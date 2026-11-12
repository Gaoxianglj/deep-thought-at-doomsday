/** 模拟用策略。纯逻辑，不依赖 DOM / Node。策略里不得出现任何具体内容 id。 */
import {
  getEventView,
  shelterIds,
  validateExpeditionPlan,
  type Action,
  type Content,
  type Effect,
  type Env,
  type ExpeditionPlan,
  type ItemDef,
} from '../engine';

export interface Bot {
  name: string;
  /** 开局选择：返回 party 与 items（必须通过 validateSetup） */
  setup(
    content: Content,
    mapId: string,
    difficultyId: string,
    unlocked: string[],
    rng: () => number,
  ): { party: string[]; items: Record<string, number> };
  /** 返回本次要执行的一个动作；plan 阶段做完想做的事后返回 { type: 'endDay' } */
  act(env: Env, rng: () => number): Action;
}

// ---------- 工具函数 ----------

function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick<T>(list: readonly T[], rng: () => number): T | undefined {
  return list.length ? list[Math.floor(rng() * list.length)] : undefined;
}

/** 递归遍历效果（含 if / random 分支） */
function walkEffects(effects: Effect[] | undefined, fn: (e: Effect) => void): void {
  for (const e of effects ?? []) {
    fn(e);
    if ('if' in e) {
      walkEffects(e.then, fn);
      walkEffects(e.else, fn);
    } else if ('random' in e) {
      for (const r of e.random) walkEffects(r.effects, fn);
    }
  }
}

/** 物品使用时各属性的正向增益总和 */
function statGains(item: ItemDef): Record<string, number> {
  const gains: Record<string, number> = {};
  walkEffects(item.onUse, (e) => {
    if ('stat' in e && e.add !== undefined && e.add > 0)
      gains[e.stat] = (gains[e.stat] ?? 0) + e.add;
  });
  return gains;
}

/** 配给标签 → 它主要补充的属性 id（按该标签下物品的 onUse 增益推断）及典型单次增益 */
function tagStat(content: Content, tag: string): { stat: string; gain: number } | undefined {
  const totals: Record<string, number> = {};
  for (const item of content.db.items) {
    if (!item.tags.includes(tag)) continue;
    for (const [stat, g] of Object.entries(statGains(item))) totals[stat] = (totals[stat] ?? 0) + g;
  }
  const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return best ? { stat: best[0], gain: best[1] } : undefined;
}

/** 0 = 最缺，1 = 满 */
function statRatio(content: Content, env: Env, charId: string, statId: string): number {
  const def = content.stats.get(statId);
  const v = env.run.characters[charId]?.stats[statId];
  if (!def || v === undefined || def.max <= def.min) return 0.5;
  return (v - def.min) / (def.max - def.min);
}

/** 角色整体状态：所有属性归一化后的最小值与平均值的混合，越高越好 */
function wellbeing(env: Env, charId: string): number {
  const { content } = env;
  const ratios = content.db.stats.map((s) => statRatio(content, env, charId, s.id));
  if (!ratios.length) return 0;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return Math.min(...ratios) * 0.5 + avg * 0.5;
}

function rationItemsInStock(env: Env, tag: string): string[] {
  return env.content.db.items
    .filter((i) => i.tags.includes(tag) && (env.run.inventory[i.id] ?? 0) > 0)
    .map((i) => i.id);
}

/** 为地图上某地点构造外出计划（空携带）；不合法返回 null。 */
function buildPlan(env: Env, charId: string, locationId: string): ExpeditionPlan | null {
  const { content, run } = env;
  const loc = content.locations.get(locationId);
  const map = content.maps.get(run.mapId);
  if (!loc || !map) return null;
  const plan: ExpeditionPlan = { charId, locationId, carry: [] };
  const vehicle = loc.vehicle ?? map.expedition.vehicle;
  if (vehicle) plan.vehicleId = vehicle;
  return validateExpeditionPlan(env, plan) ? null : plan;
}

function legalLocations(
  env: Env,
  charId: string,
): { id: string; danger: number; distance: number }[] {
  const out: { id: string; danger: number; distance: number }[] = [];
  for (const loc of env.content.db.locations) {
    if (loc.map === env.run.mapId && buildPlan(env, charId, loc.id)) {
      out.push({ id: loc.id, danger: loc.danger, distance: loc.distance });
    }
  }
  return out;
}

function eventAct(env: Env, choose: (enabled: string[]) => string | undefined): Action | null {
  if (env.run.phase !== 'event') return null;
  const view = getEventView(env);
  if (!view) return { type: 'endDay' }; // 状态异常：交给引擎拒绝
  if (view.result) return { type: 'continueEvent' };
  const enabled = view.choices.filter((c) => c.enabled).map((c) => c.id);
  return { type: 'chooseEventOption', choiceId: choose(enabled) ?? view.choices[0].id };
}

// ---------- randomBot ----------

