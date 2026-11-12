# ENGINE_GUIDE —— 如何扩展引擎

面向以后改引擎的 AI 模型。日常加内容（角色、物品、事件……）看根目录 `CLAUDE.md`，不需要读本文。设计依据见 `docs/DESIGN.md`（第 9、10 节专门讲模块与扩展余地）。**改引擎的提交必须同步更新本文与 `CLAUDE.md` 的对应表格。**

## 1. 引擎架构总览

### 1.1 模块职责（`src/engine/`）

| 文件            | 职责                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`     | 全部内容与存档结构的 zod schema，TS 类型由此推导（`Condition` / `Effect` 因递归是手写类型）；`SAVE_VERSION`、`TRIGGERS`、`ENGINE_TEXT_KEYS` |
| `content.ts`    | `buildContent(db)`：把 `ContentDB` 建成按 id 查询的 `Map` 索引（`Content`）                                                                 |
| `context.ts`    | `Env`、`Scope`、`resolveTargets`、`formatText`、`addLog` / `sysLog`、库存与队伍的小工具                                                     |
| `rng.ts`        | 可设种子的随机数（mulberry32，状态是 `RunState.rng` 一个 uint32）                                                                           |
| `conditions.ts` | `evalCondition`                                                                                                                             |
| `effects.ts`    | `applyEffects`（唯一入口）、`addStatus` / `removeStatus` / `removeFromParty` / `checkDeaths`                                                |
| `rules.ts`      | 规则收集（`globalRules` / `characterRules`）、`getModifier`、`fireTrigger`                                                                  |
| `events.ts`     | 角色绑定、事件抽取与队列、选项结算、事件链、日记、`getEventView`                                                                            |
| `day.ts`        | `MORNING_STEPS` / `NIGHT_STEPS`、`startDay` / `endDay`、`consumeItemOn`                                                                     |
| `expedition.ts` | 外出计划校验、出发、返回结算                                                                                                                |
| `setup.ts`      | `validateSetup`、`pointsCost`、`newRun`                                                                                                     |
| `endings.ts`    | `checkEndings`                                                                                                                              |
| `game.ts`       | 对外 API：`Action` 联合、`applyAction`、`getArtState`                                                                                       |
| `index.ts`      | 统一导出；UI / 存档 / sim 只从这里导入                                                                                                      |

### 1.2 调用关系

```
UI / sim:  applyAction(state, action, content)
             └─ env = { run: structuredClone(state), content }
                dispatch(env, action)  ── switch (action.type)
                  chooseEventOption / continueEvent → events.ts ─┐
                  endDay → day.ts: NIGHT_STEPS → checkEndings → startDay: MORNING_STEPS → nextEvent
                  setRation / useItem(consumeItemOn) / planExpedition / cancelExpedition
                events / day / expedition ──→ applyEffects (effects.ts) ──→ checkDeaths
                                          └─→ getModifier / fireTrigger (rules.ts) ──→ evalCondition
             返回 { state: env.run } 或 { state: 原对象, error: '错误码' }
