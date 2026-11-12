/**
 * 外出：规划校验、出发、返回结算。
 * 返回结算见 docs/DESIGN.md 第 6 节：安危三档、战利品抽取、specials 特殊事件。
 */
import { evalCondition } from './conditions';
import { changeItem, isAlive, itemCount, sysLog, type Env } from './context';
import { applyEffects, removeFromParty } from './effects';
import { pickWeighted, randInt, rollChance } from './rng';
import { fireTrigger, getModifier } from './rules';
import type { ExpeditionPlan, LocationDef } from './schema';

/** 校验一个外出计划；合法返回 null，否则返回错误码。 */
export function validateExpeditionPlan(env: Env, plan: ExpeditionPlan): string | null {
  const { run, content } = env;
  if (run.expedition) return 'expeditionActive';
  const ch = run.characters[plan.charId];
  if (!ch || ch.where !== 'shelter') return 'charUnavailable';
  if (ch.statuses.some((s) => content.statuses.get(s.id)?.blocksExpedition)) return 'charBlocked';
  const loc = content.locations.get(plan.locationId);
  const map = content.maps.get(run.mapId);
  if (!loc || !map || loc.map !== run.mapId) return 'unknownLocation';
  const scope = { self: plan.charId, expedition: plan };
  if (!evalCondition(env, scope, loc.requires)) return 'locationLocked';
  if (plan.carry.length > map.expedition.carrySlots) return 'tooManyItems';
  const need: Record<string, number> = {};
  for (const id of plan.carry) need[id] = (need[id] ?? 0) + 1;
  for (const [id, n] of Object.entries(need)) if (itemCount(run, id) < n) return 'itemMissing';
  // 预留：交通工具。地图或地点要求的交通工具必须在库存中，并记入 plan.vehicleId。
  const vehicle = loc.vehicle ?? map.expedition.vehicle;
  if (vehicle && (plan.vehicleId !== vehicle || itemCount(run, vehicle) < 1))
    return 'vehicleMissing';
  return null;
}

/** 入夜时调用：若有合法的外出计划则出发。 */
export function departExpedition(env: Env): void {
  const { run, content } = env;
  const plan = run.plan.expedition;
  delete run.plan.expedition;
  if (!plan) return;
  if (validateExpeditionPlan(env, plan)) {
    // 计划在入夜时已不合法（例如携带物被当作配给吃掉）：取消并告知玩家
    const name = content.locations.get(plan.locationId)?.name ?? '';
    sysLog(env, 'expeditionCancelled', 'expedition', { self: plan.charId }, { location: name });
    return;
  }
  const loc = content.locations.get(plan.locationId)!;
  for (const id of plan.carry) changeItem(run, id, -1);
  run.characters[plan.charId].where = 'away';
  const days = Math.max(
    1,
    Math.round(
      getModifier(env, 'expedition.duration', loc.distance, plan.charId, { expedition: plan }),
    ),
  );
  run.expedition = { ...plan, returnDay: run.day + days };
  run.counters.expeditions = (run.counters.expeditions ?? 0) + 1;
  sysLog(env, 'expeditionDepart', 'expedition', { self: plan.charId }, { location: loc.name });
  fireTrigger(env, 'expeditionDepart', plan);
}

type Outcome = 'safe' | 'injured' | 'lost';

/** 安危判定：先按风险掷骰，出事再按 failSplit 抽受伤 / 失踪。 */
function rollOutcome(env: Env, loc: LocationDef, exp: ExpeditionPlan): Outcome {
  const { run } = env;
  const danger = getModifier(env, 'expedition.danger', loc.danger, exp.charId, { expedition: exp });
  const risk = Math.min(0.95, Math.max(0, danger));
  if (!rollChance(run, risk)) return 'safe';
  const split = loc.failSplit ?? { injured: 1, lost: 1 };
  const options: { outcome: Outcome; weight: number }[] = [
    { outcome: 'injured', weight: split.injured },
    { outcome: 'lost', weight: split.lost },
  ];
  return pickWeighted(run, options, (o) => o.weight)?.outcome ?? 'safe';
}

