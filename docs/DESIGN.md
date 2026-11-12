# 《末日时在深度思考中》设计文档（阶段 0）

> 状态：待确认。本文是引擎、数据、存档、UI 各模块的唯一设计依据；实现与本文冲突时先改本文。
> 所有数值、文案、内容均为占位，重在跑通。

## 1. 核心循环

```
选档案 → 新开局（选地图 → 选难度 → 选伙伴 → 用点数选物资）→ 庇护所按天循环 → 结局 → 结算（解锁写入档案）
```

每一天分两个需要玩家操作的阶段，其余由引擎自动结算：

| 顺序 | 阶段            | 内容                                                                                                                                   |
| ---- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 清晨（自动）    | 天气抽取（预留）→ 外出者到期则结算返回 → 触发 `dayStart` 规则 → 抽取当日事件                                                           |
| 2    | `event`（玩家） | 有事件则展示并选择；结果可立即接续下一个事件（事件链）。无事件则跳过                                                                   |
| 3    | `plan`（玩家）  | 给每个角色分配食物/水、使用道具、决定是否派人外出（谁、去哪、带什么）                                                                  |
| 4    | 入夜（自动）    | 消耗配给 → 外出者出发 → 属性每日衰减 → 状态自动进入/退出、持续时间递减 → 触发 `dayEnd` 规则 → 死亡判定 → 结局判定 → 天数 +1 → 自动存档 |

引擎是纯函数式的：`applyAction(state, action, content) → { state, log }`，不碰 DOM / IndexedDB / 时间 / `Math.random`。
玩家动作只有：`chooseEventOption`、`continueEvent`（看完结果后继续）、`setRation`、`useItem`、`planExpedition`、`cancelExpedition`、`endDay`。

阶段 0 的简化默认值（都由数据/配置控制，之后可调）：每天最多抽 1 个随机事件（事件链不计）；同一时间只有 1 人外出；队伍 2–4 人（由地图数据定）。

## 2. 属性与数值框架

一切都是数据，引擎只认识"属性""状态""物品""标记"这些抽象概念。

**属性（stat）**：数值 0–100，定义在 `stats` 数据里：`{ id, name, min, max, initial, dailyDelta, deathAtZero? , deathText? }`。
阶段 0 占位：

| id          | 含义   | 初始 | 每日变化 | 备注                          |
| ----------- | ------ | ---- | -------- | ----------------------------- |
| `satiety`   | 饱食度 | 70   | −12      | 一份罐头 +40                  |
| `hydration` | 水分   | 70   | −20      | 一瓶水 +45                    |
| `health`    | 健康   | 100  | 0        | `deathAtZero`，唯一的死亡闸门 |
| `sanity`    | 理智   | 80   | −2       | 低了进入"发疯"                |

**状态（status）**：`{ id, name, desc, enterWhen?, exitWhen?, duration?, artState?, rules }`。

- `enterWhen` / `exitWhen`：每晚自动检查的条件（如"饱食度 < 25 → 饥饿"）。
- 也可由效果 `addStatus` 手动施加（如事件导致生病，带 `duration`）。
- 状态的全部作用通过 `rules` 表达（如"饥饿：每天健康 −8"）。
- 阶段 0 占位状态：饥饿、口渴、生病、受伤、发疯、降智模式。

**死亡**：任何 `deathAtZero` 的属性归零即死亡（饥饿/脱水/生病都通过扣健康致死），没有别的写死路径。

**物品（item）**：库存是 `Record<itemId, 数量>`。物品定义：`{ id, name, desc, tags, cost?, maxAtStart?, onUse?, rules? }`。

- 食物和水只是带 `food` / `water` 标签的物品，`onUse` 写明吃掉后的效果。水世界的各种鱼就是新的 `food` 物品，无需改引擎。
- 道具持有期间的被动作用写在 `rules`（如"海水蒸馏器：每天 +2 淡水"）。

**标记与计数（flags）**：`Record<string, number | boolean | string>`，供事件链、结局条件使用。

## 3. 难度与点数分配

