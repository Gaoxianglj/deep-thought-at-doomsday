/**
 * 全部内容定义与运行时状态的 zod schema —— 类型的唯一真相。
 * 除 Condition / Effect（递归，手写类型）外，TS 类型都由 schema 推导。
 * 新增条件/效果种类的步骤见 docs/ENGINE_GUIDE.md。
 */
import { z } from 'zod';

export const SAVE_VERSION = 1;

const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id 必须是小写蛇形（a-z、0-9、_）');
const Text = z.string().min(1);
const cmp = {
  gte: z.number().optional(),
  gt: z.number().optional(),
  lte: z.number().optional(),
  lt: z.number().optional(),
  eq: z.number().optional(),
};
const Prob = z.number().min(0).max(1);

// ---------- 目标 ----------
export type Target =
  'self' | 'any' | 'all' | 'random' | 'expeditioner' | { role: string } | { id: string };
export const TargetSchema: z.ZodType<Target> = z.union([
  z.enum(['self', 'any', 'all', 'random', 'expeditioner']),
  z.strictObject({ role: z.string() }),
  z.strictObject({ id: Id }),
]);

// ---------- 条件 ----------
export interface Cmp {
  gte?: number;
  gt?: number;
  lte?: number;
  lt?: number;
  eq?: number;
}
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | ({ stat: string; of: Target } & Cmp)
  | { hasStatus: string; of: Target }
  | { hasItem: string; count?: number }
  | { hasTag: string; count?: number }
  | { carrying: string }
  | ({ flag: string; is?: boolean | string } & Cmp)
  | { day: Cmp }
  | { inParty: string }
  | { inShelter: string }
  | { unlocked: string }
  | { partyAlive: Cmp }
  | { shelterCount: Cmp }
  | { map: string }
  | { difficulty: string }
  | { weather: string }
  | { at: string }
  | { chance: number };

const CmpSchema = z.strictObject(cmp);
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(ConditionSchema) }),
    z.strictObject({ any: z.array(ConditionSchema) }),
    z.strictObject({ not: ConditionSchema }),
    z.strictObject({ stat: Id, of: TargetSchema, ...cmp }),
    z.strictObject({ hasStatus: Id, of: TargetSchema }),
    z.strictObject({ hasItem: Id, count: z.number().int().min(1).optional() }),
    z.strictObject({ hasTag: z.string(), count: z.number().int().min(1).optional() }),
    z.strictObject({ carrying: Id }),
    z.strictObject({ flag: z.string(), is: z.union([z.boolean(), z.string()]).optional(), ...cmp }),
    z.strictObject({ day: CmpSchema }),
    z.strictObject({ inParty: Id }),
    z.strictObject({ inShelter: Id }),
    z.strictObject({ unlocked: Id }),
    z.strictObject({ partyAlive: CmpSchema }),
    z.strictObject({ shelterCount: CmpSchema }),
    z.strictObject({ map: Id }),
    z.strictObject({ difficulty: Id }),
    z.strictObject({ weather: Id }),
    z.strictObject({ at: Id }),
    z.strictObject({ chance: Prob }),
  ]),
);

// ---------- 效果 ----------
export type Effect =
  | { stat: string; of: Target; add?: number; set?: number }
  | { addStatus: string; of: Target; duration?: number; chance?: number }
  | { removeStatus: string; of: Target }
  | { item: string; add: number }
  | { loseRandomItem: { tag?: string; count?: number } }
  | { setFlag: string; value: boolean | number | string }
  | { addFlag: string; add: number }
  | { joinParty: string }
  | { leaveParty: Target; reason: 'dead' | 'gone'; text?: string }
  | { unlock: string }
  | { queueEvent: string; delay?: number }
  | { ending: string }
  | { log: string; kind?: string }
  | { if: Condition; then: Effect[]; else?: Effect[] }
  | { random: { weight?: number; effects: Effect[] }[] };

