/** 模拟用策略。纯逻辑，不依赖 DOM / Node。策略里不得出现任何具体内容 id。 */
import {
  aliveIds,
  evalCondition,
  getEventView,
  shelterIds,
  validateExpeditionPlan,
  type Action,
  type Content,
  type Effect,
  type Condition,
  type Env,
  type EventDef,
  type ExpeditionPlan,
  type ItemDef,
  type Rule,
  type Scope,
} from '../engine';

type ChoiceDef = EventDef['choices'][number];

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
  /**
   * 追目标的力度（0 = 不追）：去"会触发东西"的地点（地点专属事件 / 外出归来时的全局规则命中）
   * 加分 goalWeight × 期望触发次数 / (1 + danger × dangerWeight)；有目标时即使 exploreWhenSafe 为 false 也会出门。
   */
  goalWeight: number;
}

export const DEFAULT_POLICY: Policy = {
  partyBudget: 0.4,
  toolReserve: 0.55,
  lowSupplyDays: 3,
  exploreMinWellbeing: 0.5,
  exploreWhenSafe: true,
  exploreMinHome: 1,
  dangerWeight: 4,
  goalWeight: 4,
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

/** 策略 bot 的每局记忆：为追目标去过各地点几次 */
function goalTripsOf(mem: BotMemory): Record<string, number> {
  return ((mem.goalTrips as Record<string, number> | undefined) ??= {}) as Record<string, number>;
}

/** 递归收集条件里出现的 hasItem / carrying 物品 id */
function itemRefsIn(
  cond: Condition | undefined,
  out: Set<string>,
  flags?: Record<string, unknown>,
): void {
  if (!cond) return;
  if ('carrying' in cond) out.add(cond.carrying);
  else if ('hasItem' in cond) out.add(cond.hasItem);
  else if ('hasFlagItem' in cond) {
    // flag 里存的物品 id（如本局随机的撤离凭证）；开局时还不知道，传了 flags 才收集
    const id = flags?.[cond.hasFlagItem];
    if (typeof id === 'string') out.add(id);
  } else if ('all' in cond) for (const c of cond.all) itemRefsIn(c, out, flags);
  else if ('any' in cond) for (const c of cond.any) itemRefsIn(c, out, flags);
  else if ('not' in cond) itemRefsIn(cond.not, out, flags);
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

/**
 * 求值用的副本：条件里的 `chance` 会推进 run.rng（run 上的一个数字字段），打分时还会在副本上
 * "心算"标记与库存的增减，所以浅拷贝 run 并单独拷贝 flags / inventory；真实对局状态不受影响。
 */
function sandbox(env: Env): Env {
  const { run } = env;
  return {
    content: env.content,
    run: { ...run, flags: { ...run.flags }, inventory: { ...run.inventory } },
  };
}

/** 某配给标签的库存可撑天数（库存 ÷ 活人数）→ 每失去一件的代价：越紧张越贵 */
function rationLossCost(sim: Env, tag: string): number {
  const { run, content } = sim;
  let stock = 0;
  for (const i of content.db.items) if (i.tags.includes(tag)) stock += run.inventory[i.id] ?? 0;
  const days = stock / Math.max(1, aliveIds(run).length);
  return days > 4 ? 1 : days >= 2 ? 3 : 10;
}

/** 在副本里扣掉该标签库存最多的一件（供后续效果按扣减后的库存估价） */
function takeOneOfTag(sim: Env, tag: string): void {
  const { run, content } = sim;
  const best = content.db.items
    .filter((i) => i.tags.includes(tag) && (run.inventory[i.id] ?? 0) > 0)
    .sort((a, b) => run.inventory[b.id] - run.inventory[a.id])[0];
  if (best) run.inventory[best.id]--;
}

const rationTagOf = (content: Content, itemId: string): string | undefined =>
  content.items.get(itemId)?.tags.find((t) => content.config.rationTags.includes(t));

/** 库存增减（item / flagItem 效果）的得分；在副本里同步改库存 */
function scoreItemChange(sim: Env, itemId: string, add: number): number {
  const { content, run } = sim;
  const item = content.items.get(itemId);
  if (!item || add === 0) return 0;
  if (add > 0) {
    run.inventory[itemId] = (run.inventory[itemId] ?? 0) + add;
    return (item.tags.includes('part') ? 6 : 1.5) * add;
  }
  const tag = rationTagOf(content, itemId);
  let score = 0;
  for (let n = 0; n < -add && (run.inventory[itemId] ?? 0) > 0; n++) {
    score -= tag ? rationLossCost(sim, tag) : 1;
    run.inventory[itemId]--;
  }
  return score;
}

// ---------- 标记的"方向"：哪些标记往哪边变才是在靠近（非死亡）结局 ----------

/** 某标记朝哪个方向变化算靠近结局 */
interface FlagDir {
  up: boolean;
  down: boolean;
  truthy: boolean;
  falsy: boolean;
}

interface GoalInfo {
  /** 守着非死亡结局的条件：结局的 when、带结局效果的事件 / 选项 / 结果 / if / 规则的条件 */
  guards: { cond: Condition; positive: boolean }[];
  dirs: Map<string, FlagDir>;
}

const goalInfoCache = new WeakMap<Content, GoalInfo>();

/**
 * 标记朝结局方向走一步的分值。与上交物资的代价（每件 1 / 3 / 10，见 rationLossCost）对照：
 * 一次交 2 件时，库存可撑 2 天以上就交，不到 2 天就先不交。
 */
const FLAG_STEP = 8;

const isGoodEnding = (content: Content, id: string) => {
  const kind = content.endings.get(id)?.kind;
  return kind !== undefined && kind !== 'death';
};

/** 收集效果列表里通往非死亡结局的 if 条件；返回列表里是否有非死亡结局 */
function endingPath(
  content: Content,
  effects: Effect[] | undefined,
  out: { cond: Condition; positive: boolean }[],
): boolean {
  let found = false;
  for (const e of effects ?? []) {
    if ('ending' in e && isGoodEnding(content, e.ending)) found = true;
    else if ('if' in e) {
      if (endingPath(content, e.then, out)) {
        out.push({ cond: e.if, positive: true });
        found = true;
      }
      if (endingPath(content, e.else, out)) {
        out.push({ cond: e.if, positive: false });
        found = true;
      }
    } else if ('random' in e) {
      for (const r of e.random) if (endingPath(content, r.effects, out)) found = true;
    }
  }
  return found;
}

function flagDirsIn(cond: Condition, positive: boolean, dirs: Map<string, FlagDir>): void {
  if ('all' in cond) for (const c of cond.all) flagDirsIn(c, positive, dirs);
  else if ('any' in cond) for (const c of cond.any) flagDirsIn(c, positive, dirs);
  else if ('not' in cond) flagDirsIn(cond.not, !positive, dirs);
  else if ('flag' in cond) {
    const d = dirs.get(cond.flag) ?? { up: false, down: false, truthy: false, falsy: false };
    const lower = cond.lt !== undefined || cond.lte !== undefined;
    const higher = cond.gt !== undefined || cond.gte !== undefined;
    if (lower || higher) {
      if (lower) d[positive ? 'down' : 'up'] = true;
      if (higher) d[positive ? 'up' : 'down'] = true;
    } else if (cond.eq === undefined) {
      const wantTrue = cond.is === undefined ? positive : !!cond.is === positive;
      d[wantTrue ? 'truthy' : 'falsy'] = true;
    }
    dirs.set(cond.flag, d);
  }
}

function goalInfo(content: Content): GoalInfo {
  const cached = goalInfoCache.get(content);
  if (cached) return cached;
  // targets：结局成立时应当满足的状态（结局 when、结果 when、通往结局的 if、规则 when）→ 推出标记方向；
  // guards 另含事件 when 与选项 requires（"能走这条路"的前提，如出示凭证）→ 只用来判断物品能否解锁内容
  const targets: GoalInfo['guards'] = [];
  const guards: GoalInfo['guards'] = [];
  for (const end of content.db.endings)
    if (end.when && end.kind !== 'death') targets.push({ cond: end.when, positive: true });
  for (const ev of content.db.events) {
    for (const c of ev.choices) {
      for (const o of c.outcomes) {
        if (!endingPath(content, o.effects, targets)) continue;
        if (o.when) targets.push({ cond: o.when, positive: true });
        for (const cond of [ev.when, c.requires]) if (cond) guards.push({ cond, positive: true });
      }
    }
  }
  const rules = [
    ...content.db.maps.flatMap((m) => m.rules ?? []),
    ...content.db.items.flatMap((i) => i.rules ?? []),
  ];
  for (const r of rules)
    if (endingPath(content, r.effects, targets) && r.when)
      targets.push({ cond: r.when, positive: true });
  const dirs = new Map<string, FlagDir>();
  for (const g of targets) flagDirsIn(g.cond, g.positive, dirs);
  // 两个方向都想要 = 说不清，当作无关
  for (const [k, d] of dirs) if ((d.up && d.down) || (d.truthy && d.falsy)) dirs.delete(k);
  const info = { guards: [...targets, ...guards], dirs };
  goalInfoCache.set(content, info);
  return info;
}

/**
 * 一段效果前后标记的净变化得分：朝结局方向 +FLAG_STEP、背离 −FLAG_STEP；与结局无关的标记被设为真值 / 数字变化 +1；
 * 第一次写入（原来没有）算初始化，+1（例如"车队报出还需要几份水"不能算成倒退）。
 */
function flagDelta(
  content: Content,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): number {
  const { dirs } = goalInfo(content);
  let score = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (a === b) continue;
    if (a === undefined) {
      score += b ? 1 : 0;
      continue;
    }
    const dir = dirs.get(key);
    let s = 0;
    if (dir && (typeof a === 'number' || typeof b === 'number')) {
      const d = (typeof b === 'number' ? b : 0) - (typeof a === 'number' ? a : 0);
      if ((d < 0 && dir.down) || (d > 0 && dir.up)) s += FLAG_STEP;
      if ((d < 0 && dir.up) || (d > 0 && dir.down)) s -= FLAG_STEP;
    } else if (dir && !!a !== !!b) {
      if (b ? dir.truthy : dir.falsy) s += FLAG_STEP;
      if (b ? dir.falsy : dir.truthy) s -= FLAG_STEP;
    }
    score += s !== 0 ? s : b ? 1 : 0;
  }
  return score;
}

/**
 * 效果列表的得分。sim 是 sandbox 副本：按顺序"心算"标记与库存的变化，
 * 这样后面的 `if`（例如"交完这批是否就交齐了"）按变化后的状态选分支；标记按整段的净变化计分。
 */
function scoreEffects(sim: Env, scope: Scope, effects: Effect[] | undefined): number {
  const before = { ...sim.run.flags };
  const s = scoreRaw(sim, scope, effects);
  return s + flagDelta(sim.content, before, sim.run.flags);
}

function scoreRaw(sim: Env, scope: Scope, effects: Effect[] | undefined): number {
  const { content, run } = sim;
  let score = 0;
  for (const e of effects ?? []) {
    if ('stat' in e) {
      const def = content.stats.get(e.stat);
      const range = def ? Math.max(1, def.max - def.min) : 100;
      const mul = typeof e.of === 'string' && e.of === 'all' ? 2 : 1;
      if (e.add !== undefined) score += (e.add / range) * 20 * mul;
    } else if ('addStatus' in e) score -= 4 * (e.chance ?? 1);
    else if ('removeStatus' in e) score += 4;
    else if ('item' in e) score += scoreItemChange(sim, e.item, e.add);
    else if ('flagItem' in e) {
      const id = run.flags[e.flagItem];
      if (typeof id === 'string') score += scoreItemChange(sim, id, e.add);
    } else if ('loseRandomItem' in e) {
      const { tag, count = 1 } = e.loseRandomItem;
      for (let n = 0; n < count; n++) {
        if (tag && content.config.rationTags.includes(tag)) {
          score -= rationLossCost(sim, tag);
          takeOneOfTag(sim, tag);
        } else score -= 2;
      }
    } else if ('setFlag' in e) run.flags[e.setFlag] = e.value;
    else if ('addFlag' in e) {
      const cur = run.flags[e.addFlag];
      run.flags[e.addFlag] = (typeof cur === 'number' ? cur : 0) + e.add;
    } else if ('pickFlags' in e || 'queueEvent' in e) score += 1;
    else if ('joinParty' in e) score += 10;
    else if ('unlock' in e) score += 8;
    else if ('leaveParty' in e) score -= e.reason === 'dead' ? 20 : 12;
    else if ('ending' in e) score += isGoodEnding(content, e.ending) ? 100 : -60;
    else if ('if' in e) {
      const branch = evalCondition(sim, scope, e.if) ? e.then : e.else;
      score += scoreRaw(sim, scope, branch);
    } else if ('random' in e) {
      const total = e.random.reduce((a, r) => a + (r.weight ?? 1), 0) || 1;
      for (const r of e.random)
        score += ((r.weight ?? 1) / total) * scoreEffects(sandbox(sim), scope, r.effects);
    }
  }
  return score;
}

/** 选项的期望得分：先按 outcome 的 when 过滤（与引擎一致；都不满足则全算），再按权重取平均 */
function scoreChoiceDef(env: Env, scope: Scope, choice: ChoiceDef): number {
  if (!choice.outcomes.length) return 0;
  const usable = choice.outcomes.filter((o) => evalCondition(sandbox(env), scope, o.when));
  const outcomes = usable.length ? usable : choice.outcomes;
  const total = outcomes.reduce((a, o) => a + (o.weight ?? 1), 0) || 1;
  let score = 0;
  for (const o of outcomes) {
    let s = scoreEffects(sandbox(env), scope, o.effects);
    if (o.next) s += 0.5;
    score += ((o.weight ?? 1) / total) * s;
  }
  return score;
}

function scoreChoice(env: Env, eventId: string, choiceId: string): number {
  const choice = env.content.events.get(eventId)?.choices.find((c) => c.id === choiceId);
  if (!choice) return 0;
  const roles = env.run.pendingEvent?.roles ?? {};
  return scoreChoiceDef(env, { self: roles.self, roles }, choice);
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

// ---------- 目的地评估：哪里能"触发东西" ----------

/** 全局规则来源（地图、难度、当前天气、库存道具）里在外出归来时触发的规则 */
function returnRules(env: Env): Rule[] {
  const { run, content } = env;
  const all: Rule[] = [
    ...(content.maps.get(run.mapId)?.rules ?? []),
    ...(content.difficulties.get(run.difficultyId)?.rules ?? []),
    ...(run.weather ? (content.weathers.get(run.weather.id)?.rules ?? []) : []),
  ];
  for (const [id, n] of Object.entries(run.inventory))
    if (n > 0) all.push(...(content.items.get(id)?.rules ?? []));
  return all.filter((r) => r.trigger === 'expeditionReturn' && r.effects?.length);
}

/** 目标评估的上下文：一次决策内共享的规则列表与"拿到某物品能否解锁新内容"的缓存 */
interface GoalCtx {
  env: Env;
  rules: Rule[];
  enables: Map<string, boolean>;
}

/**
 * 多拿 1 件该物品，是否会让某个原本不成立的条件成立：事件的 when、地图规则的 when、
 * 守着非死亡结局的条件（如"出示凭证"选项的 requires）。
 * 例：拿到部件 → 安装事件入池；已经装好（when 里有"未安装"）就不再算。
 */
function enablesSomething(ctx: GoalCtx, itemId: string): boolean {
  const cached = ctx.enables.get(itemId);
  if (cached !== undefined) return cached;
  const { env } = ctx;
  const { content, run } = env;
  const conds: Condition[] = goalInfo(content).guards.map((g) => g.cond);
  for (const e of content.db.events) if (e.when) conds.push(e.when);
  const map = content.maps.get(run.mapId);
  for (const r of map?.rules ?? []) if (r.when) conds.push(r.when);
  const refs = new Set<string>();
  for (const c of conds) itemRefsIn(c, refs, run.flags);
  let result = false;
  if (refs.has(itemId)) {
    const after = sandbox(env);
    after.run.inventory[itemId] = (after.run.inventory[itemId] ?? 0) + 1;
    result = conds.some(
      (c) => !evalCondition(sandbox(env), {}, c) && evalCondition(sandbox(after), {}, c),
    );
  }
  ctx.enables.set(itemId, result);
  return result;
}

/**
 * 效果里"推进进度"的程度：非死亡结局 10（死亡 −10）；标记的净变化（见 flagDelta）；
 * 随机挑选标记、排队事件、入队 / 解锁、拿到能解锁新内容的物品各 1。普通物资不算（那是战利品，不是目标）。
 */
function progressOf(ctx: GoalCtx, sim: Env, scope: Scope, effects: Effect[] | undefined): number {
  const before = { ...sim.run.flags };
  const p = progressRaw(ctx, sim, scope, effects);
  return p + flagDelta(sim.content, before, sim.run.flags);
}

function progressRaw(ctx: GoalCtx, sim: Env, scope: Scope, effects: Effect[] | undefined): number {
  const { content, run } = sim;
  let p = 0;
  for (const e of effects ?? []) {
    if ('ending' in e) p += isGoodEnding(content, e.ending) ? 10 : -10;
    else if ('setFlag' in e) run.flags[e.setFlag] = e.value;
    else if ('addFlag' in e) {
      const cur = run.flags[e.addFlag];
      run.flags[e.addFlag] = (typeof cur === 'number' ? cur : 0) + e.add;
    } else if ('pickFlags' in e || 'queueEvent' in e || 'joinParty' in e || 'unlock' in e) p += 1;
    else if ('item' in e || 'flagItem' in e) {
      const id = 'item' in e ? e.item : run.flags[e.flagItem];
      if (typeof id === 'string' && e.add > 0 && enablesSomething(ctx, id)) p += 1;
    } else if ('if' in e) {
      p += progressRaw(ctx, sim, scope, evalCondition(sim, scope, e.if) ? e.then : e.else);
    } else if ('random' in e) {
      const total = e.random.reduce((a, r) => a + (r.weight ?? 1), 0) || 1;
      for (const r of e.random)
        p += ((r.weight ?? 1) / total) * progressOf(ctx, sandbox(sim), scope, r.effects);
    }
  }
  return p;
}

/** 事件最好的选项能推进多少进度（忽略 requires；outcome 按 when 过滤后按权重平均） */
function eventProgress(ctx: GoalCtx, scope: Scope, eventId: string): number {
  const { env } = ctx;
  const ev = env.content.events.get(eventId);
  let best = 0;
  for (const c of ev?.choices ?? []) {
    const usable = c.outcomes.filter((o) => evalCondition(sandbox(env), scope, o.when));
    const outcomes = usable.length ? usable : c.outcomes;
    const total = outcomes.reduce((a, o) => a + (o.weight ?? 1), 0) || 1;
    let p = 0;
    for (const o of outcomes)
      p += ((o.weight ?? 1) / total) * progressOf(ctx, sandbox(env), scope, o.effects);
    best = Math.max(best, p);
  }
  return best;
}

/**
 * 一个外出计划"会推进目标"的程度（≈ 期望触发次数）：
 * (a) 地点 specials 的 when 成立、且专属事件能推进进度（按 chance 计）；
 * (c) 战利品表里有拿到就能解锁新内容的物品（按至少抽到一次的概率计）；
 * (b) 全局 expeditionReturn 规则的 when 对这个计划成立、但对"哪儿也不去、什么也不带"的空计划不成立
 *     （排除"任何外出归来都触发"的通用规则），且其效果能推进进度（按规则 chance 计）。
 */
function goalValue(ctx: GoalCtx, plan: ExpeditionPlan): number {
  const { env } = ctx;
  const { content } = env;
  const loc = content.locations.get(plan.locationId);
  if (!loc) return 0;
  const scope: Scope = { self: plan.charId, expedition: plan };
  let value = 0;
  for (const sp of loc.specials ?? []) {
    if (!content.events.has(sp.event)) continue;
    if (!evalCondition(sandbox(env), scope, sp.when)) continue;
    if (eventProgress(ctx, { self: plan.charId, roles: { self: plan.charId } }, sp.event) > 0)
      value += sp.chance;
    break; // 引擎只检查命中的第一条
  }
  // (c) 战利品表里有能解锁新内容的物品（如稀有部件）：按"至少抽到一次"的概率计
  const total = loc.loot.reduce((a, l) => a + l.weight, 0);
  for (const l of loc.loot) {
    if (total <= 0 || !enablesSomething(ctx, l.item)) continue;
    value += 1 - Math.pow(1 - l.weight / total, Math.max(1, loc.lootRolls));
  }
  const baseline: Scope = { self: plan.charId, expedition: { ...plan, locationId: '', carry: [] } };
  for (const r of ctx.rules) {
    if (!evalCondition(sandbox(env), scope, r.when)) continue;
    if (evalCondition(sandbox(env), baseline, r.when)) continue;
    if (progressOf(ctx, sandbox(env), scope, r.effects) <= 0) continue;
    value += r.chance ?? 1;
  }
  return value;
}

/** 条件里出现的、库存里有的非配给 carrying 物品：可能是"带对东西才触发"的钥匙 */
function keyCandidates(env: Env, conds: (Condition | undefined)[]): string[] {
  const { content, run } = env;
  const wanted = new Set<string>();
  for (const c of conds) carryingIn(c, wanted);
  return [...wanted].filter(
    (id) => content.items.has(id) && !rationTagOf(content, id) && (run.inventory[id] ?? 0) >= 1,
  );
}

/** 从 list 里取不超过 k 个的所有组合（含空集） */
function subsets<T>(list: T[], k: number): T[][] {
  const out: T[][] = [[]];
  const rec = (start: number, cur: T[]) => {
    for (let i = start; i < list.length; i++) {
      const next = [...cur, list[i]];
      out.push(next);
      if (next.length < k) rec(i + 1, next);
    }
  };
  if (k > 0) rec(0, []);
  return out;
}

/** 某角色去各合法地点的目标值与对应的最佳携带组合（没有目标的地点不出现） */
function goalTargets(env: Env, charId: string): Map<string, { value: number; carry: string[] }> {
  const { content, run } = env;
  const out = new Map<string, { value: number; carry: string[] }>();
  const rules = returnRules(env);
  const ctx: GoalCtx = { env, rules, enables: new Map() };
  const slots = content.maps.get(run.mapId)?.expedition.carrySlots ?? 0;
  for (const loc of content.db.locations) {
    if (loc.map !== run.mapId) continue;
    const base = buildPlan(env, charId, loc.id);
    if (!base) continue;
    const keys = keyCandidates(env, [
      ...(loc.specials ?? []).map((s) => s.when),
      ...rules.map((r) => r.when),
    ]).slice(0, 6);
    let best: { value: number; carry: string[] } | undefined;
    for (const carry of subsets(keys, slots)) {
      const plan = { ...base, carry };
      if (validateExpeditionPlan(env, plan)) continue;
      const value = goalValue(ctx, plan);
      if (value > 1e-9 && (!best || value > best.value + 1e-9)) best = { value, carry };
    }
    if (best) out.set(loc.id, best);
  }
  return out;
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

  // 3. 外出：补给不足时去能带回配给的地方；有目标（会触发专属事件 / 线索）就去目标；否则轮流探索各地点
  if (!run.expedition && !run.plan.expedition && chars.length) {
    const low = supplyLow(env, policy.lowSupplyDays);
    const ranked = [...chars].sort((a, b) => wellbeing(env, b) - wellbeing(env, a));
    const seen = visitsOf(mem);
    const visits = (id: string) => seen[id] ?? 0;
    const trips = goalTripsOf(mem);
    for (const charId of ranked) {
      const fit =
        chars.length >= policy.exploreMinHome + 1 &&
        wellbeing(env, charId) >= policy.exploreMinWellbeing;
      if (!low && !fit) continue;
      const locs = legalLocations(env, charId);
      if (!locs.length) continue;
      const goals: ReturnType<typeof goalTargets> =
        policy.goalWeight > 0 ? goalTargets(env, charId) : new Map();
      // 目标加分：按危险折算；同一目标地点去得越多越不急（防止数据没写"已完成"条件时原地打转）
      const goalBonus = (l: { id: string; danger: number }) => {
        const g = goals.get(l.id);
        return g
          ? (policy.goalWeight * g.value) /
              (1 + l.danger * policy.dangerWeight) /
              (1 + 0.25 * (trips[l.id] ?? 0))
          : 0;
      };
      if (!low && !policy.exploreWhenSafe && !goals.size) continue;
      const rationScore = (l: { id: string; danger: number }) =>
        rationLootValue(content, l.id) / (1 + l.danger * policy.dangerWeight);
      const pickLoc = low
        ? locs.sort(
            (a, b) =>
              rationScore(b) + goalBonus(b) - (rationScore(a) + goalBonus(a)) ||
              visits(a.id) - visits(b.id),
          )[0]
        : goals.size
          ? locs.sort((a, b) => goalBonus(b) - goalBonus(a) || visits(a.id) - visits(b.id))[0]
          : locs.sort(
              (a, b) =>
                visits(a.id) - visits(b.id) || a.danger - b.danger || a.distance - b.distance,
            )[0];
      const plan = buildPlan(env, charId, pickLoc.id);
      if (!plan) continue;
      const goal = goals.get(pickLoc.id);
      plan.carry = goal ? goal.carry : carryFor(env, pickLoc.id);
      if (validateExpeditionPlan(env, plan)) continue;
      seen[pickLoc.id] = visits(pickLoc.id) + 1;
      if (goal) trips[pickLoc.id] = (trips[pickLoc.id] ?? 0) + 1;
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
