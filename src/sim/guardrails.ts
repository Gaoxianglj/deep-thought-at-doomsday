/**
 * 平衡护栏：对一批汇总做"设计无关"的健全性检查，外加用户在 balance/targets.ts 里写的数值范围。
 * - 健康：无崩溃、无卡死、无不变量错误
 * - 难度单调：越难（开局点数越少）通关率 / 存活天数不应显著更高
 * - 技能单调：更强的 bot 不应显著更差
 * - 事件覆盖：没有任何地方能触发到的事件
 * - 超时率不过高；用户自定义的数值范围
 * 显著性用两样本比例 / 均值差的 z 检验（|z| > 2），避免被抽样噪声误报。
 * 零 DOM、零 Node 专属 API；不含任何内容 id。
 */
import type { Content } from '../engine';
import { diffProportion } from './compare';
import type { Summary } from './simulate';

export type Metric = 'winRate' | 'daysMean' | 'daysMedian' | 'survivorsMean' | 'timeoutRate';

export interface RangeRule {
  /** 省略 = 所有难度 */
  difficulty?: string;
  bot: string;
  metric: Metric;
  min?: number;
  max?: number;
  /** 说明这条规则的设计意图（显示在失败信息里） */
  note?: string;
}

export interface GuardrailConfig {
  runs: number;
  seed: string;
  /** 要跑的 bot 描述串（可含参数覆盖），按技能从低到高排列 */
  bots: string[];
  /** 用来做难度单调检查的 bot */
  referenceBot: string;
  /** 允许的最高超时率（0–1） */
  maxTimeoutRate: number;
  /** 要求每个事件至少被某个 (难度, bot) 触发过 */
  requireAllEventsTrigger: boolean;
  ranges: RangeRule[];
}

export interface Check {
  name: string;
  ok: boolean;
  severity: 'error' | 'warning';
  detail: string;
}

export const metricOf = (s: Summary, m: Metric): number =>
  m === 'winRate'
    ? s.winRate
    : m === 'daysMean'
      ? s.days.mean
      : m === 'daysMedian'
        ? s.days.median
        : m === 'survivorsMean'
          ? s.survivors.mean
          : s.runs
            ? s.timeout / s.runs
            : 0;

/** 存活天数均值差的 z 值（标准差由 p10–p90 估计） */
function daysZ(lo: Summary, hi: Summary): number {
  const sd = (s: Summary) => Math.max((s.days.p90 - s.days.p10) / 2.56, 1e-9);
  const se = Math.sqrt(sd(lo) ** 2 / lo.runs + sd(hi) ** 2 / hi.runs);
  return se > 0 ? (hi.days.mean - lo.days.mean) / se : 0;
}

const pctText = (x: number) => `${(x * 100).toFixed(1)}%`;

