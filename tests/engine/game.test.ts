import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getArtState,
  getEventView,
  newRun,
  RunStateSchema,
  validateSetup,
  type Action,
  type Env,
  type RunState,
} from '../../src/engine';
import { applyEffects } from '../../src/engine/effects';
import { startEvent, writeDiary } from '../../src/engine/events';
import { makeContent, makeEnv } from '../fixtures/content';

/** 连续执行动作，任何一步出错即失败 */
function play(env: Env, ...actions: Action[]): RunState {
  for (const a of actions) {
    const r = applyAction(env.run, a, env.content);
    expect(r.error, JSON.stringify(a)).toBeUndefined();
    env.run = r.state;
  }
  return env.run;
}

describe('开局', () => {
  it('校验点数、队伍与解锁', () => {
    const content = makeContent();
    const base = {
      seed: 's',
      mapId: 'bunker',
      difficultyId: 'normal',
      party: ['alpha'],
      items: {},
      unlocked: ['alpha', 'beta'],
    };
    expect(validateSetup(content, base)).toEqual([]);
    expect(validateSetup(content, { ...base, party: ['gamma'] })).toContain('characterLocked');
    expect(validateSetup(content, { ...base, party: [] })).toContain('partySize');
    expect(validateSetup(content, { ...base, items: { can: 11 } })).toEqual(
      expect.arrayContaining(['itemOverMax', 'overBudget']),
    );
    expect(validateSetup(content, { ...base, items: { can: 10 } })).toEqual([]);
    expect(() => newRun(content, { ...base, mapId: 'nope' })).toThrow();
  });
  it('初始状态符合存档 schema，同种子可复现', () => {
    const a = makeEnv({ items: { can: 4, bottle: 4 }, seed: 'abc' });
    const b = makeEnv({ items: { can: 4, bottle: 4 }, seed: 'abc' });
    expect(RunStateSchema.safeParse(a.run).success).toBe(true);
    for (let i = 0; i < 6; i++) {
      play(a, { type: 'endDay' });
      play(b, { type: 'endDay' });
    }
    expect(a.run).toEqual(b.run);
    expect(JSON.parse(JSON.stringify(a.run))).toEqual(a.run); // 可 JSON 往返
  });
});