export const EffectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.union([
    z.strictObject({
      stat: Id,
      of: TargetSchema,
      add: z.number().optional(),
      set: z.number().optional(),
    }),
    z.strictObject({
      addStatus: Id,
      of: TargetSchema,
      duration: z.number().int().min(1).optional(),
      chance: Prob.optional(),
    }),
    z.strictObject({ removeStatus: Id, of: TargetSchema }),
    z.strictObject({ item: Id, add: z.number().int() }),
    z.strictObject({
      loseRandomItem: z.strictObject({
        tag: z.string().optional(),
        count: z.number().int().min(1).optional(),
      }),
    }),
    z.strictObject({ setFlag: z.string(), value: z.union([z.boolean(), z.number(), z.string()]) }),
    z.strictObject({ addFlag: z.string(), add: z.number() }),
    z.strictObject({ joinParty: Id }),
    z.strictObject({
      leaveParty: TargetSchema,
      reason: z.enum(['dead', 'gone']),
      text: z.string().optional(),
    }),
    z.strictObject({ unlock: Id }),
    z.strictObject({ queueEvent: Id, delay: z.number().int().min(0).optional() }),
    z.strictObject({ ending: Id }),
    z.strictObject({ log: Text, kind: z.string().optional() }),
    z.strictObject({
      if: ConditionSchema,
      then: z.array(EffectSchema),
      else: z.array(EffectSchema).optional(),
    }),
    z.strictObject({
      random: z
        .array(
          z.strictObject({
            weight: z.number().positive().optional(),
            effects: z.array(EffectSchema),
          }),
        )
        .min(1),
    }),
  ]),
);

// ---------- 规则 ----------
export const TRIGGERS = ['dayStart', 'dayEnd', 'expeditionDepart', 'expeditionReturn'] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const ModifierSchema = z.strictObject({
  key: z.string().min(1),
  mul: z.number().optional(),
  add: z.number().optional(),
  /** self（默认）= 只影响规则所属角色；global = 影响所有人及全局计算 */
  scope: z.enum(['self', 'global']).optional(),
});
export type Modifier = z.infer<typeof ModifierSchema>;

export const RuleSchema = z.strictObject({
  id: Id,
  when: ConditionSchema.optional(),
  trigger: z.enum(TRIGGERS).optional(),
  chance: Prob.optional(),
  effects: z.array(EffectSchema).optional(),
  modifiers: z.array(ModifierSchema).optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

// ---------- 内容定义 ----------
export const StatSchema = z.strictObject({
  id: Id,
  name: Text,
  min: z.number(),
  max: z.number(),
  initial: z.number(),
  dailyDelta: z.number(),
  /** 归零（≤ min）即死亡 */
  deathAtZero: z.boolean().optional(),
  /** 死亡日志模板，可用 {self} */
  deathText: z.string().optional(),
});
export type StatDef = z.infer<typeof StatSchema>;

export const StatusSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  /** 每晚对每个活着的角色检查（self = 该角色），成立则自动获得 */
  enterWhen: ConditionSchema.optional(),
  /** 每晚检查，成立则移除 */
  exitWhen: ConditionSchema.optional(),
  /** 默认持续天数（效果里的 duration 优先）；不写 = 直到 exitWhen 或被移除 */
  duration: z.number().int().min(1).optional(),
  /** 美术状态名：public/art/characters/<id>/<artState>.png */
  artState: z.string().optional(),
  /** 多个状态都有 artState 时取 priority 最大的，默认 0 */
  priority: z.number().optional(),
  blocksExpedition: z.boolean().optional(),
  rules: z.array(RuleSchema).optional(),
  onEnter: z.array(EffectSchema).optional(),
  onExit: z.array(EffectSchema).optional(),
});
export type StatusDef = z.infer<typeof StatusSchema>;

export const ItemSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  tags: z.array(z.string()),
  /** 开局点数花费；不写则不能在开局选择 */
  cost: z.number().int().min(0).optional(),
  maxAtStart: z.number().int().min(1).optional(),
  /** 被使用/作为配给吃掉时的效果，self = 使用对象 */
  onUse: z.array(EffectSchema).optional(),
  /** 可在计划阶段对某个角色手动使用（消耗 1 个） */
  manualUse: z.boolean().optional(),
  /** 持有期间生效的规则（全局来源） */
  rules: z.array(RuleSchema).optional(),
});
export type ItemDef = z.infer<typeof ItemSchema>;

export const TraitSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  rules: z.array(RuleSchema),
});
export const CharacterSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  unlockedByDefault: z.boolean().optional(),
  cost: z.number().int().min(0).optional(),
  /** 覆盖属性初始值 */
  stats: z.record(z.string(), z.number()).optional(),
  traits: z.array(TraitSchema),
});
export type CharacterDef = z.infer<typeof CharacterSchema>;

export const DifficultySchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  points: z.number().int().min(0),
  rules: z.array(RuleSchema).optional(),
});
export type DifficultyDef = z.infer<typeof DifficultySchema>;

export const WeatherSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  duration: z
    .strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .optional(),
  rules: z.array(RuleSchema).optional(),
});
export type WeatherDef = z.infer<typeof WeatherSchema>;

