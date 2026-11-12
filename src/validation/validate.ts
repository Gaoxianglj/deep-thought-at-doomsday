/**
 * 内容校验：纯函数，零 DOM、零 Node API。
 * 第一层 zod 结构校验 → 第二层引用与语义（error）→ 第三层可达性等提示（warning，仅在结构合法时运行）。
 */
import type { ZodType } from 'zod';
import {
  ConfigSchema,
  ContentDBSchema,
  CharacterSchema,
  DifficultySchema,
  DiarySchema,
  EndingSchema,
  ENGINE_TEXT_KEYS,
  EventSchema,
  ItemSchema,
  LocationSchema,
  MapSchema,
  StatSchema,
  StatusSchema,
  WeatherSchema,
} from '../engine/schema';
import type {
  Condition,
  ContentDB,
  Effect,
  GameConfig,
  Rule,
  StatDef,
  Target,
} from '../engine/schema';

export interface Issue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

/**
 * 引擎认识的修正键模式。引擎新增修正键时在此登记。
 * ref：捕获组 1 需要是已存在的 stat / status id。
 */
export const MODIFIER_KEY_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly doc: string;
  readonly ref?: 'stat' | 'status';
}[] = [
  { pattern: /^stat\.([^.]+)\.dailyDelta$/, doc: 'stat.<statId>.dailyDelta', ref: 'stat' },
  {
    pattern: /^status\.([^.]+)\.gainChance$/,
    doc: 'status.<statusId>.gainChance',
    ref: 'status',
  },
  { pattern: /^item\.[^.]+\.useEffect$/, doc: 'item.<tag>.useEffect' },
  { pattern: /^expedition\.lootRolls$/, doc: 'expedition.lootRolls' },
  { pattern: /^expedition\.lootWeight\.[^.]+$/, doc: 'expedition.lootWeight.<tag>' },
  { pattern: /^expedition\.danger$/, doc: 'expedition.danger' },
  { pattern: /^expedition\.duration$/, doc: 'expedition.duration' },
  { pattern: /^event\.dailyChance$/, doc: 'event.dailyChance' },
  { pattern: /^event\.weight\.[^.]+$/, doc: 'event.weight.<tag>' },
];

/** config.texts 各键允许的额外变量（{self} {day} {item:id} 恒可用） */
const TEXT_VARS: Record<string, readonly string[]> = {
  death: [],
  statusEnter: ['status'],
  statusExit: ['status'],
  rationMissing: ['item'],
  expeditionDepart: ['location', 'loot', 'lootCount'],
  expeditionReturn: ['location', 'loot', 'lootCount'],
  expeditionInjured: ['location', 'loot', 'lootCount'],
  expeditionLost: ['location', 'loot', 'lootCount'],
  expeditionCancelled: ['location'],
  weatherChange: ['weather'],
};

// ================= 第一层：zod issue 转中文 =================

const COND_PRIMARY = [
  'all',
  'any',
  'not',
  'stat',
  'hasStatus',
  'hasItem',
  'hasTag',
  'carrying',
  'flag',
  'day',
  'inParty',
  'inShelter',
  'unlocked',
  'partyAlive',
  'shelterCount',
  'map',
  'difficulty',
  'weather',
  'at',
  'chance',
];
const EFFECT_PRIMARY = [
  'stat',
  'addStatus',
  'removeStatus',
  'item',
  'loseRandomItem',
  'setFlag',
  'addFlag',
  'joinParty',
  'leaveParty',
  'unlock',
  'queueEvent',
  'ending',
  'log',
  'if',
  'random',
];
const EFFECT_LISTS = ['effects', 'then', 'else', 'onUse', 'onEnter', 'onExit', 'injury'];
const COND_SLOTS = ['when', 'requires', 'not', 'enterWhen', 'exitWhen', 'where', 'if'];

type Key = PropertyKey;

