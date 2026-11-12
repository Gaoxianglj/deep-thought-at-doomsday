/** 效果执行。新增效果种类：先在 schema.ts 加类型与 schema，再在 applyOne 加分支（漏了会编译报错）。 */
import { evalCondition } from './conditions';
import {
  addLog,
  aliveIds,
  changeItem,
  createCharState,
  formatText,
  isAlive,
  resolveTargets,
  sysLog,
  type Env,
  type Scope,
} from './context';
import { pickWeighted, rollChance } from './rng';
import { getModifier } from './rules';
import type { Effect } from './schema';

/** 执行一组效果，结束后统一做死亡判定。引擎其他模块只调用这个入口。 */
export function applyEffects(env: Env, scope: Scope, effects: Effect[] | undefined): void {
  if (!effects?.length) return;
  applyList(env, scope, effects);
  checkDeaths(env);
}

function applyList(env: Env, scope: Scope, effects: Effect[]): void {
  for (const e of effects) applyOne(env, scope, e);
}

function applyOne(env: Env, scope: Scope, e: Effect): void {
  const { run, content } = env;

  if ('stat' in e) {
    const def = content.stats.get(e.stat);
    if (!def) return;
    for (const id of resolveTargets(env, scope, e.of, 'effect')) {
      const ch = run.characters[id];
      let v = ch.stats[e.stat] ?? def.initial;
      if (e.set !== undefined) v = e.set;
      if (e.add !== undefined) v += e.add > 0 ? e.add * (scope.gainMul ?? 1) : e.add;
      ch.stats[e.stat] = Math.min(def.max, Math.max(def.min, v));
    }
    return;
  }
  if ('addStatus' in e) {
    for (const id of resolveTargets(env, scope, e.of, 'effect')) {
      const p = getModifier(env, `status.${e.addStatus}.gainChance`, e.chance ?? 1, id);
      if (rollChance(run, p)) addStatus(env, id, e.addStatus, e.duration);
    }
    return;
  }
  if ('removeStatus' in e) {
    for (const id of resolveTargets(env, scope, e.of, 'effect'))
      removeStatus(env, id, e.removeStatus);
    return;
  }
  if ('item' in e) {
    if (content.items.has(e.item)) changeItem(run, e.item, e.add);
    return;
  }
  if ('loseRandomItem' in e) {
    const lost: string[] = [];
    for (let i = 0; i < (e.loseRandomItem.count ?? 1); i++) {
      const tag = e.loseRandomItem.tag;
      const pool = Object.keys(run.inventory).filter(
        (id) => !tag || content.items.get(id)?.tags.includes(tag),
      );
      const id = pickWeighted(run, pool, (x) => run.inventory[x]);
      if (!id) break;
      changeItem(run, id, -1);
      lost.push(content.items.get(id)?.name ?? id);
    }
    // 供后续 log 效果和事件结果文案使用：{lost}
    scope.vars = { ...scope.vars, lost: lost.join('、') };
    return;
  }
  if ('setFlag' in e) {
    run.flags[e.setFlag] = e.value;
    return;
  }
  if ('addFlag' in e) {
    const cur = run.flags[e.addFlag];
    run.flags[e.addFlag] = (typeof cur === 'number' ? cur : 0) + e.add;
    return;
  }
  if ('joinParty' in e) {
    if (run.characters[e.joinParty]) return; // 已在队伍中（或曾经在）则忽略，不复活
    const ch = createCharState(content, e.joinParty);
    if (!ch) return;
    run.characters[ch.id] = ch;
    run.party.push(ch.id);
    return;
  }
  if ('leaveParty' in e) {
    for (const id of resolveTargets(env, scope, e.leaveParty, 'effect')) {
      removeFromParty(env, id, e.reason, e.text);
    }
    return;
  }
  if ('unlock' in e) {
    if (content.characters.has(e.unlock) && !run.unlocked.includes(e.unlock)) {
      run.unlocked.push(e.unlock);
    }
    return;
  }
  if ('queueEvent' in e) {
    const roles = { ...scope.roles };
    if (scope.self) roles.self = scope.self;
    run.eventQueue.push({ eventId: e.queueEvent, day: run.day + (e.delay ?? 0), roles });
    return;
  }
  if ('ending' in e) {
    if (!run.ending) run.ending = { id: e.ending, day: run.day };
    return;
  }
  if ('log' in e) {
    addLog(run, e.kind ?? 'info', formatText(env, scope, e.log));
    return;
  }
  if ('if' in e) {
    if (evalCondition(env, scope, e.if)) applyList(env, scope, e.then);
    else if (e.else) applyList(env, scope, e.else);
    return;
  }
  if ('random' in e) {
    const branch = pickWeighted(run, e.random, (b) => b.weight ?? 1);
    if (branch) applyList(env, scope, branch.effects);
    return;
  }

  const exhaustive: never = e;
  return exhaustive;
}

/** 施加状态（已有则刷新持续时间）。不掷 gainChance —— 那是 addStatus 效果的事。 */
export function addStatus(env: Env, charId: string, statusId: string, duration?: number): void {
  const { run, content } = env;
  const def = content.statuses.get(statusId);
  const ch = run.characters[charId];
  if (!def || !isAlive(ch)) return;
  const daysLeft = duration ?? def.duration;
  const existing = ch.statuses.find((s) => s.id === statusId);
  if (existing) {
    if (daysLeft !== undefined) existing.daysLeft = Math.max(existing.daysLeft ?? 0, daysLeft);
    return;
  }
  ch.statuses.push(
    daysLeft === undefined
      ? { id: statusId, since: run.day }
      : { id: statusId, since: run.day, daysLeft },
  );
  sysLog(env, 'statusEnter', 'status', { self: charId }, { status: def.name });
  if (def.onEnter) applyList(env, { self: charId }, def.onEnter);
}

export function removeStatus(env: Env, charId: string, statusId: string): void {
  const { run, content } = env;
  const ch = run.characters[charId];
  if (!ch) return;
  const i = ch.statuses.findIndex((s) => s.id === statusId);
  if (i < 0) return;
  ch.statuses.splice(i, 1);
  const def = content.statuses.get(statusId);
  if (!def || !isAlive(ch)) return;
  sysLog(env, 'statusExit', 'status', { self: charId }, { status: def.name });
  if (def.onExit) applyList(env, { self: charId }, def.onExit);
}

/** 角色死亡或离开：清理其计划；若正在外出则外出作废（携带物一并丢失）。 */
export function removeFromParty(
  env: Env,
  charId: string,
  reason: 'dead' | 'gone',
  text?: string,
): void {
  const { run } = env;
  const ch = run.characters[charId];
  if (!isAlive(ch)) return;
  ch.where = reason;
  delete run.plan.rations[charId];
  if (run.plan.expedition?.charId === charId) delete run.plan.expedition;
  if (run.expedition?.charId === charId) run.expedition = null;
  const kind = reason === 'dead' ? 'death' : 'leave';
  if (text) addLog(run, kind, formatText(env, { self: charId }, text));
  else if (reason === 'dead') sysLog(env, 'death', kind, { self: charId });
  run.counters[kind] = (run.counters[kind] ?? 0) + 1;
}

/** 任何 deathAtZero 属性 ≤ min 的活人死亡 */
export function checkDeaths(env: Env): void {
  const { run, content } = env;
  for (const id of aliveIds(run)) {
    const ch = run.characters[id];
    const fatal = content.db.stats.find(
      (s) => s.deathAtZero && (ch.stats[s.id] ?? s.initial) <= s.min,
    );
    if (fatal) removeFromParty(env, id, 'dead', fatal.deathText);
  }
}
