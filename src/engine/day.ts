/**
 * 按天推进。清晨与入夜各是一张有序步骤表 —— 新的引擎系统作为新步骤插入，不要改已有步骤的内部。
 */
import { evalCondition } from './conditions';
import { aliveIds, changeItem, itemCount, shelterIds, sysLog, type Env } from './context';
import { addStatus, applyEffects, checkDeaths, removeStatus } from './effects';
import { checkEndings } from './endings';
import { nextEvent, writeDiary } from './events';
import { departExpedition, resolveReturn } from './expedition';
import { pickWeighted, randInt } from './rng';
import { fireTrigger, getModifier } from './rules';

export interface DayStep {
  name: string;
  run: (env: Env) => void;
}

/** 使用物品时正向属性增益的倍率：item.<tag>.useEffect */
export function useGainMul(env: Env, itemId: string, charId: string): number {
  const tags = env.content.items.get(itemId)?.tags ?? [];
  return tags.reduce((m, tag) => getModifier(env, `item.${tag}.useEffect`, m, charId), 1);
}

/** 消耗 1 个物品并对角色执行其 onUse。库存不足返回 false。 */
export function consumeItemOn(env: Env, itemId: string, charId: string): boolean {
  const def = env.content.items.get(itemId);
  if (!def || itemCount(env.run, itemId) < 1) return false;
  changeItem(env.run, itemId, -1);
  applyEffects(env, { self: charId, gainMul: useGainMul(env, itemId, charId) }, def.onUse);
  return true;
}

// ---------- 清晨 ----------
function stepWeather(env: Env): void {
  const { run, content } = env;
  const table = content.maps
    .get(run.mapId)
    ?.weatherTable?.filter((w) => content.weathers.has(w.weather));
  if (!table?.length) {
    run.weather = null;
    return;
  }
  if (run.weather && --run.weather.daysLeft > 0) return;
  const picked = pickWeighted(run, table, (w) => w.weight);
  if (!picked) return;
  const def = content.weathers.get(picked.weather)!;
  const changed = run.weather?.id !== def.id;
  run.weather = {
    id: def.id,
    daysLeft: randInt(run, def.duration?.min ?? 1, def.duration?.max ?? 1),
  };
  if (changed) sysLog(env, 'weatherChange', 'weather', {}, { weather: def.name });
}

function stepTrimLog(env: Env): void {
  const keepFrom = env.run.day - env.content.config.logKeepDays + 1;
  env.run.log = env.run.log.filter((l) => l.day >= keepFrom);
}

export const MORNING_STEPS: DayStep[] = [
  { name: 'weather', run: stepWeather },
  { name: 'expeditionReturn', run: resolveReturn },
  { name: 'dayStartRules', run: (env) => fireTrigger(env, 'dayStart') },
  { name: 'diary', run: writeDiary },
  { name: 'trimLog', run: stepTrimLog },
];

// ---------- 入夜 ----------
function stepRations(env: Env): void {
  const { run, content } = env;
  for (const id of shelterIds(run)) {
    for (const tag of content.config.rationTags) {
      const itemId = run.plan.rations[id]?.[tag];
      if (!itemId || run.characters[id].where !== 'shelter') continue;
      if (!consumeItemOn(env, itemId, id)) {
        sysLog(
          env,
          'rationMissing',
          'info',
          { self: id },
          { item: content.items.get(itemId)?.name ?? '' },
        );
      }
    }
  }
}

function stepStatDecay(env: Env): void {
  const { run, content } = env;
  for (const id of aliveIds(run)) {
    const ch = run.characters[id];
    for (const stat of content.db.stats) {
      const delta = getModifier(env, `stat.${stat.id}.dailyDelta`, stat.dailyDelta, id);
      const v = (ch.stats[stat.id] ?? stat.initial) + delta;
      ch.stats[stat.id] = Math.min(stat.max, Math.max(stat.min, v));
    }
  }
}

function stepStatuses(env: Env): void {
  const { run, content } = env;
  for (const id of aliveIds(run)) {
    const ch = run.characters[id];
    for (const s of [...ch.statuses]) {
      const def = content.statuses.get(s.id);
      const expired = s.daysLeft !== undefined && --s.daysLeft <= 0;
      if (!def || expired || (def.exitWhen && evalCondition(env, { self: id }, def.exitWhen))) {
        removeStatus(env, id, s.id);
      }
    }
    for (const def of content.db.statuses) {
      if (!def.enterWhen || ch.statuses.some((s) => s.id === def.id)) continue;
      if (evalCondition(env, { self: id }, def.enterWhen)) addStatus(env, id, def.id);
    }
  }
}

export const NIGHT_STEPS: DayStep[] = [
  { name: 'rations', run: stepRations },
  { name: 'expeditionDepart', run: departExpedition },
  { name: 'statDecay', run: stepStatDecay },
  { name: 'statuses', run: stepStatuses },
  { name: 'dayEndRules', run: (env) => fireTrigger(env, 'dayEnd') },
  { name: 'deaths', run: checkDeaths },
];

/** 清晨结算，然后进入事件或计划阶段。新开局的第 1 天也走这里。 */
export function startDay(env: Env): void {
  env.run.eventRolled = false;
  env.run.plan = { rations: {} };
  for (const step of MORNING_STEPS) step.run(env);
  checkDeaths(env);
  nextEvent(env);
}

/** 玩家结束当天：入夜结算 → 结局判定 → 下一天清晨。 */
export function endDay(env: Env): string | null {
  const { run } = env;
  if (run.phase !== 'plan') return 'notPlanPhase';
  for (const step of NIGHT_STEPS) step.run(env);
  if (checkEndings(env)) return null;
  run.day += 1;
  startDay(env);
  return null;
}
