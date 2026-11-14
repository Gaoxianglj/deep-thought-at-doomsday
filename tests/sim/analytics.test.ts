import { describe, expect, it } from 'vitest';
import { buildContent } from '../../src/engine';
import { contentDB } from '../../src/data';
import { randomBot, sensibleBot, type Bot } from '../../src/sim/bots';
import {
  formatSummary,
  simulateMany,
  simulateRun,
  type RunObserver,
  type RunResult,
} from '../../src/sim/simulate';
import { computeDiversity, type RunAnalytics } from '../../src/sim/analytics';
import { makeContent } from '../fixtures/content';

const lively = () =>
  makeContent((db) => {
    db.maps[0].eventDailyChance = 0.6;
    for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  });
const base = { mapId: 'bunker', difficultyId: 'normal' };

describe('崩溃处理', () => {
  it('bot.act 抛异常 → crashed，记录 stage 与 seed，不拖垮整批', () => {
    const content = lively();
    const bad: Bot = {
      ...sensibleBot,
      name: 'bad',
      act: () => {
        throw new Error('boom');
      },
    };
    const r = simulateRun(content, { ...base, seed: 'c1', bot: bad });
    expect(r.ending).toBe('crashed');
    expect(r.crash?.stage).toBe('bot');
    expect(r.crash?.message).toBe('boom');
    expect(r.lastError).toBe('crash:boom');
  });

  it('applyAction 抛异常 → crashed(engine)，带上出事的动作', () => {
    const content = lively();
    const bad: Bot = {
      ...sensibleBot,
      name: 'bad',
      act: (env, rng) =>
        env.run.phase === 'plan'
          ? // carry 缺失会让引擎在展开数组时抛 TypeError
            ({
              type: 'planExpedition',
              charId: env.run.party[0],
              locationId: 'shop',
              carry: undefined,
            } as never)
          : sensibleBot.act(env, rng),
    };
    const r = simulateRun(content, { ...base, seed: 'c2', bot: bad });
    expect(r.ending).toBe('crashed');
    expect(r.crash?.stage).toBe('engine');
    expect(r.crash?.action).toContain('planExpedition');
  });

  it('bot.setup 抛异常 → crashed(setup)', () => {
    const bad: Bot = {
      ...sensibleBot,
      name: 'bad',
      setup: () => {
        throw new Error('no setup');
      },
    };
    const r = simulateRun(lively(), { ...base, seed: 'c3', bot: bad });
    expect(r.ending).toBe('crashed');
    expect(r.crash?.stage).toBe('setup');
  });

  it('汇总里统计崩溃局数、列出问题种子与回放用的信息', () => {
    const bad: Bot = {
      ...sensibleBot,
      name: 'bad',
      act: () => {
        throw new Error('boom');
      },
    };
    const s = simulateMany(lively(), { ...base, bot: bad, runs: 5, seedPrefix: 'cr' });
    expect(s.crashed).toBe(5);
    expect(s.failedRuns).toBe(5);
    expect(s.failures[0]).toMatchObject({ seed: 'cr-0', kind: 'crash' });
    const text = formatSummary(s, lively());
    expect(text).toContain('崩溃');
    expect(text).toContain('cr-0');
  });
});

describe('不变量检查接入 simulateRun', () => {
  it('内容有问题时能报出违规，且关闭检查后不报', () => {
    const content = makeContent((db) => {
      db.stats[0].initial = 120; // 超过 max=100
    });
    const on = simulateRun(content, { ...base, seed: 'v1', bot: sensibleBot, maxDays: 3 });
    expect(on.violations.map((v) => v.code)).toContain('stat.range');
    const off = simulateRun(content, {
      ...base,
      seed: 'v1',
      bot: sensibleBot,
      maxDays: 3,
      check: false,
    });
    expect(off.violations).toEqual([]);
  });

  it('同一种违规每局只记一次；汇总按代码聚合并给出种子', () => {
    const content = makeContent((db) => {
      db.stats[0].initial = 120;
    });
    const s = simulateMany(content, { ...base, bot: sensibleBot, runs: 4, maxDays: 5 });
    const v = s.violations.find((x) => x.code === 'stat.range');
    expect(v?.runs).toBe(4);
    expect(v?.severity).toBe('error');
    expect(v?.seeds.length).toBeGreaterThan(0);
    expect(s.failedRuns).toBe(4);
    expect(formatSummary(s, content)).toContain('[错误] stat.range');
  });
});

