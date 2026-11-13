import { describe, expect, it } from 'vitest';
import { applyAction, type RunState } from '../../src/engine';
import { checkInvariants, checkTransition } from '../../src/sim/invariants';
import { makeEnv } from '../fixtures/content';

const codes = (vs: { code: string }[]) => vs.map((v) => v.code);

/** 干净的开局状态（plan 或 event 阶段，视内容而定） */
function fresh() {
  const env = makeEnv({ items: { can: 3, bottle: 3 } });
  return { content: env.content, run: env.run };
}

/** 复制一份并改坏 */
function broken(mutate: (r: RunState) => void) {
  const { content, run } = fresh();
  const r = structuredClone(run);
  mutate(r);
  return checkInvariants(content, r);
}

describe('checkInvariants', () => {
  it('正常开局与一整局的每一步都没有违规', () => {
    const { content, run } = fresh();
    expect(checkInvariants(content, run)).toEqual([]);
    let state = run;
    for (let i = 0; i < 60 && state.phase !== 'ended'; i++) {
      const action =
        state.phase === 'event'
          ? state.pendingEvent?.result
            ? ({ type: 'continueEvent' } as const)
            : ({
                type: 'chooseEventOption',
                choiceId: content.events.get(state.pendingEvent!.eventId)!.choices[0].id,
              } as const)
          : ({ type: 'endDay' } as const);
      const res = applyAction(state, action, content);
      expect(res.error).toBeUndefined();
      expect(checkInvariants(content, res.state)).toEqual([]);
      expect(checkTransition(state, res.state)).toEqual([]);
      state = res.state;
    }
  });

  it('属性越界 / NaN / 缺失', () => {
    expect(codes(broken((r) => (r.characters.alpha.stats.food = 101)))).toContain('stat.range');
    expect(codes(broken((r) => (r.characters.alpha.stats.food = -1)))).toContain('stat.range');
    expect(codes(broken((r) => (r.characters.alpha.stats.food = NaN)))).toContain('stat.nan');
    expect(codes(broken((r) => delete r.characters.alpha.stats.food))).toContain('stat.missing');
    expect(codes(broken((r) => (r.characters.alpha.stats.ghost = 1)))).toContain('stat.unknown');
  });

  it('库存：负数 / 小数 / 未知物品', () => {
    expect(codes(broken((r) => (r.inventory.can = -1)))).toContain('inventory.count');
    expect(codes(broken((r) => (r.inventory.can = 1.5)))).toContain('inventory.count');
    expect(codes(broken((r) => (r.inventory.nope = 1)))).toContain('inventory.unknown');
  });

  it('队伍与角色状态不一致', () => {
    expect(codes(broken((r) => r.party.push('beta')))).toContain('party.duplicate');
    expect(codes(broken((r) => r.party.push('gamma')))).toContain('party.missing-state');
    expect(codes(broken((r) => delete (r as RunState).characters.beta))).toContain(
      'party.missing-state',
    );
    expect(codes(broken((r) => (r.party = ['alpha'])))).toContain('party.orphan-state');
  });

  it('状态：未知 / 重复', () => {
    expect(
      codes(broken((r) => r.characters.alpha.statuses.push({ id: 'nope', since: 1 }))),
    ).toContain('status.unknown');
    expect(
      codes(
        broken((r) => {
          r.characters.alpha.statuses.push({ id: 'sick', since: 1 }, { id: 'sick', since: 1 });
        }),
      ),
    ).toContain('status.duplicate');
  });

  it('外出：away 与 expedition 必须对得上，且不能过期', () => {
    expect(codes(broken((r) => (r.characters.alpha.where = 'away')))).toContain(
      'expedition.orphan-away',
    );
    expect(
      codes(
        broken((r) => {
          r.expedition = { charId: 'alpha', locationId: 'shop', carry: [], returnDay: r.day + 1 };
        }),
      ),
    ).toContain('expedition.away-mismatch');
    const ok = broken((r) => {
      r.characters.alpha.where = 'away';
      r.expedition = { charId: 'alpha', locationId: 'shop', carry: [], returnDay: r.day + 1 };
    });
    expect(ok).toEqual([]);
    expect(
      codes(
        broken((r) => {
          r.characters.alpha.where = 'away';
          r.expedition = { charId: 'alpha', locationId: 'nope', carry: [], returnDay: r.day - 1 };
        }),
      ),
    ).toEqual(expect.arrayContaining(['expedition.unknown-location', 'expedition.overdue']));
    expect(
      codes(
        broken((r) => {
          r.characters.alpha.where = 'dead';
          r.plan.expedition = { charId: 'alpha', locationId: 'shop', carry: [] };
        }),
      ),
    ).toContain('plan.expedition-char');
  });

  it('阶段与事件', () => {
    expect(codes(broken((r) => ((r.phase = 'ended'), (r.ending = null))))).toContain(
      'phase.ended-no-ending',
    );
    expect(codes(broken((r) => (r.ending = { id: 'nope', day: 1 })))).toContain('ending.unknown');
    expect(
      codes(
        broken((r) => {
          r.phase = 'event';
          r.pendingEvent = null;
        }),
      ),
    ).toContain('phase.event-no-pending');
    expect(
      codes(
        broken((r) => {
          r.phase = 'plan';
          r.pendingEvent = { eventId: 'knock', roles: {} };
        }),
      ),
    ).toContain('phase.plan-has-pending');
    expect(
      codes(broken((r) => r.eventQueue.push({ eventId: 'nope', day: 1, roles: {} }))),
    ).toContain('queue.unknown-event');
    expect(codes(broken((r) => (r.weather = { id: 'nope', daysLeft: 1 })))).toContain(
      'weather.unknown',
    );
    expect(codes(broken((r) => (r.day = 0)))).toContain('day.range');
    expect(codes(broken((r) => (r.rng = -5)))).toContain('rng.invalid');
  });

  it('没有活人但对局没结束：event 阶段是警告，plan 阶段是错误', () => {
    const killAll = (r: RunState) => {
      for (const c of Object.values(r.characters)) c.where = 'dead';
    };
    const { content, run } = fresh();
    const planState = structuredClone(run);
    killAll(planState);
    planState.phase = 'plan';
    planState.pendingEvent = null;
    const plan = checkInvariants(content, planState).find((v) => v.code === 'phase.plan-no-alive');
    expect(plan?.severity).toBe('error');

    const eventState = structuredClone(run);
    killAll(eventState);
    eventState.phase = 'event';
    eventState.pendingEvent = { eventId: 'knock', roles: {} };
    const ev = checkInvariants(content, eventState).find((v) => v.code === 'phase.event-no-alive');
    expect(ev?.severity).toBe('warning');

    // 事件已选完、正在展示结果时全员死亡是合法的
    const showingResult = structuredClone(eventState);
    showingResult.pendingEvent = {
      eventId: 'knock',
      roles: {},
      result: { choiceId: 'open', text: '……' },
    };
    expect(codes(checkInvariants(content, showingResult))).not.toContain('phase.event-no-alive');
  });
});

