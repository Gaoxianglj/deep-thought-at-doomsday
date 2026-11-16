import { describe, expect, it } from 'vitest';
import { applyAction, newRun, type RunState } from '../../src/engine';
import {
  checkSetup,
  describeInfo,
  describeState,
  describeStep,
  loadRun,
  parseCommand,
  runCommand,
  type PlaySession,
  type PlaySetup,
} from '../../src/sim/play';
import { createReplayRecorder, formatReplay } from '../../src/sim/replay';
import { makeContent } from '../fixtures/content';

const content = makeContent((db) => {
  db.maps[0].eventDailyChance = 0.7;
  for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  db.config.tagNames = { food: '食物', water: '饮水' };
  db.locations[0].requiresHint = '先熬过几天';
  for (const i of db.items) if (i.id === 'medkit') i.desc = '治疗生病并恢复健康。';
});
const setup: PlaySetup = {
  seed: 'play1',
  mapId: 'bunker',
  difficultyId: 'normal',
  party: ['alpha', 'beta'],
  items: { can: 3, bottle: 4, medkit: 1 },
  unlocked: ['alpha', 'beta'],
};
const fresh = (): RunState => newRun(content, setup);
const asPlan = (run: RunState): RunState => {
  let r = run;
  while (r.phase === 'event') {
    const view = r.pendingEvent!;
    const act = view.result
      ? ({ type: 'continueEvent' } as const)
      : ({
          type: 'chooseEventOption',
          choiceId: content.events.get(view.eventId)!.choices[0].id,
        } as const);
    r = applyAction(r, act, content).state;
  }
  return r;
};

describe('describeInfo / checkSetup', () => {
  it('列出伙伴、物资、点数与开局命令', () => {
    const text = describeInfo(content, 'bunker', 'normal', ['alpha', 'beta']);
    expect(text).toContain('阿尔法[alpha]');
    expect(text).toContain('罐头[can]');
    expect(text).toContain('总点数 20');
    expect(text).toContain('new --party');
    expect(text).not.toContain('伽马'); // 没解锁的不列
  });

  it('开局设置不合法时给出人话错误', () => {
    const bad = checkSetup(content, { ...setup, items: { can: 99 } }, (c) => `E:${c}`);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((e) => e.startsWith('E:'))).toBe(true);
    expect(checkSetup(content, setup)).toEqual([]);
  });
});

describe('parseCommand', () => {
  const plan = asPlan(fresh());

  it('名字或 id 都能认；大小写不敏感', () => {
    const byName = parseCommand(content, plan, 'ration 阿尔法 食物 罐头');
    const byId = parseCommand(content, plan, 'RATION alpha food can');
    expect(byName).toEqual({ type: 'setRation', charId: 'alpha', tag: 'food', itemId: 'can' });
    expect(byId).toEqual(byName);
  });

  it('none 清空配给；use / go / end / cancel', () => {
    expect(parseCommand(content, plan, 'ration beta food none')).toEqual({
      type: 'setRation',
      charId: 'beta',
      tag: 'food',
      itemId: null,
    });
    expect(parseCommand(content, plan, 'use 药箱 阿尔法')).toEqual({
      type: 'useItem',
      itemId: 'medkit',
      charId: 'alpha',
    });
    expect(parseCommand(content, plan, 'go alpha shop can,lock')).toMatchObject({
      type: 'planExpedition',
      charId: 'alpha',
      locationId: 'shop',
      carry: ['can', 'lock'],
    });
    expect(parseCommand(content, plan, 'end')).toEqual({ type: 'endDay' });
    expect(parseCommand(content, plan, 'cancel')).toEqual({ type: 'cancelExpedition' });
  });

  it('解析失败返回说明而不是抛异常', () => {
    for (const bad of [
      '',
      'dance',
      'ration',
      'ration nobody food can',
      'ration alpha 金属 can',
      'go alpha nowhere',
      'use ghost alpha',
      'choose',
    ]) {
      const r = parseCommand(content, plan, bad);
      expect(typeof r).toBe('string');
    }
  });

  it('choose 支持序号与选项 id', () => {
    const event = fresh();
    expect(event.phase).toBe('event');
    const first = content.events.get(event.pendingEvent!.eventId)!.choices[0].id;
    expect(parseCommand(content, event, 'choose 1')).toEqual({
      type: 'chooseEventOption',
      choiceId: first,
    });
    expect(parseCommand(content, event, `choose ${first}`)).toEqual({
      type: 'chooseEventOption',
      choiceId: first,
    });
    expect(typeof parseCommand(content, event, 'choose 99')).toBe('string');
  });
});

describe('runCommand', () => {
  it('引擎拒绝时返回中文原因，局面不变', () => {
    const event = fresh();
    const r = runCommand(content, event, 'end', (c) => `拒绝:${c}`);
    expect(r).toEqual({ error: '拒绝:notPlanPhase（有事件在等你做选择：先 act choose <序号>）' });
  });

  it('选完事件、结果还没看完时提示 continue', () => {
    const chosen = runCommand(content, fresh(), 'choose 1');
    if ('error' in chosen) throw new Error(chosen.error);
    const r = runCommand(content, chosen.run, 'end', (c) => `拒绝:${c}`);
    expect(r).toEqual({ error: '拒绝:notPlanPhase（有事件结果还没看完：先 act continue）' });
  });

  it('合法命令返回新状态与动作', () => {
    const plan = asPlan(fresh());
    const r = runCommand(content, plan, 'ration alpha food can');
    expect('run' in r && r.run.plan.rations.alpha.food).toBe('can');
  });
});