interface ZIssue {
  code: string;
  path: Key[];
  message: string;
  keys?: string[];
  expected?: string;
  values?: unknown[];
  minimum?: number | bigint;
  maximum?: number | bigint;
  origin?: string;
  errors?: ZIssue[][];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getAt(root: unknown, path: readonly Key[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<Key, unknown>)[k];
  }
  return cur;
}

/** 把 zod 路径转成以 id 定位的可读路径 */
function locate(root: unknown, path: readonly Key[]): string {
  let cur: unknown = root;
  let out = '';
  for (const k of path) {
    if (typeof k === 'number' && Array.isArray(cur)) {
      const el: unknown = cur[k];
      const id = isObj(el) && typeof el.id === 'string' ? el.id : k;
      out += `[${String(id)}]`;
      cur = el;
    } else {
      out += out ? `.${String(k)}` : String(k);
      cur = cur !== null && typeof cur === 'object' ? (cur as Record<Key, unknown>)[k] : undefined;
    }
  }
  return out || '(根)';
}

function guessKind(full: readonly Key[]): 'condition' | 'effect' | 'target' | 'primitive' | null {
  const last = full[full.length - 1];
  if (last === 'of' || last === 'leaveParty') return 'target';
  if (last === 'is' || last === 'value') return 'primitive';
  if (typeof last === 'number') {
    const parent = String(full[full.length - 2]);
    if (EFFECT_LISTS.includes(parent)) return 'effect';
    if (parent === 'all' || parent === 'any') return 'condition';
    return null;
  }
  if (COND_SLOTS.includes(String(last))) return 'condition';
  return null;
}

