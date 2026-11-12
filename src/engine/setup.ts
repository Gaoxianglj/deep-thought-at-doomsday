/** 开局：点数与队伍校验、生成初始 RunState。 */
import type { Content } from './content';
import { createCharState } from './context';
import { startDay } from './day';
import { seedToState } from './rng';
import { SAVE_VERSION, type RunState } from './schema';

export interface NewRunOptions {
  seed: string;
  mapId: string;
  difficultyId: string;
  /** 所选伙伴 id */
  party: string[];
  /** 用点数购买的物品：id → 数量 */
  items: Record<string, number>;
  /** 档案中已解锁的角色 id */
  unlocked: string[];
}

/** 所选伙伴与物品的点数总花费 */
export function pointsCost(
  content: Content,
  party: string[],
  items: Record<string, number>,
): number {
  let cost = 0;
  for (const id of party) cost += content.characters.get(id)?.cost ?? 0;
  for (const [id, n] of Object.entries(items)) cost += (content.items.get(id)?.cost ?? 0) * n;
  return cost;
}

/** 返回错误码列表；空数组 = 合法。 */
export function validateSetup(content: Content, o: NewRunOptions): string[] {
  const errors: string[] = [];
  const map = content.maps.get(o.mapId);
  const diff = content.difficulties.get(o.difficultyId);
  if (!map) errors.push('unknownMap');
  if (!diff) errors.push('unknownDifficulty');
  if (!map || !diff) return errors;
  if (new Set(o.party).size !== o.party.length) errors.push('duplicateCharacter');
  if (o.party.length < map.partySize.min || o.party.length > map.partySize.max)
    errors.push('partySize');
  for (const id of o.party) {
    if (!content.characters.has(id)) errors.push('unknownCharacter');
    else if (!o.unlocked.includes(id)) errors.push('characterLocked');
  }
  for (const [id, n] of Object.entries(o.items)) {
    const item = content.items.get(id);
    if (!Number.isInteger(n) || n < 0) errors.push('badItemCount');
    else if (n === 0) continue;
    else if (!item || item.cost === undefined || !map.startingPool.includes(id))
      errors.push('itemNotAllowed');
    else if (item.maxAtStart !== undefined && n > item.maxAtStart) errors.push('itemOverMax');
  }
  if (pointsCost(content, o.party, o.items) > diff.points) errors.push('overBudget');
  return [...new Set(errors)];
}

/** 生成新对局并结算第 1 天清晨。选项不合法时抛错（UI 应先调 validateSetup）。 */
export function newRun(content: Content, o: NewRunOptions): RunState {
  const errors = validateSetup(content, o);
  if (errors.length) throw new Error(`invalid setup: ${errors.join(', ')}`);
  const map = content.maps.get(o.mapId)!;
  const run: RunState = {
    v: SAVE_VERSION,
    seed: o.seed,
    rng: seedToState(o.seed),
    mapId: o.mapId,
    difficultyId: o.difficultyId,
    day: 1,
    phase: 'plan',
    party: [...o.party],
    characters: {},
    inventory: {},
    flags: { ...map.startingFlags },
    plan: { rations: {} },
    expedition: null,
    pendingEvent: null,
    eventQueue: [],
    eventRolled: false,
    history: {},
    weather: null,
    log: [],
    ending: null,
    counters: {},
    unlocked: [...new Set(o.unlocked)],
    newUnlocks: [],
    ext: {},
  };
  for (const id of o.party) run.characters[id] = createCharState(content, id)!;
  for (const src of [map.startingItems ?? {}, o.items]) {
    for (const [id, n] of Object.entries(src)) {
      if (n > 0 && content.items.has(id)) run.inventory[id] = (run.inventory[id] ?? 0) + n;
    }
  }
  startDay({ run, content });
  return run;
}
