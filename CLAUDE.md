# CLAUDE.md —— 给接手本项目的 AI 模型

《末日时在深度思考中》（英文名 Deep Thought at Doomsday）：原创的回合制末日求生决策小游戏。Vite + TypeScript（strict）、无 UI 框架、PWA、部署到 GitHub Pages。**引擎完全数据驱动**：玩法内容（角色、物品、事件、地图……）都是 `src/data/` 里的纯数据，引擎只认识抽象概念。

- 线上地址：https://gaoxianglj.github.io/deep-thought-at-doomsday/
- 仓库：https://github.com/Gaoxianglj/deep-thought-at-doomsday
- 设计依据：`docs/DESIGN.md`（实现与它冲突时先改它）；引擎扩展：`docs/ENGINE_GUIDE.md`；环境记录：`docs/SETUP_REPORT.md`

## 1. 常用命令

| 命令                                                         | 用途                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                | 本地开发服务器（base 为 `/deep-thought-at-doomsday/`，地址要带这个路径）                                                                            |
| `npm run dev:host`                                           | 同上，局域网可访问（手机预览；http 下 Service Worker 不生效）                                                                                       |
| `npm run build`                                              | `tsc && vite build`，类型检查 + 打包                                                                                                                |
| `npm run preview`                                            | 预览打包产物                                                                                                                                        |
| `npm test`                                                   | `vitest run`，跑 `tests/**/*.test.ts`                                                                                                               |
| `npm run lint`                                               | `eslint .`                                                                                                                                          |
| `npm run format`                                             | `prettier --write .`                                                                                                                                |
| `npm run validate`                                           | 校验 `src/data` 内容；有 error 退出码 1。`-- --strict` 把 warning 也当失败                                                                          |
| `npm run sim -- --runs 200 --difficulty normal --bot random` | 批量模拟；其余参数：`--map <id>`、`--seed <前缀>`、`--max-days <n>`、`--unlock-all`、`--json`、`--help`。`--bot` 可选 `sensible`（默认）\| `random` |

**提交前必须全绿：**

```
npm run build && npm test && npm run lint && npm run validate
```

改了文档/代码后再跑 `npx prettier --write <改过的文件>`（lint 与 prettier 配置冲突由 `eslint-config-prettier` 处理，格式以 prettier 为准：单引号、分号、尾逗号、行宽 100）。

## 2. 目录结构与依赖方向

```
ui → save → engine ← data
sim → engine        validation → engine
```

