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

**死亡**：任何 `deathAtZero` 的属性归零即死亡（饥饿/脱水/生病都通过扣健康致死）。引擎里没有别的自动致死路径；内容可以用效果 `{ leaveParty, reason: 'dead' }` 直接写死某个角色（剧情杀）。

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
{ queueEvent: 'rescue_arrives', delay: 3 }           // 沿用当前的 self 与已绑定角色；到期必定触发，不再检查该事件的 when
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
   - **安危**：`风险 = clamp(修正(expedition.danger, 基础值 danger), 0, 0.95)`（距离只体现在耗时上，危险度完全由地点数据决定）。掷骰得到三档之一：平安 / 受伤返回（施加地点指定的状态、扣属性）/ 未能返回（`leaveParty`，携带道具一并丢失）。受伤与失踪的比例由地点数据的 `failSplit` 决定。
   - **战利品**：平安或受伤时，从 `loot` 表按权重抽 `lootRolls + 修正` 次（权重受 `expedition.lootWeight.<tag>` 修正），受伤时次数减半。
   - **特殊事件**：逐条检查 `specials`（条件通常是 `carrying` + `at`），命中则把对应事件以外出者为主角排入当天队列。
   - 携带道具归还库存。
4. 所有随机都走种子随机数；结果写入日志，由 UI 在清晨报告里展示。

"城市废墟"占位地点：便利店（近、安全、食物和水）、药房（中、药品）、五金市场（远、危险、工具零件——自救结局所需）。

**扩展点**：`ActiveExpedition.vehicleId` 与 `location.vehicle` 字段已预留（水世界的小船）；找不到淡水只是 `loot` 表里不放水；下雨集水是天气的 `rules`；这些都不需要改结算代码。

## 7. 运行时状态与存档

> 下面的结构是设计时的示意。**字段的精确定义以 `src/engine/schema.ts` 的 `RunStateSchema` 和 `src/save/types.ts` 为准**（例如 `rng` 实际是一个数字，事件历史字段叫 `history`，另有 `newUnlocks`、`eventRolled`）。

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
- 美术：`public/art/<characters|items|locations|events|ui>/<id>/<状态>.webp`。角色的状态名取其当前优先级最高、且带 `artState` 的状态，否则 `normal`。加载失败依次回退 `normal.webp` → 程序生成的占位图（由 id 哈希得到的色块 + 名称）。

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

## 12. 阶段 1 内容扩充：七人庇护所、道具事件与四条结局线

> 依据用户提供的 `设定/` 文件夹（人设、技能构想、日记与事件灵感）。本节是数值与 id 的约定，**内容实现以本节为准**；`设定/` 里的文字是文案素材。数值是起点，最终以 `npm run sim` / `npm run skill` 调出来的为准（调整后回写本节）。

### 12.1 新增的引擎机制（都已实现，见 ENGINE_GUIDE）

| 机制                          | 写法                                                                                   | 用途                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 随机不重复挑选                | 效果 `{ pickFlags: { flags: ['trail_1','trail_2'], from: ['a','b','c'] } }`            | 每局随机的目标地点、需要的道具                       |
| 按 flag 里的地点判断外出地点  | 条件 `{ atFlag: 'trail_1' }`                                                           | 线索链：去对的地方才触发                             |
| 按 flag 里的物品判断/增减库存 | 条件 `{ hasFlagItem: 'evac_item', count? }`、效果 `{ flagItem: 'evac_item', add: -1 }` | 每局随机的撤离凭证                                   |
| 文案里显示 flag               | `{flag:x}`（原值）、`{flagItem:x}`（物品名）、`{flagLocation:x}`（地点名）             | "还需要 4 份水""下一个记号在药房"                    |
| 备忘                          | 内容 `notes: [{ id, text, when?, order? }]`，引擎 `getNotes(env)`                      | 日记本"备忘"页：任务进度与线索，防止玩家忘记随机目标 |

### 12.2 角色（7 人）

- 开局队伍 2–3 人；**同时在世最多 4 人**：所有"访客入队"事件都要求 `{ partyAlive: { lte: 3 } }`。
- 默认解锁：龙娘 `dragon_girl`、大肥鱼 `big_fish`、糖包 `tangbao`。靠事件解锁：基米奈 `kiminai`、嘎拉嘛 `garama`、克劳德 `kelaode`、月 `moon`。任何不在本局队伍里的角色（含已解锁的）都可能以访客身份出现。
- 设定里的技能对引擎的评估结论：全部可以用现有"条件→效果"表达，以下几处做了调整：