describe('checkTransition', () => {
  const pair = (mutate: (r: RunState) => void) => {
    const { run } = fresh();
    const after = structuredClone(run);
    mutate(after);
    return checkTransition(run, after);
  };

  it('不复活、不回退、不跳天', () => {
    const { run } = fresh();
    const dead = structuredClone(run);
    dead.characters.alpha.where = 'dead';
    const revived = structuredClone(dead);
    revived.characters.alpha.where = 'shelter';
    expect(codes(checkTransition(dead, revived))).toContain('trans.revive');

    expect(codes(pair((r) => (r.day += 2)))).toContain('trans.day-jump');
    expect(codes(pair((r) => (r.day = 0)))).toContain('trans.day-regress');
    expect(codes(pair((r) => r.party.reverse()))).toContain('trans.party-changed');
    expect(codes(pair((r) => (r.seed = 'other')))).toContain('trans.identity');
    expect(codes(pair((r) => (r.unlocked = [])))).toContain('trans.unlock-regress');
  });

  it('计数器与历史只增不减，结局不可更改', () => {
    const { run } = fresh();
    const a = structuredClone(run);
    a.counters.events = 3;
    a.history['event:x'] = { count: 2, lastDay: 1 };
    a.ending = { id: 'wiped', day: 1 };
    const b = structuredClone(a);
    b.counters.events = 2;
    b.history['event:x'] = { count: 1, lastDay: 1 };
    b.ending = { id: 'other', day: 1 };
    expect(codes(checkTransition(a, b))).toEqual(
      expect.arrayContaining([
        'trans.counter-regress',
        'trans.history-regress',
        'trans.ending-changed',
      ]),
    );
  });
});