export const randomBot: Bot = {
  name: 'random',

  setup(content, mapId, difficultyId, unlocked, rng) {
    const map = content.maps.get(mapId);
    const diff = content.difficulties.get(difficultyId);
    if (!map || !diff) return { party: [], items: {} };
    const pool = shuffle(
      unlocked.filter((id) => content.characters.has(id)),
      rng,
    );
    const size = Math.min(
      pool.length,
      map.partySize.min + Math.floor(rng() * (map.partySize.max - map.partySize.min + 1)),
    );
    const party: string[] = [];
    let points = diff.points;
    for (const id of pool) {
      const cost = content.characters.get(id)?.cost ?? 0;
      if (party.length < size && (cost <= points || party.length < map.partySize.min)) {
        party.push(id);
        points -= cost;
      }
    }
    const items: Record<string, number> = {};
    const buyable = map.startingPool.filter((id) => content.items.get(id)?.cost !== undefined);
    for (let i = 0; i < 200 && buyable.length; i++) {
      const id = pick(buyable, rng)!;
      const def = content.items.get(id)!;
      const cost = def.cost ?? 0;
      if (cost > points || (def.maxAtStart !== undefined && (items[id] ?? 0) >= def.maxAtStart)) {
        if (cost > points) buyable.splice(buyable.indexOf(id), 1);
        continue;
      }
      items[id] = (items[id] ?? 0) + 1;
      points -= cost;
      if (rng() < 0.05) break;
    }
    return { party, items };
  },

  act(env, rng) {
    const ev = eventAct(env, (enabled) => pick(enabled, rng));
    if (ev) return ev;
    const { run, content } = env;
    if (rng() < 0.45) return { type: 'endDay' };
    const chars = shelterIds(run);
    const kind = rng();
    if (kind < 0.12 && !run.expedition && !run.plan.expedition && chars.length) {
      const charId = pick(chars, rng)!;
      const loc = pick(legalLocations(env, charId), rng);
      const plan = loc && buildPlan(env, charId, loc.id);
      if (plan) return { type: 'planExpedition', ...plan };
    } else if (kind < 0.2) {
      const usable = content.db.items.filter((i) => i.manualUse && (run.inventory[i.id] ?? 0) > 0);
      const item = pick(usable, rng);
      const charId = pick(chars, rng);
      if (item && charId) return { type: 'useItem', itemId: item.id, charId };
    } else if (chars.length && content.config.rationTags.length) {
      const charId = pick(chars, rng)!;
      const tag = pick(content.config.rationTags, rng)!;
      const itemId = pick(rationItemsInStock(env, tag), rng);
      if (itemId) return { type: 'setRation', charId, tag, itemId };
    }
    return { type: 'endDay' };
  },
};

// ---------- sensibleBot ----------

/** 每个配给标签库存可支撑的人天数低于此值时考虑外出 */
const LOW_SUPPLY_DAYS = 3;
/** 开局留给工具的点数比例 */
const TOOL_RESERVE = 0.15;
/** 队员花费不超过总点数的这个比例 */
const PARTY_BUDGET = 0.4;

function itemValuePerCost(content: Content, item: ItemDef, tag: string): number {
  const ts = tagStat(content, tag);
  const gain = ts ? (statGains(item)[ts.stat] ?? 0) : 0;
  return gain / Math.max(item.cost ?? 0, 0.5);
}

/** 当前每个人该吃哪些配给：返回 charId → tag → itemId（库存不够时优先给最缺的人） */
function desiredRations(env: Env): Record<string, Record<string, string>> {
  const { content, run } = env;
  const want: Record<string, Record<string, string>> = {};
  const chars = shelterIds(run);
  for (const tag of content.config.rationTags) {
    const ts = tagStat(content, tag);
    const stock: Record<string, number> = {};
    const candidates = content.db.items.filter(
      (i) => i.tags.includes(tag) && (run.inventory[i.id] ?? 0) > 0,
    );
    for (const i of candidates) stock[i.id] = run.inventory[i.id];
    const order = [...chars].sort(
      (a, b) =>
        (ts ? statRatio(content, env, a, ts.stat) - statRatio(content, env, b, ts.stat) : 0) ||
        chars.indexOf(a) - chars.indexOf(b),
    );
    for (const id of order) {
      const ratio = ts ? statRatio(content, env, id, ts.stat) : 0;
      if (ratio >= 0.9) continue; // 基本是满的，不浪费
      // 物品选择：需求越大用越强的；先用能补满的里最弱的
      const have = candidates.filter((i) => stock[i.id] > 0);
      if (!have.length) break;
      const gainOf = (i: ItemDef) => (ts ? (statGains(i)[ts.stat] ?? 0) : 0);
      const def = content.stats.get(ts?.stat ?? '');
      const deficit = def ? (1 - ratio) * (def.max - def.min) : 0;
      const sorted = [...have].sort((a, b) => gainOf(a) - gainOf(b));
      const fit = sorted.find((i) => gainOf(i) >= deficit) ?? sorted[sorted.length - 1];
      stock[fit.id]--;
      (want[id] ??= {})[tag] = fit.id;
    }
  }
  return want;
}