| 原构想                                     | 调整                                                                                                                                                                    | 原因                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 嘎拉嘛"夜间修补受损道具"                   | 在家且状态正常时，夜间入侵类事件（tag `danger`）权重减半                                                                                                                | 引擎没有"拦截道具损坏"的时机；降低入侵概率表达的是同一件事 |
| 克劳德"踩雷就拒绝对话"、基米奈"失窃后绝望" | 用"昨日事故"flag：内容在出事时写 `incident` / `rule_broken`，地图规则每天清晨把它们转成 `incident_recent` / `rule_broken_recent` 并清零；角色在清晨对 `*_recent` 做反应 | 没有"某事发生时"的触发时机；次日清晨反应在叙事上也成立     |
| 糖包"去哄理智最低的人"                     | 随机哄一个在场的人                                                                                                                                                      | 目标没有"最低者"这一种                                     |
| 克劳德"压低全局理智崩坏"                   | 只压低全队生病概率                                                                                                                                                      | 与糖包的理智光环重叠                                       |
| 基米奈"陷入绝望"直到理智回升               | 加 4 天上限                                                                                                                                                             | 绝望会持续扣理智，没有上限容易变成死亡螺旋                 |
| 大肥鱼原特性"水里的老大"                   | 按设定替换为"大白饭"；新增道具 **大米** `rice`（tag `food` + `rice`）作为她的专属加成                                                                                   | 设定重写了她                                               |
| 月"有地图册/收音机时放大效果"              | 有地图册：外出耗时 −1 天；有收音机：在家时 `radio` 类事件权重 ×1.5                                                                                                      | 拆成两个能直接落地的修正                                   |

各角色的数值起点（`self` 修正除特别说明外只影响本人）：

| 角色   | 高光（条件）                                                                                                                       | 崩坏状态（进入条件 → 效果）                                                                                                                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 龙娘   | 饱食 ≥70：生病概率 ×0.4、外出战利品 +1；饱食 ≥80 入夜 15% 用小火苗烤罐头（全员理智 +2）                                            | 饱食 <30 入夜 → `dumb_mode`（现有）：饱食衰减 ×0.5，25% 偷吃/弄坏工具（并写 `incident`）                                                                                                                                                                                                                                             |
| 大肥鱼 | 食物增益 ×1.4（`item.food.useEffect`）；吃 `rice` 再 ×1.3 且理智 +3；饱食 ≥70：理智衰减 ×0.3、外出食物权重 ×1.6                    | 饱食 <30：理智额外 −2/天、外出危险 ×1.3、战利品 −1。饱食 ≥85 入夜 50% → `food_coma` 晕碳中（1 天；入夜判定时饱食最高只到 88，所以门槛是 85 而不是 90）：不能外出，饱食衰减 ×0.5，健康 +3/天，理智 +2/天                                                                                                                              |
| 基米奈 | 理智 ≥50 且健康 ≥50 且非绝望（"开朗"）：生病 ×0.5、外出危险 ×0.8、战利品 +1；在家时全队理智衰减 +0.5（global，同样只在开朗时生效） | `despair` 陷入绝望：她自己的 `dayEnd` 规则在理智 <30 时进入；清晨若身上有受伤/生病 35%、`incident_recent` 40% 进入。进入时理智压到最多 45；最长 4 天、理智 ≥55 退出；不能外出，自身理智 −2/天，入夜 40% 让随机一人理智 −3；退出时全员理智 +3 并写振作冷却 flag `despair_cooldown`（冷却期间三条进入规则都不触发，每天清晨 30% 清除） |
| 嘎拉嘛 | 外出工具、部件权重 ×1.6；携带手电筒或撬棍时外出危险 ×0.75；在家且理智 ≥40 且非已读乱回：`event.weight.danger` ×0.5（global）       | 入夜（理智 <35 或饱食 <30）35% → `misread` 已读乱回（3 天，理智 ≥50 且饱食 ≥40 提前退出）：战利品 −1、工具权重 ×2、食物与水权重 ×0.5，理智衰减 ×0.5，生病概率 ×0.5                                                                                                                                                                   |
| 克劳德 | 初始理智 90。理智 ≥50 且非拒绝对话：外出危险 ×0.5、药品权重 ×1.5、部件权重 ×1.3；在家时全队生病概率 ×0.75（global）                | `refuse_talk` 拒绝对话（2 天）：清晨 `rule_broken_recent` 60% 进入；每次外出归来 25% 进入。不能外出，光环失效，自身理智 +3/天                                                                                                                                                                                                        |
| 月     | 外出战利品 +1；持有地图册：外出耗时 −1 天；持有收音机且在家：`event.weight.radio` ×1.5（global）                                   | `queueing` 排队等待中（1 天）：外出归来 40% 进入；入夜理智 <40 时 25% 进入。不能外出，饱食衰减 ×0.7；退出时：40% 想起一件小物资（饼干/水/感冒药 1 件），60% 全员理智 +2                                                                                                                                                              |
| 糖包   | 在家且没有生病/发疯/滑跪：全队理智衰减 +1.5（global）；入夜 30% 哄随机一人理智 +4                                                  | 外出：危险 ×1.3、工具与部件权重 ×0.6。入夜（饱食 <40 或理智 <50）10% 好心办坏事：丢 1 件食物或水（写 `incident`）并进入 `kneeling` 面壁滑跪中（1 天，不能外出，进入时全员理智 +3）                                                                                                                                                   |