export const MapSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  partySize: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  /** 开局可用点数购买的物品 id */
  startingPool: z.array(Id),
  /** 不花点数的初始物品 / 标记 */
  startingItems: z.record(z.string(), z.number().int().min(0)).optional(),
  startingFlags: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  eventDailyChance: Prob,
  diaryPerDay: z.number().int().min(0).optional(),
  expedition: z.strictObject({
    carrySlots: z.number().int().min(0),
    /** 预留：该地图外出必须使用的交通工具（物品 id） */
    vehicle: Id.optional(),
  }),
  /** 预留：天气表，空或不写 = 无天气 */
  weatherTable: z.array(z.strictObject({ weather: Id, weight: z.number().positive() })).optional(),
  rules: z.array(RuleSchema).optional(),
});
export type MapDef = z.infer<typeof MapSchema>;

export const LocationSchema = z.strictObject({
  id: Id,
  name: Text,
  desc: z.string().optional(),
  map: Id,
  /** 往返所需天数 */
  distance: z.number().int().min(1),
  /** 基础出事概率 0–1 */
  danger: Prob,
  /** 出事时受伤返回 : 未能返回 的权重 */
  failSplit: z.strictObject({ injured: z.number().min(0), lost: z.number().min(0) }).optional(),
  /** 受伤返回时的效果，self = 外出者 */
  injury: z.array(EffectSchema).optional(),
  lootRolls: z.number().int().min(0),
  loot: z.array(
    z.strictObject({
      item: Id,
      weight: z.number().positive(),
      min: z.number().int().min(1).optional(),
      max: z.number().int().min(1).optional(),
    }),
  ),
  requires: ConditionSchema.optional(),
  requiresHint: z.string().optional(),
  /** 返回时可能触发的特殊事件；when 中可用 carrying / at，self = 外出者 */
  specials: z
    .array(z.strictObject({ when: ConditionSchema.optional(), chance: Prob, event: Id }))
    .optional(),
  /** 预留：前往此地需要的交通工具 */
  vehicle: Id.optional(),
});
export type LocationDef = z.infer<typeof LocationSchema>;

export const RoleSchema = z.strictObject({
  /** 指定某个角色（只有他此刻在庇护所才绑得上） */
  is: Id.optional(),
  /** 候选角色须满足的条件，self = 候选角色 */
  where: ConditionSchema.optional(),
});
export type RoleDef = z.infer<typeof RoleSchema>;
const RolesSchema = z.record(z.string(), RoleSchema);

export const OutcomeSchema = z.strictObject({
  weight: z.number().positive().optional(),
  when: ConditionSchema.optional(),
  text: Text,
  effects: z.array(EffectSchema).optional(),
  /** 接续事件 id（事件链），沿用当前绑定的角色 */
  next: Id.optional(),
});
export const ChoiceSchema = z.strictObject({
  id: Id,
  text: Text,
  requires: ConditionSchema.optional(),
  requiresHint: z.string().optional(),
  outcomes: z.array(OutcomeSchema).min(1),
});
export const EventSchema = z.strictObject({
  id: Id,
  title: Text,
  text: Text,
  tags: z.array(z.string()).optional(),
  when: ConditionSchema.optional(),
  /** 随机抽取权重，默认 1；0 = 只能被 queueEvent / next / specials 触发 */
  weight: z.number().min(0).optional(),
  once: z.boolean().optional(),
  cooldown: z.number().int().min(0).optional(),
  roles: RolesSchema.optional(),
  art: z.string().optional(),
  choices: z.array(ChoiceSchema).min(1),
});
export type EventDef = z.infer<typeof EventSchema>;

export const DiarySchema = z.strictObject({
  id: Id,
  text: Text,
  when: ConditionSchema.optional(),
  roles: RolesSchema.optional(),
  weight: z.number().positive().optional(),
  cooldown: z.number().int().min(0).optional(),
  once: z.boolean().optional(),
});
export type DiaryDef = z.infer<typeof DiarySchema>;

export const EndingSchema = z.strictObject({
  id: Id,
  name: Text,
  text: Text,
  kind: z.enum(['selfRescue', 'rescue', 'death', 'other']),
  /** 每晚及进入计划阶段时检查；不写 = 只能由 { ending } 效果触发 */
  when: ConditionSchema.optional(),
  priority: z.number().optional(),
});
export type EndingDef = z.infer<typeof EndingSchema>;

