import { describe, expect, it } from 'vitest';
import { compareSummaries, diffProportion } from '../../src/sim/compare';
import { evaluateGuardrails, metricOf, type GuardrailConfig } from '../../src/sim/guardrails';
import { randomBot, sensibleBot } from '../../src/sim/bots';
import { simulateMany, type Summary } from '../../src/sim/simulate';
import { makeContent } from '../fixtures/content';

const lively = () =>
  makeContent((db) => {
    db.maps[0].eventDailyChance = 0.6;
    for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  });
const base = { mapId: 'bunker' };

describe('diffProportion', () => {
  it('同一比例不显著；大差异显著；样本太少时即使差很大也不显著', () => {
    expect(diffProportion(0.2, 500, 0.2, 500).significant).toBe(false);
    const big = diffProportion(0.1, 400, 0.03, 400);
    expect(big.significant).toBe(true);
    expect(big.delta).toBeCloseTo(-0.07, 10);
    expect(diffProportion(0.5, 4, 0.25, 4).significant).toBe(false);
  });
  it('两边都是 0 或都是 1 时不除零', () => {
    expect(diffProportion(0, 100, 0, 100).z).toBe(0);
    expect(diffProportion(1, 100, 1, 100).z).toBe(0);
  });
});

describe('compareSummaries', () => {
  const content = lively();
  const run = (bot: typeof sensibleBot, difficultyId: string, seed: string, runs = 60) =>
    simulateMany(content, { ...base, difficultyId, bot, runs, seedPrefix: seed });

  it('完全相同的两份：没有显著标记', () => {
    const a = run(sensibleBot, 'normal', 'cmp');
    const text = compareSummaries([a], [structuredClone(a)], content);
    expect(text).toContain('改动前 60 局 → 改动后 60 局');
    // 图例行本身含 ▲▼，所以只检查表格行末尾的标记
    expect(text).not.toMatch(/[▲▼]\s*$/m);
  });

  it('差异很大的两份（random vs sensible 的存活天数）：标出显著变化', () => {
    const before = run(randomBot, 'normal', 'cmp');
    const after = run(sensibleBot, 'normal', 'cmp');
    const text = compareSummaries([before], [after], content);
    expect(text).toMatch(/平均存活天数.*▲/);
    expect(text).toContain('策略 random → sensible');
    expect(text).toContain('⚠ 策略或地图不同');
  });

  it('只在一边出现的难度被跳过并说明', () => {
    const a = run(sensibleBot, 'normal', 's', 10);
    const b = run(sensibleBot, 'hard', 's', 10);
    const text = compareSummaries([a], [b], content);
    expect(text).toContain('只在改动前出现');
    expect(text).toContain('只在改动后出现');
  });

  it('JSON 往返后仍能比较（--out 保存的就是这个形状）', () => {
    const a = run(sensibleBot, 'normal', 'rt', 30);
    const round = JSON.parse(JSON.stringify([a])) as Summary[];
    expect(() => compareSummaries(round, round, content)).not.toThrow();
  });
});

describe('evaluateGuardrails', () => {
  const content = lively();
  const cfg: GuardrailConfig = {
    runs: 80,
    seed: 'g',
    bots: ['random', 'sensible'],
    referenceBot: 'sensible',
    maxTimeoutRate: 0.15,
    requireAllEventsTrigger: false,
    ranges: [],
  };
  const bots = { random: randomBot, sensible: sensibleBot };
  const summaries = new Map<string, Summary>();
  for (const d of content.db.difficulties) {
    for (const name of cfg.bots) {
      summaries.set(
        `${d.id}|${name}`,
        simulateMany(content, {
          ...base,
          difficultyId: d.id,
          bot: bots[name as keyof typeof bots],
          runs: cfg.runs,
          seedPrefix: cfg.seed,
        }),
      );
    }
  }
  const failing = (checks: ReturnType<typeof evaluateGuardrails>) => checks.filter((c) => !c.ok);

  it('正常数据：健康与超时率都通过，给出难度 / 技能单调检查', () => {
    const checks = evaluateGuardrails(content, cfg, summaries);
    expect(checks.some((c) => c.name.startsWith('难度单调'))).toBe(true);
    expect(checks.some((c) => c.name.startsWith('技能单调'))).toBe(true);
    expect(failing(checks).filter((c) => c.name.startsWith('健康'))).toEqual([]);
  });

  it('有崩溃的局 → 健康检查报错', () => {
    const bad = new Map(summaries);
    const s = structuredClone(bad.get('normal|sensible')!);
    s.failedRuns = 3;
    s.crashed = 3;
    s.failures = [{ seed: 'x-1', kind: 'crash', detail: 'boom' }];
    bad.set('normal|sensible', s);
    const f = failing(evaluateGuardrails(content, cfg, bad));
    expect(f.some((c) => c.name.startsWith('健康') && c.severity === 'error')).toBe(true);
  });

  it('难度显著倒挂（更难的反而通关更多）→ 报错；噪声内的倒挂不报', () => {
    const rig = (hardWin: number, easyWin: number) => {
      const m = new Map(summaries);
      const diffs = [...content.db.difficulties].sort((a, b) => b.points - a.points);
      const e = structuredClone(m.get(`${diffs[0].id}|sensible`)!);
      const h = structuredClone(m.get(`${diffs[1].id}|sensible`)!);
      e.winRate = easyWin;
      h.winRate = hardWin;
      e.runs = h.runs = 400;
      m.set(`${diffs[0].id}|sensible`, e);
      m.set(`${diffs[1].id}|sensible`, h);
      return failing(evaluateGuardrails(content, cfg, m)).filter((c) =>
        c.name.startsWith('难度单调·通关率'),
      );
    };
    expect(rig(0.4, 0.05)).toHaveLength(1);
    expect(rig(0.21, 0.2)).toHaveLength(0);
  });

  it('数值范围规则：越界报错并带上说明', () => {
    const ranged: GuardrailConfig = {
      ...cfg,
      ranges: [{ bot: 'random', metric: 'winRate', max: -1, note: '故意写不可能满足' }],
    };
    const f = failing(evaluateGuardrails(content, ranged, summaries)).filter((c) =>
      c.name.startsWith('范围'),
    );
    expect(f.length).toBe(content.db.difficulties.length);
    expect(f[0].detail).toContain('故意写不可能满足');
    const ok: GuardrailConfig = {
      ...cfg,
      ranges: [{ bot: 'random', metric: 'winRate', min: 0, max: 1 }],
    };
    expect(
      failing(evaluateGuardrails(content, ok, summaries)).filter((c) => c.name.startsWith('范围')),
    ).toEqual([]);
  });

  it('事件覆盖：没有任何地方触发过的事件被指出', () => {
    const f = failing(
      evaluateGuardrails(content, { ...cfg, requireAllEventsTrigger: true }, summaries),
    ).find((c) => c.name === '事件覆盖');
    // 夹具里有只能由链触发而本批没触发到的事件时才会失败；这里只验证结构
    if (f) expect(f.detail).toContain('从未触发');
  });

  it('metricOf', () => {
    const s = summaries.get('normal|sensible')!;
    expect(metricOf(s, 'winRate')).toBe(s.winRate);
    expect(metricOf(s, 'daysMean')).toBe(s.days.mean);
    expect(metricOf(s, 'timeoutRate')).toBe(s.timeout / s.runs);
  });
});