难度是数据：`{ id, name, desc, points, rules }`。`rules` 是全局修正（如困难：属性衰减 ×1.2、外出危险 ×1.3）。
占位：简单 30 点 / 普通 22 点 / 困难 15 点。

开局流程：

1. 选地图（只显示数据中存在的地图）。
2. 选难度。
3. 选伙伴：从档案已解锁的角色中选，人数在地图的 `partySize: {min, max}` 内。角色可带 `cost` 字段（默认 0，阶段 0 不用）。
4. 分配点数：地图的 `startingPool` 列出可选物品 id；每个物品有 `cost` 和 `maxAtStart`。点数不必用完，剩余作废。
5. 用种子（默认随机，可手填）生成初始 `RunState`。

## 4. "条件 → 效果"规则系统

全部是可被 zod 校验的 JSON 结构（数据文件用 TypeScript 写，享受类型提示，但内容必须是纯数据）。

### 4.1 目标（Target）

凡是涉及角色的条件/效果都带 `of`：

`"self"`（规则所属角色 / 事件绑定的主角）｜`"any"` / `"all"`（在庇护所的活人；条件里分别表示存在/全部，效果里 `all` 表示全体）｜`"random"`（随机一个在场活人）｜`"expeditioner"`（当前外出者）｜`{ "role": "名字" }`（事件里绑定的角色）｜`{ "id": "角色id" }`。

### 4.2 条件（Condition）

```ts
{ all: Condition[] } | { any: Condition[] } | { not: Condition }
{ stat: 'satiety', of: 'self', gte?: n, gt?: n, lte?: n, lt?: n }
{ hasStatus: 'sick', of: 'any' }
{ hasItem: 'radio', count?: 1 }            // 库存中有
{ carrying: 'crowbar' }                     // 本次外出携带（仅外出相关上下文）
{ hasTag: 'food', count?: 1 }               // 某标签物品总数
{ flag: 'radio_fixed', is?: true, gte?: n, lte?: n }  // 什么都不写 = 为真值
{ day: { gte?: n, lte?: n } }
{ inParty: 'kiminai' }                      // 该角色在本局队伍中且活着（含外出中）
{ inShelter: 'kiminai' }                    // 该角色此刻就在庇护所里
{ shelterCount: { gte?: n, lte?: n } }      // 此刻在庇护所的活人数
{ unlocked: 'kiminai' }                     // 局外已解锁
{ partyAlive: { gte?: n, lte?: n } }
{ map: 'city_ruins' } | { difficulty: 'hard' }
{ weather: 'rain' }                         // 预留
{ at: 'supermarket' }                       // 外出地点（仅外出相关上下文）
{ chance: 0.25 }                            // 用种子随机数掷骰
```

### 4.3 效果（Effect）

```ts
{ stat: 'health', of: 'self', add: -10 }         // 或 set: n；自动钳制到范围
{ addStatus: 'sick', of: 'self', duration?: 5, chance?: 0.5 }
{ removeStatus: 'sick', of: 'self' }
{ item: 'canned_food', add: 2 }                   // 负数为扣除，不会低于 0
{ loseRandomItem: { tag?: 'food', count: 1 } }    // 随机丢/坏一件
{ setFlag: 'radio_fixed', value: true } | { addFlag: 'signal', add: 1 }
{ joinParty: 'kiminai' }                          // 该角色加入本局
{ leaveParty: 'self', reason: 'gone' | 'dead', text?: '…' }
{ unlock: 'kiminai' }                             // 局外解锁，立即写入档案
{ queueEvent: 'rescue_arrives', delay: 3, roles?: {…} }
{ ending: 'rescued' }
{ log: '{self} 把罐头偷吃了。' }                   // 文案模板：{self} {role:xx} {item:id} {day}
{ if: Condition, then: Effect[], else?: Effect[] }
{ random: [{ weight: 3, effects: Effect[] }, …] }
```

### 4.4 规则（Rule）与修正（Modifier）