function supplyLow(env: Env): boolean {
  const { content, run } = env;
  const people = Math.max(1, shelterIds(run).length);
  for (const tag of content.config.rationTags) {
    if (!tagStat(content, tag)) continue;
    let count = 0;
    for (const i of content.db.items) if (i.tags.includes(tag)) count += run.inventory[i.id] ?? 0;
    if (count < LOW_SUPPLY_DAYS * people) return true;
  }
  return false;
}

export const sensibleBot: Bot = {
  name: 'sensible',

  setup(content, mapId, difficultyId, unlocked, rng) {
    const map = content.maps.get(mapId);
    const diff = content.difficulties.get(difficultyId);
    if (!map || !diff) return { party: [], items: {} };
    const budget = diff.points;
    const costOf = (id: string) => content.characters.get(id)?.cost ?? 0;

    // 队伍：随机顺序，在预算比例内尽量招满，至少满足最小人数
    const pool = shuffle(
      unlocked.filter((id) => content.characters.has(id)),
      rng,
    );
    const party: string[] = [];
    let spent = 0;
    for (const id of pool) {
      if (party.length >= map.partySize.max) break;
      if (spent + costOf(id) <= budget * PARTY_BUDGET) {
        party.push(id);
        spent += costOf(id);
      }
    }
    for (const id of [...pool].sort((a, b) => costOf(a) - costOf(b))) {
      if (party.length >= map.partySize.min) break;
      if (!party.includes(id)) {
        party.push(id);
        spent += costOf(id);
      }
    }

    // 物品
    const items: Record<string, number> = {};
    let points = budget - spent;
    const allowed = (i: ItemDef) =>
      i.cost !== undefined && map.startingPool.includes(i.id) && content.items.has(i.id);
    const canBuy = (i: ItemDef) =>
      (i.cost ?? 0) <= points && (i.maxAtStart === undefined || (items[i.id] ?? 0) < i.maxAtStart);
    const buy = (i: ItemDef) => {
      items[i.id] = (items[i.id] ?? 0) + 1;
      points -= i.cost ?? 0;
    };
    const rationTags = content.config.rationTags;
    const isRation = (i: ItemDef) => i.tags.some((t) => rationTags.includes(t));

    // 工具：先留预算，每种买 1 个（便宜的、能用的优先）
    let toolBudget = Math.floor(budget * TOOL_RESERVE);
    const tools = content.db.items
      .filter((i) => allowed(i) && !isRation(i))
      .sort(
        (a, b) =>
          Number(!!b.manualUse) - Number(!!a.manualUse) ||
          Number(!!b.rules?.length) - Number(!!a.rules?.length) ||
          (a.cost ?? 0) - (b.cost ?? 0),
      );
    for (const t of tools) {
      if ((t.cost ?? 0) <= toolBudget && canBuy(t)) {
        buy(t);
        toolBudget -= t.cost ?? 0;
      }
    }

    // 食物与水：每个标签挑性价比最高的，轮流买
    const bestPerTag = rationTags
      .map((tag) =>
        content.db.items
          .filter((i) => allowed(i) && i.tags.includes(tag))
          .sort((a, b) => itemValuePerCost(content, b, tag) - itemValuePerCost(content, a, tag)),
      )
      .filter((l) => l.length);
    for (let guard = 0; guard < 5000; guard++) {
      let bought = false;
      for (const list of bestPerTag) {
        const item = list.find(canBuy);
        if (item) {
          buy(item);
          bought = true;
        }
      }
      if (!bought) break;
    }
    return { party, items };
  },

  act(env) {
    const ev = eventAct(env, (enabled) => enabled[0]);
    if (ev) return ev;
    const { run, content } = env;
    const chars = shelterIds(run);

    // 1. 治疗：有 manualUse 物品且能去掉某人身上的状态
    for (const item of content.db.items) {
      if (!item.manualUse || (run.inventory[item.id] ?? 0) < 1) continue;
      const cures = new Set<string>();
      walkEffects(item.onUse, (e) => {
        if ('removeStatus' in e) cures.add(e.removeStatus);
      });
      for (const id of chars) {
        if (run.characters[id].statuses.some((s) => cures.has(s.id))) {
          return { type: 'useItem', itemId: item.id, charId: id };
        }
      }
    }

    // 2. 配给
    const want = desiredRations(env);
    for (const id of chars) {
      for (const tag of content.config.rationTags) {
        const target = want[id]?.[tag];
        if (target && run.plan.rations[id]?.[tag] !== target) {
          return { type: 'setRation', charId: id, tag, itemId: target };
        }
      }
    }

    // 3. 补给不足且没人外出：派状态最好的人去最安全的合法地点
    if (!run.expedition && !run.plan.expedition && chars.length && supplyLow(env)) {
      const ranked = [...chars].sort((a, b) => wellbeing(env, b) - wellbeing(env, a));
      for (const charId of ranked) {
        const locs = legalLocations(env, charId).sort(
          (a, b) => a.danger - b.danger || a.distance - b.distance,
        );
        const plan = locs[0] && buildPlan(env, charId, locs[0].id);
        if (plan) return { type: 'planExpedition', ...plan };
      }
    }
    return { type: 'endDay' };
  },
};

export const BOTS: Record<string, Bot> = { sensible: sensibleBot, random: randomBot };