访客入队事件（都要求 `{ not: { inParty: <id> } }` 与 `{ partyAlive: { lte: 3 } }`，tag `visitor`，冷却 5 天）：

| 角色   | 事件 id                         | 额外条件                                         |
| ------ | ------------------------------- | ------------------------------------------------ |
| 基米奈 | `knock`（现有，补上人数上限）   | 第 3 天起                                        |
| 嘎拉嘛 | `garama_knock` 夜半门栓响       | 第 3 天起                                        |
| 克劳德 | `kelaode_umbrella` 雨幕下的公约 | 第 4 天起，且有工具或药品                        |
| 月     | `moon_flyers` 循着传单找来的人  | 第 3 天起，且（`explored` 或持有地图册或收音机） |
| 糖包   | `tangbao_candy` 门缝里的糖纸    | 第 2 天起                                        |

### 12.3 flag 约定

| flag                                                                                     | 谁写                                          | 含义                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------ |
| `incident`                                                                               | 内容（失窃、物资损坏、偷吃时 `setFlag true`） | 今天出了事故                         |
| `rule_broken`                                                                            | 内容（暴力/不道德选项、偷吃、违规时）         | 今天有人踩了克劳德的雷               |
| `incident_recent` / `rule_broken_recent`                                                 | 地图规则（每天清晨）                          | 昨天出过事故；角色在清晨对它做反应   |
| `explored`                                                                               | 地图规则（任何外出归来）                      | 至少外出过一次                       |
| `evac_item`                                                                              | 地图规则（第 1 天清晨 `pickFlags`）           | 本局军方撤离需要的凭证物品           |
| `evac_known` `evac_contact`                                                              | 军方线事件                                    | 听到过广播 / 已约定会合              |
| `caravan_known` `caravan_water_left` `caravan_food_left` `caravan_visits` `caravan_gone` | 车队线事件                                    | 车队进度                             |
| `trail_started` `trail_step`（1–4） `trail_1` `trail_2` `trail_3`                        | 线索线事件（`pickFlags`）                     | 地下列车线索进度与本局随机的三个地点 |
| `gen_installed` `filter_installed` `seeds_installed` `vent_installed`                    | 自救线事件                                    | 自救设施进度                         |

### 12.4 道具（新增 7 件）

| id            | 名称     | tag        | 作用                                        |
| ------------- | -------- | ---------- | ------------------------------------------- |
| `rice`        | 大米     | food, rice | 饱食 +35、理智 +2；大肥鱼专属加成           |
| `lighter`     | 打火机   | tool       | 寒夜取暖、烧鼠窝、信号火等事件              |
| `duct_tape`   | 胶带     | tool       | 修漏水、修收音机等事件                      |
| `bug_spray`   | 杀虫喷雾 | tool       | 虫鼠事件；植物园温室的专属事件钥匙          |
| `rope`        | 绳索     | tool       | 救人、下竖井；地铁站的专属事件钥匙          |
| `flare`       | 信号弹   | tool       | 直升机/军方事件；撤离凭证候选；不能开局购买 |
| `vent_filter` | 通风滤网 | part       | 第 4 个自救部件                             |

