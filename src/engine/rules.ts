/**
 * 规则收集、修正查询、触发派发。
 * 规则来源 —— 全局：地图、难度、当前天气、库存中的道具；角色：特性、身上的状态。
 * 引擎里新增一个可被内容影响的数值 = 在计算处调用一次 getModifier，并把键登记到 docs/ENGINE_GUIDE.md。
 */
import { evalCondition } from './conditions';
import { aliveIds, isAlive, shelterIds, type Env, type Scope } from './context';
import { applyEffects } from './effects';
import { rollChance } from './rng';
import type { ExpeditionPlan, Rule, Trigger } from './schema';

export function globalRules(env: Env): Rule[] {
  const { run, content } = env;
  const out: Rule[] = [];
  out.push(...(content.maps.get(run.mapId)?.rules ?? []));
  out.push(...(content.difficulties.get(run.difficultyId)?.rules ?? []));
  if (run.weather) out.push(...(content.weathers.get(run.weather.id)?.rules ?? []));
  for (const [id, n] of Object.entries(run.inventory)) {
    if (n > 0) out.push(...(content.items.get(id)?.rules ?? []));
  }
  return out;
}

export function characterRules(env: Env, charId: string): Rule[] {
  const { run, content } = env;
  const ch = run.characters[charId];
  if (!ch) return [];
  const out: Rule[] = [];
  for (const t of content.characters.get(charId)?.traits ?? []) out.push(...t.rules);
  for (const s of ch.statuses) out.push(...(content.statuses.get(s.id)?.rules ?? []));
  return out;
}

/**
 * 最终值 = (base + Σadd) × Πmul。
 * subject：这次计算是关于哪个角色的（全局计算不传）。
 * - 全局来源的规则总是参与，when 中的 self = subject。
 * - 角色来源的规则：scope 为 self（默认）时只影响该角色自己；为 global 时影响所有计算，但该角色须在庇护所。
 */
export function getModifier(
  env: Env,
  key: string,
  base: number,
  subject?: string,
  extra: Scope = {},
): number {
  let add = 0;
  let mul = 1;
  const collect = (rules: Rule[], self: string | undefined, onlyGlobal: boolean) => {
    for (const rule of rules) {
      if (rule.trigger || !rule.modifiers) continue;
      const hits = rule.modifiers.filter(
        (m) => m.key === key && (!onlyGlobal || m.scope === 'global'),
      );
      if (!hits.length || !evalCondition(env, { ...extra, self }, rule.when)) continue;
      for (const m of hits) {
        add += m.add ?? 0;
        mul *= m.mul ?? 1;
      }
    }
  };
  collect(globalRules(env), subject, false);
  for (const id of aliveIds(env.run)) {
    if (id === subject) collect(characterRules(env, id), id, false);
    else if (env.run.characters[id].where === 'shelter') collect(characterRules(env, id), id, true);
  }
  return (base + add) * mul;
}

/**
 * 派发触发时机。
 * - dayStart / dayEnd：全局来源各触发一次（无 self）；角色来源只对此刻在庇护所的角色触发。
 * - expeditionDepart / expeditionReturn（传 expedition）：全局来源以外出者为 self；角色来源只对外出者本人。
 */
export function fireTrigger(env: Env, trigger: Trigger, expedition?: ExpeditionPlan): void {
  const fire = (rules: Rule[], self: string | undefined) => {
    for (const rule of rules) {
      if (rule.trigger !== trigger || !rule.effects) continue;
      if (self !== undefined && !isAlive(env.run.characters[self])) return;
      const scope: Scope = { self, expedition };
      if (!evalCondition(env, scope, rule.when)) continue;
      if (rule.chance !== undefined && !rollChance(env.run, rule.chance)) continue;
      applyEffects(env, scope, rule.effects);
    }
  };
  fire(globalRules(env), expedition?.charId);
  const chars = expedition ? [expedition.charId] : shelterIds(env.run);
  for (const id of chars) fire(characterRules(env, id), id);
}