describe('describeState / describeStep', () => {
  it('事件阶段：显示事件与选项；选完后显示结果与 continue', () => {
    const run = fresh();
    const text = describeState(content, run);
    expect(text).toContain('◆ 事件');
    expect(text).toContain('1)');
    expect(text).toContain('choose <序号>');
    const chosen = applyAction(
      run,
      {
        type: 'chooseEventOption',
        choiceId: content.events.get(run.pendingEvent!.eventId)!.choices[0].id,
      },
      content,
    ).state;
    expect(describeState(content, chosen)).toContain('continue');
  });

  it('库存里的物品附带说明', () => {
    expect(describeState(content, fresh())).toContain('药箱: 治疗生病并恢复健康。');
  });

  it('计划阶段：配给提醒、用标签中文名、地点信息', () => {
    const plan = asPlan(fresh());
    const text = describeState(content, plan);
    expect(text).toContain('不设置 = 今晚不吃不喝');
    expect(text).toContain('ration <角色> 食物');
    expect(text).toContain('商店[shop]');
    expect(text).toContain('危险 1/5');
    expect(text).toContain('use <物品> <角色>');
    expect(text).toContain('end');
    // 不该泄露战利品表与精确概率
    expect(text).not.toContain('lootRolls');
    expect(text).not.toContain('0.1');
  });

  it('describeStep 带上本步新增的日志', () => {
    const plan = asPlan(fresh());
    const after = applyAction(plan, { type: 'endDay' }, content).state;
    const text = describeStep(content, plan, after);
    expect(text).toContain(`第 ${after.day} 天`);
  });

  it('结局阶段：显示结局名与提示', () => {
    let run = asPlan(fresh());
    for (let i = 0; i < 80 && run.phase !== 'ended'; i++) {
      run = asPlan(applyAction(run, { type: 'endDay' }, content).state);
    }
    expect(run.phase).toBe('ended');
    const text = describeState(content, run);
    expect(text).toContain('★ 结局');
    expect(text).toContain('report');
  });
});

describe('会话：由开局 + 动作重建', () => {
  it('重放得到与直接推进完全相同的状态', () => {
    const session: PlaySession = { version: 1, setup, actions: [], notes: [] };
    let run = fresh();
    for (let i = 0; i < 40 && run.phase !== 'ended'; i++) {
      const cmd =
        run.phase === 'event'
          ? run.pendingEvent?.result
            ? 'continue'
            : 'choose 1'
          : 'ration alpha food can; ration alpha water bottle; end';
      for (const c of cmd.split(';')) {
        const r = runCommand(content, run, c.trim());
        if ('error' in r) continue; // 库存耗尽等情况下允许跳过
        session.actions.push(r.action);
        run = r.run;
      }
    }
    expect(session.actions.length).toBeGreaterThan(5);
    expect(loadRun(content, session)).toEqual(run);
  });

  it('动作无法重放时报出明确错误', () => {
    const session: PlaySession = {
      version: 1,
      setup,
      actions: [{ type: 'endDay' }],
      notes: [],
    };
    // 开局是事件阶段，endDay 不合法
    expect(() => loadRun(content, session)).toThrow('第 1 个动作重放失败');
  });

  it('report：用记录器 + formatReplay 能导出过程', () => {
    const rec = createReplayRecorder(content);
    let run = fresh();
    rec.start(run);
    const r = runCommand(content, run, 'choose 1');
    if ('error' in r) throw new Error(r.error);
    rec.step({ index: 0, before: run, action: r.action, after: r.run });
    run = r.run;
    const text = formatReplay(
      content,
      {
        result: { ending: 'ongoing', days: run.day, survivors: 2, violations: [] },
        start: rec.getStart(),
        steps: rec.steps,
      },
      '== H ==',
    );
    expect(text).toContain('◆ 事件');
    expect(text).toContain('还没有结束');
  });
});

describe('describeState 的备忘', () => {
  it('有备忘时列出（按 order，模板已渲染）；条件不成立的不列', () => {
    const withNotes = makeContent((db) => {
      db.notes = [
        { id: 'later', text: '第二条', order: 2 },
        { id: 'goal', text: '目标：第 {day} 天', order: 1 },
        { id: 'hidden', text: '不该出现', when: { flag: 'never_set' } },
      ];
    });
    const text = describeState(withNotes, newRun(withNotes, setup));
    expect(text).toContain('备忘');
    expect(text.indexOf('目标：第 1 天')).toBeLessThan(text.indexOf('第二条'));
    expect(text).not.toContain('不该出现');
  });

  it('没有备忘时不出现备忘段', () => {
    expect(describeState(content, newRun(content, setup))).not.toContain('备忘');
  });
});

describe('会话容错与配给超额', () => {
  it('tryLoadRun：重放失败时返回失败前状态与步序号', async () => {
    const { tryLoadRun, staleSessionMessage } = await import('../../src/sim/play');
    const session: PlaySession = {
      version: 1,
      setup,
      actions: [{ type: 'cancelExpedition' }, { type: 'cancelExpedition' }],
      notes: [],
    };
    const res = tryLoadRun(content, session);
    expect(res.failedAt).toBeDefined();
    expect(res.run).toBeDefined();
    expect(staleSessionMessage(2)).toContain('第 2 步');
    expect(staleSessionMessage(0)).toContain('重新开局');
  });
  it('配给分配超过库存时 describeState 提醒', () => {
    const run = asPlan(fresh());
    const r1 = runCommand(content, run, 'ration alpha food can');
    expect('run' in r1).toBe(true);
    const lowStock: RunState = structuredClone((r1 as { run: RunState }).run);
    lowStock.inventory.can = 0;
    expect(describeState(content, lowStock)).toContain('配给超额');
  });
});
