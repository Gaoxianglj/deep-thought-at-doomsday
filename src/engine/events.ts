/** 事件引擎：角色绑定、抽取、队列、选项结算、事件链；以及避难所日记。 */
import { evalCondition } from './conditions';
import { addLog, formatText, isAlive, shelterIds, type Env, type Scope } from './context';
import { applyEffects } from './effects';
import { checkEndings } from './endings';
import { pickWeighted, rollChance } from './rng';
import { getModifier } from './rules';
import type { RoleDef } from './schema';

type Roles = Record<string, string>;

/**
 * 绑定角色。已预先绑定的（来自队列/事件链）只要求还活着；
 * 其余从此刻在庇护所的活人中挑选，互不重复，须满足 is / where。绑不上返回 null。
 */
export function bindRoles(
  env: Env,
  defs: Record<string, RoleDef> | undefined,
  pre: Roles = {},
): Roles | null {
  const roles: Roles = {};
  for (const [name, id] of Object.entries(pre)) {
    if (!isAlive(env.run.characters[id])) return null;
    roles[name] = id;
  }
  for (const [name, def] of Object.entries(defs ?? {})) {
    if (roles[name]) continue;
    const used = new Set(Object.values(roles));
    const candidates = shelterIds(env.run).filter(
      (id) =>
        !used.has(id) &&
        (!def.is || def.is === id) &&
        evalCondition(env, { self: id, roles }, def.where),
    );
    const picked = pickWeighted(env.run, candidates);
    if (!picked) return null;
    roles[name] = picked;
  }
  return roles;
}

function scopeOf(roles: Roles): Scope {
  return { self: roles.self, roles };
}

/** once / cooldown / when 检查。key 为 history 的键。 */
function isEligible(
  env: Env,
  key: string,
  def: { once?: boolean; cooldown?: number; when?: Parameters<typeof evalCondition>[2] },
): boolean {
  const h = env.run.history[key];
  if (h && def.once) return false;
  if (h && def.cooldown !== undefined && env.run.day - h.lastDay <= def.cooldown) return false;
  return evalCondition(env, {}, def.when);
}

function markHistory(env: Env, key: string): void {
  const h = env.run.history[key];
  env.run.history[key] = { count: (h?.count ?? 0) + 1, lastDay: env.run.day };
}

/** 把某事件设为当前待处理事件。事件不存在或角色绑不上返回 false。 */
export function startEvent(env: Env, eventId: string, pre: Roles = {}): boolean {
  const def = env.content.events.get(eventId);
  if (!def) return false;
  const roles = bindRoles(env, def.roles, pre);
  if (!roles) return false;
  env.run.pendingEvent = { eventId, roles };
  env.run.phase = 'event';
  markHistory(env, `event:${eventId}`);
  env.run.counters.events = (env.run.counters.events ?? 0) + 1;
  return true;
}

/** 按每日概率与权重抽一个随机事件并开始；没抽到返回 false。 */
function drawRandomEvent(env: Env): boolean {
  const { run, content } = env;
  const map = content.maps.get(run.mapId);
  const p = getModifier(env, 'event.dailyChance', map?.eventDailyChance ?? 0);
  if (!rollChance(run, p)) return false;
  const pool: { id: string; roles: Roles; weight: number }[] = [];
  for (const def of content.db.events) {
    let weight = def.weight ?? 1;
    if (weight <= 0 || !isEligible(env, `event:${def.id}`, def)) continue;
    const roles = bindRoles(env, def.roles);
    if (!roles) continue;
    for (const tag of def.tags ?? []) weight = getModifier(env, `event.weight.${tag}`, weight);
    pool.push({ id: def.id, roles, weight });
  }
  const picked = pickWeighted(run, pool, (x) => x.weight);
  return !!picked && startEvent(env, picked.id, picked.roles);
}

/**
 * 推进到下一个需要玩家处理的事件；没有则进入计划阶段（并检查结局）。
 * 顺序：到期的队列事件 → （今天还没掷过且没有队列事件触发时）随机事件。
 */
export function nextEvent(env: Env): void {
  const { run } = env;
  run.pendingEvent = null;
  for (;;) {
    const i = run.eventQueue.findIndex((q) => q.day <= run.day);
    if (i < 0) break;
    const [q] = run.eventQueue.splice(i, 1);
    run.eventRolled = true;
    if (startEvent(env, q.eventId, q.roles)) return;
  }
  if (!run.eventRolled) {
    run.eventRolled = true;
    if (drawRandomEvent(env)) return;
  }
  run.phase = 'plan';
  checkEndings(env);
}