| 目录                         | 职责                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/engine/`                | 纯逻辑，零 DOM / IndexedDB / 时间 / `Math.random`；schema、条件、效果、规则、事件、按天流程、外出、开局、结局 |
| `src/data/`                  | 全部内容（纯数据）与界面固定文案 `ui-text.ts`；`index.ts` 汇总导出 `contentDB`                                |
| `src/save/`                  | IndexedDB、档案、版本迁移、`sanitize`、导入导出、存档码、自动保存                                             |
| `src/ui/`                    | 无框架 UI：`store.ts`（状态容器）、`screens/`、`components/`、`art.ts`（美术回退链）、`text.ts`               |
| `src/sim/`                   | 无 UI 批量模拟：策略机器人 `bots.ts` + 统计 `simulate.ts`                                                     |
| `src/validation/validate.ts` | 内容校验（纯函数）；修正键登记表 `MODIFIER_KEY_PATTERNS` 与文案变量表在这里                                   |
| `scripts/`                   | CLI 入口：`validate-content.ts`、`simulate.ts`                                                                |
| `src/pwa.ts` `src/pwa.css`   | Service Worker 注册与"有新版本"横幅                                                                           |
| `tests/`                     | `engine/` `save/` `sim/` `ui/` `validation/` 与夹具 `fixtures/`（见第 7 节）                                  |
| `public/art/`                | 美术：`<类别>/<id>/<状态>.webp`（见 5.10）                                                                    |
| `docs/`                      | DESIGN.md、ENGINE_GUIDE.md、SETUP_REPORT.md                                                                   |

## 3. 铁律

**Do**

- 内容一律写成纯数据，放在 `src/data/`，用 `satisfies XxxDef[]` 获得类型检查；互相只用字符串 id 引用；id 为小写蛇形 `^[a-z][a-z0-9_]*$`。
- 所有玩家看到的文案放数据里：内容文案在各内容文件，界面固定文案在 `src/data/ui-text.ts`，引擎自动日志在 `config.texts`。
- 引擎用随机数只走 `src/engine/rng.ts`（`rollChance` / `pickWeighted` / `randInt`），状态存在 `RunState.rng`。
- 改引擎必须同步：`docs/ENGINE_GUIDE.md`、本文件的对应表格、`src/validation/validate.ts` 的登记表（修正键 / 文案变量 / 条件效果分支），并补测试。
- 改 `RunState` 结构先想存档迁移（第 8 节）。
- 内容文案渲染到 DOM 一律用 `textContent`（或等价的安全 API），不要 `innerHTML`。

**Don't**

- 引擎里不得出现任何内容 id（如 `'hungry'`、`'kiminai'`）、中文文案、DOM、`Date`、`Math.random`。（`tests/e2e/architecture.test.ts` 会自动扫描 `src/engine` 与 `src/ui`。）
- 内容里不写函数、不写回调；只有 schema 允许的字段（schema 是 `strictObject`，多写字段会报错）。
- UI 不写死内容 id；需要"某类东西"时读数据（如 `config.rationTags`、`config.tagNames`）。
- 不要引入 UI 框架或新依赖，除非用户同意。
- 不要升级 TypeScript：**固定在 6.0.x**（`~6.0.0`），因为 `typescript-eslint` 8.72 的 peer 要求 `<6.1.0`，装 7.x 会 ERESOLVE；等 typescript-eslint 支持后再升。
- `tsconfig` 开了 `erasableSyntaxOnly`：不能用 `enum`、`namespace`、构造函数参数属性等不可擦除语法；用字面量联合类型和 `as const` 数组代替。同时 `verbatimModuleSyntax`：纯类型导入要写 `import type`。
- 不要在 `requires` / `when`（会被反复求值的位置）里用 `{ chance }`（见 ENGINE_GUIDE 第 4 节）。

## 4. 数据格式速查

类型唯一真相：`src/engine/schema.ts`。以下表格与其逐项一致；字段不确定时去读 schema。

### 4.1 目标 Target（`of` 字段）

| 写法                    | 在**条件**里                                | 在**效果**里                                 |
| ----------------------- | ------------------------------------------- | -------------------------------------------- |
| `'self'`                | 规则所属角色 / 事件绑定的 `self` / 外出者   | 同左                                         |
| `'any'` / `'random'`    | 此刻在庇护所的活人中**存在**一个满足即真    | 从此刻在庇护所的活人中随机挑 1 个            |
| `'all'`                 | 在庇护所的活人**全部**满足（且至少 1 人）   | 此刻在庇护所的全体活人（**不含外出中的人**） |
| `'expeditioner'`        | 当前外出者（外出上下文或 `run.expedition`） | 同左                                         |
| `{ role: '名字' }`      | 事件/日记里绑定的角色                       | 同左                                         |
| `{ id: 'dragon_girl' }` | 指定角色（活着即可，含外出中）              | 同左                                         |

`resolveTargets` 只返回活人（`shelter` 或 `away`）。找不到目标的效果静默无效。

### 4.2 条件 Condition

| 写法                                               | 含义                         | 注意                                                                              |
| -------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `{ all: [...] }` / `{ any: [...] }` / `{ not: c }` | 与 / 或 / 非                 | 空 `all` 为真，空 `any` 为假                                                      |
| `{ stat: 'satiety', of, gte/gt/lte/lt/eq }`        | 属性比较                     | 多个比较键同时写则需全部满足                                                      |
| `{ hasStatus: 'sick', of }`                        | 目标身上有该状态             |                                                                                   |
| `{ hasItem: 'radio', count?: 1 }`                  | 库存中该物品数量 ≥ count     | 外出中携带的物品不在库存里                                                        |
| `{ hasTag: 'food', count?: 1 }`                    | 带该标签的物品总数 ≥ count   | tag 不校验是否存在                                                                |
| `{ carrying: 'crowbar' }`                          | 本次外出携带了该物品         | 仅外出上下文有意义（specials、`requires`、外出修正）；其余回退到 `run.expedition` |
| `{ at: 'pharmacy' }`                               | 本次外出的地点               | 同上                                                                              |
| `{ flag: 'x', is?, gte/gt/lte/lt/eq }`             | 标记判断                     | 只写 `flag` = 真值；写 `is` = 严格相等；写比较键 = 按数字比（非数字当 0）         |
| `{ day: { gte?, lte?, ... } }`                     | 当前天数                     |                                                                                   |
| `{ inParty: 'id' }`                                | 角色在队伍中且活着           | 含外出中                                                                          |
| `{ inShelter: 'id' }`                              | 角色此刻在庇护所             |                                                                                   |
| `{ unlocked: 'id' }`                               | 局外已解锁（`run.unlocked`） |                                                                                   |
| `{ partyAlive: { ... } }`                          | 活着的队员数（含外出）       |                                                                                   |
| `{ shelterCount: { ... } }`                        | 此刻在庇护所的活人数         |                                                                                   |
| `{ map: 'id' }` / `{ difficulty: 'id' }`           | 当前地图 / 难度              | 事件、日记限定地图就靠 `map`                                                      |
| `{ weather: 'id' }`                                | 当前天气                     | 天气 id 必须在 `weathers` 里存在，否则校验报错                                    |
| `{ chance: 0.25 }`                                 | 掷骰                         | **每次求值都重掷**，不要放在会被反复检查的位置                                    |

事件 / 日记 / 结局的顶层 `when` 求值时**没有 `self`**（`of: 'self'` 无目标 → 条件为假）；要判断角色请放进 `roles.x.where`。

### 4.3 效果 Effect

| 写法                                              | 含义                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{ stat, of, add?, set? }`                        | 改属性，自动钳制到 `[min, max]`；`add` 与 `set` 至少一个（校验）；**正数 add 会乘 `scope.gainMul`**（物品使用时的 `item.<tag>.useEffect`）                   |
| `{ addStatus, of, duration?, chance? }`           | 施加状态（已有则刷新较长的持续时间）；成功概率 = 修正后的 `status.<id>.gainChance`（基础值为 `chance ?? 1`）；`duration` 优先于状态定义的 duration           |
| `{ removeStatus, of }`                            | 移除状态（触发 `onExit`）                                                                                                                                    |
| `{ item, add }`                                   | 库存增减，不低于 0；不存在的物品 id 静默忽略                                                                                                                 |
| `{ loseRandomItem: { tag?, count? } }`            | 随机丢 `count`（默认 1）件，按库存数量加权；**把丢失物品名写入 `{lost}`**，供之后同一效果列表里的 `log` 与事件结果文案使用                                   |
| `{ setFlag, value }` / `{ addFlag, add }`         | 设置标记 / 数字标记累加（不存在当 0）                                                                                                                        |
| `{ joinParty }`                                   | 角色加入本局（已在队伍或曾经在则忽略，不复活）                                                                                                               |
| `{ leaveParty, reason: 'dead' \| 'gone', text? }` | 目标离队；`text` 是日志模板（只有 `{self}` 和角色/物品变量，运行时**没有** `{lost}`）；不写 `text` 且 `dead` 时用 `config.texts.death`；外出者离队则外出作废 |
| `{ unlock }`                                      | 局外解锁角色（写入 `run.unlocked` 与 `newUnlocks`，存档层并入档案）                                                                                          |
| `{ queueEvent, delay? }`                          | 把事件排到 `当前天 + delay`（默认 0）的清晨；沿用当前 `self` 与 roles；**排队事件不检查其 `when`**                                                           |
| `{ ending }`                                      | 触发结局（已有结局则忽略）；`phase` 在待处理事件处理完后变 `ended`                                                                                           |
| `{ log, kind? }`                                  | 写一条日志（kind 默认 `info`），按文案模板渲染                                                                                                               |
| `{ if, then, else? }`                             | 条件分支                                                                                                                                                     |
| `{ random: [{ weight?, effects }] }`              | 按权重选一支执行（至少 1 支）                                                                                                                                |

### 4.4 规则 Rule 与修正 Modifier

```ts
{ id, when?, trigger?, chance?, effects?, modifiers? }   // modifiers 项：{ key, mul?, add?, scope?: 'self' | 'global' }
```

| 类型             | 写法                           | 行为                                                                                    |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------- |
| **被动修正**     | 没有 `trigger`，有 `modifiers` | `when` 成立期间持续生效；`最终值 = (基础值 + Σadd) × Πmul`；不得写 `effects` / `chance` |
| **trigger 规则** | 有 `trigger` 和 `effects`      | 到时机且 `when` 成立、再过 `chance` 才执行 `effects`；`modifiers` 无效                  |

