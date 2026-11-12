/** 条件求值。新增条件种类：先在 schema.ts 加类型与 schema，再在这里加分支（漏了会编译报错）。 */
import { aliveIds, itemCount, resolveTargets, shelterIds, type Env, type Scope } from './context';
import { rollChance } from './rng';
import type { Cmp, Condition } from './schema';

export function compare(value: number, c: Cmp): boolean {
  if (c.gte !== undefined && !(value >= c.gte)) return false;
  if (c.gt !== undefined && !(value > c.gt)) return false;
  if (c.lte !== undefined && !(value <= c.lte)) return false;
  if (c.lt !== undefined && !(value < c.lt)) return false;
  if (c.eq !== undefined && value !== c.eq) return false;
  return true;
}

function hasCmp(c: Cmp): boolean {
  return [c.gte, c.gt, c.lte, c.lt, c.eq].some((v) => v !== undefined);
}

export function evalCondition(env: Env, scope: Scope, cond: Condition | undefined): boolean {
  if (!cond) return true;
  const { run, content } = env;

  if ('all' in cond) return cond.all.every((c) => evalCondition(env, scope, c));
  if ('any' in cond) return cond.any.some((c) => evalCondition(env, scope, c));
  if ('not' in cond) return !evalCondition(env, scope, cond.not);

  if ('stat' in cond || 'hasStatus' in cond) {
    const ids = resolveTargets(env, scope, cond.of, 'cond');
    const test = (id: string) => {
      const ch = run.characters[id];
      if ('stat' in cond) return cond.stat in ch.stats && compare(ch.stats[cond.stat], cond);
      return ch.statuses.some((s) => s.id === cond.hasStatus);
    };
    // 'all' 要求全体满足（且至少一人）；其余为"存在"
    return cond.of === 'all' ? ids.length > 0 && ids.every(test) : ids.some(test);
  }

  if ('hasItem' in cond) return itemCount(run, cond.hasItem) >= (cond.count ?? 1);
  if ('hasTag' in cond) {
    let total = 0;
    for (const [id, n] of Object.entries(run.inventory)) {
      if (content.items.get(id)?.tags.includes(cond.hasTag)) total += n;
    }
    return total >= (cond.count ?? 1);
  }
  if ('carrying' in cond) {
    const exp = scope.expedition ?? run.expedition;
    return !!exp && exp.carry.includes(cond.carrying);
  }
  if ('at' in cond) {
    const exp = scope.expedition ?? run.expedition;
    return !!exp && exp.locationId === cond.at;
  }
  if ('flag' in cond) {
    const v = run.flags[cond.flag];
    if (cond.is !== undefined) return v === cond.is;
    if (hasCmp(cond)) return compare(typeof v === 'number' ? v : 0, cond);
    return !!v;
  }
  if ('day' in cond) return compare(run.day, cond.day);
  if ('inParty' in cond) return aliveIds(run).includes(cond.inParty);
  if ('inShelter' in cond) return run.characters[cond.inShelter]?.where === 'shelter';
  if ('unlocked' in cond) return run.unlocked.includes(cond.unlocked);
  if ('partyAlive' in cond) return compare(aliveIds(run).length, cond.partyAlive);
  if ('shelterCount' in cond) return compare(shelterIds(run).length, cond.shelterCount);
  if ('map' in cond) return run.mapId === cond.map;
  if ('difficulty' in cond) return run.difficultyId === cond.difficulty;
  if ('weather' in cond) return run.weather?.id === cond.weather;
  if ('chance' in cond) return rollChance(run, cond.chance);

  const exhaustive: never = cond;
  return exhaustive;
}
