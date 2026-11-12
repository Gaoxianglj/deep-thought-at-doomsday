/** 可设种子、状态可序列化（一个 uint32，存在 RunState.rng）的随机数。引擎内禁止使用 Math.random。 */
export interface RngHolder {
  rng: number;
}

/** 种子字符串 → 初始状态（FNV-1a） */
export function seedToState(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** [0, 1) —— mulberry32 */
export function nextFloat(r: RngHolder): number {
  r.rng = (r.rng + 0x6d2b79f5) >>> 0;
  let t = r.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 闭区间整数 */
export function randInt(r: RngHolder, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(nextFloat(r) * (max - min + 1));
}

export function rollChance(r: RngHolder, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return nextFloat(r) < p;
}

/** 按权重抽一个；列表为空或总权重 ≤ 0 时返回 undefined */
export function pickWeighted<T>(
  r: RngHolder,
  list: readonly T[],
  weightOf: (item: T) => number = () => 1,
): T | undefined {
  const weights = list.map((x) => Math.max(0, weightOf(x)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let roll = nextFloat(r) * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll < 0) return list[i];
  }
  return list[list.length - 1];
}