**规则来源**与 `self`：

| 来源                                                                   | 类别 | `when` 里的 `self`                    | `scope` 字段                                                              |
| ---------------------------------------------------------------------- | ---- | ------------------------------------- | ------------------------------------------------------------------------- |
| 地图 `rules`、难度 `rules`、当前天气 `rules`、**库存中**的道具 `rules` | 全局 | 被计算的角色（subject，全局计算时无） | **忽略**：全局来源的修正总是作用于所有人                                  |
| 角色特性 `traits[].rules`、角色身上的状态 `rules`                      | 角色 | 该角色                                | 默认 `self`：只影响该角色自己；`global`：影响所有计算，但该角色须在庇护所 |

**trigger 何时、对谁触发**（`fireTrigger`）：

| trigger            | 全局来源                               | 角色来源                           |
| ------------------ | -------------------------------------- | ---------------------------------- |
| `dayStart`（清晨） | 触发 1 次，**无 `self`**               | **只对此刻在庇护所的角色**逐个触发 |
| `dayEnd`（入夜）   | 同上                                   | 同上                               |
| `expeditionDepart` | 触发 1 次，`self` = 外出者             | 只对外出者本人                     |
| `expeditionReturn` | 同上（战利品已入库、携带物已归还之后） | 同上                               |

经验规则：**持续性的每日增减用修正**（如"饥饿：健康每日 −8"写 `stat.health.dailyDelta add -8`），这样外出中的角色也生效；trigger 规则外出者不会触发 `dayStart/dayEnd`。全局 trigger 规则里要影响角色，用 `of: 'all'` / `'random'`，不要用 `'self'`。道具被带出去时不在库存里，它的 `rules` 暂时失效。

**修正键一览**（登记表在 `src/validation/validate.ts` 的 `MODIFIER_KEY_PATTERNS`，未登记的键校验报错）：

| 键                             | 含义                               | 基础值来自                | 在哪里被查询                                              |
| ------------------------------ | ---------------------------------- | ------------------------- | --------------------------------------------------------- |
| `stat.<statId>.dailyDelta`     | 该属性每日变化量                   | `StatDef.dailyDelta`      | `day.ts` `stepStatDecay`（对每个活人，含外出中）          |
| `status.<statusId>.gainChance` | 被施加该状态的概率                 | 效果的 `chance ?? 1`      | `effects.ts` 的 `addStatus` 效果（subject = 目标）        |
| `item.<tag>.useEffect`         | 使用该标签物品时正向属性增益的倍率 | 1（对物品所有 tag 连乘）  | `day.ts` `useGainMul`（配给与手动使用；subject = 使用者） |
| `expedition.lootRolls`         | 战利品抽取次数                     | `LocationDef.lootRolls`   | `expedition.ts` `rollLoot`（四舍五入；受伤再减半）        |
| `expedition.lootWeight.<tag>`  | 某类物品在战利品表里的权重         | 条目 `weight`             | `rollLoot`（按条目物品的每个 tag 连乘）                   |
| `expedition.danger`            | 外出出事概率                       | `LocationDef.danger`      | `rollOutcome`（结果夹到 0–0.95）                          |
| `expedition.duration`          | 外出耗时（天）                     | `LocationDef.distance`    | `departExpedition`（四舍五入，至少 1）                    |
| `event.dailyChance`            | 每日抽随机事件的概率               | `MapDef.eventDailyChance` | `events.ts` `drawRandomEvent`（无 subject）               |
| `event.weight.<tag>`           | 某类事件的抽取权重                 | 事件 `weight`（默认 1）   | `drawRandomEvent`（按事件每个 tag 连乘，无 subject）      |

`expedition.*` 的 subject 是外出者；`event.*` 没有 subject，因此只有全局来源和 `scope: 'global'` 的角色规则能影响它。

### 4.5 文案模板占位符

模板由 `formatText` 渲染：`{self}`、`{角色名}`（绑定的 role）、`{item:物品id}`、`{day}`，以及上下文变量。无法解析的占位符**原样保留**，校验脚本会报错。

| 位置                                               | 可用变量                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 事件 `title` / `text` / 选项 `text`                | `{self}`（若有 `self` 角色）、`{<roles 中定义的名字>}`、`{item:id}`、`{day}`               |
| 选项 `requiresHint`                                | 引擎**不**套模板，别写占位符                                                               |
| 结果 `text`、`log` 效果                            | 同上，再加 `{lost}`（来自本次执行中更早的 `loseRandomItem`；没有则保持原样，所以先丢后写） |
| 日记 `text`                                        | `{<roles 中定义的名字>}`（常用 `{a}` `{b}`）、`{item:id}`、`{day}`；文本里不得直接写角色名 |
| `StatDef.deathText`                                | `{self}`                                                                                   |
| `leaveParty.text`                                  | `{self}`、`{item:id}`、`{day}`                                                             |
| `config.texts.death`                               | `{self}`                                                                                   |
| `statusEnter` / `statusExit`                       | `{self}` `{status}`                                                                        |
| `rationMissing`                                    | `{self}` `{item}`                                                                          |
| `expeditionDepart` / `Return` / `Injured` / `Lost` | `{self}` `{location}` `{loot}` `{lootCount}`（`Depart` 时 `{loot}` 为空）                  |
| `expeditionCancelled`                              | `{self}` `{location}`                                                                      |
| `weatherChange`                                    | `{weather}`（天气名）                                                                      |

### 4.6 每日流程顺序（`src/engine/day.ts`）

清晨 `MORNING_STEPS`（`startDay`，新开局第 1 天也走这里；先清空当天配给计划、`eventRolled = false`）：

1. `weather` 抽取/延续天气（地图有 `weatherTable` 才有；天气变化写 `weatherChange`）
2. `expeditionReturn` 外出者到期则结算返回（安危 → 战利品 → `expeditionReturn` trigger → specials 入队）
3. `dayStartRules` 触发 `dayStart`
4. `diary` 写 `diaryPerDay` 条日记
5. `trimLog` 丢掉超过 `logKeepDays` 的日志
6. （步骤之后）`checkDeaths` → `nextEvent`：先处理已到期的队列事件（`day <= 今天`，全部依次进行，且今天不再随机抽）；否则按 `event.dailyChance` 抽 1 个随机事件；都没有则进入 `plan` 阶段并检查结局