describe('按天循环', () => {
  it('applyAction 不修改传入的状态；非法动作原样返回', () => {
    const env = makeEnv();
    const before = structuredClone(env.run);
    const r = applyAction(env.run, { type: 'endDay' }, env.content);
    expect(env.run).toEqual(before);
    expect(r.state.day).toBe(2);
    const bad = applyAction(env.run, { type: 'continueEvent' }, env.content);
    expect(bad.error).toBe('noEventResult');
    expect(bad.state).toBe(env.run);
  });
  it('配给被消耗并生效，属性每日衰减，道具修正增益', () => {
    const env = makeEnv({ items: { can: 2, bottle: 1, spice: 1 } });
    play(
      env,
      { type: 'setRation', charId: 'alpha', tag: 'food', itemId: 'can' },
      { type: 'setRation', charId: 'beta', tag: 'water', itemId: 'bottle' },
      { type: 'endDay' },
    );
    expect(env.run.inventory).toEqual({ can: 1, spice: 1 });
    expect(env.run.characters.alpha.stats).toMatchObject({ food: 90, water: 30 }); // 先吃后衰减：50 + 40×1.5 钳到 100，再 -10
    expect(env.run.characters.beta.stats).toMatchObject({ food: 40, water: 70 });
    expect(env.run.plan.rations).toEqual({});
    expect(
      applyAction(
        env.run,
        { type: 'setRation', charId: 'alpha', tag: 'food', itemId: 'bottle' },
        env.content,
      ).error,
    ).toBe('itemWrongTag');
  });
  it('状态自动进入/退出，饥饿扣健康直至死亡，全灭触发结局', () => {
    const env = makeEnv({ party: ['beta'] });
    play(env, { type: 'endDay' }, { type: 'endDay' }, { type: 'endDay' }); // food 50→20
    const beta = () => env.run.characters.beta;
    expect(beta().statuses.map((s) => s.id)).toEqual(['hungry']);
    expect(beta().stats.hp).toBe(50); // 当晚才进入饥饿，下一晚开始扣
    play(env, { type: 'endDay' });
    expect(beta().stats.hp).toBe(40);
    applyEffects(env, {}, [{ stat: 'food', of: { id: 'beta' }, set: 90 }]);
    play(env, { type: 'endDay' });
    expect(beta().statuses).toEqual([]);
    applyEffects(env, {}, [
      { stat: 'food', of: { id: 'beta' }, set: 0 },
      { stat: 'hp', of: { id: 'beta' }, set: 5 },
    ]);
    play(env, { type: 'endDay' }, { type: 'endDay' });
    expect(beta().where).toBe('dead');
    expect(env.run.phase).toBe('ended');
    expect(env.run.ending?.id).toBe('wiped');
    expect(applyAction(env.run, { type: 'endDay' }, env.content).error).toBe('runEnded');
  });
  it('有持续时间的状态到期移除；手动用药；美术状态', () => {
    const env = makeEnv({ items: { medkit: 1 } });
    applyEffects(env, {}, [{ addStatus: 'sick', of: 'all' }]);
    expect(getArtState(env.run, env.content, 'beta')).toBe('sick');
    play(env, { type: 'useItem', itemId: 'medkit', charId: 'alpha' });
    expect(env.run.characters.alpha.statuses).toEqual([]);
    expect(env.run.characters.alpha.stats.hp).toBe(70);
    expect(
      applyAction(env.run, { type: 'useItem', itemId: 'medkit', charId: 'beta' }, env.content)
        .error,
    ).toBe('itemMissing');
    play(env, { type: 'endDay' }, { type: 'endDay' });
    expect(env.run.characters.beta.statuses.map((s) => s.id)).toEqual(['sick']);
    play(env, { type: 'endDay' });
    expect(env.run.characters.beta.statuses.map((s) => s.id)).toEqual(['hungry']); // 生病到期，同晚饿了
    expect(getArtState(env.run, env.content, 'beta')).toBe('normal');
  });
  it('标记满足即达成自救结局（优先级高于其他）', () => {
    const env = makeEnv();
    applyEffects(env, {}, [{ setFlag: 'generator', value: true }]);
    play(env, { type: 'endDay' });
    expect(env.run.ending).toEqual({ id: 'self_rescue', day: 1 });
    expect(env.run.phase).toBe('ended');
  });
  it('角色特性：饿了进入降智，衰减减半并闯祸；吃饱后退出', () => {
    const env = makeEnv({ items: { can: 5 } });
    applyEffects(env, {}, [{ stat: 'food', of: { id: 'alpha' }, set: 35 }]);
    play(env, { type: 'endDay' }); // 25 → 当晚进入降智
    expect(getArtState(env.run, env.content, 'alpha')).toBe('silly');
    play(env, { type: 'endDay' }); // 衰减减半 25→20，并偷吃一个
    expect(env.run.characters.alpha.stats.food).toBe(20);
    expect(env.run.inventory.can).toBe(4);
    play(
      env,
      { type: 'setRation', charId: 'alpha', tag: 'food', itemId: 'can' },
      { type: 'endDay' },
    );
    expect(env.run.characters.alpha.statuses.map((s) => s.id)).not.toContain('silly');
  });
});

describe('外出', () => {
  it('校验、出发、按期返回并归还携带物', () => {
    const env = makeEnv({ items: { lock: 1 } });
    expect(
      applyAction(
        env.run,
        { type: 'planExpedition', charId: 'alpha', locationId: 'shop', carry: ['lock', 'lock'] },
        env.content,
      ).error,
    ).toBe('tooManyItems');
    applyEffects(env, {}, [{ addStatus: 'sick', of: { id: 'beta' } }]);
    expect(
      applyAction(
        env.run,
        { type: 'planExpedition', charId: 'beta', locationId: 'shop', carry: [] },
        env.content,
      ).error,
    ).toBe('charBlocked');
    play(
      env,
      { type: 'planExpedition', charId: 'alpha', locationId: 'shop', carry: ['lock'] },
      { type: 'endDay' },
    );
    expect(env.run.characters.alpha.where).toBe('away');
    expect(env.run.inventory.lock).toBeUndefined();
    expect(env.run.expedition?.returnDay).toBe(3);
    expect(env.run.characters.alpha.stats.food).toBe(40); // 外出期间照常衰减
    play(env, { type: 'endDay' });
    expect(env.run.day).toBe(3);
    expect(env.run.characters.alpha.where).toBe('shelter');
    expect(env.run.inventory.lock).toBe(1);
    expect(env.run.expedition).toBeNull();
  });
});