/** summaries 的键为 `${difficultyId}|${bot}` */
export function evaluateGuardrails(
  content: Content,
  cfg: GuardrailConfig,
  summaries: Map<string, Summary>,
): Check[] {
  const checks: Check[] = [];
  const key = (d: string, b: string) => `${d}|${b}`;
  // 越容易（开局点数越多）越靠前
  const diffs = [...content.db.difficulties].sort((a, b) => b.points - a.points).map((d) => d.id);
  const diffName = (id: string) => content.difficulties.get(id)?.name ?? id;

  for (const d of diffs) {
    for (const b of cfg.bots) {
      const s = summaries.get(key(d, b));
      if (!s) continue;
      checks.push({
        name: `健康 ${diffName(d)}/${b}`,
        ok: s.failedRuns === 0,
        severity: 'error',
        detail: s.failedRuns
          ? `${s.failedRuns}/${s.runs} 局有问题（崩溃 ${s.crashed}，卡死 ${s.stuck}；例 ${s.failures[0]?.seed}: ${s.failures[0]?.detail}）`
          : `${s.runs} 局无问题`,
      });
      const to = metricOf(s, 'timeoutRate');
      checks.push({
        name: `超时率 ${diffName(d)}/${b}`,
        ok: to <= cfg.maxTimeoutRate,
        severity: 'warning',
        detail: `${pctText(to)}（上限 ${pctText(cfg.maxTimeoutRate)}）`,
      });
    }
  }

  // 难度单调：只在显著反向时失败
  for (let i = 0; i + 1 < diffs.length; i++) {
    const easy = summaries.get(key(diffs[i], cfg.referenceBot));
    const hard = summaries.get(key(diffs[i + 1], cfg.referenceBot));
    if (!easy || !hard) continue;
    const win = diffProportion(easy.winRate, easy.runs, hard.winRate, hard.runs);
    checks.push({
      name: `难度单调·通关率 ${diffName(diffs[i])}→${diffName(diffs[i + 1])}`,
      ok: !(win.delta > 0 && win.significant),
      severity: 'error',
      detail: `${pctText(easy.winRate)} → ${pctText(hard.winRate)}（${cfg.referenceBot}）`,
    });
    const z = daysZ(hard, easy); // 期望 easy 的天数不低于 hard
    checks.push({
      name: `难度单调·存活天数 ${diffName(diffs[i])}→${diffName(diffs[i + 1])}`,
      ok: !(z < -2),
      severity: 'error',
      detail: `${easy.days.mean.toFixed(1)} → ${hard.days.mean.toFixed(1)} 天（${cfg.referenceBot}）`,
    });
  }

  // 技能单调：相邻两档 bot，高档不应显著更差
  for (const d of diffs) {
    for (let i = 0; i + 1 < cfg.bots.length; i++) {
      const lo = summaries.get(key(d, cfg.bots[i]));
      const hi = summaries.get(key(d, cfg.bots[i + 1]));
      if (!lo || !hi) continue;
      const win = diffProportion(lo.winRate, lo.runs, hi.winRate, hi.runs);
      const z = daysZ(lo, hi);
      checks.push({
        name: `技能单调 ${diffName(d)} ${cfg.bots[i]}→${cfg.bots[i + 1]}`,
        ok: !(win.delta < 0 && win.significant) && !(z < -2),
        severity: 'warning',
        detail: `通关率 ${pctText(lo.winRate)} → ${pctText(hi.winRate)}，天数 ${lo.days.mean.toFixed(1)} → ${hi.days.mean.toFixed(1)}`,
      });
    }
  }

  // 事件覆盖
  if (cfg.requireAllEventsTrigger) {
    const all = content.db.events.map((e) => e.id);
    const never = all.filter((id) =>
      [...summaries.values()].every((s) => s.neverTriggered.includes(id)),
    );
    checks.push({
      name: '事件覆盖',
      ok: never.length === 0,
      severity: 'warning',
      detail: never.length
        ? `这些事件在所有 (难度, bot) 里都从未触发: ${never.map((id) => content.events.get(id)?.title ?? id).join('、')}`
        : `全部 ${all.length} 个事件至少触发过一次`,
    });
  }

  // 用户自定义范围
  for (const r of cfg.ranges) {
    for (const d of r.difficulty ? [r.difficulty] : diffs) {
      const s = summaries.get(key(d, r.bot));
      if (!s) continue;
      const v = metricOf(s, r.metric);
      const ok = (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
      const fmt = (x: number) =>
        r.metric === 'winRate' || r.metric === 'timeoutRate' ? pctText(x) : x.toFixed(2);
      checks.push({
        name: `范围 ${diffName(d)}/${r.bot} ${r.metric}`,
        ok,
        severity: 'error',
        detail: `${fmt(v)}（要求 ${r.min !== undefined ? fmt(r.min) : '-∞'} ~ ${r.max !== undefined ? fmt(r.max) : '+∞'}）${r.note ? ` — ${r.note}` : ''}`,
      });
    }
  }
  return checks;
}