入夜 `NIGHT_STEPS`（玩家点"结束这一天"，仅 `plan` 阶段可用）：

1. `rations` 在庇护所的人按配给计划吃喝（`onUse`，受 `useEffect` 修正；缺货写 `rationMissing`）
2. `expeditionDepart` 若有外出计划且仍合法：携带物离开库存、角色变 `away`、写返回日；不合法则取消
3. `statDecay` 全体活人（含外出中）按 `dailyDelta`（修正后）衰减并钳制
4. `statuses` 先处理已有状态（`daysLeft` 递减、`exitWhen` 满足则移除），再检查 `enterWhen` 进入新状态
5. `dayEndRules` 触发 `dayEnd`
6. `deaths` 死亡判定
7. （步骤之后）结局判定 → 无结局则 `day + 1` → 下一天清晨

时序要点：**先吃后衰减**（当晚吃的东西当晚抵消衰减）；**状态当晚进入、次日夜里的衰减才起效**（`statuses` 在 `statDecay` 之后；但进入后同晚的 `dayEnd` trigger 规则会触发）；外出者出发当晚仍吃配给（`rations` 在 `expeditionDepart` 之前）；外出期间不吃配给但属性照常衰减。

## 5. 如何新增内容（分步指南）

通用：改完内容后跑 `npm run validate`，再跑 `npm run sim -- --runs 100`（看是否卡死、新事件是否触发），最后跑完整的"提交前清单"。下面的示例都已按当前 schema 验证过。

### 5.1 新增角色

1. 在 `src/data/characters.ts` 的数组里加一项；特性写在 `traits[].rules`（规则语义见 4.4）。
2. 默认可选：`unlockedByDefault: true`。要靠剧情解锁：不写它，并在某个事件的结果里写 `{ joinParty }` + `{ unlock }`（`unlock` 立即写入档案，本局失败也保留）。
3. 配套解锁事件放 `src/data/events/` 下（新文件要在 `events/index.ts` 汇总）；加入后的欢迎事件用 `weight: 0` + `roles: { w: { is: '角色id' } }`，由 `next` 接续。
4. 美术放 `public/art/characters/<id>/normal.webp`（以及各 `artState` 对应的 `<状态>.webp`），没有也能玩（占位图）。
5. 想让日记有该角色的专属句子：见 5.6 的 `is`。

```ts
{
  id: 'ice_wolf', name: '冰狼', desc: '怕热不怕冷的北方来客，饿着肚子也不吭声。',
  traits: [{ id: 'wolf_hardy', name: '耐寒耐饿', desc: '饱食度下降变慢；理智低时会嚎一嗓子鼓舞大家。',
    rules: [
      { id: 'wolf_slow_hunger', modifiers: [{ key: 'stat.satiety.dailyDelta', mul: 0.8 }] },
      { id: 'wolf_howl', trigger: 'dayEnd', chance: 0.2, when: { stat: 'sanity', of: 'self', lt: 50 },
        effects: [{ stat: 'sanity', of: 'all', add: 3 }, { log: '{self} 对着月亮嚎了一嗓子，大家的心情好了一些。' }] },
    ] }],
}
// 解锁事件（events/ 下）
{ id: 'wolf_scratch', title: '门外的抓挠声', text: '深夜，有什么东西在门外一下一下地抓挠，还带着低低的呜咽。',
  when: { all: [{ not: { inParty: 'ice_wolf' } }, { day: { gte: 5 } }] }, once: true,
  choices: [
    { id: 'let_in', text: '开门看看', outcomes: [{ text: '一只灰白色的大狼把头探了进来，用鼻子顶了顶你的手。',
      effects: [{ joinParty: 'ice_wolf' }, { unlock: 'ice_wolf' }], next: 'wolf_welcome' }] },
    { id: 'ignore', text: '不理它', outcomes: [{ text: '抓挠声渐渐远了。' }] },
  ] }
{ id: 'wolf_welcome', title: '新成员', text: '{w} 绕着庇护所转了三圈，最后趴在了最暖和的角落。', weight: 0,
  roles: { w: { is: 'ice_wolf' } },
  choices: [{ id: 'pat', text: '摸摸头', outcomes: [{ text: '{w} 眯起了眼睛。', effects: [{ stat: 'sanity', of: 'all', add: 5 }] }] }] }
```

验证：`npm run validate`（会提示"没有任何 unlock 指向它"之类）；`npm run sim -- --unlock-all` 看它是否出场。常见错误：角色 id 在 `unlock` 与 `joinParty` 里写得不一致；欢迎事件忘了 `weight: 0` 导致被随机抽到；`traits[].rules` 里写了 `{ role }` 目标（规则里不允许，校验报错）。

### 5.2 新增状态类型

1. `src/data/statuses.ts` 加一项。
2. 自动进入/退出：写 `enterWhen`（每晚对每个活人检查，`self` = 该角色）和 `exitWhen`。由效果施加：不写 `enterWhen`，在事件/地点 `injury`/规则里用 `{ addStatus }`（没有任何来源时校验给 warning）。
3. `duration` 不写 = 直到 `exitWhen` 或被 `removeStatus`；效果里的 `duration` 优先。
4. 美术：`artState` 是 `public/art/characters/<角色id>/<artState>.png` 的状态名；多个状态都有 `artState` 时取 `priority` 最大者，没有则 `normal`。
5. `blocksExpedition: true` 禁止该角色被派出去。
6. 状态的持续作用写 `rules`（修正）；进入/离开时的一次性效果写 `onEnter` / `onExit`（`self` = 该角色）。

```ts
{ id: 'frostbite', name: '冻伤', desc: '手脚发麻，无法外出，健康每天下降。',
  duration: 3, artState: 'frostbite', priority: 3, blocksExpedition: true,
  rules: [{ id: 'frostbite_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -5 }] }],
  onEnter: [{ stat: 'sanity', of: 'self', add: -5 }] }
{ id: 'shaken', name: '心神不宁', enterWhen: { stat: 'sanity', of: 'self', lt: 30 },
  exitWhen: { stat: 'sanity', of: 'self', gte: 45 }, artState: 'shaken', priority: 1 }
```

验证：`npm run validate`。常见错误：`enterWhen` 与 `exitWhen` 边界重叠导致每晚进进出出（让退出阈值高于进入阈值，如 25 进 / 30 出）；在 `enterWhen` / `exitWhen` 里用 `chance`（会警告）。