```

### 1.3 Env / Scope

- `Env = { run: RunState, content: Content }`：一次引擎调用的环境。`run` 是**可变草稿**。
- `Scope`（条件/效果求值的局部上下文）：`self`（`'self'` 指向的角色 id）、`roles`（事件/日记绑定：名字 → 角色 id）、`expedition`（外出上下文，`carrying` / `at` 条件与 `'expeditioner'` 用，缺省取 `run.expedition`）、`gainMul`（正向属性增益倍率，物品使用时）、`vars`（文案额外变量，如 `lost` `loot` `location`）。

### 1.4 状态模型：可变草稿 + `structuredClone`

`applyAction` 先 `structuredClone(state)`，所有引擎代码直接**原地修改** `env.run`，成功返回新对象；出错返回**原对象**且保证未被改动。因此：`RunState` 里只能放可 `structuredClone` 且可 JSON 序列化的数据（不要放函数、`Map`、`Set`、类实例）；引擎函数里不要自己再拷贝 `run`。

### 1.5 随机数

只用 `rng.ts`：`rollChance(run, p)`、`pickWeighted(run, list, weightOf)`、`randInt(run, min, max)`、`nextFloat(run)`。它们推进 `run.rng`。**调用顺序就是随机序列**：增删、重排任何一次随机调用会改变同一种子之后的全部结果（旧存档不受影响，因为 `rng` 状态已存，但 `npm run sim` 的统计会整体漂移）。

### 1.6 日志

`addLog(run, kind, text)` 直接写日志；`sysLog(env, key, kind, scope, vars)` 写**引擎自动日志**：模板取自 `content.config.texts[key]`，缺键则不写；引擎里不得出现中文文案。

## 2. 设计不变量（改引擎时不能破坏）

| 不变量                                                                                                                                                                           | 为什么                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯函数与确定性：不读时间、不用 `Math.random`、不碰 DOM / IO；同种子同动作序列同结果                                                                                              | 可复现、可测试、可模拟（`npm run sim`）、存档可恢复到同一画面                                                                                                                     |
| 引擎零内容 id                                                                                                                                                                    | 内容整体替换（如换世界观）不能弄坏引擎；引擎测试用夹具内容。`tests/e2e/architecture.test.ts` 会扫描 `src/engine` 与 `src/ui` 的源码；与引擎内部枚举同名的 id 需加入该测试的白名单 |
| 引擎零文案                                                                                                                                                                       | 文案属于数据，便于改与本地化；引擎日志走 `config.texts`                                                                                                                           |
| 未知 id 一律静默忽略（`if (!def) return`）                                                                                                                                       | 内容被删改后旧存档仍能读；`sanitize` 只是兜底，不能让引擎在遇到遗留 id 时抛异常                                                                                                   |
| 死亡只走 `deathAtZero` 属性归零（`checkDeaths`）；另有显式的 `{ leaveParty, reason: 'dead' }` 效果                                                                               | 死亡规则是数据；不要在别处写"某条件下直接死亡"                                                                                                                                    |
| `applyEffects` 是执行效果的唯一入口，结束后统一做死亡判定                                                                                                                        | 保证任何效果列表之后都不会留下"健康 ≤ 0 的活人"。（`addStatus` 的 `onEnter` 等内部走 `applyList`，其死亡判定由外层 `applyEffects` 或 `deaths` 步骤完成）                          |
| 结局判定时机固定：入夜步骤之后、进入 `plan` 阶段时（`nextEvent`）、看完事件结果后（`continueEvent`）；`{ ending }` 效果只设 `run.ending`，`phase` 在没有待处理事件时才变 `ended` | 保证玩家能看完当前事件结果再进入结局页                                                                                                                                            |
| `applyAction` 出错时不改状态                                                                                                                                                     | UI 与存档可以放心重试；sim 靠它判断卡死                                                                                                                                           |
| 引擎不 import `ui` / `save`；`RunState` 可序列化                                                                                                                                 | 依赖方向 `ui → save → engine ← data`                                                                                                                                              |
| 条件 / 效果 / 动作的求值处用 `never` 穷尽检查                                                                                                                                    | 加新种类时编译器指出所有漏处                                                                                                                                                      |
| 触发规则只对此刻在庇护所的角色触发；持续性数值用修正                                                                                                                             | 外出者不应偷吃庇护所的粮；修正对外出者也生效                                                                                                                                      |

## 3. 扩展清单

通用收尾（每一项都要做）：`npm run build && npm test && npm run lint && npm run validate`，更新本文与 `CLAUDE.md`。

### 3.1 新增条件种类

- [ ] `src/engine/schema.ts`：在 `Condition` 联合类型加一支；在 `ConditionSchema` 的 `z.union` 里加对应的 `z.strictObject`（字段名不要与现有条件的键重复——求值用 `'键' in cond` 判别）。
- [ ] `src/engine/conditions.ts`：在 `evalCondition` 加 `if ('新键' in cond)` 分支；漏了会在末尾的 `const exhaustive: never` 处编译报错——按报错定位。
- [ ] `src/validation/validate.ts`：`COND_PRIMARY` 数组加新键（用于把 zod 报错翻译成"未知条件种类"）；`cond()` 函数加分支，检查其中的 id 引用（`ref('类别', id, path, '条件 xxx')`）；若它读 flag 之类要参与可达性收集，在此登记。
- [ ] 若新条件依赖上下文（如外出上下文），在 `docs` 里写清哪里可用；必要时在 `Scope` 增字段。
- [ ] `CLAUDE.md` 4.2 条件表加一行。
- [ ] 测试：`tests/engine/` 用 `makeEnv` 构造场景直接 `evalCondition`；`tests/validation/validate.test.ts` 加"引用不存在时报错"。

### 3.2 新增效果种类

- [ ] `schema.ts`：`Effect` 联合 + `EffectSchema`（同样注意键不要冲突，`applyOne` 用 `'键' in e`）。
- [ ] `src/engine/effects.ts`：`applyOne` 加分支（`never` 检查会报漏）；用 `resolveTargets(env, scope, e.of, 'effect')` 解析目标；遇到未知 id 直接 `return`。
- [ ] `validate.ts`：`EFFECT_PRIMARY` 加键；`effect()` 加分支（id 引用、`target()`、可达性收集如 `queued` / `itemProduced`）。
- [ ] 如果机器人需要理解它（`src/sim/bots.ts` 的 `walkEffects` 遍历效果以估算收益），按需补充；不补也不会编译失败，但新的 `if`/`random` 以外的容器型效果必须在 `walkEffects` 递归。
- [ ] `CLAUDE.md` 4.3 效果表加一行。
- [ ] 测试：`tests/engine/` 直接 `applyEffects(env, scope, [新效果])` 断言；校验测试。

### 3.3 新增修正键 / 让某个数值可被内容影响

- [ ] 在计算处调用 `getModifier(env, '键', 基础值, subject?, extra?)`：`subject` 传"这次计算是关于哪个角色的"（全局计算不传）；`extra` 可传 `{ expedition }` 以便规则的 `when` 能用 `carrying` / `at`。
- [ ] `validate.ts` 的 `MODIFIER_KEY_PATTERNS` 加一项 `{ pattern, doc, ref? }`（`ref` 让校验检查捕获组是否是已存在的 stat/status id）。**不登记则内容里写这个键会报"未知的修正键"。**
- [ ] `CLAUDE.md` 4.4 修正键表加一行（含基础值来源与查询位置）。
- [ ] 取整规则自己定（例：`Math.round`、下限 1、夹到某区间）并写进表。
- [ ] 测试：`tests/engine/rules.test.ts` 用夹具里的规则或在 `makeEnv(opts, mutate)` 的 `mutate` 里加规则，断言 `getModifier` 结果与调用方行为。

### 3.4 新增触发时机 trigger

- [ ] `schema.ts`：`TRIGGERS` 数组加名字（`Trigger` 类型与 `RuleSchema` 的枚举自动跟随）。
- [ ] 在合适的位置调用 `fireTrigger(env, '新时机', expedition?)`。**先决定"对谁触发"**并写清：
  - 不传 `expedition`：全局来源（地图/难度/天气/库存道具）触发 1 次且无 `self`；角色来源对每个**此刻在庇护所**的角色逐个触发。
  - 传 `expedition`：全局来源以 `self` = 外出者触发；角色来源只对外出者本人。
  - 需要别的语义（例如"只对事件主角"）就扩展 `fireTrigger` 的参数，并保持现有两种语义不变。
- [ ] `validate.ts` 对 trigger 名没有硬编码，通常无需改；确认 `rule()` 对新 trigger 的 effects/modifiers 检查仍合理。
- [ ] `CLAUDE.md` 4.4 的 trigger 表加一行。
- [ ] 测试：构造带该 trigger 规则的夹具，断言触发对象（在庇护所 / 外出中 / 已死亡）。

### 3.5 新增每日步骤

`MORNING_STEPS` / `NIGHT_STEPS`（`src/engine/day.ts`）是 `{ name, run(env) }` 的有序数组：新系统作为**新步骤**插入，不改已有步骤内部。选择插入位置的原则：

- 依赖谁就放在谁之后：消耗配给的 → `rations` 之后；要用"当晚新进入的状态" → `statuses` 之后；会改属性的 → `statDecay` 之前还是之后决定了当晚是否被衰减抵消。
- 会影响外出的 → 与 `expeditionDepart` 的先后要想清楚（出发时携带物已离开库存）。
- 必须在 `deaths` 与结局判定之前，除非你明确想让结果延后一天。
- 清晨步骤在 `checkDeaths` / `nextEvent` 之前跑，别在步骤里直接弹事件（用 `queueEvent` 入队）。

走一遍"制作系统"（新增 `recipes` 类别见 3.7；玩家动作见 3.6）：

- [ ] `RunState.plan` 增可选字段 `craft`（要做的配方 id 列表）→ 3.8。
- [ ] 写 `src/engine/crafting.ts` 的 `stepCrafting(env)`：遍历 `run.plan.craft`，检查配方存在、材料够，扣材料（`changeItem`），产出用 `applyEffects` 执行配方的 `effects`；失败用 `sysLog`（新文案键见 3.9）。**别在这里直接判死亡。**
- [ ] 在 `NIGHT_STEPS` 中把 `{ name: 'crafting', run: stepCrafting }` 插到 `expeditionDepart` 之后、`statDecay` 之前（理由：携带物已出库不会被拿去制作；制作发生在衰减前）。
- [ ] `startDay` 清晨清空 `run.plan` 时会自动丢弃当天计划，无需另写。
- [ ] 测试：`tests/engine/` 里断言步骤顺序（`NIGHT_STEPS.map(s => s.name)`）与材料扣除。

### 3.6 新增玩家动作

- [ ] `src/engine/game.ts`：`Action` 联合加一支；`dispatch` 的 `switch` 加 `case`（`never` 检查会报漏）。
- [ ] 错误码约定：合法返回 `null`，否则返回**驼峰短字符串**（`notPlanPhase`、`charUnavailable`、`itemMissing`…）；先校验再修改，**校验失败前不要改 `run`**（虽然出错时会丢弃草稿，但保持习惯）。
- [ ] `src/data/ui-text.ts` 的 `uiText.errors` 为每个新错误码加中文说明，否则 UI 显示"操作无效（code）"。
- [ ] UI：在对应屏幕里 `store.dispatch({ type: ... })`（`src/ui/screens/`），注意 UI 不写死内容 id。
- [ ] sim：`src/sim/bots.ts` 的机器人只会产生它们认识的动作；新动作若是玩法必需（如不制作就无法通关），要给 `sensibleBot` 加上，否则模拟统计会失真；不是必需则可以不加。
- [ ] 测试：`tests/engine/game.test.ts`（用 `play(env, ...actions)` 风格），含错误码与"出错时状态不变"。

### 3.7 新增内容类别（如"配方"）

- [ ] `schema.ts`：新增 `RecipeSchema`（`z.strictObject`，带 `id: Id`）与类型；在 **`ContentDBSchema`** 加 `recipes: z.array(RecipeSchema)`（该 schema 是 strict，所有现有数据与夹具都必须补上这个键）。
- [ ] `src/engine/content.ts`：`Content` 接口加 `recipes: Map<string, RecipeDef>`；`buildContent` 里 `index(db.recipes)`。
- [ ] `src/data/recipes.ts`（新文件，`satisfies RecipeDef[]`）；`src/data/index.ts` 的 `contentDB` 加上。
- [ ] `src/validation/validate.ts`：`CATS` 数组、`CAT_SCHEMA`、`CAT_NAME`、`Pick<ContentDB, ...>` 类型里都加上；写该类别的语义检查（引用、规则、文案）；需要让别处能引用它就用 `ref('recipes', id, ...)`；id 重复检查自动覆盖 `CATS`。
- [ ] `src/save/sanitize.ts`：若 `RunState` 里持有该类别的 id，加"未知 id 丢弃"逻辑。
- [ ] `tests/fixtures/content.ts` 的 `makeDB()` 加 `recipes: [...]`（至少 `[]`），否则 `ContentDBSchema.parse` 全部夹具测试都会失败。
- [ ] `tests/validation/validate.test.ts` 加用例；`src/sim` 如有汇总内容类别的统计，按需补充。
- [ ] `CLAUDE.md`：数据格式速查与新增指南加一节。

### 3.8 给 `RunState` 加字段

- [ ] `schema.ts` 的 `RunStateSchema` 加字段。**可选字段**（`.optional()`）：旧存档无需迁移。**必填字段**：旧存档过不了 schema，必须提升 `SAVE_VERSION` 并写迁移。
- [ ] 想先试验：把数据放进 `run.ext['模块名']`（类型是 `unknown`，使用处自己 narrow；JSON 可序列化即可），不需要迁移；正式落地时再迁到具名字段并配一次迁移。
- [ ] `src/engine/setup.ts`：`newRun` 里的 `RunState` 字面量是有类型的，必填字段不补会编译报错；可选字段按需初始化。
- [ ] 提升 `SAVE_VERSION` 时：`schema.ts` `SAVE_VERSION` +1；`src/save/migrations.ts` 的 `migrations[旧版本]` 写迁移（处理原始 `unknown` 信封，`run` 在 `raw.run`）；`tests/save/migrations.test.ts` 加用例；检查 `tests/` 里手写 `RunState` 的地方。
- [ ] `src/save/sanitize.ts`：新字段里有内容 id 引用 → 加清理。
- [ ] 注意 `RunStateSchema` 是 `z.object`（非 strict）：未知键会被剥掉；新字段务必写进 schema，否则存读一轮就丢。
- [ ] 测试：`tests/engine`（行为）、`tests/save`（往返 / 迁移 / sanitize）。

### 3.9 新增引擎自动日志文案键

- [ ] `schema.ts`：`ENGINE_TEXT_KEYS` 加键，并在其上方的注释里写明可用变量。
- [ ] `src/validation/validate.ts`：`TEXT_VARS` 加该键的额外变量表（`{self}` `{day}` `{item:id}` 恒可用）；缺这一项会让该键被报"未知的引擎文案键"警告。
- [ ] 调用点：`sysLog(env, '新键', kind, { self: id }, { 变量名: 字符串 })`（变量值必须是字符串）。
- [ ] `src/data/config.ts` 的 `texts` 加文案；`ConfigSchema.texts` 是自由 record，所以不加不会编译失败，只有校验 warning。
- [ ] `CLAUDE.md` 4.5 占位符表加一行；测试夹具 `makeDB().config.texts` 按需加。

### 3.10 让预留扩展点落地（以代码现状为准）

**天气**（已基本落地）：清晨 `weather` 步骤（`day.ts` `stepWeather`）按 `map.weatherTable`（过滤掉不存在的天气）加权抽取，`daysLeft` 在 `duration{min,max}` 间随机，每天递减，到 0 重抽；`weather.rules` 作为全局来源参与 `getModifier` / `fireTrigger`；`{ weather }` 条件可用；变化时写 `weatherChange`；UI 顶栏显示天气名。当前没有任何天气数据（`src/data/weathers.ts` 为空）。缺的：天气预报、天气专属事件机制（现在靠事件 `when: { weather }`）、`daysLeft` 的 UI 展示。落地一个新天气是纯数据。

**地图专属规则 `map.rules`**：已落地，`globalRules` 收集，校验 `rules(m.rules)` 覆盖。纯数据可用。

**外出交通工具 `vehicle`**：已实现 — `validateExpeditionPlan`（`expedition.ts`）要求 `plan.vehicleId === (loc.vehicle ?? map.expedition.vehicle)` 且库存 ≥ 1，否则 `vehicleMissing`；UI（`screens/shelter.ts`）与 sim 机器人自动填 `vehicleId`；`validate.ts` 检查两处 `vehicle` 的物品引用；`sanitize` 清理未知 `vehicleId`。未实现：占用（外出期间别人不能用）、消耗/损坏、载具容量、载具对耗时/危险的专属影响、防止被无标签 `loseRandomItem` 丢掉、外出期间载具离开库存。要做这些：在 `departExpedition` / `resolveReturn` 里处理库存变化，必要时给 `ActiveExpedition` 记载具状态（→ 3.8），并补 `validate.ts` 与 UI。

**多人同时外出**：`RunState.expedition` 是单个可空对象，`plan.expedition` 也是单个。要改：

- [ ] `schema.ts`：`expedition` → 数组（必填字段变形，**需要迁移**：`null` → `[]`，对象 → `[对象]`；`plan.expedition` 同理）；`SAVE_VERSION` +1。
- [ ] `expedition.ts`：`validateExpeditionPlan` 的 `expeditionActive` 判断改为"每人一次 / 总人数上限"；`departExpedition`、`resolveReturn` 遍历数组；`queueSpecial` 的 `self`。
- [ ] `context.ts` `resolveTargets` 的 `'expeditioner'` 与 `conditions.ts` 的 `carrying` / `at` 回退到 `run.expedition` 的逻辑需重新定义（多人时回退谁？）——保持有 `scope.expedition` 的路径不变。
- [ ] `effects.ts` `removeFromParty` 对 `run.expedition` 的清理；`game.ts` `cancelExpedition` / `planExpedition`；`sanitize.ts`；`src/ui/screens/shelter.ts`；`src/sim/bots.ts`；计数器 `counters`；`map.expedition` 是否加 `maxParty` 之类的数据字段（`MapSchema`）并加校验。
- [ ] 测试：`tests/engine/expedition.test.ts`、`tests/save/sanitize.test.ts`、迁移测试。

**每天多个随机事件**：`RunState.eventRolled` 是布尔，`events.ts` `nextEvent` 只抽 1 次（队列里到期的事件则全部处理，且当天不再随机抽）。要改：

- [ ] `eventRolled` 改成"今天已抽次数"数字（必填字段变形，需要迁移：`false`→0，`true`→1）；`day.ts` `startDay` 重置；`nextEvent` 循环到次数用完；`MapSchema` 加可选 `eventsPerDay`（可选字段免迁移）；`validate.ts` 检查；`DESIGN.md` 第 1 节"每天最多 1 个随机事件"同步。
- [ ] 注意 `once` / `cooldown` 用 `run.day - lastDay <= cooldown`，同一天抽两次要想清楚是否允许重复；`drawRandomEvent` 每次都会为所有候选事件绑角色（消耗随机数）。
- [ ] 测试：`tests/engine/game.test.ts` 的事件抽取用例。

## 4. 常见陷阱

1. **在会被反复求值的位置用 `chance`**：`getEventView` 每次渲染都会重新求值选项的 `requires`；结局 `when` 一天内被检查多次（入夜后、进入计划阶段、看完事件结果后）；`enterWhen` / `exitWhen` 每晚求值。`chance` 每次求值都推进随机数并重新掷骰，会出现"按钮闪烁"或概率被放大。随机应放在 `outcomes` 的权重、`random` 效果或 trigger 规则的 `chance` 字段里。
2. **`getModifier` 的 `subject` 与 `scope`**：`subject` = 这次计算关于谁（外出键传外出者，`event.*` 不传）。全局来源（地图/难度/天气/库存道具）**总是**参与，其 `modifier.scope` 被忽略，`when` 里的 `self` = subject；角色来源（特性/状态）：`scope: 'self'`（默认）只有当 `subject` 是它自己时参与，`scope: 'global'` 对所有计算参与但该角色须在庇护所。因此"只有持有者受益的道具"做不到。外出者携带的道具不在库存里，其规则暂时失效。
3. **`effects.ts` ↔ `rules.ts` 的循环 import**：`effects.ts` 调 `getModifier`，`rules.ts` 调 `applyEffects`。这是安全的：两边都只在函数体内使用对方，模块顶层没有求值依赖（ES 模块的循环导入在调用时已解析）。**不要**在这两个文件的顶层写依赖对方导出的常量或立即执行的代码。
4. **`resolveTargets` 的 cond / effect 两种模式**：`'cond'` 下 `any`/`random` 返回全部在场者，由调用方判"存在"，不消耗随机数；`'effect'` 下 `any`/`random` 随机挑 1 个（消耗随机数）。`'all'` 在两种模式下都只含此刻在庇护所的人。在条件里别用 `'effect'` 模式。
5. **遍历中修改 `statuses`**：`removeStatus` 会 `splice`，`addStatus` 会 `push`，`onEnter` / `onExit` 效果还可能再加减状态。遍历前先拷贝（`for (const s of [...ch.statuses])`，见 `stepStatuses`）。
6. **`scope.vars` 的传递**：`loseRandomItem` 把 `{lost}` 写进 `scope.vars`（直接替换传入 `scope` 对象的属性）。同一个 `scope` 对象要一路传给之后的 `log` 效果与结果文案（`chooseEventOption` 先 `applyEffects` 再 `formatText` 同一个 `scope`）。你若复制了 scope（`{ ...scope }`）再传，后续就看不到 `{lost}`。`sysLog` 的 `vars` 则是显式合并。
7. **事件顶层 `when` 没有 `self`**：事件/日记/结局的 `when` 以空 scope 求值；角色相关判断放进 `roles.x.where`（其中 `self` = 候选人）。`queueEvent` 排队的事件不检查 `when`；`next` 的事件会重新绑定角色，只保留仍存活的预绑定角色。
8. **随机数消耗顺序**：`drawRandomEvent` 为每个满足条件的候选事件调用 `bindRoles`（会 `pickWeighted`），即使最后没抽中它；`fireTrigger` 在 `when` 成立之后才掷 `chance`。改变求值顺序会改变同种子的结果。
9. **`dayStart` / `dayEnd` 的全局规则没有 `self`**：全局 trigger 规则里写 `of: 'self'` 无目标，要用 `'all'` / `'random'`。
10. **测试里用 `makeEnv` 构造场景**：`makeEnv({ party?, items?, seed?, difficultyId? }, mutate?)`（`tests/fixtures/content.ts`）用夹具内容开局并返回 `{ run, content }`；`mutate(db)` 在建索引前修改内容（给夹具临时加规则/事件）；场景状态直接改草稿，如 `env.run.characters.alpha.stats.food = 80`、`env.run.inventory.can = 3`、`env.run.characters.alpha.where = 'away'`；然后直接调 `applyEffects(env, { self: 'alpha' }, [...])`、`fireTrigger(env, 'dayEnd')`、`getModifier(...)`，或用 `applyAction(env.run, action, env.content)`（注意它返回新 state，要回填 `env.run = r.state`）。`makeContent(mutate)` 会过一遍 `ContentDBSchema.parse`，写错夹具会立即抛错。

## 5. 修改引擎后的完成定义（Definition of Done）

- [ ] 新的条件 / 效果 / 动作 / 触发时机：`never` 穷尽检查全部通过（`npm run build` 无报错）。
- [ ] 引擎里没有内容 id、中文文案、`Math.random`、`Date`、DOM（`grep -rn "Math.random\|Date\.\|document\|window" src/engine` 为空）。
- [ ] 随机数只走 `rng.ts`，且没有无意改变现有调用顺序（`npm run sim -- --runs 100` 结果量级与改动前相当，除非改动本意如此）。
- [ ] `src/validation/validate.ts` 的登记表同步更新（`MODIFIER_KEY_PATTERNS`、`TEXT_VARS`、`COND_PRIMARY` / `EFFECT_PRIMARY`、`cond()` / `effect()` 分支、`CATS` 等），并有校验测试。
- [ ] 新增错误码已加进 `uiText.errors`；UI 需要的入口已加。
- [ ] 存档：新字段已按 3.8 处理——必填变更已迁移并有测试，`sanitize` 已覆盖内容引用，`newRun` 已初始化。
- [ ] 夹具 `tests/fixtures/content.ts` 与引擎测试已更新；正式内容不被引擎测试引用。
- [ ] `docs/ENGINE_GUIDE.md`、`CLAUDE.md`（条件 / 效果 / 修正键 / 占位符 / 每日流程 / "哪些改动必须改引擎"表）已同步；与 `docs/DESIGN.md` 冲突处已先改设计文档。
- [ ] `npm run build && npm test && npm run lint && npm run validate` 全绿；`npx prettier --write` 过改动的文件。