```ts
interface Rule {
  id: string;
  when?: Condition; // 不写 = 恒真
  trigger?: 'dayStart' | 'dayEnd' | 'expeditionDepart' | 'expeditionReturn';
  chance?: number; // 仅 trigger 规则
  effects?: Effect[]; // trigger 触发且 when 成立时执行
  modifiers?: Modifier[]; // 无 trigger：when 成立期间持续生效
}
interface Modifier {
  key: string;
  mul?: number;
  add?: number;
  scope?: 'self' | 'global';
} // 默认 self
```

规则的来源（引擎每次计算时统一收集）：角色特性 `character.traits[].rules`、角色身上的状态 `status.rules`、库存中的道具 `item.rules`、地图 `map.rules`、难度 `difficulty.rules`、天气 `weather.rules`（预留）。角色/状态来源的规则以该角色为 `self`。

**修正键**是引擎暴露的通用挂点，引擎在对应计算处查询 `最终值 = (基础值 + Σadd) × Πmul`：

| 键                                                     | 作用                              |
| ------------------------------------------------------ | --------------------------------- |
| `stat.<statId>.dailyDelta`                             | 该属性每日变化量                  |
| `status.<statusId>.gainChance`                         | 被施加该状态的概率（"不易生病"）  |
| `item.<tag>.useEffect`                                 | 使用带该标签物品时属性增益的倍率  |
| `expedition.lootRolls` / `expedition.lootWeight.<tag>` | 外出战利品抽取次数 / 某类物品权重 |
| `expedition.danger` / `expedition.duration`            | 外出危险度 / 耗时                 |
| `event.dailyChance` / `event.weight.<tag>`             | 每日事件概率 / 某类事件权重       |

新增挂点才需要改引擎；内容只是往这些键上挂数字。

约定：

- **持续性的每日增减用修正表达**（如"饥饿：健康每日 −8"写成 `stat.health.dailyDelta add -8`），这样外出中的角色也照常生效。
- **trigger 规则只对此刻在庇护所的角色触发**（外出的龙娘不会偷吃庇护所的粮）；`expeditionDepart/Return` 只对外出者本人及全局来源触发。
- 状态另有 `onEnter` / `onExit` 效果列表，用于进入/离开状态时的一次性效果。

### 4.5 示例：龙娘（引擎里没有任何"龙娘"字样）

```ts
// characters：龙娘的特性
traits: [{
  id: 'dragon_appetite', name: '龙之胃口', desc: '吃饱了什么都好说，饿了……',
  rules: [
    { id: 'dragon_full', when: { stat: 'satiety', of: 'self', gte: 70 },
      modifiers: [{ key: 'status.sick.gainChance', mul: 0.4 }, { key: 'expedition.lootRolls', add: 1 }] },
    { id: 'dragon_dumb_enter', trigger: 'dayEnd',
      when: { all: [{ stat: 'satiety', of: 'self', lt: 30 }, { not: { hasStatus: 'dumb_mode', of: 'self' } }] },
      effects: [{ addStatus: 'dumb_mode', of: 'self' }, { log: '{self} 的眼神逐渐清澈……' }] },
  ],
}]

// statuses：降智模式
{ id: 'dumb_mode', name: '降智模式', artState: 'dumb',
  exitWhen: { stat: 'satiety', of: 'self', gte: 30 },
  rules: [
    { id: 'dumb_slow_hunger', modifiers: [{ key: 'stat.satiety.dailyDelta', mul: 0.5 }] },
    { id: 'dumb_trouble', trigger: 'dayEnd', chance: 0.25, effects: [{ random: [
        { weight: 2, effects: [{ loseRandomItem: { tag: 'food', count: 1 } }, { log: '{self} 半夜偷吃了储备粮。' }] },
        { weight: 1, effects: [{ loseRandomItem: { tag: 'tool', count: 1 } }, { log: '{self} 把一件工具玩坏了。' }] },
    ] }] },
  ] }
```

## 5. 事件系统