export function chooseEventOption(env: Env, choiceId: string): string | null {
  const { run, content } = env;
  const pending = run.pendingEvent;
  if (run.phase !== 'event' || !pending) return 'noPendingEvent';
  if (pending.result) return 'alreadyChosen';
  const def = content.events.get(pending.eventId);
  const choice = def?.choices.find((c) => c.id === choiceId);
  if (!def || !choice) return 'unknownChoice';
  const scope = scopeOf(pending.roles);
  if (!evalCondition(env, scope, choice.requires)) return 'choiceLocked';

  const outcomes = choice.outcomes.filter((o) => evalCondition(env, scope, o.when));
  const outcome = pickWeighted(run, outcomes, (o) => o.weight ?? 1);
  if (!outcome) {
    // 数据问题（没有可用结果）：不卡死，直接给出空结果。校验脚本应当报出这种事件。
    pending.result = { choiceId, text: '' };
    return null;
  }
  applyEffects(env, scope, outcome.effects);
  const text = formatText(env, scope, outcome.text);
  pending.result = outcome.next ? { choiceId, text, next: outcome.next } : { choiceId, text };
  addLog(run, 'event', text);
  return null;
}

/** 看完结果后继续：进入事件链的下一个事件、下一个队列事件，或计划阶段。 */
export function continueEvent(env: Env): string | null {
  const { run } = env;
  const pending = run.pendingEvent;
  if (run.phase !== 'event' || !pending?.result) return 'noEventResult';
  run.pendingEvent = null;
  if (checkEndings(env)) return null;
  const next = pending.result.next;
  if (next) {
    const alive = Object.fromEntries(
      Object.entries(pending.roles).filter(([, id]) => isAlive(run.characters[id])),
    );
    if (startEvent(env, next, alive)) return null;
  }
  nextEvent(env);
  return null;
}

/** 每天清晨写日记：从满足条件且角色绑得上的条目中不放回地抽 map.diaryPerDay 条。 */
export function writeDiary(env: Env): void {
  const { run, content } = env;
  const count = content.maps.get(run.mapId)?.diaryPerDay ?? 1;
  const pool: { id: string; text: string; roles: Roles; weight: number }[] = [];
  for (const def of content.db.diary) {
    if (!isEligible(env, `diary:${def.id}`, def)) continue;
    const roles = bindRoles(env, def.roles);
    if (roles) pool.push({ id: def.id, text: def.text, roles, weight: def.weight ?? 1 });
  }
  for (let n = 0; n < count && pool.length; n++) {
    const picked = pickWeighted(run, pool, (x) => x.weight);
    if (!picked) break;
    pool.splice(pool.indexOf(picked), 1);
    markHistory(env, `diary:${picked.id}`);
    addLog(run, 'diary', formatText(env, scopeOf(picked.roles), picked.text));
  }
}

export interface EventView {
  eventId: string;
  title: string;
  text: string;
  art?: string;
  roles: Roles;
  choices: { id: string; text: string; enabled: boolean; hint?: string }[];
  /** 已选择后的结果文案；有值时 UI 应显示结果并提供"继续" */
  result?: { choiceId: string; text: string };
}

/** 给 UI 的当前事件视图（文案已套模板）。没有待处理事件返回 null。 */
export function getEventView(env: Env): EventView | null {
  const pending = env.run.pendingEvent;
  const def = pending && env.content.events.get(pending.eventId);
  if (!pending || !def) return null;
  const scope = scopeOf(pending.roles);
  return {
    eventId: def.id,
    title: formatText(env, scope, def.title),
    text: formatText(env, scope, def.text),
    art: def.art,
    roles: pending.roles,
    choices: def.choices.map((c) => {
      // 注意：requires 里不要用 chance（每次渲染都会重掷）
      const enabled = evalCondition(env, scope, c.requires);
      return {
        id: c.id,
        text: formatText(env, scope, c.text),
        enabled,
        hint: enabled || !c.requiresHint ? undefined : formatText(env, scope, c.requiresHint),
      };
    }),
    result: pending.result && { choiceId: pending.result.choiceId, text: pending.result.text },
  };
}
