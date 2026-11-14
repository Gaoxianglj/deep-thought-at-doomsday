/** 模拟用策略。纯逻辑，不依赖 DOM / Node。策略里不得出现任何具体内容 id。 */
import {
  getEventView,
  shelterIds,
  validateExpeditionPlan,
  type Action,
  type Content,
  type Effect,
  type Condition,
  type Env,
  type ExpeditionPlan,
  type ItemDef,
} from '../engine';

/** 每局一份、由 simulateRun 创建并传给 setup / act 的 bot 私有记忆（bot 自己不得持有跨局的全局状态） */
export type BotMemory = Record<string, unknown>;

export interface Bot {
  name: string;
  /** 开局选择：返回 party 与 items（必须通过 validateSetup） */
  setup(
    content: Content,
    mapId: string,
    difficultyId: string,
    unlocked: string[],
    rng: () => number,
    mem?: BotMemory,
  ): { party: string[]; items: Record<string, number> };
  /** 返回本次要执行的一个动作；plan 阶段做完想做的事后返回 { type: 'endDay' } */
  act(env: Env, rng: () => number, mem?: BotMemory): Action;
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

// ---------- fuzzBot ----------

/** 引擎应当拒绝（返回错误码）的"类型合法但语义非法"的动作。只用数据里的 id 与固定的假 id，不写具体内容。 */
function illegalAction(env: Env, rng: () => number): Action {
  const { run, content } = env;
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
  const anyChar = pick([...run.party, 'no_such_char'], rng)!;
  const deadChar = pick(
    run.party.filter((id) => run.characters[id]?.where !== 'shelter'),
    rng,
  );
  const anyItem = pick([...ids(content.db.items), 'no_such_item'], rng)!;
  const anyTag = pick([...content.config.rationTags, 'no_such_tag'], rng)!;
  const anyLoc = pick([...ids(content.db.locations), 'no_such_location'], rng)!;
  const charId = pick([anyChar, deadChar ?? anyChar], rng)!;
  const carry = Array.from({ length: Math.floor(rng() * 4) }, () =>
    pick([...ids(content.db.items), 'no_such_item'], rng)!,
  );

  const kinds: Action[] = [
    { type: 'setRation', charId, tag: anyTag, itemId: pick([anyItem, null], rng)! },
    { type: 'useItem', itemId: anyItem, charId },
    { type: 'planExpedition', charId, locationId: anyLoc, carry },
    { type: 'planExpedition', charId, locationId: anyLoc, carry, vehicleId: anyItem },
    { type: 'cancelExpedition' },
    { type: 'endDay' },
    { type: 'continueEvent' },
    { type: 'chooseEventOption', choiceId: 'no_such_choice' },
  ];
  // 事件阶段里尽量发"计划阶段"的动作，计划阶段里尽量发"事件阶段"的动作，凑出错阶段的情形
  if (run.phase === 'plan' && rng() < 0.4) {
    return pick(kinds.slice(6), rng)!;
  }
  if (run.phase === 'event' && rng() < 0.6) {
    return pick(kinds.slice(0, 6), rng)!;
  }
  return pick(kinds, rng)!;
}

/**
 * 模糊测试 bot：约 35% 的动作是非法动作（错阶段、不存在 / 已死亡 / 外出中的角色、
 * 错配的物品与标签、越界的携带……），其余照 randomBot 正常玩，保证对局能推进。
 * 用来检查引擎：不抛异常、只返回错误码、被拒绝时状态不变。
 */
export const fuzzBot: Bot = {
  name: 'fuzz',
  setup: (content, mapId, difficultyId, unlocked, rng) =>
    randomBot.setup(content, mapId, difficultyId, unlocked, rng),
  act(env, rng, mem) {
    if (rng() < 0.35) return illegalAction(env, rng);
    return randomBot.act(env, rng, mem);
  },
};

// ---------- sensibleBot ----------

/**
 * 策略参数。同一套决策逻辑，不同参数 = 不同"风格"的玩家，用来量难度的上下界。
 * 所有参数都与具体内容无关。
 */
export interface Policy {
  /** 队员花费不超过总点数的这个比例 */
  partyBudget: number;
  /** 开局留给工具的点数比例 */
  toolReserve: number;
  /** 每个配给标签库存可支撑的人天数低于此值时视为"物资告急"，会外出补给 */
  lowSupplyDays: number;
  /** 物资充足时，外出者的整体状态须不低于此值（0-1） */
  exploreMinWellbeing: number;
  /** 物资充足时是否也出门探索（false = 只在告急时外出） */
  exploreWhenSafe: boolean;
  /** 物资充足时探索，外出后庇护所里至少要留的人数 */
  exploreMinHome: number;
  /** 选地点时对危险的厌恶：得分 = 配给收益 / (1 + danger × dangerWeight) */
  dangerWeight: number;
}

export const DEFAULT_POLICY: Policy = {
  partyBudget: 0.4,
  toolReserve: 0.55,
  lowSupplyDays: 3,
  exploreMinWellbeing: 0.5,
  exploreWhenSafe: true,
  exploreMinHome: 1,
  dangerWeight: 4,
};

/** 各风格的预设（相对 DEFAULT_POLICY 的差异） */
export const POLICY_PRESETS: Record<string, Partial<Policy>> = {
  /** 默认：稳健，物资告急就外出，否则轮流探索 */
  sensible: {},
  /** 龟缩：只在物资告急时才出门，且尽量挑安全的地方 */
  turtle: { exploreWhenSafe: false, lowSupplyDays: 2, dangerWeight: 8 },
  /** 激进：频繁出门，不太在乎危险和身体状态，少买工具 */
  explorer: {
    lowSupplyDays: 6,
    exploreMinWellbeing: 0.2,
    exploreMinHome: 0,
    dangerWeight: 0.5,
    toolReserve: 0.35,
  },
};

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

function supplyLow(env: Env, lowSupplyDays: number): boolean {
  const { content, run } = env;
  const people = Math.max(1, shelterIds(run).length);
  for (const tag of content.config.rationTags) {
    if (!tagStat(content, tag)) continue;
    let count = 0;
    for (const i of content.db.items) if (i.tags.includes(tag)) count += run.inventory[i.id] ?? 0;
    if (count < lowSupplyDays * people) return true;
  }
  return false;
}

/** 策略 bot 的每局记忆：各地点已去过几次 */
function visitsOf(mem: BotMemory): Record<string, number> {
  return ((mem.visits as Record<string, number> | undefined) ??= {}) as Record<string, number>;
}

/** 递归收集条件里出现的 hasItem / carrying 物品 id */
function itemRefsIn(cond: Condition | undefined, out: Set<string>): void {
  if (!cond) return;
  if ('carrying' in cond) out.add(cond.carrying);
  else if ('hasItem' in cond) out.add(cond.hasItem);
  else if ('all' in cond) for (const c of cond.all) itemRefsIn(c, out);
  else if ('any' in cond) for (const c of cond.any) itemRefsIn(c, out);
  else if ('not' in cond) itemRefsIn(cond.not, out);
}

/** 事件触发条件 / 地点特殊事件条件所依赖的物品（买了才可能解锁相应内容） */
function enablerItems(content: Content): Set<string> {
  const out = new Set<string>();
  for (const e of content.db.events) itemRefsIn(e.when, out);
  for (const l of content.db.locations) for (const sp of l.specials ?? []) itemRefsIn(sp.when, out);
  return out;
}

/** 递归收集条件里出现的 carrying 物品 id */
function carryingIn(cond: Condition | undefined, out: Set<string>): void {
  if (!cond) return;
  if ('carrying' in cond) out.add(cond.carrying);
  else if ('all' in cond) for (const c of cond.all) carryingIn(c, out);
  else if ('any' in cond) for (const c of cond.any) carryingIn(c, out);
  else if ('not' in cond) carryingIn(cond.not, out);
}

/** 目的地的 specials 需要携带的、且库存里有的物品（受携带格数限制，非配给物品） */
function carryFor(env: Env, locationId: string): string[] {
  const { content, run } = env;
  const loc = content.locations.get(locationId);
  const slots = content.maps.get(run.mapId)?.expedition.carrySlots ?? 0;
  const wanted = new Set<string>();
  for (const sp of loc?.specials ?? []) carryingIn(sp.when, wanted);
  const rationTags = content.config.rationTags;
  const carry: string[] = [];
  for (const id of wanted) {
    const item = content.items.get(id);
    if (!item || item.tags.some((t) => rationTags.includes(t))) continue;
    if ((run.inventory[id] ?? 0) >= 1 && carry.length < slots) carry.push(id);
  }
  return carry;
}

/** 某地点战利品里"配给类物品"的期望价值（用于物资告急时选目的地） */
function rationLootValue(content: Content, locationId: string): number {
  const loc = content.locations.get(locationId);
  if (!loc) return 0;
  const rationTags = content.config.rationTags;
  const total = loc.loot.reduce((a, l) => a + l.weight, 0) || 1;
  let value = 0;
  for (const l of loc.loot) {
    const item = content.items.get(l.item);
    if (!item?.tags.some((t) => rationTags.includes(t))) continue;
    value += (l.weight / total) * ((l.min ?? 1) + (l.max ?? l.min ?? 1)) * 0.5;
  }
  return value * loc.lootRolls;
}

// ---------- 事件选项打分 ----------

function scoreEffects(env: Env, effects: Effect[] | undefined): number {
  const { content } = env;
  let score = 0;
  for (const e of effects ?? []) {
    if ('stat' in e) {
      const def = content.stats.get(e.stat);
      const range = def ? Math.max(1, def.max - def.min) : 100;
      const mul = typeof e.of === 'string' && e.of === 'all' ? 2 : 1;
      if (e.add !== undefined) score += (e.add / range) * 20 * mul;
    } else if ('addStatus' in e) score -= 4 * (e.chance ?? 1);
    else if ('removeStatus' in e) score += 4;
    else if ('item' in e) {
      const isPart = content.items.get(e.item)?.tags.includes('part');
      score += e.add > 0 ? (isPart ? 6 : 1.5) * e.add : 1 * e.add;
    } else if ('loseRandomItem' in e) score -= 2 * (e.loseRandomItem.count ?? 1);
    else if ('setFlag' in e) score += e.value ? 6 : 0;
    else if ('joinParty' in e) score += 10;
    else if ('unlock' in e) score += 8;
    else if ('leaveParty' in e) score -= e.reason === 'dead' ? 20 : 12;
    else if ('queueEvent' in e) score += 1;
    else if ('ending' in e) score += content.endings.get(e.ending)?.kind === 'death' ? -30 : 30;
    else if ('if' in e) {
      score += (scoreEffects(env, e.then) + scoreEffects(env, e.else)) / 2;
    } else if ('random' in e) {
      const total = e.random.reduce((a, r) => a + (r.weight ?? 1), 0) || 1;
      for (const r of e.random) score += ((r.weight ?? 1) / total) * scoreEffects(env, r.effects);
    }
  }
  return score;
}

/** 选项的期望得分：按 outcome 权重取平均，忽略 when */
function scoreChoice(env: Env, eventId: string, choiceId: string): number {
  const choice = env.content.events.get(eventId)?.choices.find((c) => c.id === choiceId);
  if (!choice || !choice.outcomes.length) return 0;
  const total = choice.outcomes.reduce((a, o) => a + (o.weight ?? 1), 0) || 1;
  let score = 0;
  for (const o of choice.outcomes) {
    let s = scoreEffects(env, o.effects);
    if (o.next) s += 0.5;
    score += ((o.weight ?? 1) / total) * s;
  }
  return score;
}

function bestChoice(env: Env, enabled: string[]): string | undefined {
  const eventId = env.run.pendingEvent?.eventId;
  if (!eventId) return enabled[0];
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const id of enabled) {
    const s = scoreChoice(env, eventId, id);
    if (s > bestScore + 1e-9) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

/** 用一套策略参数造一个 bot */
export function makePolicyBot(name: string, overrides: Partial<Policy> = {}): Bot {
  const policy: Policy = { ...DEFAULT_POLICY, ...overrides };
  return {
    name,
    setup: (content, mapId, difficultyId, unlocked, rng) =>
      policySetup(policy, content, mapId, difficultyId, unlocked, rng),
    act: (env, _rng, mem = {}) => policyAct(policy, env, mem),
  };
}

function policySetup(
  policy: Policy,
  content: Content,
  mapId: string,
  difficultyId: string,
  unlocked: string[],
  rng: () => number,
): { party: string[]; items: Record<string, number> } {
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
    if (spent + costOf(id) <= budget * policy.partyBudget) {
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

  // 工具：先留预算，每种买 1 个（按 cost 从低到高），其余点数买食物和水
  const enablers = enablerItems(content);
  let toolBudget = Math.floor(points * policy.toolReserve);
  const tools = content.db.items
    .filter((i) => allowed(i) && !isRation(i))
    .sort(
      (a, b) =>
        Number(enablers.has(b.id)) - Number(enablers.has(a.id)) || (a.cost ?? 0) - (b.cost ?? 0),
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
}

function policyAct(policy: Policy, env: Env, mem: BotMemory): Action {
  const ev = eventAct(env, (enabled) => bestChoice(env, enabled));
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

  // 3. 外出：补给不足时去能带回配给的地方；否则（有健康的人时）轮流探索各地点
  if (!run.expedition && !run.plan.expedition && chars.length) {
    const low = supplyLow(env, policy.lowSupplyDays);
    const ranked = [...chars].sort((a, b) => wellbeing(env, b) - wellbeing(env, a));
    for (const charId of ranked) {
      if (
        !low &&
        (!policy.exploreWhenSafe ||
          chars.length < policy.exploreMinHome + 1 ||
          wellbeing(env, charId) < policy.exploreMinWellbeing)
      )
        continue;
      const locs = legalLocations(env, charId);
      if (!locs.length) continue;
      const seen = visitsOf(mem);
      const visits = (id: string) => seen[id] ?? 0;
      const pickLoc = low
        ? locs.sort(
            (a, b) =>
              rationLootValue(content, b.id) / (1 + b.danger * policy.dangerWeight) -
                rationLootValue(content, a.id) / (1 + a.danger * policy.dangerWeight) ||
              visits(a.id) - visits(b.id),
          )[0]
        : locs.sort(
            (a, b) => visits(a.id) - visits(b.id) || a.danger - b.danger || a.distance - b.distance,
          )[0];
      const plan = buildPlan(env, charId, pickLoc.id);
      if (!plan) continue;
      plan.carry = carryFor(env, pickLoc.id);
      if (validateExpeditionPlan(env, plan)) continue;
      seen[pickLoc.id] = visits(pickLoc.id) + 1;
      return { type: 'planExpedition', ...plan };
    }
  }
  return { type: 'endDay' };
}

export const sensibleBot: Bot = makePolicyBot('sensible', POLICY_PRESETS.sensible);
export const turtleBot: Bot = makePolicyBot('turtle', POLICY_PRESETS.turtle);
export const explorerBot: Bot = makePolicyBot('explorer', POLICY_PRESETS.explorer);

export const BOTS: Record<string, Bot> = {
  sensible: sensibleBot,
  turtle: turtleBot,
  explorer: explorerBot,
  random: randomBot,
  fuzz: fuzzBot,
};

const POLICY_KEYS = Object.keys(DEFAULT_POLICY) as (keyof Policy)[];

/**
 * 把 bot 描述串解析成 bot：`sensible`，或带参数覆盖的 `sensible:toolReserve=0.3,dangerWeight=2`。
 * 只有策略型 bot（sensible / turtle / explorer）支持参数覆盖。返回 string 表示错误信息。
 */
export function resolveBot(spec: string): Bot | string {
  const [name, rest] = spec.split(':', 2);
  const preset = POLICY_PRESETS[name];
  if (rest === undefined)
    return BOTS[name] ?? `未知策略: ${name}（可选: ${Object.keys(BOTS).join('、')}）`;
  if (!preset)
    return `只有策略型 bot（${Object.keys(POLICY_PRESETS).join('、')}）支持参数覆盖: ${name}`;
  const overrides: Partial<Policy> = { ...preset };
  for (const pair of rest.split(',').filter(Boolean)) {
    const [key, raw] = pair.split('=', 2);
    if (!POLICY_KEYS.includes(key as keyof Policy))
      return `未知策略参数: ${key}（可选: ${POLICY_KEYS.join('、')}）`;
    const value = key === 'exploreWhenSafe' ? raw === 'true' : Number(raw);
    if (typeof value === 'number' && !Number.isFinite(value)) return `参数 ${key} 需要数字: ${raw}`;
    (overrides as Record<string, number | boolean>)[key] = value;
  }
  return makePolicyBot(spec, overrides);
}

/** 当前策略参数 + 覆盖项 → 描述串（resolveBot 的逆运算） */
export function policySpec(base: string, overrides: Partial<Policy>): string {
  const pairs = Object.entries(overrides).map(
    ([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`,
  );
  return pairs.length ? `${base}:${pairs.join(',')}` : base;
}