现有部件 `generator_part` `water_filter` `seed_pack` 不再在五金市场掉落，改为分散在远处的专属地点（12.6）。

### 12.5 地点（10 个，地图 `city_ruins`）

| id                  | 名称       | 天数 | 危险 | 抽取 | 主要产出                                                       | 专属事件钥匙（携带）                 |
| ------------------- | ---------- | ---- | ---- | ---- | -------------------------------------------------------------- | ------------------------------------ |
| `convenience_store` | 便利店     | 1    | 0.12 | 3    | 水、饼干、罐头、大米、打火机、扑克牌、信号弹（少）             | 手电筒 → 后仓库（35%，每局一次）     |
| `residential_block` | 居民楼     | 1    | 0.12 | 3    | 水、食物、大米、胶带、打火机、杀虫喷雾、信号弹、防毒面具（少） | —                                    |
| `pharmacy`          | 药房       | 2    | 0.18 | 2    | 急救包、感冒药、防毒面具、杀虫喷雾、水                         | 防毒面具 → 密封药柜（25%，每局一次） |
| `library`           | 图书馆     | 2    | 0.12 | 2    | 地图册、收音机（少）、饼干                                     | —                                    |
| `subway_station`    | 地铁站     | 2    | 0.24 | 2    | 绳索、手电筒、水、信号弹；**通风滤网**                         | 绳索 → 通风竖井（55%，必得滤网）     |
| `police_station`    | 警察局     | 2    | 0.3  | 3    | 信号弹、门锁、急救包、防毒面具、撬棍                           | —                                    |
| `hardware_market`   | 五金市场   | 3    | 0.3  | 3    | 撬棍、手电筒、门锁、收音机、胶带、绳索、信号弹                 | 撬棍 → 上锁仓库（25%，每局一次）     |
| `substation`        | 变电站     | 3    | 0.26 | 2    | 胶带、手电筒、水；**发电机零件**                               | 手电筒 → 配电室（55%，必得零件）     |
| `water_plant`       | 自来水厂   | 3    | 0.25 | 2    | 大量水、防毒面具；**滤水芯**                                   | 防毒面具 → 过滤车间（55%，必得滤芯） |
| `greenhouse`        | 植物园温室 | 3    | 0.26 | 2    | 食物、杀虫喷雾；**种子包**                                     | 杀虫喷雾 → 育苗室（55%，必得种子）   |

稀有部件在掉落表里的权重约占 12–25%（发电机零件 2.5、滤水芯 3、种子包 / 通风滤网 1.5）；带对的钥匙道具去，专属事件 55% 触发并必得该部件。便利店、居民楼失败时"受伤 : 失踪"为 3 : 1，其余地点见数据。
**废墟越搜越空**（地图规则，全局）：第 10 天起每次外出少抽 1 次（`expedition.lootRolls −1`）；第 14 天起食物与水的掉落权重 ×0.6。前期物资相对宽裕，中后期逼着玩家尽快走一条结局线。

### 12.6 结局（5 个）

| id              | 名称     | kind       | 达成方式                                                                                                                                                                                                                                                            | 设计意图                                                            |
| --------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `self_rescue`   | 自给自足 | selfRescue | 四个设施都装好（`gen/filter/seeds/vent_installed`）。拿到部件的当天清晨自动弹出安装事件                                                                                                                                                                             | **最难**：4 个稀有部件分散在 4 个最远最危险的地点，最好带对钥匙道具 |
| `military_evac` | 军方撤离 | rescue     | 有收音机 → 听到军方广播（告知本局需要的凭证 `{flagItem:evac_item}`，从 防毒面具/信号弹/手电筒/地图册/绳索 中随机）→ 回应（成功 50%，失败也会记下凭证）约定会合 → 3 天后会合时出示凭证（或 3 份食物贿赂，25% 成功）。广播：第 6 天起、权重 1.5、冷却 5 天            | **匹配随机道具**：每局要的东西不同                                  |
| `caravan`       | 南下车队 | rescue     | 车队来访（第 5 天起、权重 3、冷却 3 天）→ 本局随机定下需要的水（3/4/5）与食物（3/4/5）→ 每次来访可分批上交（每次 1 份，可连交），每 2 天来一次，最多来 6 次；交齐即被带走（参数在 `events/rescue.ts` 顶部的 `CARAVAN_*` 常量）                                      | **提交物资**：与自己活下去争资源                                    |
| `subway_rescue` | 地下列车 | rescue     | 门缝里的传单（第 4 天起、权重 3、冷却 3 天）→ `pickFlags` 从 变电站/图书馆/药房/地铁站/警察局/五金市场 中随机三个地点作为三个记号 → 必须**按顺序**外出到那里（地图规则在 `expeditionReturn` 时检查 `atFlag`），每找到一个记号揭示下一个 → 第三个记号后 2 天列车到站 | **随机顺序与地点的连续事件**                                        |
| `wiped`         | 全员失联 | death      | 全员死亡/离开                                                                                                                                                                                                                                                       | —                                                                   |

