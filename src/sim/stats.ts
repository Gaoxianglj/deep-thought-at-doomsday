/** 简单统计量。零 DOM、零 Node 专属 API。 */

export interface Stat {
  mean: number;
  median: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function stat(values: number[]): Stat {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  return {
    mean,
    median: quantile(s, 0.5),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
    p10: quantile(s, 0.1),
    p90: quantile(s, 0.9),
  };
}
