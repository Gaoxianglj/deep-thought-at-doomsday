/**
 * 外出预估（纯函数，无 DOM）：危险等级文字、途中消耗预估与"撑不到回来"警告。
 * 不含任何内容 id：配给相关属性取自"配给标签物品的 onUse 会改动的属性"，
 * 警告阈值取自状态定义里 `{ stat, lt }` 形式的 enterWhen（取不到时用默认值）。
 */
import {
  getModifier,
  type Condition,
  type Content,
  type Effect,
  type Env,
  type ExpeditionPlan,
  type LocationDef,
} from '../../engine';

/** 没有对应状态阈值时的默认警戒线 */
export const DEFAULT_WARN_THRESHOLD = 25;

/** 危险度 → 1–5 级 */
export function dangerLevel(danger: number): number {
  return Math.max(1, Math.min(5, Math.ceil(danger / 0.1 - 1e-9)));
}

/** 危险等级对应的说法（1–5 级），第 5 级明确提到可能一去不回 */
export const DANGER_WORDS = [
  '比较安全',
  '有些风险',
  '有风险，可能受伤',
  '很危险，可能受伤甚至一去不回',
  '极度危险，很可能一去不回',
] as const;

export function dangerWord(level: number): string {
  return DANGER_WORDS[Math.max(1, Math.min(5, level)) - 1];
}

/** 针对（可能已选的）外出者与携带物计算的危险值，夹到 0–0.95 */
export function effectiveDanger(
  env: Env,
  loc: LocationDef,
  charId: string | undefined,
  plan: ExpeditionPlan,
): number {
  return Math.min(
    0.95,
    Math.max(0, getModifier(env, 'expedition.danger', loc.danger, charId, { expedition: plan })),
  );
}

export function tripDays(
  env: Env,
  loc: LocationDef,
  charId: string | undefined,
  plan: ExpeditionPlan,
): number {
  return Math.max(
    1,
    Math.round(getModifier(env, 'expedition.duration', loc.distance, charId, { expedition: plan })),
  );
}

function effectStats(effects: Effect[] | undefined, out: Set<string>): void {
  for (const e of effects ?? []) {
    if ('stat' in e && typeof e.stat === 'string') out.add(e.stat);
    if ('if' in e) {
      effectStats(e.then, out);
      effectStats(e.else, out);
    }
    if ('random' in e) for (const b of e.random) effectStats(b.effects, out);
  }
}

/** 配给物品会补充的属性 id 集合 */
export function rationStatIds(content: Content): string[] {
  const out = new Set<string>();
  const tags = new Set(content.config.rationTags);
  for (const it of content.db.items)
    if (it.tags.some((t) => tags.has(t))) effectStats(it.onUse, out);
  return [...out];
}

function findLt(c: Condition | undefined, statId: string): number | undefined {
  if (!c || typeof c !== 'object') return undefined;
  if ('stat' in c && c.stat === statId && 'lt' in c && typeof c.lt === 'number') return c.lt;
  if ('all' in c)
    for (const x of c.all) {
      const v = findLt(x, statId);
      if (v !== undefined) return v;
    }
  return undefined;
}

/** 某属性的警戒线：优先取状态定义里 "该属性 < N" 的 N */
export function warnThreshold(content: Content, statId: string): number {
  for (const s of content.db.statuses) {
    const v = findLt(s.enterWhen, statId);
    if (v !== undefined) return v;
  }
  return DEFAULT_WARN_THRESHOLD;
}

export interface TripShortfall {
  statId: string;
  name: string;
  /** 预计返回时的数值（取整） */
  value: number;
  threshold: number;
}

export interface TripEstimate {
  days: number;
  shortfalls: TripShortfall[];
}

/**
 * 预估外出途中的消耗。在克隆里把外出者设为 `away`（外出时的规则才会生效）。
 * 保守假设：出发当晚会按计划吃喝，所以从"当前值"起算，共衰减 `days` 个夜晚。
 */
export function estimateTrip(
  env: Env,
  loc: LocationDef,
  plan: ExpeditionPlan,
): TripEstimate | null {
  const ch = env.run.characters[plan.charId];
  if (!ch) return null;
  const days = tripDays(env, loc, plan.charId, plan);
  const sim: Env = { run: structuredClone(env.run), content: env.content };
  sim.run.characters[plan.charId].where = 'away';
  const shortfalls: TripShortfall[] = [];
  for (const statId of rationStatIds(env.content)) {
    const def = env.content.stats.get(statId);
    if (!def) continue;
    const delta = getModifier(sim, `stat.${statId}.dailyDelta`, def.dailyDelta, plan.charId);
    const value = Math.min(
      def.max,
      Math.max(def.min, (ch.stats[statId] ?? def.initial) + delta * days),
    );
    const threshold = warnThreshold(env.content, statId);
    if (value < threshold)
      shortfalls.push({ statId, name: def.name, value: Math.round(value), threshold });
  }
  return { days, shortfalls };
}