旧的 `rescued`（收音机回应后必定获救）删除。所有线索都写进**备忘**（12.1）。

每局一次的搜刮点：便利店后仓库（`back_room_emptied`）、药房密封药柜（`pharmacy_vault_opened`）、五金市场上锁仓库（`market_vault_opened`）。

### 12.7 道具事件（60 Seconds 式"用不用某件东西"）

每件工具类道具至少在两个事件里有用：要么作为选项的 `requires`（没有就置灰），要么在结果 `when` 里改变结局走向，要么作为事件的出现条件。好结果通常消耗或损坏道具（`{ item, add: -1 }`），让玩家权衡"现在用还是留着"。

### 12.8 文件归属（阶段 1 并行开发时）

| 范围                 | 文件                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 角色                 | `characters.ts` `statuses.ts` `events/characters.ts` `events/kiminai.ts`                                                                                                 |
| 世界                 | `items.ts` `locations.ts` `maps.ts` `endings.ts` `notes.ts` `config.ts` `scenes.ts` `events/rescue.ts` `events/self-rescue.ts` `events/items.ts` `events/city-common.ts` |
| 文本阶段（平衡之后） | `diary.ts`、全部事件文案润色                                                                                                                                             |

### 12.9 数值平衡（阶段 1 调平后的取值与目标）

基础数值（取代第 2、3 节的阶段 0 占位）：

| 项目          | 取值                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| 饱食度 / 水分 | 初始 70，每日 −10 / −10                                                    |
| 饥饿 / 口渴   | 饱食 / 水分 <25 进入、≥30 退出；健康 −15 / −20 每天                        |
| 瓶装水        | 水分 +30（1 点）；罐头 +40（3 点）、饼干 +22（1 点）、大米 +35（2 点）不变 |
| 道具价格      | 收音机 3、手电筒 3（其余不变）                                             |
| 简单          | 30 点；外出危险 ×0.85，食物 / 水掉落权重 ×1.1                              |
| 普通          | 22 点，无修正                                                              |
| 困难          | 17 点；外出危险 ×1.2，食物 / 水掉落权重 ×0.9（不再改饱食衰减）             |

注意：sim 的策略 bot 在属性低于 90% 时就喂食，所以**每日衰减是否 ≤10 是个悬崖**：≤10 时它隔天才吃喝一次（与人类的消耗接近），>10 时每天都吃喝，消耗翻倍。改衰减或给衰减加 `mul` 修正前先跑 `compare`。

平衡目标（每难度 ≥500 局、固定种子；回归护栏写在 `balance/targets.ts`）：

- random 各难度通关 <3%；sensible 简单 40–55%、普通 25–40%、困难 12–25%，三档显著递减。
- 普通 sensible：军方撤离、地下列车各 ≥5%；自救 2–8% 且是最少见的胜利结局。**南下车队例外**：它被设计成需要主动节食囤货的线，sensible 从不节食，所以它的车队率（约 3%）低估了真人玩家；车队难度以 LLM 试玩与真人反馈为准。
- 死因：口渴、饥渴并发、饥饿、外出失踪、事件各类都不超过全部死亡的 45%；首个死亡日中位 ≥8；非通关局存活天数中位 15–30。
- 降智模式、已读乱回各自 <20% 的该角色存活天数；军方凭证五选一每种都能在部分局里凑到。