describe('逐局分析数据的一致性', () => {
  const check = (content: ReturnType<typeof buildContent>, opts: typeof base, bot: Bot) => {
    for (let i = 0; i < 25; i++) {
      let chosen = 0;
      const observer: RunObserver = {
        step: ({ action, error }) => {
          if (!error && action.type === 'chooseEventOption') chosen++;
        },
      };
      const r: RunResult = simulateRun(content, {
        ...opts,
        seed: `an-${i}`,
        bot,
        observer,
        maxDays: 80,
      });
      const a = r.analytics;
      // 出发 / 回来 / 失踪与引擎计数器对得上（含"当晚出发、次日清晨就结算"的一天往返）
      expect(a.departures.length).toBe(r.counters.expeditions ?? 0);
      const count = (o: string) => a.expeditions.filter((e) => e.outcome === o).length;
      expect(count('returned')).toBe(r.counters.expeditionsReturned ?? 0);
      expect(count('lost')).toBe(r.counters.expeditionsLost ?? 0);
      // 每个选择都被计数
      const picked = Object.values(a.choices).reduce((n, c) => n + c.picked, 0);
      expect(picked).toBe(chosen);
      for (const c of Object.values(a.choices)) {
        expect(c.enabled).toBeLessThanOrEqual(c.offered);
        expect(c.picked).toBeLessThanOrEqual(c.enabled);
      }
      // 每天一个样本、连续
      expect(a.aliveByDay.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
      expect(a.aliveByDay.length).toBeGreaterThanOrEqual(1);
      for (const tag of content.config.rationTags) {
        expect(a.supplyByDay[tag].length).toBe(a.aliveByDay.length);
      }
      // 事件序列长度 = 引擎的事件计数器
      expect(a.eventSeq.length).toBe(r.counters.events ?? 0);
      // 死亡 / 离队记录数 = 引擎计数器
      expect(a.deaths.length).toBe((r.counters.death ?? 0) + (r.counters.leave ?? 0));
    }
  };

  it('夹具内容（两种 bot）', () => {
    for (const bot of [sensibleBot, randomBot]) check(lively(), base, bot);
  });

  it('正式内容（两种 bot）', () => {
    const real = buildContent(contentDB);
    const o = { mapId: real.db.maps[0].id, difficultyId: real.db.difficulties[0].id };
    for (const bot of [sensibleBot, randomBot]) check(real, o, bot);
  });
});

describe('死因分类', () => {
  it('夜间健康归零被记为 night + 致命属性', () => {
    const content = makeContent((db) => {
      db.stats.find((s) => s.id === 'hp')!.dailyDelta = -60;
      db.maps[0].eventDailyChance = 0;
    });
    const r = simulateRun(content, { ...base, seed: 'd1', bot: sensibleBot });
    expect(r.analytics.deaths.length).toBeGreaterThan(0);
    for (const d of r.analytics.deaths) {
      expect(d.how).toBe('dead');
      expect(d.trigger).toBe('night');
      expect(d.fatal).toEqual(['hp']);
    }
  });

  it('汇总里有死因表与分类标签（用名字而不是 id）', () => {
    const content = makeContent((db) => {
      db.stats.find((s) => s.id === 'hp')!.dailyDelta = -60;
      db.maps[0].eventDailyChance = 0;
    });
    const s = simulateMany(content, { ...base, bot: sensibleBot, runs: 6 });
    expect(s.analytics.deaths.total).toBeGreaterThan(0);
    const pctSum = s.analytics.deaths.causes.reduce((a, c) => a + c.pct, 0);
    expect(pctSum).toBeCloseTo(1, 6);
    expect(s.analytics.deaths.causes[0].label).toContain('夜间结算');
    expect(s.analytics.deaths.causes[0].label).toContain('健康归零');
    expect(formatSummary(s, content)).toContain('死亡 / 离队原因');
  });
});

describe('汇总的其他新字段', () => {
  const content = lively();
  const s = simulateMany(content, { ...base, bot: sensibleBot, runs: 30, seedPrefix: 'sm' });

  it('每种结局带示例种子，最短 / 最长一局', () => {
    for (const e of s.endings) {
      expect(e.seeds.length).toBeGreaterThan(0);
      expect(e.seeds.length).toBeLessThanOrEqual(3);
    }
    expect(s.extremes!.shortest.days).toBe(s.days.min);
    expect(s.extremes!.longest.days).toBe(s.days.max);
  });

  it('每日曲线：第 1 天 100% 仍在继续，且不超过 maxDays', () => {
    const t = s.analytics.timeline;
    expect(t[0].day).toBe(1);
    expect(t[0].running).toBe(1);
    for (let i = 1; i < t.length; i++) expect(t[i].running).toBeLessThanOrEqual(t[i - 1].running);
    const capped = simulateMany(content, { ...base, bot: sensibleBot, runs: 5, maxDays: 4 });
    expect(Math.max(...capped.analytics.timeline.map((p) => p.day))).toBeLessThanOrEqual(4);
  });

  it('文本报告包含各新增段落', () => {
    const text = formatSummary(s, content);
    for (const part of ['健康检查', '死亡 / 离队原因', '每日曲线', '事件选项', '示例种子']) {
      expect(text).toContain(part);
    }
    expect(formatSummary(s, content, { detail: true })).toContain('选择率');
  });

  it('事件选项：条件永远不满足的选项被标为"从未可选"', () => {
    const stuck = makeContent((db) => {
      db.maps[0].eventDailyChance = 0.8;
      const ev = db.events.find((e) => e.id === 'break_in')!;
      ev.weight = 1;
      ev.choices[1].requires = { hasItem: 'ghost_item' };
    });
    const sum = simulateMany(stuck, { ...base, bot: randomBot, runs: 60, seedPrefix: 'ch' });
    const row = sum.analytics.choices.find(
      (c) => c.eventId === 'break_in' && c.choiceId === 'chop',
    );
    expect(row?.offered).toBeGreaterThan(0);
    expect(row?.enabled).toBe(0);
    expect(row?.picked).toBe(0);
    expect(formatSummary(sum, stuck)).toContain('从未可选: 「破门」· 用药箱砸');
  });
});

describe('computeDiversity', () => {
  const run = (eventSeq: string[]): RunAnalytics => ({
    deaths: [],
    aliveByDay: [],
    supplyByDay: {},
    departures: [],
    expeditions: [],
    choices: {},
    eventSeq,
  });

  it('所有局完全相同：相似度 1、重复局 100%、开场只有 1 种', () => {
    const runs = Array.from({ length: 6 }, () => run(['a', 'b', 'c', 'a']));
    const d = computeDiversity(
      runs,
      runs.map(() => 'x@5'),
    );
    expect(d.meanJaccard).toBeCloseTo(1, 10);
    expect(d.duplicateRunRate).toBe(1);
    expect(d.openings.distinct).toBe(1);
    expect(d.openings.topShare).toBe(1);
    expect(d.repeat.meanMax).toBe(2);
  });

  it('各局事件互不相同：相似度 0、熵最大、没有重复局', () => {
    const runs = ['a', 'b', 'c', 'd'].map((id) => run([id]));
    const d = computeDiversity(
      runs,
      runs.map(() => 'x@5'),
    );
    expect(d.meanJaccard).toBe(0);
    expect(d.eventEntropy).toBeCloseTo(1, 10);
    expect(d.duplicateRunRate).toBe(0);
    expect(d.openings.distinct).toBe(4);
  });

  it('重复最多的事件与单局最大重复次数', () => {
    const d = computeDiversity([run(['a', 'a', 'a', 'b']), run(['a', 'b'])]);
    expect(d.repeat.worstEventId).toBe('a');
    expect(d.repeat.worstPerRun).toBeCloseTo(2, 10);
    expect(d.repeat.meanMax).toBeCloseTo(2, 10);
  });

  it('空输入不除零', () => {
    const d = computeDiversity([]);
    expect(d.eventEntropy).toBe(0);
    expect(d.duplicateRunRate).toBe(0);
    expect(Number.isFinite(d.repeat.meanMax)).toBe(true);
  });

  it('汇总里带多样性，文本报告里有对应段落', () => {
    const content = lively();
    const s = simulateMany(content, { ...base, bot: sensibleBot, runs: 30, seedPrefix: 'dv' });
    expect(s.analytics.diversity.eventEntropy).toBeGreaterThanOrEqual(0);
    expect(s.analytics.diversity.eventEntropy).toBeLessThanOrEqual(1);
    expect(formatSummary(s, content)).toContain('多样性（跨局）');
  });
});
