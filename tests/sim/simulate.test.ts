import { describe, expect, it } from 'vitest';
import { buildContent } from '../../src/engine';
import { contentDB } from '../../src/data';
import { randomBot, sensibleBot } from '../../src/sim/bots';
import { formatSummary, simulateMany, simulateRun } from '../../src/sim/simulate';
import { makeContent } from '../fixtures/content';

const lively = () =>
  makeContent((db) => {
    db.maps[0].eventDailyChance = 0.6;
    for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  });
const base = { mapId: 'bunker', difficultyId: 'normal' };

describe('simulateRun', () => {
  it('同种子同结果（深度相等）', () => {
    const content = lively();
    for (const bot of [sensibleBot, randomBot]) {
      const a = simulateRun(content, { ...base, seed: 'x', bot });
      const b = simulateRun(content, { ...base, seed: 'x', bot });
      expect(a).toEqual(b);
    }
  });

  it('不同种子结果会不同', () => {
    const content = lively();
    const results = Array.from({ length: 12 }, (_, i) =>
      JSON.stringify(simulateRun(content, { ...base, seed: `s${i}`, bot: randomBot })),
    );
    expect(new Set(results).size).toBeGreaterThan(1);
  });

  it('每局都以结局或 timeout 结束且不 stuck；sensibleBot 无被拒绝动作', () => {
    const content = lively();
    for (let i = 0; i < 30; i++) {
      for (const bot of [sensibleBot, randomBot]) {
        const r = simulateRun(content, { ...base, seed: `k${i}`, bot });
        expect(r.ending).not.toBe('stuck');
        expect(content.endings.has(r.ending) || r.ending === 'timeout').toBe(true);
        if (bot === sensibleBot) expect(r.rejected).toBe(0);
      }
    }
  });

  it('maxDays 生效', () => {
    const content = makeContent((db) => {
      // 属性不衰减，永远不会死
      for (const s of db.stats) s.dailyDelta = 0;
    });
    const r = simulateRun(content, { ...base, seed: 'm', bot: sensibleBot, maxDays: 7 });
    expect(r.ending).toBe('timeout');
    expect(r.days).toBe(7);
    expect(r.survivors).toBeGreaterThan(0);
  });

  it('连续被拒绝判定 stuck 并记录错误码', () => {
    const content = lively();
    const bad = { ...sensibleBot, name: 'bad', act: () => ({ type: 'continueEvent' }) as const };
    const r = simulateRun(content, { ...base, seed: 'b', bot: bad });
    expect(r.ending).toBe('stuck');
    expect(r.lastError).toBe('noEventResult');
    expect(r.rejected).toBe(50);
  });

  it('开局选择不合法时记为 stuck', () => {
    const content = lively();
    const bad = { ...sensibleBot, name: 'bad', setup: () => ({ party: [], items: {} }) };
    const r = simulateRun(content, { ...base, seed: 'b', bot: bad });
    expect(r.ending).toBe('stuck');
    expect(r.lastError).toContain('setup:');
  });
});

describe('simulateMany / formatSummary', () => {
  const content = lively();
  const summary = simulateMany(content, {
    ...base,
    bot: sensibleBot,
    runs: 40,
    seedPrefix: 'many',
  });

  it('结局百分比之和为 100，统计量一致', () => {
    expect(summary.runs).toBe(40);
    const total = summary.endings.reduce((a, e) => a + e.pct, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(summary.endings.reduce((a, e) => a + e.count, 0)).toBe(40);
    expect(summary.days.min).toBeLessThanOrEqual(summary.days.median);
    expect(summary.days.median).toBeLessThanOrEqual(summary.days.max);
    expect(summary.days.p10).toBeLessThanOrEqual(summary.days.p90);
  });

  it('从未触发事件列表正确', () => {
    const triggered = new Set(summary.events.map((e) => e.id));
    expect(triggered.has('fever')).toBe(true);
    // break_in / welcome 只能被队列或事件链触发，这里仍可能触发；用全部事件互补校验
    const all = content.db.events.map((e) => e.id);
    expect([...summary.neverTriggered].sort()).toEqual(
      all.filter((id) => !triggered.has(id)).sort(),
    );
    const silent = simulateMany(makeContent(), { ...base, bot: sensibleBot, runs: 5 });
    expect(silent.neverTriggered.sort()).toEqual(
      makeContent()
        .db.events.map((e) => e.id)
        .sort(),
    );
    expect(silent.events).toEqual([]);
  });

  it('角色出场率与存活率在 [0,1]，解锁率合理', () => {
    for (const c of summary.characters) {
      expect(c.appearRate).toBeGreaterThan(0);
      expect(c.appearRate).toBeLessThanOrEqual(1);
      expect(c.survivalRate).toBeGreaterThanOrEqual(0);
      expect(c.survivalRate).toBeLessThanOrEqual(1);
    }
    for (const u of summary.unlocks) expect(u.rate).toBeLessThanOrEqual(1);
  });

  it('formatSummary 输出包含结局名称', () => {
    const text = formatSummary(summary, content);
    for (const e of summary.endings) {
      const label =
        e.id === 'timeout' ? '超时' : e.id === 'stuck' ? '卡死' : content.endings.get(e.id)?.name;
      expect(text).toContain(label);
    }
    expect(text).toContain('地堡');
    expect(text).toContain('普通');
  });
});

describe('正式数据冒烟', () => {
  const real = buildContent(contentDB);
  const ready = real.db.maps.length > 0 && real.db.characters.length > 0;
  it.skipIf(!ready)('20 局不 stuck、不抛异常', () => {
    for (const difficulty of real.db.difficulties) {
      const s = simulateMany(real, {
        mapId: real.db.maps[0].id,
        difficultyId: difficulty.id,
        bot: sensibleBot,
        runs: 20,
        maxDays: 120,
      });
      expect(s.stuck).toBe(0);
      expect(s.runs).toBe(20);
    }
  });

  it.skipIf(!ready)('sensibleBot 200 局（普通难度）至少出现 2 种不同结局，且无被拒绝动作', () => {
    const s = simulateMany(real, {
      mapId: real.db.maps[0].id,
      difficultyId: real.db.difficulties[1]?.id ?? real.db.difficulties[0].id,
      bot: sensibleBot,
      runs: 200,
    });
    expect(s.stuck).toBe(0);
    expect(s.endings.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(s.rejectedCodes)).toEqual([]);
  });

  it.skipIf(!ready)('同种子同结果（正式数据，含外出与携带）', () => {
    const o = { mapId: real.db.maps[0].id, difficultyId: real.db.difficulties[0].id };
    const a = simulateRun(real, { ...o, seed: 'repeat', bot: sensibleBot });
    simulateRun(real, { ...o, seed: 'other', bot: sensibleBot });
    expect(simulateRun(real, { ...o, seed: 'repeat', bot: sensibleBot })).toEqual(a);
  });
});