describe('事件', () => {
  it('道具改变结果并被消耗；没有道具时走另一结果；选项可被锁', () => {
    const env = makeEnv({ items: { lock: 1, can: 1 } });
    expect(startEvent(env, 'break_in')).toBe(true);
    const view = getEventView(env)!;
    expect(view.choices.map((c) => [c.id, c.enabled, c.hint])).toEqual([
      ['hold', true, undefined],
      ['chop', false, '需要药箱'],
    ]);
    expect(
      applyAction(env.run, { type: 'chooseEventOption', choiceId: 'chop' }, env.content).error,
    ).toBe('choiceLocked');
    expect(applyAction(env.run, { type: 'endDay' }, env.content).error).toBe('notPlanPhase');
    play(env, { type: 'chooseEventOption', choiceId: 'hold' });
    expect(getEventView(env)?.result?.text).toBe('门锁撑住了。');
    expect(env.run.inventory).toEqual({ can: 1 });
    expect(
      applyAction(env.run, { type: 'chooseEventOption', choiceId: 'hold' }, env.content).error,
    ).toBe('alreadyChosen');
    play(env, { type: 'continueEvent' });
    expect(env.run.phase).toBe('plan');

    startEvent(env, 'break_in');
    play(env, { type: 'chooseEventOption', choiceId: 'hold' });
    expect(getEventView(env)?.result?.text).toBe('被抢走了 罐头。');
    expect(env.run.inventory).toEqual({});
  });
  it('遇到新伙伴：加入队伍、局外解锁、事件链沿用并绑定角色', () => {
    const env = makeEnv();
    startEvent(env, 'knock');
    play(env, { type: 'chooseEventOption', choiceId: 'open' });
    expect(env.run.party).toEqual(['alpha', 'beta', 'gamma']);
    expect(env.run.unlocked).toContain('gamma');
    play(env, { type: 'continueEvent' });
    expect(getEventView(env)).toMatchObject({
      eventId: 'welcome',
      text: '大家欢迎 伽马。',
      roles: { who: 'gamma' },
    });
    play(env, { type: 'chooseEventOption', choiceId: 'ok' }, { type: 'continueEvent' });
    expect(env.run.phase).toBe('plan');
    expect(env.run.characters.gamma.stats.hp).toBe(50);
  });
  it('queueEvent 在指定天数后的清晨必定触发', () => {
    const env = makeEnv();
    startEvent(env, 'knock');
    play(
      env,
      { type: 'chooseEventOption', choiceId: 'ignore' },
      { type: 'continueEvent' },
      { type: 'endDay' },
    );
    expect(env.run.phase).toBe('plan');
    play(env, { type: 'endDay' });
    expect(env.run.day).toBe(3);
    expect(env.run.pendingEvent?.eventId).toBe('break_in');
  });
  it('随机抽取遵守 when / once / 权重 0，角色绑不上不入池', () => {
    const env = makeEnv({}, (db) => {
      db.maps[0].eventDailyChance = 1;
      db.events.find((e) => e.id === 'fever')!.weight = 1;
      db.events.find((e) => e.id === 'fever')!.once = true;
    });
    expect(env.run.pendingEvent?.eventId).toBe('fever'); // 第 1 天清晨就抽到（唯一有权重的）
    const who = env.run.pendingEvent!.roles.self;
    play(
      env,
      { type: 'chooseEventOption', choiceId: 'ok' },
      { type: 'continueEvent' },
      { type: 'endDay' },
    );
    expect(env.run.characters[who].statuses.map((s) => s.id)).toContain('sick');
    expect(env.run.pendingEvent).toBeNull(); // once：不再出现
    expect(env.run.phase).toBe('plan');
  });
  it('事件中全员死亡：看完结果后进入结局', () => {
    const env = makeEnv({ party: ['beta'] });
    startEvent(env, 'fever');
    applyEffects(env, {}, [{ leaveParty: { id: 'beta' }, reason: 'gone', text: '{self} 走了。' }]);
    env.run.pendingEvent!.result = { choiceId: 'ok', text: '' };
    play(env, { type: 'continueEvent' });
    expect(env.run.phase).toBe('ended');
    expect(env.run.ending?.id).toBe('wiped');
  });
});

describe('避难所日记', () => {
  const diaryEnv = () => makeEnv({}, (db) => void (db.maps[0].diaryPerDay = 2));
  const diaryTexts = (env: Env) => env.run.log.filter((l) => l.kind === 'diary').map((l) => l.text);

  it('只写此刻在庇护所的人', () => {
    for (let i = 0; i < 20; i++) {
      const env = diaryEnv();
      env.run.seed = `d${i}`;
      env.run.rng = i * 7919;
      env.run.log = [];
      env.run.history = {};
      env.run.characters.alpha.where = 'away';
      writeDiary(env);
      const texts = diaryTexts(env);
      expect(texts).toEqual(['贝塔 很有活力。']); // 吵架需要两个人，绑不上
    }
  });
  it('角色条件不满足时该条目不会出现', () => {
    const env = diaryEnv();
    env.run.log = [];
    env.run.history = {};
    applyEffects(env, {}, [{ addStatus: 'hungry', of: 'all' }]);
    env.run.log = [];
    writeDiary(env);
    expect(diaryTexts(env)).toHaveLength(1);
    expect(diaryTexts(env)[0]).toMatch(/吵架了/);
  });
  it('每天清晨自动写入，且不重复抽同一条', () => {
    const env = diaryEnv();
    const texts = diaryTexts(env);
    expect(texts).toHaveLength(2);
    expect(new Set(texts).size).toBe(2);
  });
});