### 5.3 新增道具

| 种类             | 写法                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| 配给物品（吃喝） | `tags` 含 `config.rationTags` 里的标签（`food` / `water`），写 `onUse`                          |
| 手动使用的药品   | `manualUse: true` + `onUse`（计划阶段对某角色使用，消耗 1 个）                                  |
| 持有即生效       | 写 `rules`（库存里有就生效，来源是**全局**，修正作用于所有人）                                  |
| 开局可买         | 写 `cost`（点数），并把 id 加进地图 `startingPool`；`maxAtStart` 限制数量；不写 `cost` 就不能买 |
| 开局白送         | 地图 `startingItems: { id: n }`                                                                 |

```ts
{ id: 'dried_fish', name: '鱼干', desc: '咸得发苦，耐放。饱食度 +30。', tags: ['food'], cost: 2, maxAtStart: 6,
  onUse: [{ stat: 'satiety', of: 'self', add: 30 }] }
{ id: 'antidote', name: '解毒剂', desc: '治疗生病。', tags: ['medicine'], cost: 3, maxAtStart: 2, manualUse: true,
  onUse: [{ removeStatus: 'sick', of: 'self' }] }
{ id: 'water_purifier', name: '净水壶', desc: '持有时全体水分每日下降变慢。', tags: ['tool'], cost: 5, maxAtStart: 1,
  rules: [{ id: 'purifier_water', modifiers: [{ key: 'stat.hydration.dailyDelta', add: 3, scope: 'global' }] }] }
```

**让道具改变事件走向的三种写法**（DESIGN 5.1）：

| 写在哪          | 效果                                       |
| --------------- | ------------------------------------------ |
| 事件 `when`     | 没有道具这个事件根本不会发生               |
| 选项 `requires` | 没有道具时选项置灰，显示 `requiresHint`    |
| 结果 `when`     | 同一选择因道具不同结果不同，可同时消耗道具 |

```ts
{ id: 'rat_raid', title: '老鼠来袭',
  text: '储藏间里传来窸窸窣窣的声音，{a} 举着手电去看，发现一群老鼠正在啃袋子。{b} 在后面小声问要不要帮忙。',
  tags: ['danger'], when: { all: [{ day: { gte: 3 } }, { hasTag: 'food', count: 2 }] }, cooldown: 6,
  roles: { a: {}, b: { where: { not: { hasStatus: 'sick', of: 'self' } } } },
  choices: [
    { id: 'trap', text: '用门锁做陷阱', requires: { hasItem: 'door_lock' }, requiresHint: '需要门锁',
      outcomes: [{ text: '陷阱奏效，老鼠被一网打尽，但门锁也废了。',
        effects: [{ item: 'door_lock', add: -1 }, { stat: 'sanity', of: 'all', add: 3 }] }] },
    { id: 'chase', text: '徒手赶走', outcomes: [
      { weight: 3, when: { not: { hasItem: 'crowbar' } }, text: '老鼠四散而逃，但咬坏了一些东西：{lost}。',
        effects: [{ loseRandomItem: { tag: 'food', count: 1 } }] },
      { weight: 1, when: { not: { hasItem: 'crowbar' } }, text: '{a} 被咬了一口，伤口红肿。',
        effects: [{ addStatus: 'sick', of: { role: 'a' }, chance: 0.7, duration: 3 }] },
      { when: { hasItem: 'crowbar' }, text: '{a} 抄起撬棍一顿猛敲，老鼠一哄而散。' },
    ] },
  ] }
```

验证：`npm run validate`；`validate` 会提示"既不在开局池也不在战利品表里的物品无法获得"。常见错误：配给物品忘写 `onUse`（校验报"配给标签没有带 onUse 的物品"）；`cost` 写了但没进 `startingPool`（买不到）；进了 `startingPool` 却没 `cost`（校验报错）；想让被动道具只影响持有者——道具规则是全局的，做不到，改用角色特性或状态。

### 5.4 新增外出地点

1. `src/data/locations.ts` 加一项，`map` 必须是已有地图 id。
2. `distance`：往返天数；`danger`：出事概率（0–1）；`failSplit`：出事时"受伤返回 : 未能返回"的权重；`injury`：受伤时的效果（`self` = 外出者）。
3. `lootRolls` 次数、`loot` 表按 `weight` 抽，数量 `min`–`max`（默认 1）。受伤返回时抽取次数减半。
4. `requires` / `requiresHint`：前往条件，不满足时置灰（别用 `chance`）。
5. `specials`：返回时按顺序检查，命中的第一条把事件排入**当天**队列，`self` = 外出者。专属事件写成 `weight: 0`（只能由 specials 触发），**不要定义 `self` 角色**（外出者已自动绑定为 `self`，文案里直接用 `{self}`）。

```ts
{ id: 'gas_station', name: '加油站', desc: '油泵早就干了，便利店货架还剩点东西。', map: 'city_ruins',
  distance: 2, danger: 0.22, failSplit: { injured: 2, lost: 1 },
  injury: [{ addStatus: 'injured', of: 'self', duration: 5 }, { stat: 'health', of: 'self', add: -12 }],
  lootRolls: 2,
  loot: [{ item: 'canned_food', weight: 3, min: 1, max: 2 }, { item: 'bottled_water', weight: 3 }, { item: 'crowbar', weight: 1 }],
  requires: { day: { gte: 3 } }, requiresHint: '第 3 天后才敢去',
  specials: [{ when: { all: [{ carrying: 'flashlight' }, { at: 'gas_station' }] }, chance: 0.3, event: 'gas_station_cellar' }] }
{ id: 'gas_station_cellar', title: '地下油库', text: '{self} 的手电光扫过地面，发现了一块可以掀开的铁板。', weight: 0,
  choices: [{ id: 'open', text: '掀开铁板', outcomes: [{ text: '下面是一箱完好的罐头！', effects: [{ item: 'canned_food', add: 3 }] }] }] }
```

验证：`npm run validate`、`npm run sim`（看外出次数与失踪率是否合理）。常见错误：`loot` 里引用了不存在的物品；`specials` 的 `event` 不存在，或事件没设 `weight: 0` 导致也会被随机抽到；忘了 `at` 条件导致任何地点都命中。

### 5.5 新增事件