export const ConfigSchema = z.strictObject({
  /** 每人每天的配给槽，每个槽是一个物品标签（如 food、water） */
  rationTags: z.array(z.string()),
  /** 日志保留天数 */
  logKeepDays: z.number().int().min(1),
  /** 全员死亡/离开且没有结局条件命中时使用的结局 id */
  fallbackEnding: Id,
  /** 引擎自动日志的文案模板，键见 ENGINE_TEXT_KEYS；缺省的键不写日志 */
  texts: z.record(z.string(), z.string()),
});
/**
 * 引擎会用到的文案键及可用变量：
 * death {self} | statusEnter/statusExit {self} {status} | rationMissing {self} {item}
 * expeditionDepart/expeditionReturn/expeditionInjured/expeditionLost {self} {location} {loot}
 * weatherChange {weather}
 */
export const ENGINE_TEXT_KEYS = [
  'death',
  'statusEnter',
  'statusExit',
  'rationMissing',
  'expeditionDepart',
  'expeditionReturn',
  'expeditionInjured',
  'expeditionLost',
  'weatherChange',
] as const;
export type EngineTextKey = (typeof ENGINE_TEXT_KEYS)[number];
export type GameConfig = z.infer<typeof ConfigSchema>;

/** 数据目录汇总导出的形状（src/data/index.ts） */
export const ContentDBSchema = z.strictObject({
  config: ConfigSchema,
  stats: z.array(StatSchema),
  statuses: z.array(StatusSchema),
  items: z.array(ItemSchema),
  characters: z.array(CharacterSchema),
  difficulties: z.array(DifficultySchema),
  weathers: z.array(WeatherSchema),
  maps: z.array(MapSchema),
  locations: z.array(LocationSchema),
  events: z.array(EventSchema),
  diary: z.array(DiarySchema),
  endings: z.array(EndingSchema),
});
export type ContentDB = z.infer<typeof ContentDBSchema>;

// ---------- 运行时状态（存档） ----------
const FlagValue = z.union([z.boolean(), z.number(), z.string()]);
const RolesState = z.record(z.string(), z.string());

export const CharStateSchema = z.object({
  id: z.string(),
  where: z.enum(['shelter', 'away', 'dead', 'gone']),
  stats: z.record(z.string(), z.number()),
  statuses: z.array(
    z.object({ id: z.string(), since: z.number(), daysLeft: z.number().optional() }),
  ),
});
export type CharState = z.infer<typeof CharStateSchema>;

export const ExpeditionPlanSchema = z.object({
  charId: z.string(),
  locationId: z.string(),
  carry: z.array(z.string()),
  vehicleId: z.string().optional(),
});
export type ExpeditionPlan = z.infer<typeof ExpeditionPlanSchema>;

export const LogEntrySchema = z.object({ day: z.number(), kind: z.string(), text: z.string() });
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const RunStateSchema = z.object({
  v: z.number().int(),
  seed: z.string(),
  /** 随机数内部状态（uint32） */
  rng: z.number(),
  mapId: z.string(),
  difficultyId: z.string(),
  day: z.number().int().min(1),
  phase: z.enum(['event', 'plan', 'ended']),
  /** 加入顺序，含已死亡/离开者 */
  party: z.array(z.string()),
  characters: z.record(z.string(), CharStateSchema),
  inventory: z.record(z.string(), z.number()),
  flags: z.record(z.string(), FlagValue),
  plan: z.object({
    /** 角色 id → 配给标签 → 物品 id */
    rations: z.record(z.string(), z.record(z.string(), z.string())),
    expedition: ExpeditionPlanSchema.optional(),
  }),
  expedition: ExpeditionPlanSchema.extend({ returnDay: z.number() }).nullable(),
  pendingEvent: z
    .object({
      eventId: z.string(),
      roles: RolesState,
      /** 已选择后的结果，等待 continueEvent */
      result: z
        .object({ choiceId: z.string(), text: z.string(), next: z.string().optional() })
        .optional(),
    })
    .nullable(),
  eventQueue: z.array(z.object({ eventId: z.string(), day: z.number(), roles: RolesState })),
  /** 今天是否已经处理过"抽随机事件"这一步 */
  eventRolled: z.boolean(),
  /** 键为 event:<id> / diary:<id> */
  history: z.record(z.string(), z.object({ count: z.number(), lastDay: z.number() })),
  weather: z.object({ id: z.string(), daysLeft: z.number() }).nullable(),
  log: z.array(LogEntrySchema),
  ending: z.object({ id: z.string(), day: z.number() }).nullable(),
  counters: z.record(z.string(), z.number()),
  /** 开局时已解锁 + 本局新解锁的角色 id；存档层负责并入档案 */
  unlocked: z.array(z.string()),
  /** 预留给未来引擎模块 */
  ext: z.record(z.string(), z.unknown()),
});
export type RunState = z.infer<typeof RunStateSchema>;
export type ActiveExpedition = NonNullable<RunState['expedition']>;