function translateZod(
  issue: ZIssue,
  base: readonly Key[],
  root: unknown,
  out: Issue[],
  seen: Set<string>,
): void {
  const full = [...base, ...issue.path];
  const path = locate(root, full);
  const push = (message: string) => {
    const k = `${path}|${message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ level: 'error', path, message });
  };
  const field = String(full[full.length - 1] ?? '');
  const val = getAt(root, full);
  switch (issue.code) {
    case 'invalid_union': {
      const kind = guessKind(full);
      if (kind === 'target') {
        push(
          "目标无效，应为 'self' / 'any' / 'all' / 'random' / 'expeditioner' / { role } / { id }",
        );
        return;
      }
      if (kind === 'primitive') {
        push(`字段 ${field} 的值应为布尔、数字或字符串`);
        return;
      }
      if ((kind === 'condition' || kind === 'effect') && isObj(val)) {
        const label = kind === 'condition' ? '条件' : '效果';
        const keys = Object.keys(val);
        const primary = kind === 'condition' ? COND_PRIMARY : EFFECT_PRIMARY;
        if (!keys.some((k) => primary.includes(k))) {
          push(`未知的${label}种类，键为 ${keys.join('、') || '(空对象)'}`);
          return;
        }
        const branches = issue.errors ?? [];
        let best: ZIssue[] | undefined;
        for (const b of branches) if (!best || b.length < best.length) best = b;
        for (const sub of best ?? []) translateZod(sub, full, root, out, seen);
        return;
      }
      if ((kind === 'condition' || kind === 'effect') && !isObj(val)) {
        push(`${kind === 'condition' ? '条件' : '效果'}应为对象`);
        return;
      }
      push('值不匹配任何允许的形态');
      return;
    }
    case 'unrecognized_keys':
      push(`存在未知字段：${(issue.keys ?? []).join('、')}`);
      return;
    case 'invalid_type':
      if (val === undefined) push(`缺少必填字段 ${field}`);
      else push(`字段 ${field} 类型错误，应为 ${issue.expected ?? '其他类型'}`);
      return;
    case 'invalid_value':
      push(`字段 ${field} 取值无效，允许：${(issue.values ?? []).map(String).join(' / ')}`);
      return;
    case 'too_small':
      push(`字段 ${field} 过小或过短（下限 ${String(issue.minimum)}）`);
      return;
    case 'too_big':
      push(`字段 ${field} 过大或过长（上限 ${String(issue.maximum)}）`);
      return;
    default:
      push(`字段 ${field}：${issue.message}`);
  }
}

// ================= 主函数 =================

const CATS = [
  'stats',
  'statuses',
  'items',
  'characters',
  'difficulties',
  'weathers',
  'maps',
  'locations',
  'events',
  'diary',
  'endings',
] as const;
type Cat = (typeof CATS)[number];

const CAT_SCHEMA: Record<Cat, ZodType> = {
  stats: StatSchema,
  statuses: StatusSchema,
  items: ItemSchema,
  characters: CharacterSchema,
  difficulties: DifficultySchema,
  weathers: WeatherSchema,
  maps: MapSchema,
  locations: LocationSchema,
  events: EventSchema,
  diary: DiarySchema,
  endings: EndingSchema,
};
const CAT_NAME: Record<Cat, string> = {
  stats: '属性',
  statuses: '状态',
  items: '物品',
  characters: '角色',
  difficulties: '难度',
  weathers: '天气',
  maps: '地图',
  locations: '地点',
  events: '事件',
  diary: '日记',
  endings: '结局',
};

interface Ctx {
  /** 可用的 role 名；null = 此上下文不允许 { role } */
  roles: ReadonlySet<string> | null;
  /** 事件里 role 'self' 即使未定义也允许 */
  allowSelfRole: boolean;
  /** 在此位置使用 { chance } 给出 warning */
  noChance: boolean;
}
const ROLELESS: Ctx = { roles: null, allowSelfRole: false, noChance: false };
const ROLELESS_NC: Ctx = { ...ROLELESS, noChance: true };

const PLACEHOLDER = /\{([a-zA-Z0-9_:]+)\}/g;

export function validateContent(db: unknown): Issue[] {
  const issues: Issue[] = [];
  const error = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  if (!isObj(db)) {
    error('(根)', '内容必须是对象');
    return issues;
  }

  // ---------- 第一层 ----------
  const parsed = ContentDBSchema.safeParse(db);
  const schemaOk = parsed.success;
  if (!parsed.success) {
    const seen = new Set<string>();
    for (const i of parsed.error.issues) translateZod(i as unknown as ZIssue, [], db, issues, seen);
  }

  // 宽松视图：逐条目通过 schema 的才参与语义检查；所有原始 id 都算"存在"
  const raw = db as Record<string, unknown>;
  const list = {} as { [K in Cat]: unknown[] };
  const ids = {} as Record<Cat, Set<string>>;
  for (const c of CATS) {
    const arr = Array.isArray(raw[c]) ? (raw[c] as unknown[]) : [];
    ids[c] = new Set(arr.flatMap((e) => (isObj(e) && typeof e.id === 'string' ? [e.id] : [])));
    list[c] = parsed.success
      ? (parsed.data as unknown as Record<Cat, unknown[]>)[c]
      : arr.filter((e) => CAT_SCHEMA[c].safeParse(e).success);
  }
  const cfgRes = ConfigSchema.safeParse(raw.config);
  const config: GameConfig | null = cfgRes.success ? cfgRes.data : null;
  const D = list as unknown as Pick<
    ContentDB,
    | 'stats'
    | 'statuses'
    | 'items'
    | 'characters'
    | 'difficulties'
    | 'weathers'
    | 'maps'
    | 'locations'
    | 'events'
    | 'diary'
    | 'endings'
  >;
  const statDefs = new Map<string, StatDef>(D.stats.map((s) => [s.id, s]));
  const itemDefs = new Map(D.items.map((i) => [i.id, i]));

  // ---------- 收集（可达性用） ----------
  const queued = new Set<string>();
  const endingRefs = new Set<string>();
  const addStatusRefs = new Set<string>();
  const itemProduced = new Set<string>();
  const unlockRefs = new Set<string>();
  const flagSet = new Set<string>();
  const flagRead = new Map<string, string>();

  // ---------- 通用辅助 ----------
  const ref = (cat: Cat, id: string, path: string, what: string) => {
    if (!ids[cat].has(id)) error(path, `${what}引用了不存在的${CAT_NAME[cat]} "${id}"`);
  };

  const checkText = (
    text: string | undefined,
    path: string,
    roles: ReadonlySet<string> | null,
    opts: { lost?: boolean; vars?: readonly string[] } = {},
  ) => {
    if (!text) return;
    for (const m of text.matchAll(PLACEHOLDER)) {
      const key = m[1];
      if (key === 'day' || key === 'self') continue;
      if (key.startsWith('item:')) {
        const id = key.slice(5);
        if (!ids.items.has(id)) error(path, `文案引用了不存在的物品 "${id}"（{${key}}）`);
        continue;
      }
      if (key === 'lost' && opts.lost) continue;
      if (opts.vars?.includes(key)) continue;
      if (roles?.has(key)) continue;
      error(
        path,
        key === 'lost'
          ? '未知占位符 {lost}（仅事件结果文本与 log 效果可用）'
          : `未知占位符 {${key}}`,
      );
    }
  };

  const target = (t: Target, path: string, ctx: Ctx) => {
    if (typeof t === 'string') return;
    if ('id' in t) {
      ref('characters', t.id, path, '目标');
      return;
    }
    if (ctx.roles === null) {
      error(path, `此处（规则/状态/物品/地点等上下文）不得使用 { role: '${t.role}' }`);
    } else if (!ctx.roles.has(t.role) && !(ctx.allowSelfRole && t.role === 'self')) {
      error(path, `使用了未在 roles 中定义的角色 "${t.role}"`);
    }
  };

  // ---------- 条件 ----------
  const cond = (c: Condition, path: string, ctx: Ctx): void => {
    if ('all' in c) c.all.forEach((x, i) => cond(x, `${path}.all[${i}]`, ctx));
    else if ('any' in c) c.any.forEach((x, i) => cond(x, `${path}.any[${i}]`, ctx));
    else if ('not' in c) cond(c.not, `${path}.not`, ctx);
    else if ('stat' in c) {
      ref('stats', c.stat, path, '条件 stat');
      target(c.of, path, ctx);
    } else if ('hasStatus' in c) {
      ref('statuses', c.hasStatus, path, '条件 hasStatus');
      target(c.of, path, ctx);
    } else if ('hasItem' in c) ref('items', c.hasItem, path, '条件 hasItem');
    else if ('carrying' in c) ref('items', c.carrying, path, '条件 carrying');
    else if ('flag' in c) {
      if (!flagRead.has(c.flag)) flagRead.set(c.flag, path);
    } else if ('inParty' in c) ref('characters', c.inParty, path, '条件 inParty');
    else if ('inShelter' in c) ref('characters', c.inShelter, path, '条件 inShelter');
    else if ('unlocked' in c) ref('characters', c.unlocked, path, '条件 unlocked');
    else if ('map' in c) ref('maps', c.map, path, '条件 map');
    else if ('difficulty' in c) ref('difficulties', c.difficulty, path, '条件 difficulty');
    else if ('weather' in c) ref('weathers', c.weather, path, '条件 weather');
    else if ('at' in c) ref('locations', c.at, path, '条件 at');
    else if ('chance' in c) {
      if (ctx.noChance)
        warn(path, '此处使用 { chance } 随机条件，每次检查都会重新掷骰，请确认是否有意');
    }
  };
  const condOpt = (c: Condition | undefined, path: string, ctx: Ctx) => {
    if (c) cond(c, path, ctx);
  };

  // ---------- 效果 ----------
  const effects = (list: Effect[] | undefined, path: string, ctx: Ctx): void => {
    list?.forEach((e, i) => effect(e, `${path}[${i}]`, ctx));
  };
  const effect = (e: Effect, path: string, ctx: Ctx): void => {
    if ('stat' in e) {
      ref('stats', e.stat, path, '效果 stat');
      target(e.of, path, ctx);
      if (e.add === undefined && e.set === undefined)
        error(path, '{ stat } 效果的 add 和 set 至少要有一个');
      const def = statDefs.get(e.stat);
      if (def && e.set !== undefined && (e.set < def.min || e.set > def.max)) {
        error(path, `set 的值 ${e.set} 超出属性 ${e.stat} 的范围 [${def.min}, ${def.max}]`);
      }
    } else if ('addStatus' in e) {
      ref('statuses', e.addStatus, path, '效果 addStatus');
      addStatusRefs.add(e.addStatus);
      target(e.of, path, ctx);
    } else if ('removeStatus' in e) {
      ref('statuses', e.removeStatus, path, '效果 removeStatus');
      target(e.of, path, ctx);
    } else if ('item' in e) {
      ref('items', e.item, path, '效果 item');
      if (e.add > 0) itemProduced.add(e.item);
    } else if ('setFlag' in e) flagSet.add(e.setFlag);
    else if ('addFlag' in e) flagSet.add(e.addFlag);
    else if ('joinParty' in e) ref('characters', e.joinParty, path, '效果 joinParty');
    else if ('leaveParty' in e) {
      target(e.leaveParty, path, ctx);
      checkText(e.text, `${path}.text`, ctx.roles, { lost: true });
    } else if ('unlock' in e) {
      ref('characters', e.unlock, path, '效果 unlock');
      unlockRefs.add(e.unlock);
    } else if ('queueEvent' in e) {
      ref('events', e.queueEvent, path, '效果 queueEvent');
      queued.add(e.queueEvent);
    } else if ('ending' in e) {
      ref('endings', e.ending, path, '效果 ending');
      endingRefs.add(e.ending);
    } else if ('log' in e) checkText(e.log, `${path}.log`, ctx.roles, { lost: true });
    else if ('if' in e) {
      cond(e.if, `${path}.if`, ctx);
      effects(e.then, `${path}.then`, ctx);
      effects(e.else, `${path}.else`, ctx);
    } else if ('random' in e) {
      e.random.forEach((b, i) => effects(b.effects, `${path}.random[${i}].effects`, ctx));
    }
  };

  // ---------- 规则 ----------
  const rule = (r: Rule, path: string): void => {
    condOpt(r.when, `${path}.when`, ROLELESS);
    effects(r.effects, `${path}.effects`, ROLELESS);
    r.modifiers?.forEach((m, i) => {
      const mp = `${path}.modifiers[${i}]`;
      let known = false;
      for (const p of MODIFIER_KEY_PATTERNS) {
        const match = p.pattern.exec(m.key);
        if (!match) continue;
        known = true;
        if (p.ref === 'stat') ref('stats', match[1], mp, `修正键 ${m.key} 中的属性`);
        if (p.ref === 'status') ref('statuses', match[1], mp, `修正键 ${m.key} 中的状态`);
        break;
      }
      if (!known) {
        error(
          mp,
          `未知的修正键 "${m.key}"，已知模式：${MODIFIER_KEY_PATTERNS.map((p) => p.doc).join('、')}`,
        );
      }
      if (m.mul === undefined && m.add === undefined) error(mp, '修正的 mul 和 add 至少要有一个');
    });
    if (r.trigger) {
      if (!r.effects) error(path, `有 trigger（${r.trigger}）的规则必须有 effects`);
      if (r.modifiers?.length) warn(path, '有 trigger 的规则上的 modifiers 不会生效');
    } else {
      if (!r.modifiers?.length) error(path, '没有 trigger 的规则必须有 modifiers');
      if (r.effects) error(path, '没有 trigger 的规则上的 effects 不会执行');
      if (r.chance !== undefined) error(path, '没有 trigger 的规则上的 chance 不会生效');
    }
  };
  const rules = (list: Rule[] | undefined, path: string) => {
    list?.forEach((r) => rule(r, `${path}.rules[${r.id}]`));
  };

  // ---------- id 重复 ----------
  for (const c of CATS) {
    const arr = Array.isArray(raw[c]) ? (raw[c] as unknown[]) : [];
    const seen = new Set<string>();
    for (const e of arr) {
      if (!isObj(e) || typeof e.id !== 'string') continue;
      if (seen.has(e.id)) error(`${c}[${e.id}]`, `${CAT_NAME[c]} id "${e.id}" 重复`);
      seen.add(e.id);
    }
  }

  // ---------- 属性 ----------
  for (const s of D.stats) {
    const p = `stats[${s.id}]`;
    if (!(s.min < s.max)) error(p, `min (${s.min}) 必须小于 max (${s.max})`);
    else if (s.initial < s.min || s.initial > s.max) {
      error(p, `initial (${s.initial}) 超出范围 [${s.min}, ${s.max}]`);
    }
    checkText(s.deathText, `${p}.deathText`, null);
  }

  // ---------- 状态 ----------
  for (const s of D.statuses) {
    const p = `statuses[${s.id}]`;
    condOpt(s.enterWhen, `${p}.enterWhen`, ROLELESS_NC);
    condOpt(s.exitWhen, `${p}.exitWhen`, ROLELESS_NC);
    effects(s.onEnter, `${p}.onEnter`, ROLELESS);
    effects(s.onExit, `${p}.onExit`, ROLELESS);
    rules(s.rules, p);
  }

  // ---------- 物品 ----------
  for (const it of D.items) {
    const p = `items[${it.id}]`;
    effects(it.onUse, `${p}.onUse`, ROLELESS);
    rules(it.rules, p);
  }

  // ---------- 角色 ----------
  for (const ch of D.characters) {
    const p = `characters[${ch.id}]`;
    for (const [k, v] of Object.entries(ch.stats ?? {})) {
      const def = statDefs.get(k);
      if (!ids.stats.has(k)) error(`${p}.stats.${k}`, `覆盖了不存在的属性 "${k}"`);
      else if (def && (v < def.min || v > def.max)) {
        error(`${p}.stats.${k}`, `覆盖值 ${v} 超出属性范围 [${def.min}, ${def.max}]`);
      }
    }
    for (const t of ch.traits) rules(t.rules, `${p}.traits[${t.id}]`);
  }

  // ---------- 难度 / 天气 / 地图 ----------
  for (const d of D.difficulties) rules(d.rules, `difficulties[${d.id}]`);
  for (const w of D.weathers) {
    const p = `weathers[${w.id}]`;
    if (w.duration && w.duration.min > w.duration.max) {
      error(`${p}.duration`, `min (${w.duration.min}) 不得大于 max (${w.duration.max})`);
    }
    rules(w.rules, p);
  }
  for (const m of D.maps) {
    const p = `maps[${m.id}]`;
    if (m.partySize.min > m.partySize.max) {
      error(`${p}.partySize`, `min (${m.partySize.min}) 不得大于 max (${m.partySize.max})`);
    }
    for (const id of m.startingPool) {
      ref('items', id, `${p}.startingPool`, '开局物品池');
      const def = itemDefs.get(id);
      if (def && def.cost === undefined) {
        error(`${p}.startingPool`, `物品 "${id}" 在开局物品池中但没有 cost`);
      }
    }
    for (const id of Object.keys(m.startingItems ?? {})) {
      ref('items', id, `${p}.startingItems.${id}`, '初始物品');
    }
    for (const w of m.weatherTable ?? []) ref('weathers', w.weather, `${p}.weatherTable`, '天气表');
    if (m.expedition.vehicle)
      ref('items', m.expedition.vehicle, `${p}.expedition.vehicle`, '交通工具');
    for (const k of Object.keys(m.startingFlags ?? {})) flagSet.add(k);
    rules(m.rules, p);
  }

  // ---------- 地点 ----------
  for (const l of D.locations) {
    const p = `locations[${l.id}]`;
    ref('maps', l.map, `${p}.map`, '地点所属地图');
    if (l.vehicle) ref('items', l.vehicle, `${p}.vehicle`, '交通工具');
    l.loot.forEach((e, i) => {
      const lp = `${p}.loot[${i}]`;
      ref('items', e.item, lp, '战利品');
      itemProduced.add(e.item);
      if (e.min !== undefined && e.max !== undefined && e.min > e.max) {
        error(lp, `min (${e.min}) 不得大于 max (${e.max})`);
      }
    });
    condOpt(l.requires, `${p}.requires`, ROLELESS_NC);
    effects(l.injury, `${p}.injury`, ROLELESS);
    l.specials?.forEach((s, i) => {
      const sp = `${p}.specials[${i}]`;
      ref('events', s.event, sp, '特殊事件');
      queued.add(s.event);
      condOpt(s.when, `${sp}.when`, ROLELESS);
    });
  }

  // ---------- 事件 ----------
  for (const ev of D.events) {
    const p = `events[${ev.id}]`;
    const roleNames = new Set(Object.keys(ev.roles ?? {}));
    const ctx: Ctx = { roles: roleNames, allowSelfRole: true, noChance: false };
    const ctxNC: Ctx = { ...ctx, noChance: true };
    checkText(ev.title, `${p}.title`, roleNames);
    checkText(ev.text, `${p}.text`, roleNames);
    condOpt(ev.when, `${p}.when`, ctxNC);
    for (const [name, r] of Object.entries(ev.roles ?? {})) {
      if (r.is) ref('characters', r.is, `${p}.roles.${name}.is`, '角色绑定');
      condOpt(r.where, `${p}.roles.${name}.where`, ctxNC);
    }
    const choiceIds = new Set<string>();
    for (const ch of ev.choices) {
      const cp = `${p}.choices[${ch.id}]`;
      if (choiceIds.has(ch.id)) error(cp, `选项 id "${ch.id}" 在事件内重复`);
      choiceIds.add(ch.id);
      checkText(ch.text, `${cp}.text`, roleNames);
      checkText(ch.requiresHint, `${cp}.requiresHint`, roleNames);
      condOpt(ch.requires, `${cp}.requires`, ctxNC);
      ch.outcomes.forEach((o, i) => {
        const op = `${cp}.outcomes[${i}]`;
        checkText(o.text, `${op}.text`, roleNames, { lost: true });
        condOpt(o.when, `${op}.when`, ctx);
        effects(o.effects, `${op}.effects`, ctx);
        if (o.next) {
          ref('events', o.next, `${op}.next`, '后续事件');
          queued.add(o.next);
        }
      });
      if (ch.outcomes.every((o) => o.when)) {
        warn(cp, '所有结果都带 when，可能出现没有可用结果的情况，请确认条件互补');
      }
    }
  }

  // ---------- 日记 ----------
  for (const d of D.diary) {
    const p = `diary[${d.id}]`;
    const roleNames = new Set(Object.keys(d.roles ?? {}));
    const ctx: Ctx = { roles: roleNames, allowSelfRole: false, noChance: false };
    checkText(d.text, `${p}.text`, roleNames);
    condOpt(d.when, `${p}.when`, { ...ctx, noChance: true });
    for (const [name, r] of Object.entries(d.roles ?? {})) {
      if (r.is) ref('characters', r.is, `${p}.roles.${name}.is`, '角色绑定');
      condOpt(r.where, `${p}.roles.${name}.where`, { ...ctx, noChance: true });
      if (!d.text.includes(`{${name}}`))
        warn(`${p}.roles.${name}`, `定义了角色 "${name}" 但文本没有用到`);
    }
    for (const c of D.characters) {
      if (d.text.includes(c.name)) {
        error(
          `${p}.text`,
          roleNames.size === 0
            ? `没有 roles 的日记文本中不得出现角色名 "${c.name}"`
            : `日记文本直接写死了角色名 "${c.name}"，请改用 roles 占位符`,
        );
      }
    }
  }

  // ---------- 结局 ----------
  for (const e of D.endings) condOpt(e.when, `endings[${e.id}].when`, ROLELESS_NC);

  // ---------- 配置 ----------
  if (config) {
    ref('endings', config.fallbackEnding, 'config.fallbackEnding', '兜底结局');
    endingRefs.add(config.fallbackEnding);
    for (const tag of config.rationTags) {
      const ok = D.items.some((i) => i.tags.includes(tag) && i.onUse && i.onUse.length > 0);
      if (!ok && schemaOrEveryItemParsed()) {
        error(`config.rationTags[${tag}]`, `配给标签 "${tag}" 没有任何带 onUse 的物品`);
      }
    }
    for (const [k, v] of Object.entries(config.texts)) {
      const vars = TEXT_VARS[k];
      if (!vars) {
        warn(
          `config.texts.${k}`,
          `未知的引擎文案键 "${k}"（已知：${ENGINE_TEXT_KEYS.join('、')}）`,
        );
        continue;
      }
      checkText(v, `config.texts.${k}`, null, { vars });
    }
    for (const k of ENGINE_TEXT_KEYS) {
      if (!(k in config.texts))
        warn(`config.texts.${k}`, `缺少引擎文案键 "${k}"，对应日志将不会写出`);
    }
  }
  function schemaOrEveryItemParsed(): boolean {
    return D.items.length === ids.items.size;
  }

  // ---------- 第三层：可达性（仅在结构合法时） ----------
  if (schemaOk) {
    for (const ev of D.events) {
      if (ev.weight === 0 && !queued.has(ev.id)) {
        warn(
          `events[${ev.id}]`,
          '权重为 0 且没有被任何 queueEvent / next / specials 引用，永远不会触发',
        );
      }
    }
    for (const e of D.endings) {
      if (!e.when && !endingRefs.has(e.id)) {
        warn(`endings[${e.id}]`, '没有 when 且没有被任何 { ending } 效果引用，永远不会触发');
      }
    }
    for (const s of D.statuses) {
      if (!s.enterWhen && !addStatusRefs.has(s.id)) {
        warn(`statuses[${s.id}]`, '没有 enterWhen 且没有被任何 addStatus 引用，永远不会获得');
      }
    }
    const startItems = new Set<string>();
    for (const m of D.maps) {
      m.startingPool.forEach((i) => startItems.add(i));
      Object.keys(m.startingItems ?? {}).forEach((i) => startItems.add(i));
    }
    for (const it of D.items) {
      if (!startItems.has(it.id) && !itemProduced.has(it.id)) {
        warn(
          `items[${it.id}]`,
          '既不在开局物品池/初始物品，也不在任何战利品表或 item 增加效果中，无法获得',
        );
      }
    }
    for (const [flag, path] of flagRead) {
      if (!flagSet.has(flag)) warn(path, `读取了从未被设置的 flag "${flag}"`);
    }
    for (const flag of flagSet) {
      if (!flagRead.has(flag)) warn(`flags.${flag}`, `flag "${flag}" 被设置但从未被读取`);
    }
    for (const c of D.characters) {
      if (!c.unlockedByDefault && !unlockRefs.has(c.id)) {
        warn(`characters[${c.id}]`, '不是默认解锁，且没有任何 unlock 效果指向它');
      }
    }
    if (!D.characters.some((c) => c.unlockedByDefault)) {
      error('characters', '没有任何默认解锁（unlockedByDefault）的角色，玩家无法开局');
    }
    for (const m of D.maps) {
      if (!D.locations.some((l) => l.map === m.id)) warn(`maps[${m.id}]`, '该地图没有任何地点');
    }
  } else if (D.characters.length > 0 && !D.characters.some((c) => c.unlockedByDefault)) {
    error('characters', '没有任何默认解锁（unlockedByDefault）的角色，玩家无法开局');
  }

  return issues;
}