1. 放在 `src/data/events/<主题>.ts`；新文件要在 `events/index.ts` 加入汇总数组。
2. 普通随机事件：`when` 决定入池条件；`weight`（默认 1）；`once`（一局一次）/ `cooldown`（冷却天数）；`tags` 用于被 `event.weight.<tag>` 修正。
3. 角色绑定：`roles: { a: {}, b: { where: ... } }` 从此刻在庇护所的活人中随机绑定，互不重复；`is: '角色id'` 指定某人（他不在庇护所则事件不入池）；`where` 的 `self` = 候选人。名为 `self` 的角色等价于 `'self'` 目标。绑不上则事件不入池。
4. 道具分支见 5.3；`requires` 不满足时选项置灰。
5. `outcomes`：先按 `when` 过滤再按 `weight` 抽 1 个；**同一选项的 `when` 必须互补，保证任何情况至少有一个结果可用**（否则运行时给出空结果，校验有 warning）。
6. 事件链：结果里 `next: '事件id'`，沿用当前绑定的角色，立刻展示；`next` 指向的事件通常 `weight: 0`。
7. 延时：效果 `{ queueEvent: 'id', delay: 3 }` 在 3 天后的清晨必定触发（沿用 `self` 与 roles；**不检查目标事件的 `when`**）。

示例：见 5.3 的 `rat_raid`（道具分支 + roles + 互补 `when`）；延时示例：

```ts
{ id: 'rat_return', title: '老鼠回来了', text: '昨天的老鼠带着朋友回来了。', weight: 0,
  choices: [{ id: 'ok', text: '头疼', outcomes: [{ text: '你们花了一整天赶老鼠。', effects: [{ loseRandomItem: { tag: 'food', count: 2 } }] }] }] }
// 在别的结果里： effects: [{ queueEvent: 'rat_return', delay: 1 }]
```

验证：`npm run validate`（引用、占位符、roles、不可达的 `weight: 0` 事件）；`npm run sim` 看"从未触发的事件"。常见错误：文案用了没在 `roles` 里定义的 `{x}`；`{lost}` 写在 `loseRandomItem` 之前；顶层 `when` 里用 `of: 'self'`；每次渲染都会重新求值的 `requires` 里写 `chance`。

### 5.6 新增日记条目

1. `src/data/diary.ts` 的数组里加一项（类型 `DiaryDef[]`）。
2. 文本里的 `{a}` `{b}` 必须在 `roles` 中定义；**角色只能通过 `roles` 出现**，不要在文本里写死角色名（校验报错；没有 `roles` 的日记更是不得出现任何角色名）。
3. `roles` 只会绑到此刻在庇护所的活人——外出、死亡、离开的不会出现。用 `where` 约束状态防止矛盾（"很有活力"要排除饥饿/生病），`is` 指定角色。
4. `when` 限定全局条件；`cooldown` / `once` / `weight` 同事件。

```ts
{ id: 'wolf_nap', text: '{a} 把自己团成一团，睡在了暖气管旁边。',
  roles: { a: { is: 'ice_wolf', where: { not: { hasStatus: 'hungry', of: 'self' } } } }, cooldown: 5 }
```

验证：`npm run validate`。常见错误：定义了 role 但文本没用（warning）；文本写了角色名；日记描述的状态与 `where` 不一致（如写"狼饿得发慌"却没要求 `hungry`）。

### 5.7 新增结局

| 类型       | 写法                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------- |
| 条件型     | 写 `when`：每晚、进入计划阶段时、看完事件结果后都会检查；按 `priority` 从高到低，第一个成立的生效 |
| 效果触发型 | 不写 `when`，由事件结果里的 `{ ending: 'id' }` 触发（没有任何引用时校验给 warning）               |

`kind` 取 `selfRescue | rescue | death | other`（供 UI/统计分类）。`config.fallbackEnding` 是"全员死亡/离开且没有结局命中"时的兜底。结局 `when` 没有 `self`，别用 `chance`。

```ts
{ id: 'beacon_lit', name: '灯塔', kind: 'other', text: '信标亮了整整一夜。', priority: 40,
  when: { all: [{ flag: 'beacon_built' }, { day: { gte: 10 } }] } }
{ id: 'convoy', name: '车队', kind: 'rescue', text: '一支车队载着你们离开。' }   // 事件里：{ ending: 'convoy' }
```

常见错误：读取了没有任何地方设置的 flag（warning）；多个结局条件同时成立时没设 `priority`。

### 5.8 新增地图（以"水世界"为例）

`MapDef` 字段：`id` `name` `desc?` `partySize{min,max}` `startingPool[]` `startingItems?` `startingFlags?` `eventDailyChance` `diaryPerDay?` `expedition{carrySlots, vehicle?}` `weatherTable?` `rules?`。

**把内容限定到某张地图**：地点用 `map: 'id'` 字段；事件、日记没有 `map` 字段，在 `when` 里写 `{ map: 'water_world' }`；结局同理。

**现状核实（以代码为准）：**

| 能力                                               | 状态                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 天气                                               | **已实现**：清晨 `weather` 步骤按 `map.weatherTable` 抽天气，持续天数在 `duration{min,max}` 间随机，变化时写 `weatherChange`；`weather.rules` 是全局来源；UI 顶栏显示天气名。目前 `src/data/weathers.ts` 是空数组，需要自己加                                                                                                                                      |
| 地图规则 `map.rules`                               | **已实现**（全局来源）                                                                                                                                                                                                                                                                                                                                             |
| 交通工具 `expedition.vehicle` / `location.vehicle` | **校验已实现**：外出计划必须带 `vehicleId` 且库存里有该物品，否则错误码 `vehicleMissing`；UI 与 sim 机器人会自动填 `vehicleId`；校验检查引用。**未实现**：交通工具不会被占用/消耗/损坏，也不影响耗时或危险（除非道具自己的 `rules`——但它留在库存里所以始终生效）；无载具容量；无随机丢失保护（无标签的 `loseRandomItem` 可能丢掉它，丢了则外出计划在出发时被取消） |

要点：外出交通工具 = 道具 + 地图/地点的 `vehicle` 字段；"只靠下雨集水" = 天气规则 + `loot` 表不放水；"海水蒸馏器" = 道具被动规则（`dayStart` trigger 往库存加水）。

