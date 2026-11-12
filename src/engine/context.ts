/** 引擎各模块共用的上下文、目标解析、日志与文案模板。 */
import type { Content } from './content';
import { pickWeighted } from './rng';
import type { CharState, EngineTextKey, ExpeditionPlan, RunState, Target } from './schema';

/** 一次引擎调用的环境：可变的对局草稿 + 只读内容 */
export interface Env {
  run: RunState;
  content: Content;
}

/** 条件/效果求值时的局部上下文 */
export interface Scope {
  /** 'self' 指向的角色 id */
  self?: string;
  /** 事件/日记绑定的角色：名字 → 角色 id */
  roles?: Record<string, string>;
  /** 外出上下文（carrying / at 条件用）；缺省时取 run.expedition */
  expedition?: ExpeditionPlan;
  /** 正向属性增益倍率（物品使用时） */
  gainMul?: number;
  /** 文案模板的额外变量，如 {lost} {loot} {location} */
  vars?: Record<string, string>;
}

export function isAlive(c: CharState | undefined): c is CharState {
  return !!c && (c.where === 'shelter' || c.where === 'away');
}
/** 活着的队员（含外出中），按加入顺序 */
export function aliveIds(run: RunState): string[] {
  return run.party.filter((id) => isAlive(run.characters[id]));
}
/** 此刻在庇护所的活人，按加入顺序 */
export function shelterIds(run: RunState): string[] {
  return run.party.filter((id) => run.characters[id]?.where === 'shelter');
}

export function createCharState(content: Content, id: string): CharState | undefined {
  const def = content.characters.get(id);
  if (!def) return undefined;
  const stats: Record<string, number> = {};
  for (const s of content.db.stats) stats[s.id] = def.stats?.[s.id] ?? s.initial;
  return { id, where: 'shelter', stats, statuses: [] };
}

/**
 * 把 Target 解析成角色 id 列表（只含活人）。
 * mode='cond'：any/random 返回全部在场者，由调用方做"存在"判断；
 * mode='effect'：any/random 随机挑一个在场者。
 */
export function resolveTargets(
  env: Env,
  scope: Scope,
  target: Target,
  mode: 'cond' | 'effect',
): string[] {
  const { run } = env;
  const one = (id: string | undefined) => (id && isAlive(run.characters[id]) ? [id] : []);
  if (target === 'self') return one(scope.self);
  if (target === 'expeditioner') return one(scope.expedition?.charId ?? run.expedition?.charId);
  if (target === 'all') return shelterIds(run);
  if (target === 'any' || target === 'random') {
    const ids = shelterIds(run);
    if (mode === 'cond') return ids;
    return one(pickWeighted(run, ids));
  }
  if ('role' in target) return one(scope.roles?.[target.role]);
  return one(target.id);
}

export function addLog(run: RunState, kind: string, text: string): void {
  if (text) run.log.push({ day: run.day, kind, text });
}

/**
 * 文案模板：{self}、{角色名}（绑定的 role）、{item:物品id}、{day}，以及 scope.vars 里的变量。
 * 无法解析的占位符原样保留，便于校验脚本和测试发现。
 */
export function formatText(env: Env, scope: Scope, text: string): string {
  const { run, content } = env;
  return text.replace(/\{([a-zA-Z0-9_:]+)\}/g, (raw, key: string) => {
    if (key === 'day') return String(run.day);
    if (key.startsWith('item:')) return content.items.get(key.slice(5))?.name ?? raw;
    if (scope.vars && key in scope.vars) return scope.vars[key];
    const charId = key === 'self' ? (scope.self ?? scope.roles?.self) : scope.roles?.[key];
    if (charId) return content.characters.get(charId)?.name ?? raw;
    return raw;
  });
}

/** 写一条引擎自动日志；config.texts 里没有该键则不写 */
export function sysLog(
  env: Env,
  key: EngineTextKey,
  kind: string,
  scope: Scope = {},
  vars: Record<string, string> = {},
): void {
  const tpl = env.content.config.texts[key];
  if (!tpl) return;
  addLog(env.run, kind, formatText(env, { ...scope, vars: { ...scope.vars, ...vars } }, tpl));
}

export function itemCount(run: RunState, itemId: string): number {
  return run.inventory[itemId] ?? 0;
}
/** 增减库存，不低于 0；归零则删除键 */
export function changeItem(run: RunState, itemId: string, delta: number): void {
  const next = Math.max(0, itemCount(run, itemId) + delta);
  if (next > 0) run.inventory[itemId] = next;
  else delete run.inventory[itemId];
}