```ts
interface EventDef {
  id: string;
  title: string;
  text: string;
  tags?: string[];
  when?: Condition; // 进入候选池的条件（含地图限定）
  weight?: number; // 默认 1
  once?: boolean;
  cooldown?: number; // 一局一次 / 冷却天数
  roles?: Record<string, { where?: Condition }>; // 从此刻在庇护所的活人中随机绑定（互不重复），绑不上则事件不入池；名为 self 的角色即 'self'
  art?: string;
  choices: Array<{
    id: string;
    text: string;
    requires?: Condition; // 不满足时置灰并显示 requiresHint
    requiresHint?: string;
    outcomes: Array<{
      weight?: number;
      when?: Condition;
      text: string;
      effects: Effect[];
      next?: string;
    }>;
  }>;
}
```

- **抽取**：每天清晨先看事件队列（`queueEvent` 排到今天的，必定触发）；队列为空则以 `eventDailyChance`（地图数据，经修正）决定是否抽随机事件，从满足 `when`、未被 `once`/`cooldown` 排除、角色可绑定的事件中按权重抽 1 个。
- **选择结算**：选项的 `outcomes` 先按 `when` 过滤再按权重抽 1 个，执行效果、显示结果文案；`next` 指向接续事件（事件链，立刻展示）。
- **可中断**：当前事件及其绑定角色、已抽到的结果都存在 `RunState.pendingEvent`，杀进程后恢复到同一画面。
- 没有选项的"通知型"事件 = 只有一个"知道了"选项。
- **结局**是数据：`{ id, name, text, kind: 'selfRescue' | 'rescue' | 'death' | 'other', when?, priority }`。每晚按优先级检查 `when`；也可由效果 `{ ending }` 直接触发。全员死亡/离开是一个普通的 `death` 结局（条件 `partyAlive ≤ 0`）。
- **阶段 0 结局**：自救（修好发电机 + 净水装置 + 种植箱三个标记齐备，庇护所可持续运转）；救援（修好电台 → 发出信号 → N 天后救援到达）；全灭。
- **基米奈流程**：事件"敲门声"（条件：本局队伍中没有她）→ 选择让她进来 → `joinParty` + `unlock`。`unlock` 立即写入档案（即使本局之后失败也保留），下次开局可选。

### 5.1 道具改变事件走向

不需要专门机制，三个位置都能写 `hasItem` 条件：

| 写在哪            | 效果                                     | 例                             |
| ----------------- | ---------------------------------------- | ------------------------------ |
| 事件的 `when`     | 没有道具根本不会发生                     | 有收音机才会收到军队广播       |
| 选项的 `requires` | 没有道具时选项置灰并提示                 | "用斧头劈开"需要斧头           |
| 结果的 `when`     | 同一选择因道具而结果不同，可同时消耗道具 | 有门锁则挡住一次破门并损坏门锁 |

```ts
{ id: 'break_in', title: '破门', text: '半夜，门外传来撞击声……',
  choices: [{ id: 'hold', text: '顶住门', outcomes: [
    { when: { hasItem: 'door_lock' }, text: '门锁撑住了，但也彻底坏了。', effects: [{ item: 'door_lock', add: -1 }] },
    { when: { not: { hasItem: 'door_lock' } }, text: '他们冲进来抢走了一些东西。', effects: [{ loseRandomItem: { count: 2 } }] },
  ] }] }
```

### 5.2 避难所日记

每天清晨（外出返回结算之后）从日记池里抽 `map.diaryPerDay` 条（默认 1）写入当日日志，纯氛围文本，不带选项。

```ts
interface DiaryDef {
  id: string;
  text: string; // 模板：{a} {b} 为绑定的角色名
  when?: Condition; // 全局条件（天数、物资、标记、天气…）
  roles?: Record<string, { where?: Condition }>; // 与事件相同的绑定方式
  weight?: number;
  cooldown?: number;
  once?: boolean;
}
```

一致性由机制保证，而不是靠作者小心：