```ts
{ id: 'small_boat', name: '小船', desc: '水世界外出必备。', tags: ['vehicle'] }       // 不写 cost：不能买，靠 startingItems 白送
{ id: 'seawater_still', name: '海水蒸馏器', desc: '每天清晨蒸出 1 份淡水。', tags: ['tool'], cost: 6, maxAtStart: 1,
  rules: [{ id: 'still_daily', trigger: 'dayStart', effects: [{ item: 'bottled_water', add: 1 }, { log: '蒸馏器滴出了一份淡水。' }] }] }
{ id: 'rain', name: '降雨', duration: { min: 1, max: 3 },
  rules: [{ id: 'rain_collect', trigger: 'dayStart', effects: [{ item: 'bottled_water', add: 2 }, { log: '雨水落进接水桶，攒下了 2 份淡水。' }] }] }
{ id: 'clear', name: '晴天' }
{ id: 'water_world', name: '水世界', desc: '大水退去后的世界。', partySize: { min: 2, max: 3 },
  startingPool: ['dried_fish', 'bottled_water', 'seawater_still'], startingItems: { small_boat: 1 },
  eventDailyChance: 0.5, diaryPerDay: 1, expedition: { carrySlots: 2, vehicle: 'small_boat' },
  weatherTable: [{ weather: 'rain', weight: 2 }, { weather: 'clear', weight: 3 }] }
{ id: 'wreck_island', name: '沉船岛', map: 'water_world', distance: 2, danger: 0.2, lootRolls: 2,
  loot: [{ item: 'dried_fish', weight: 3 }, { item: 'bottled_water', weight: 2 }] }
{ id: 'tide_surge', title: '涌潮', text: '水位在夜里涨高了一截。', when: { map: 'water_world' },
  choices: [{ id: 'ok', text: '加固', outcomes: [{ text: '勉强撑住了。' }] }] }
```

新地图还需要：至少一个 `map` 指向它的地点（否则 warning）；`startingPool` 里的物品都有 `cost`；UI 的选图界面会自动列出。验证：`npm run validate`、`npm run sim -- --map water_world`。常见错误：`vehicle` 物品没进库存（忘了 `startingItems`），导致谁都出不了门；`weatherTable` 引用了不存在的天气；地图限定忘了给事件加 `{ map }` 导致城市事件在水世界出现。

### 5.9 新增难度、天气

- **难度**：`src/data/difficulties.ts`，`{ id, name, desc?, points, rules? }`，`rules` 是全局修正（`scope` 对全局来源无意义，写不写都作用于所有人）。
  `{ id: 'nightmare', name: '噩梦', points: 10, rules: [{ id: 'nightmare_rules', modifiers: [{ key: 'stat.satiety.dailyDelta', mul: 1.5, scope: 'global' }, { key: 'expedition.danger', mul: 1.5, scope: 'global' }] }] }`
- **天气**：见 5.8 的 `rain` / `clear`。写在 `src/data/weathers.ts`（当前为空数组），再挂进地图的 `weatherTable`。天气 `rules` 只在该天气持续期间生效。

### 5.10 新增 / 替换属性、美术与文案

- **新属性（纯数据）**：`src/data/stats.ts` 加 `{ id, name, min, max, initial, dailyDelta, deathAtZero?, deathText? }`。引擎自动给每个角色初始化、每日衰减、可被 `stat.<id>.dailyDelta` 修正；UI 的角色卡是否展示它去看 `src/ui/components/character-card.ts` / `screens/status.ts`（读现状，不要假设）。旧存档缺该属性时 `sanitize` 补初始值。
- **美术**：路径 `public/art/<类别>/<id>/<状态>.webp`，类别 `characters | items | locations | events | ui`。加载回退链：`<状态>.webp` → `normal.webp` → 程序生成的占位图（id 哈希色块 + 名称前 2 字）。角色的状态名取其身上有 `artState` 且 `priority` 最大的状态，否则 `normal`（`getArtState`）。替换 = 覆盖同名文件。美术不进预缓存，运行时 StaleWhileRevalidate 缓存。
- **界面文案**：`src/data/ui-text.ts`（`uiText`，占位符 `{name}` 由 UI 的 `fmt()` 填）；引擎错误码 → 中文说明在 `uiText.errors`，新增错误码必须在这里加一行，否则 UI 显示"操作无效（code）"。
- **引擎自动日志文案**：`src/data/config.ts` 的 `texts`（键见 4.5）。缺省的键不写日志（校验给 warning）。

## 6. "哪些改动必须改引擎"对照表

| 需求举例                                         | 纯数据可做 / 需要改引擎                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 新角色、特性、状态、道具、事件、日记、地点、结局 | 纯数据                                                                                                      |
| 新属性（如"体温"）                               | 纯数据（`stats.ts`），UI 展示另看 `src/ui`                                                                  |
| 新食物 / 药品 / 被动道具                         | 纯数据                                                                                                      |
| 新地图、新难度、新天气、地图专属规则             | 纯数据（天气表、`map.rules`、`vehicle` 校验都已实现，见 5.8）                                               |
| 现有数值的新影响方式（如"外出耗时 ×0.8"）        | 键已有则纯数据；键没有则改引擎：ENGINE_GUIDE 第 3.3 节（新增修正键）                                        |
| 新的条件种类（如"某属性在全员中最低"）           | 改引擎：ENGINE_GUIDE 3.1                                                                                    |
| 新的效果种类（如"交换两人物品"）                 | 改引擎：ENGINE_GUIDE 3.2                                                                                    |
| 新的可被内容影响的数值（如"配给吃喝量"）         | 改引擎：3.3                                                                                                 |
| 新的触发时机（如"事件结算后"）                   | 改引擎：3.4                                                                                                 |
| 新的每日步骤（制作、建造、士气结算）             | 改引擎：3.5                                                                                                 |
| 新的玩家动作（如"制作物品"）                     | 改引擎 + UI + 错误码：3.6                                                                                   |
| 新的内容类别（如配方、建筑）                     | 改引擎、校验、sanitize、夹具：3.7                                                                           |
| 给存档加字段                                     | 改引擎 + 可能迁移：3.8                                                                                      |
| 新的引擎自动日志                                 | 改引擎：3.9                                                                                                 |
| 多人同时外出                                     | 改引擎（`run.expedition` 是单个可空对象）+ 迁移 + UI + sim：3.10                                            |
| 每天多个随机事件                                 | 改引擎（`eventRolled` 是布尔、`nextEvent` 只抽 1 次）：3.10                                                 |
| 交通工具被占用/消耗/影响危险                     | 改引擎（目前只做"必须持有"校验）：3.10                                                                      |
| 新的结局条件                                     | 多数纯数据（用 `flag` / `counter` 以外的现有条件组合）；要读 `run.counters` 等现有字段则需新条件种类（3.1） |
| 条件里读 `run.counters`（外出次数、事件数）      | 改引擎（目前没有对应条件种类）：3.1                                                                         |

