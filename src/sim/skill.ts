/**
 * 技能梯度：用不同风格 / 水平的 bot 跑同一批局，估计"游戏对不同水平玩家有多难"。
 * - 固定预设：random（下限）、turtle、sensible、explorer
 * - best：在策略参数空间里随机搜索，取最好的一组，再用全新种子复测（避免"赢家诅咒"）
 * 搜索出的最优组合以 resolveBot 可识别的描述串给出，可以直接用于 --bot 复现。
 * 零 DOM、零 Node 专属 API；不含任何内容 id。
 */
import type { Content } from '../engine';
import { BOTS, DEFAULT_POLICY, makePolicyBot, policySpec, resolveBot, type Policy } from './bots';
import { makeRng, simulateMany, type Summary } from './simulate';

/** 在参数空间里随机取一组策略参数 */
export function sampleOverrides(rng: () => number): Partial<Policy> {
  const range = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(range(lo, hi + 1));
  return {
    partyBudget: +range(0.2, 0.6).toFixed(2),
    toolReserve: +range(0.2, 0.8).toFixed(2),
    lowSupplyDays: int(1, 8),
    exploreMinWellbeing: +range(0.1, 0.8).toFixed(2),
    exploreWhenSafe: rng() < 0.6,
    exploreMinHome: int(0, 2),
    dangerWeight: +range(0, 10).toFixed(1),
    goalWeight: +range(0, 10).toFixed(1),
  };
}

export interface SkillRow {
  label: string;
  /** bot 描述串（可直接用于 --bot） */
  spec: string;
  winRate: number;
  daysMean: number;
  survivorsMean: number;
  runs: number;
}

export interface SkillOptions {
  mapId: string;
  difficultyId: string;
  /** 每个固定预设 / 最终复测的局数 */
  runs: number;
  /** 随机搜索的候选组数（0 = 不搜索） */
  search: number;
  /** 搜索阶段每组候选的局数 */
  searchRuns: number;
  seed: string;
  unlocked?: string[];
  maxDays?: number;
  /**
   * 把 simulateMany 换成别的实现（例如多进程并行）；默认直接在本进程跑。
   * purpose：ladder = 固定预设，search = 搜索阶段的小样本，final = 最优组合复测。
   */
  run?: (
    spec: string,
    runs: number,
    seedPrefix: string,
    purpose: 'ladder' | 'search' | 'final',
  ) => Summary | Promise<Summary>;
}

function row(label: string, spec: string, s: Summary): SkillRow {
  return {
    label,
    spec,
    winRate: s.winRate,
    daysMean: s.days.mean,
    survivorsMean: s.survivors.mean,
    runs: s.runs,
  };
}

export async function runSkillLadder(content: Content, opts: SkillOptions): Promise<SkillRow[]> {
  const evaluate =
    opts.run ??
    ((spec: string, runs: number, seedPrefix: string): Summary => {
      const bot = resolveBot(spec);
      if (typeof bot === 'string') throw new Error(bot);
      return simulateMany(content, {
        runs,
        seedPrefix,
        mapId: opts.mapId,
        difficultyId: opts.difficultyId,
        bot,
        unlocked: opts.unlocked,
        maxDays: opts.maxDays,
        check: false,
      });
    });

  const rows: SkillRow[] = [];
  for (const spec of ['random', 'turtle', 'sensible', 'explorer'] as const) {
    if (!BOTS[spec]) continue;
    rows.push(row(spec, spec, await evaluate(spec, opts.runs, `${opts.seed}-ladder`, 'ladder')));
  }

  if (opts.search > 0) {
    const rng = makeRng(`${opts.seed}|skill-search|${opts.difficultyId}`);
    let best: { spec: string; score: number } | null = null;
    for (let i = 0; i < opts.search; i++) {
      const spec = policySpec('sensible', sampleOverrides(rng));
      const s = await evaluate(spec, opts.searchRuns, `${opts.seed}-search`, 'search');
      // 通关率优先，其次存活天数（天数除以 1000 只用来打破平局）
      const score = s.winRate + s.days.mean / 1000;
      if (!best || score > best.score) best = { spec, score };
    }
    if (best)
      rows.push(
        row(
          'best（搜索）',
          best.spec,
          await evaluate(best.spec, opts.runs, `${opts.seed}-final`, 'final'),
        ),
      );
  }
  return rows;
}

/** 默认策略参数（给文档 / 帮助输出用） */
export const POLICY_DEFAULTS = DEFAULT_POLICY;
export { makePolicyBot };