- 文本里出现的角色**必须**通过 `roles` 绑定，而绑定只会选**此刻在庇护所的活人**——外出、死亡、离开的角色不可能被写进日记。
- 每个角色的 `where` 限定其状态，例如"很有活力"要求 `{ not: { hasStatus: 'hungry', of: 'self' } }` 且饱食度够高。
- 指名某个角色的日记给该 role 加 `is: '角色id'`（事件的 role 同样支持）：只有该角色此刻在庇护所时才绑得上。
- 校验脚本检查：文本中的 `{名字}` 都有对应 role；没有 role 的日记文本不得出现任何角色名。

```ts
{ id: 'argue', text: '{a} 和 {b} 为了最后一块饼干的归属吵了一架。', when: { shelterCount: { gte: 2 } }, roles: { a: {}, b: {} } }
{ id: 'energetic', text: '{a} 今天精神很好，在庇护所里做起了广播体操。',
  roles: { a: { where: { all: [{ stat: 'satiety', of: 'self', gte: 60 }, { not: { hasStatus: 'sick', of: 'self' } }] } } } }
```

## 6. 外出结算

**地点（location）**：`{ id, name, desc, map, distance, danger, lootRolls, loot: [{ item, weight, min, max }], requires?, specials?: [{ when, chance, event }], vehicle? }`

流程：

1. `plan` 阶段选择：外出者（在庇护所、活着、没有禁止外出的状态）、目的地（满足 `requires`）、携带道具（最多 `map.expedition.carrySlots` 件，暂时离开库存）。
2. 入夜出发，触发 `expeditionDepart`；外出期间该角色不吃配给，属性照常衰减。
3. `耗时 = distance + 修正(expedition.duration)` 天后的清晨结算，触发 `expeditionReturn`：
   - **安危**：`风险 = clamp(danger × 修正(expedition.danger) × 距离系数, 0, 0.95)`。掷骰得到三档之一：平安 / 受伤返回（施加地点指定的状态、扣属性）/ 未能返回（`leaveParty`，携带道具一并丢失）。受伤与失踪的比例由地点数据的 `failSplit` 决定。
   - **战利品**：平安或受伤时，从 `loot` 表按权重抽 `lootRolls + 修正` 次（权重受 `expedition.lootWeight.<tag>` 修正），受伤时次数减半。
   - **特殊事件**：逐条检查 `specials`（条件通常是 `carrying` + `at`），命中则把对应事件以外出者为主角排入当天队列。
   - 携带道具归还库存。
4. 所有随机都走种子随机数；结果写入日志，由 UI 在清晨报告里展示。

"城市废墟"占位地点：便利店（近、安全、食物和水）、药房（中、药品）、五金市场（远、危险、工具零件——自救结局所需）。

**扩展点**：`ActiveExpedition.vehicleId` 与 `location.vehicle` 字段已预留（水世界的小船）；找不到淡水只是 `loot` 表里不放水；下雨集水是天气的 `rules`；这些都不需要改结算代码。

## 7. 运行时状态与存档

```ts
interface RunState {
  v: number; // 存档版本
  seed: string;
  rng: number[]; // 可复现随机数的内部状态
  mapId: string;
  difficultyId: string;
  day: number;
  phase: 'event' | 'plan' | 'ended';
  party: string[]; // 加入顺序
  characters: Record<
    string,
    {
      id: string;
      where: 'shelter' | 'away' | 'dead' | 'gone';
      stats: Record<string, number>;
      statuses: Array<{ id: string; since: number; daysLeft?: number }>;
    }
  >;
  inventory: Record<string, number>;
  flags: Record<string, number | boolean | string>;
  plan: {
    rations: Record<string, { food?: string; water?: string }>;
    expedition?: { charId; locationId; carry: string[]; vehicleId? };
  };
  expedition: { charId; locationId; carry: string[]; vehicleId?; returnDay: number } | null;
  pendingEvent: {
    eventId;
    roles: Record<string, string>;
    resolved?: { choiceId; outcomeIndex };
  } | null;
  eventQueue: Array<{ eventId; day: number; roles?: Record<string, string> }>;
  eventHistory: Record<string, { count: number; lastDay: number }>;
  weather: { id: string; daysLeft: number } | null; // 预留
  log: Array<{ day: number; text: string; kind: string }>; // 只保留最近若干天
  ending: { id: string; day: number } | null;
  counters: Record<string, number>; // 统计：外出次数、事件数等
  unlocked: string[]; // 开局时档案已解锁 + 本局新解锁；存档层每次动作后并入档案
  ext: Record<string, unknown>; // 预留给未来引擎模块的状态，见第 11 节
}

interface Profile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  unlockedCharacters: string[]; // 初始为数据中 unlockedByDefault 的角色
  endingsSeen: string[];
  runsPlayed: number;
  settings: Record<string, unknown>;
}
```