/** 战利品抽取，返回 物品 id → 数量（按首次抽到的顺序） */
function rollLoot(
  env: Env,
  loc: LocationDef,
  exp: ExpeditionPlan,
  injured: boolean,
): Map<string, number> {
  const { run, content } = env;
  const extra = { expedition: exp };
  let rolls = Math.round(
    getModifier(env, 'expedition.lootRolls', loc.lootRolls, exp.charId, extra),
  );
  if (injured) rolls = Math.floor(rolls / 2);
  rolls = Math.max(0, rolls);
  const table = loc.loot
    .filter((entry) => content.items.has(entry.item))
    .map((entry) => {
      const tags = content.items.get(entry.item)!.tags;
      const weight = tags.reduce(
        (w, tag) => getModifier(env, `expedition.lootWeight.${tag}`, w, exp.charId, extra),
        entry.weight,
      );
      return { entry, weight };
    });
  const out = new Map<string, number>();
  for (let i = 0; i < rolls; i++) {
    const picked = pickWeighted(run, table, (x) => x.weight)?.entry;
    if (!picked) break;
    const min = picked.min ?? 1;
    const n = randInt(run, min, Math.max(min, picked.max ?? min));
    out.set(picked.item, (out.get(picked.item) ?? 0) + n);
  }
  return out;
}

/** 依次检查 specials，命中的第一条排入当天事件队列。 */
function queueSpecial(env: Env, loc: LocationDef, exp: ExpeditionPlan): void {
  const { run, content } = env;
  const scope = { self: exp.charId, expedition: exp };
  for (const sp of loc.specials ?? []) {
    if (!content.events.has(sp.event)) continue;
    if (!evalCondition(env, scope, sp.when)) continue;
    if (!rollChance(run, sp.chance)) continue;
    run.eventQueue.push({ eventId: sp.event, day: run.day, roles: { self: exp.charId } });
    return;
  }
}

/** 清晨调用：外出者到期则结算返回。 */
export function resolveReturn(env: Env): void {
  const { run, content } = env;
  const exp = run.expedition;
  if (!exp || exp.returnDay > run.day) return;
  const ch = run.characters[exp.charId];
  const loc = content.locations.get(exp.locationId);
  run.expedition = null;
  if (!ch || ch.where !== 'away') return;
  const charId = exp.charId;
  const location = loc?.name ?? '';
  const outcome = loc ? rollOutcome(env, loc, exp) : 'safe';

  if (outcome === 'lost') {
    sysLog(env, 'expeditionLost', 'expedition', { self: charId }, { location });
    removeFromParty(env, charId, 'gone');
    run.counters.expeditionsLost = (run.counters.expeditionsLost ?? 0) + 1;
    return;
  }

  const injured = outcome === 'injured';
  ch.where = 'shelter';
  for (const id of exp.carry) changeItem(run, id, 1);
  if (injured && loc) applyEffects(env, { self: charId, expedition: exp }, loc.injury);

  const loot = loc ? rollLoot(env, loc, exp, injured) : new Map<string, number>();
  const parts: string[] = [];
  let lootCount = 0;
  for (const [id, n] of loot) {
    changeItem(run, id, n);
    parts.push(`${content.items.get(id)?.name ?? id}×${n}`);
    lootCount += n;
  }
  sysLog(
    env,
    injured ? 'expeditionInjured' : 'expeditionReturn',
    'expedition',
    { self: charId },
    { location, loot: parts.join('、'), lootCount: String(lootCount) },
  );
  fireTrigger(env, 'expeditionReturn', exp);
  if (loc && isAlive(run.characters[charId])) queueSpecial(env, loc, exp);
  run.counters.expeditionsReturned = (run.counters.expeditionsReturned ?? 0) + 1;
}
