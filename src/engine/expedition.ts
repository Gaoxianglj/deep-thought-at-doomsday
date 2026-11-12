/**
 * 外出：规划校验、出发、返回结算。
 * 【任务 C2】resolveReturn 目前是桩（必定平安、无战利品）。完整实现见 docs/DESIGN.md 第 6 节：
 * 安危三档、战利品抽取、specials 特殊事件。其余函数的签名与行为不要改。
 */
import { evalCondition } from './conditions';
import { changeItem, itemCount, sysLog, type Env } from './context';
import { fireTrigger, getModifier } from './rules';
import type { ExpeditionPlan } from './schema';

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
  if (!plan || validateExpeditionPlan(env, plan)) return;
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

/** 清晨调用：外出者到期则结算返回。 */
export function resolveReturn(env: Env): void {
  const { run, content } = env;
  const exp = run.expedition;
  if (!exp || exp.returnDay > run.day) return;
  const ch = run.characters[exp.charId];
  const loc = content.locations.get(exp.locationId);
  run.expedition = null;
  if (!ch || ch.where !== 'away') return;

  // TODO(C2)：安危判定、战利品、specials。以下为桩：平安返回，携带物归还。
  ch.where = 'shelter';
  for (const id of exp.carry) changeItem(run, id, 1);
  sysLog(
    env,
    'expeditionReturn',
    'expedition',
    { self: exp.charId },
    { location: loc?.name ?? '', loot: '' },
  );
  fireTrigger(env, 'expeditionReturn', exp);
}