- **IndexedDB**（库名 `dtad`）：`profiles`（档案）、`runs`（键为档案 id，每个档案一个进行中的对局）、`meta`（上次使用的档案等）。
- **保存时机**：每个玩家动作之后、每天结束时；`visibilitychange`(hidden) / `pagehide` 补存。不使用 `beforeunload`。启动时调用 `navigator.storage.persist()`。
- **导出信封**：`{ format: 'dtad-save', version, exportedAt, profile, run? }`。JSON 文件导出/导入；**存档码** = `DTAD1.` + base64url(deflate(JSON)) + 校验和（`CompressionStream` 不可用时退回不压缩的 `DTAD0.`）。
- **版本与迁移**：`migrations[n]` 把版本 n 升到 n+1，读取时依次执行；高于当前版本的存档拒绝并提示更新游戏。
- **导入校验**：先 zod 校验结构，错误翻译成友好中文（"存档码不完整""文件不是本游戏存档"等）。
- **失效引用修复**（内容被删除后）：读取时执行 `sanitize(run, content)` —— 未知物品/状态/标记静默丢弃；未知的待处理事件和队列事件移除；外出目的地失效则外出者直接返回；未知角色移出队伍；地图或难度失效、或队伍被清空，则该对局作废并告知玩家（档案和解锁保留）。档案里未知的解锁角色保留但不显示。

## 8. 数据目录

```
src/data/
  stats.ts  statuses.ts  items.ts  characters.ts  difficulties.ts  endings.ts
  maps.ts  locations.ts  weathers.ts(空)
  events/            按主题分文件（city-common.ts、kiminai.ts、rescue.ts …），index.ts 汇总
  ui-text.ts         界面固定文案
  index.ts           汇总导出 content: ContentDB
```

- 每个文件导出一个定义数组，用 `satisfies` 获得类型检查；互相只用字符串 id 引用。id 用小写蛇形，全局在各自类别内唯一。
- 新增内容 = 在对应文件加一条数据（新事件文件需在 `events/index.ts` 加一行）。
- 美术：`public/art/<characters|items|locations|events|ui>/<id>/<状态>.png`。角色的状态名取其当前优先级最高、且带 `artState` 的状态，否则 `normal`。加载失败依次回退 `normal.png` → 程序生成的占位图（由 id 哈希得到的色块 + 名称）。

## 9. 模块划分

```
src/engine/   纯逻辑，零浏览器依赖
  schema.ts       全部内容与存档结构的 zod schema，TS 类型由此推导（唯一真相）
  content.ts      ContentDB：加载数据、建索引
  rng.ts          可设种子、可序列化的随机数
  conditions.ts   条件求值        effects.ts   效果执行
  rules.ts        规则收集、修正查询、trigger 派发
  events.ts       事件抽取、角色绑定、选项结算、队列
  day.ts          清晨/入夜结算流程
  expedition.ts   外出规划校验与返回结算
  setup.ts        开局（点数校验、初始状态）
  endings.ts      结局判定
  game.ts         对外 API：newRun / applyAction / 查询辅助
src/save/     IndexedDB、档案、迁移、sanitize、导入导出、存档码
src/ui/       无框架：store（订阅状态）、screens/（档案、开局、庇护所、事件、外出、结局、设置）、components/、art.ts
src/sim/      无 UI 批量模拟：策略机器人 + 统计输出
scripts/      validate-content.ts（npm run validate）、simulate.ts（npm run sim）
tests/        引擎单测、存档往返测试、内容校验测试、模拟冒烟测试
```