## 7. 测试与校验

| 目录                        | 用途                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/engine/`             | 引擎单测（开局、按天循环、外出、事件、规则）                                                                                                      |
| `tests/save/`               | 存档往返、迁移、`sanitize`、导入导出、自动保存                                                                                                    |
| `tests/validation/`         | 校验脚本的单测（夹具应零 error；逐条构造错误断言）                                                                                                |
| `tests/sim/`                | 模拟器单测；含"正式数据冒烟"（20 局不卡死）                                                                                                       |
| `tests/ui/`                 | `store`、`art` 纯函数、假存档                                                                                                                     |
| `tests/fixtures/content.ts` | 夹具：`makeDB()`、`makeContent(mutate?)`、`makeEnv(opts?, mutate?)`                                                                               |
| `tests/e2e/`                | 端到端：使用正式内容走通完整流程（`flow.test.ts`）并检查架构约束（`architecture.test.ts`）；内容整体替换后只需改 `flow.test.ts` 顶部的 `IDS` 常量 |

**引擎测试只用 `tests/fixtures` 的夹具内容**（地图 `bunker`、角色 `alpha` `beta` `gamma` 等），不用 `src/data`：这样正式内容怎么换都不会弄坏引擎测试，也防止引擎偷偷依赖具体 id。`tests/sim` 的冒烟与 `tests/validation` 里个别用例会读正式数据，内容大改后要留意。

**`npm run validate`**：`error`（红）= 结构不合法、引用不存在、占位符未知、规则写法错误、没有默认解锁角色等，必须修；`warning` = 可能有问题但不阻断（不可达的事件/结局/物品/flag、`chance` 放在反复求值处、所有结果都带 `when`、缺少引擎文案键）。`-- --strict` 让 warning 也失败。常见报错与修法：

| 报错（节选）                        | 修法                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| 引用了不存在的 X "id"               | 拼写错或忘了在对应数据文件里加                             |
| 存在未知字段                        | schema 是 strict，删掉多余字段（可能写错了键名）           |
| 未知的修正键                        | 键未登记，检查拼写，或按 ENGINE_GUIDE 3.3 新增             |
| 未知占位符 `{x}`                    | 该位置没有这个变量，对照 4.5；roles 里没定义               |
| 此处不得使用 `{ role }`             | 规则/状态/物品/地点里没有 roles，改用 `self`/`id`          |
| 没有 trigger 的规则必须有 modifiers | 想写一次性效果就加 `trigger`；想写持续修正就用 `modifiers` |
| 权重为 0 且没有被引用               | 加 `queueEvent` / `next` / `specials`，或删掉              |

**`npm run sim`**：默认每个难度各跑 100 局、策略 `sensible`。输出段落：结局分布、存活天数（均值/中位/p10/p90…）、各角色出场率与存活率、各事件触发率、**从未触发的事件**、新解锁率；若有"卡死/超时"或被拒绝的动作码要先查原因（卡死 = 机器人连续动作被拒，常见于新增机制而 bot 不会用）。调数值的做法：改一处（物品数值、`danger`、`dailyDelta`、点数），固定 `--seed` 重跑对比结局分布与存活天数；对比不同难度之间的梯度；用 `--bot random` 做下限参照。bot 在 `src/sim/bots.ts`，不得写具体内容 id。

## 8. 存档注意事项

- `SAVE_VERSION`（`src/engine/schema.ts`，当前 1）；`migrations`（`src/save/migrations.ts`，当前空）。**升级步骤**：`SAVE_VERSION` +1 → 在 `migrations[旧版本]` 写 `(raw: unknown) => unknown`，处理的是整个导出信封的原始数据（`profile` 与 `run`），不依赖 zod 类型 → 在 `tests/save/migrations.test.ts` 加用例。`migrateEnvelope` 每步后自动把 `version` 与 `run.v` 设为 n+1。高于当前版本的存档会被拒绝。
- **`sanitize`**（`src/save/sanitize.ts`）负责：内容被删/改名后旧存档仍能读——未知物品/状态/角色/事件/天气静默丢弃，外出地点失效则外出者提前返回，地图/难度失效或队伍清空则作废该局（档案与解锁保留）。**删内容不需要迁移**。
- **需要迁移的 `RunState` 改动**：改变已有字段的含义或形状；新增**必填**字段（旧存档过不了 `RunStateSchema`）；重命名/删除字段且旧数据有用。**不需要迁移**：新增**可选**字段（`.optional()`）；往 `run.ext` 里放试验性状态；新增内容 id。新增字段还要在 `src/engine/setup.ts` 的 `newRun` 里初始化，并想想 `sanitize` 要不要清理其中的内容引用。
- 档案 `Profile` 的结构在 `src/save/types.ts`，同样受版本管控。

## 9. 部署

推送到 `main` 即触发 `.github/workflows/deploy.yml`（`npm ci` → lint → test → validate → build → 发布 `dist` 到 Pages）；任何一步失败都不会部署，所以推送前先在本地跑全。`vite.config.ts` 的 `base` 是 `/deep-thought-at-doomsday/`；引用 `public/` 资源用相对 base 的方式（`art.ts` 用 `import.meta.env.BASE_URL`）。PWA：`vite-plugin-pwa`，`registerType: 'prompt'`；`src/pwa.ts` 仅生产构建注册 Service Worker，有新版本时顶部横幅提示，用户点"更新"才刷新；`public/art/**` 不预缓存。

## 10. 派发子代理时的模型分工（项目负责人的约定）

- **设计判断类**（引擎改动、数据结构设计、存档迁移、需要权衡的审查）用 **opus**；**明确执行类**（照清单加内容、写样例数据、补测试、改样式、文档起草）用 **sonnet**。
- 需求**一次写清**：目标、涉及的文件、必须遵守的铁律、验收命令（第 1 节清单）、禁止改动的范围；别让子代理猜。
- 要求子代理**只回报摘要**（改了哪些文件、验证结果、发现的问题），不要贴大段代码；并行派发时划清各自负责的目录，避免冲突。
- 发现代码与 `docs/DESIGN.md` 不一致或疑似 bug：先汇报，不要擅自改。
