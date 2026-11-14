import { describe, expect, it } from 'vitest';
import {
  BOTS,
  DEFAULT_POLICY,
  POLICY_PRESETS,
  fuzzBot,
  makePolicyBot,
  policySpec,
  resolveBot,
  sensibleBot,
  turtleBot,
} from '../../src/sim/bots';
import { simulateMany, simulateRun } from '../../src/sim/simulate';
import { makeContent } from '../fixtures/content';

const lively = () =>
  makeContent((db) => {
    db.maps[0].eventDailyChance = 0.6;
    for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  });
const base = { mapId: 'bunker', difficultyId: 'normal' };

describe('resolveBot', () => {
  it('预设名直接取到对应 bot', () => {
    for (const name of Object.keys(BOTS)) expect(resolveBot(name)).toBe(BOTS[name]);
  });

  it('带参数覆盖：生成新 bot，名字就是描述串', () => {
    const bot = resolveBot('sensible:toolReserve=0.3,exploreWhenSafe=false,lowSupplyDays=5');
    expect(typeof bot).toBe('object');
    expect((bot as { name: string }).name).toBe(
      'sensible:toolReserve=0.3,exploreWhenSafe=false,lowSupplyDays=5',
    );
  });

  it('错误输入返回说明而不是抛异常', () => {
    expect(resolveBot('nope')).toContain('未知策略');
    expect(resolveBot('sensible:nope=1')).toContain('未知策略参数');
    expect(resolveBot('sensible:toolReserve=abc')).toContain('需要数字');
    expect(resolveBot('random:toolReserve=1')).toContain('只有策略型');
  });

  it('policySpec 与 resolveBot 互为逆运算', () => {
    const spec = policySpec('turtle', {
      toolReserve: 0.4,
      exploreWhenSafe: true,
      lowSupplyDays: 2,
    });
    expect(spec).toBe('turtle:toolReserve=0.4,exploreWhenSafe=true,lowSupplyDays=2');
    expect(typeof resolveBot(spec)).toBe('object');
  });
});

describe('策略 bot 没有跨局的全局状态', () => {
  it('交错执行其他局 / 其他 bot，同种子结果不变', () => {
    const content = lively();
    for (const bot of [sensibleBot, turtleBot, makePolicyBot('x', { dangerWeight: 0 })]) {
      const a = simulateRun(content, { ...base, seed: 'iso', bot });
      simulateRun(content, { ...base, seed: 'noise-1', bot: sensibleBot });
      simulateRun(content, { ...base, seed: 'noise-2', bot: turtleBot });
      expect(simulateRun(content, { ...base, seed: 'iso', bot })).toEqual(a);
    }
  });

  it('sensible 预设 = 默认策略参数', () => {
    expect(POLICY_PRESETS.sensible).toEqual({});
    const content = lively();
    const explicit = makePolicyBot('sensible', { ...DEFAULT_POLICY });
    for (let i = 0; i < 5; i++) {
      expect(simulateRun(content, { ...base, seed: `p${i}`, bot: explicit })).toEqual(
        simulateRun(content, { ...base, seed: `p${i}`, bot: sensibleBot }),
      );
    }
  });
});

describe('各风格都能正常打完且无被拒绝动作', () => {
  it('sensible / turtle / explorer', () => {
    const content = lively();
    for (const name of ['sensible', 'turtle', 'explorer']) {
      const s = simulateMany(content, { ...base, bot: BOTS[name], runs: 25, maxDays: 80 });
      expect(s.stuck).toBe(0);
      expect(s.failures).toEqual([]);
      expect(s.rejectedCodes).toEqual({});
    }
  });

  it('turtle 只在物资告急时才外出：探索型参数下外出更少', () => {
    const content = makeContent((db) => {
      db.maps[0].eventDailyChance = 0;
      for (const s of db.stats) s.dailyDelta = Math.round(s.dailyDelta / 4); // 慢衰减，多数时间物资充足
    });
    const trips = (bot: typeof sensibleBot) =>
      simulateMany(content, { ...base, bot, runs: 20, maxDays: 40 }).analytics.expeditions.reduce(
        (n, e) => n + e.departed,
        0,
      );
    expect(trips(turtleBot)).toBeLessThanOrEqual(trips(sensibleBot));
  });
});

describe('通关率', () => {
  it('winRate = kind 为 rescue / selfRescue 的结局占比', () => {
    const content = lively();
    const s = simulateMany(content, { ...base, bot: sensibleBot, runs: 30 });
    const wins = s.endings
      .filter((e) => ['rescue', 'selfRescue'].includes(content.endings.get(e.id)?.kind ?? ''))
      .reduce((n, e) => n + e.count, 0);
    expect(s.winRate).toBeCloseTo(wins / 30, 10);
  });
});

describe('fuzzBot', () => {
  it('夹具内容：不崩溃、不卡死、被拒绝时不改状态，且确实触发了各种错误码', () => {
    const content = lively();
    const s = simulateMany(content, { ...base, bot: fuzzBot, runs: 60, maxDays: 40 });
    expect(s.failures).toEqual([]);
    expect(s.crashed).toBe(0);
    expect(s.stuck).toBe(0);
    const codes = Object.keys(s.rejectedCodes);
    for (const must of ['notPlanPhase', 'noPendingEvent', 'unknownChoice']) {
      expect(codes).toContain(must);
    }
  });
});