依赖方向：`ui → save → engine ← data`，`sim → engine`。引擎不得 import `ui` / `save`，也不得出现任何具体内容 id。

## 10. 为以后加引擎功能留的余地

项目处于早期验证，之后会追加需要改引擎的机能，接手的多半是较小的模型。因此：

- **类型驱动的扩展**：条件、效果、动作、触发时机都是 TypeScript 可辨识联合，求值处用穷尽检查（`never`）。在 `schema.ts` 加一种新类型后，编译器会逐个报出所有还没处理它的地方——照着报错补完即可，不会漏。
- **修正键是开放的字符串**：新系统要让内容能影响某个数值，只需在计算处调用一次 `getModifier(键, 基础值)`，并把键登记到文档。
- **按天流程是有序步骤表**：`day.ts` 的清晨/入夜各是一个带名字的步骤数组，新系统（天气、制作、建造、士气…）作为新步骤插入，不改已有步骤。
- **状态留扩展槽**：`RunState.ext` 给新模块存放自己的状态；正式落地时配一次存档迁移。新增可选字段不需要迁移，改变已有字段含义必须加迁移。
- **引擎零内容 id**：有测试扫描 `src/engine/` 确保不出现数据里的 id。
- **引擎测试用独立的夹具内容**（`tests/fixtures/`），不依赖正式数据，所以内容整体替换不会弄坏引擎测试。
- **文档**：`CLAUDE.md`（日常约定与"如何新增内容"）＋ `docs/ENGINE_GUIDE.md`（如何扩展引擎：新增条件/效果/触发时机/修正键/每日步骤/动作/存档字段各自的分步清单、必须同步更新的文件、常见错误）＋ 本文（设计依据）。改引擎的提交必须同步更新 `ENGINE_GUIDE.md`。

## 11. 任务拆分

| #   | 任务                                                                                                                           | 负责                      | 依赖  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ----- |
| A   | 本文档                                                                                                                         | 主设计师                  | —     |
| B   | `schema.ts`、`rng`、条件/效果/规则、事件引擎、按天循环、`setup`、`endings`、`game.ts` + 关键单测；`expedition.ts` 只定接口和桩 | 主设计师                  | A     |
| C1  | 存档系统（`src/save/` 全部 + 测试）                                                                                            | opus                      | B     |
| C2  | 外出结算（实现 `expedition.ts` + 测试）                                                                                        | opus                      | B     |
| C3  | UI 整体结构（store、路由、屏幕骨架、`art.ts` 回退链、与存档的衔接）                                                            | opus                      | B     |
| C4  | 样例数据（2+1 角色、3 地点、约 10 事件、约 15 条日记、道具、状态、3 结局）                                                     | sonnet                    | B     |
| C5  | 内容校验脚本 `npm run validate`（引用、语法、越界、不可达结局提示）                                                            | sonnet                    | B     |
| C6  | 批量模拟入口 `npm run sim` + 冒烟测试                                                                                          | sonnet                    | B     |
| C7  | 各页面与样式（手机竖屏优先）                                                                                                   | sonnet                    | C3    |
| C8  | PWA 完善（manifest、离线缓存、更新提示、iOS meta）                                                                             | sonnet                    | C3    |
| C9  | 测试补充（跑通基米奈解锁、两种结局的端到端用例）                                                                               | sonnet                    | C2 C4 |
| D   | 集成、审查、修复；build / test / lint / validate 全绿；推送并确认 Pages                                                        | 主设计师                  | 全部  |
| E   | `CLAUDE.md`（约定、目录、数据格式、各类新增指南）与 `docs/ENGINE_GUIDE.md`（引擎扩展指南）                                     | sonnet 起草，主设计师审核 | D     |

C1–C6 并行派发；C7–C9 第二批并行。
