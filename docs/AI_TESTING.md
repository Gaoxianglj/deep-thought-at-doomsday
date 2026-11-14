# AI 驱动的测试手册

这份文档说明怎么用 AI（脚本 bot 与 LLM 玩家）批量测游戏：找 bug、调平衡、看通关难度、看多局随机性。
所有工具都在 `src/sim/`（纯逻辑）与 `scripts/`（命令行入口），引擎本身不依赖它们。

## 0. 先选工具

| 想知道                                   | 用什么                                          | 耗时               |
| ---------------------------------------- | ----------------------------------------------- | ------------------ |
| 有没有 bug / 引擎会不会崩 / 状态是否合法 | `npm run sim`（默认带不变量检查）、`--bot fuzz` | 1000 局约 12–30 秒 |
| 某一局到底发生了什么                     | `npm run replay -- --seed <种子> ...`           | 秒级               |
| 游戏对不同水平的玩家有多难               | `npm run skill`                                 | 约 20–60 秒        |
| 改了数值，效果是好是坏                   | `npm run sim -- --out` + `npm run compare`      | 两次 sim           |
| 平衡有没有被改坏（回归）                 | `npm run balance`                               | 约 17 秒           |
| 重复玩会不会腻、事件重不重复             | `npm run sim` 报告里的"多样性"段                | 同 sim             |
| 文案是否矛盾、选项是否没意义、信息够不够 | `npm run play`（让 LLM 当玩家）                 | 一局数分钟，较贵   |

原则：**脚本 bot 管数量（千局级、查数值与 bug），LLM 玩家管质量（几局、查文案与体验）**。LLM 贵，别拿它做脚本能做的事。

## 1. 批量模拟 `npm run sim`

```bash
npm run sim -- --runs 1000 --difficulty normal --bot sensible
npm run sim -- --runs 1000 --bot random --unlock-all      # 下限参照 + 全角色
npm run sim -- --runs 1000 --bot fuzz --unlock-all        # 引擎健壮性
npm run sim -- --runs 500 --bot "sensible:toolReserve=0.3,dangerWeight=2"   # 带参数的策略
```

- 局数 ≥ 300 时默认多进程并行（`--jobs auto`），结果与单进程**逐字节一致**；`--jobs 1` 强制单进程。
- 种子是 `<前缀>-<序号>`（前缀用 `--seed` 改，默认 `sim`）。固定前缀，改一处数据再跑，才能比较前后。
- 退出码：有崩溃 / 卡死 / 不变量**错误**时为 1。

报告自上而下：**健康检查**（崩溃、卡死、不变量违规，带示例种子）→ 结局分布（带示例种子）与通关率 → 存活天数 →
**死亡/离队原因** → **每日曲线**（仍在继续比例、平均活人、食物与水的库存与断供率）→ **外出**（各地点出发/失踪率）→
**多样性** → **事件选项**异常 → 角色 / 事件 / 解锁 / 被拒绝动作。

### 策略（`--bot`）

| 名字       | 含义                                                                                            |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `random`   | 乱玩，当**下限**                                                                                |
| `sensible` | 稳健：物资告急就外出补给，否则轮流探索（默认）                                                  |
| `turtle`   | 龟缩：只在物资告急时才出门，挑安全的地方                                                        |
| `explorer` | 激进：频繁出门，不怎么在乎危险与身体状态，少买工具                                              |
| `fuzz`     | 约 35% 的动作是非法动作（错阶段、不存在 / 已死亡的角色、错配物品…），测引擎不崩、被拒绝不改状态 |

策略型（后三者之外的 sensible / turtle / explorer）可带参数覆盖：`sensible:toolReserve=0.3,dangerWeight=2`。
可用参数见 `src/sim/bots.ts` 的 `Policy`：`partyBudget` `toolReserve` `lowSupplyDays` `exploreMinWellbeing`
`exploreWhenSafe` `exploreMinHome` `dangerWeight`。

**注意：`sensible` 只是贪心策略，不代表好玩家。** 它的通关率不能直接当作"游戏难度"，要看技能梯度（第 3 节）。

### 不变量违规的两个级别

- `error`：一定是 bug（属性越界、库存为负、外出状态对不上、动作被拒绝却改了状态、角色复活……），退出码 1。
- `warning`：疑似流程缺口，只列出。

## 2. 回放 `npm run replay`

```bash
npm run replay -- --seed sim-3 --difficulty normal --bot sensible            # 完整
npm run replay -- --seed sim-3 --difficulty normal --from 5 --to 9 --brief   # 只看第 5–9 天，精简
npm run replay -- --seed sim-3 --difficulty normal --json                    # 结构化，便于让 AI 逐步分析
```

回放要带上与产生该种子的 sim **相同**的 `--map --difficulty --bot --unlock-all --max-days`，同种子同结果。
sim 报告末尾会给出可直接粘贴的命令。输出：每天的角色属性与状态、库存、事件（正文 + 选项 + 所选 + 结果）、
配给 / 用药 / 外出动作、引擎日志，末尾是结局与不变量违规。

## 3. 技能梯度 `npm run skill`

```bash
npm run skill -- --runs 300 --search 16 --difficulty normal
```

用 random / turtle / sensible / explorer 与"随机搜索出的最优参数"（best）各跑一批局，估计游戏对不同水平玩家的难度。
best 先用小样本搜索、再用**全新种子**复测，避免挑出"运气好"的参数；最后一行给出可复现的 `--bot "<描述串>"`。

怎么读：

- 通关率应随技能上升（random < sensible < best）。如果 random 的通关率与 sensible 差不多，说明通关主要靠运气 / 固定事件，技能无关。
- best 与 sensible 差距大 = 有"没被默认策略发现的更优玩法"，值得人工看看那组参数在做什么。
- 各难度之间应有梯度（简单 > 普通 > 困难）。

## 4. 改数值后的前后对比：`--out` + `npm run compare`

```bash
npm run sim -- --runs 500 --seed base --out /tmp/before.json     # 改动前
# 改数值 / 内容
npm run sim -- --runs 500 --seed base --out /tmp/after.json      # 改动后（参数必须相同）
npm run compare -- /tmp/before.json /tmp/after.json
```

只列"超出噪声"的变化：比例类用两样本 z 检验（▲▼ = |z|>2 显著，· = 噪声内），覆盖通关率、结局占比、存活天数、
死因占比变化（≥2pp）、外出（出发与失踪率）、曲线检查点（继续比例与断供率）、事件触发率变化（≥5pp）、
新增"从未触发"的事件、新增的违规。**样本越大越灵敏，调数值建议 ≥ 500 局。**

## 5. 平衡护栏 `npm run balance`

规则写在 `balance/targets.ts`。默认只启用**设计无关**的检查：

- 健康（无崩溃 / 卡死 / 错误）、超时率不过高
- 难度单调：更难的难度，通关率与存活天数不应显著更高（用参考 bot）
- 技能单调：更强的 bot 不应显著更差
- 事件覆盖：没有任何 (难度, bot) 能触发到的事件

想把设计意图固化成数值，往 `ranges` 加规则，例如：

```ts
{ difficulty: 'normal', bot: 'sensible', metric: 'winRate', min: 0.1, max: 0.4, note: '普通难度稳健玩家 10–40% 通关' },
{ bot: 'random', metric: 'winRate', max: 0.05, note: '乱玩不应通关' },
```

有"错误"级失败时退出码为 1。这是**手动**跑的回归工具，没有放进 `npm test`（它依赖会被你不断调整的数值）。

## 6. 让 LLM 当玩家 `npm run play`

文本界面：一局 = 一个会话文件（`.playtest/*.json`，已 gitignore），每次调用读取、推进、保存。
会话 = 开局设置 + 动作列表，状态由重放重建（引擎是确定性的），所以可复现、可导出。

```bash
npm run play -- info                                  # 可选伙伴 / 物资 / 点数
npm run play -- new --party 大肥鱼,龙娘 --items 罐头=4,瓶装水=8 --seed t1      # 或 --auto
npm run play -- show
npm run play -- act choose 1
npm run play -- act "ration 大肥鱼 食物 罐头; ration 大肥鱼 饮水 瓶装水; go 龙娘 便利店; end"
npm run play -- note "第 3 天：选项 2 的结果文案和选项描述对不上"
npm run play -- report            # 完整过程 + 笔记
```

- 命令：`choose <序号>` `continue` `ration <角色> <配给类型> <物品|none>` `use <物品> <角色>`
  `go <角色> <地点> [携带物,…]` `cancel` `end`。名字或 id 都可以；`act` 用 `;` 连续执行多条，遇错即停。
- 信息量与真实界面对齐：地点只给描述、往返天数、危险等级（1–5 档），不给战利品表与精确概率。
- **配给每天都要重新设置**，不设置 = 当晚不吃不喝（界面也是这样）。
- 并行试玩时每个玩家用不同的 `--session`，如 `--session .playtest/p1.json`。

### 派 AI 当试玩员（提示词模板）

用 Agent 工具派子代理（执行类用 sonnet，见 CLAUDE.md 第 10 节），每个试玩员一份：

> 你是《末日时在深度思考中》的试玩员，目标是**像第一次玩的普通玩家那样**玩几局，并找出游戏的问题。
> 规则：
>
> 1. 只通过 `npm run play -- ...` 玩（会话文件用 `--session .playtest/<你的名字>.json`）。**不要读 `src/`、`docs/` 或任何源码**——你应当和真实玩家一样只知道界面告诉你的信息。
> 2. 先 `info` 看可选项，自己选队伍和物资开一局（`--seed <给定种子>`），然后一直玩到结局。每一步按你的真实判断选，不要故意求死或求胜。
> 3. 遇到下列情况立刻用 `note` 记下（写清第几天、哪个事件 / 选项）：文案前后矛盾或与实际结果对不上；选项看不出区别 / 明显没意义；信息不够无法做判断；某个机制没看懂；觉得不公平或太无聊；任何疑似 bug（数值异常、操作被拒绝却不知道为什么、界面说的与发生的不一致）。
> 4. 打完后运行 `report`，并按这个格式回报：①总体感受（难度、节奏、是否想再玩）②问题清单（按严重程度，每条带第几天与原文）③你的决策依据（你为什么这样选）。**只回报摘要，不要贴整份 report。**

主会话收到各试玩员的回报后：把"疑似 bug"用 `replay`（同种子 + 对应参数）或会话文件复现，把平衡类感受用 sim / skill 验证。
LLM 的主观感受是线索，不是结论——用批量数据交叉验证再动手改。

## 7. 典型工作流

**加 / 改内容后**：`npm run validate` → `npm run sim -- --runs 300`（看健康检查与"从未触发的事件"）→ `--bot random --unlock-all` 与 `--bot fuzz` 各一遍。

**调平衡**：固定 `--seed` 跑 before → 改一处 → 跑 after → `compare`；再用 `skill` 看各水平玩家的体验是否同步变化；满意后 `balance` 确认没破坏护栏。

**排查"某局为什么死了 / 卡了"**：sim 报告里拿种子 → `replay`（`--brief`、`--from/--to` 缩小范围）。

**发版前**：`npm run build && npm test && npm run lint && npm run validate`，再 `npm run balance`。

## 8. 扩展

- 新增不变量：`src/sim/invariants.ts`（`checkInvariants` 任意时刻成立；`checkTransition` 一步前后成立）。拿不准是不是一定是 bug 就标 `warning`。补 `tests/sim/invariants.test.ts`。
- 新增分析统计：`src/sim/analytics.ts` 的 `Recorder`（逐步观察）→ `aggregateAnalytics`（汇总）→ `formatAnalytics`（输出）。保持 `tests/sim/analytics.test.ts` 里"分析数据与引擎计数器一致"的校验。
- 新增策略风格：在 `POLICY_PRESETS`（`src/sim/bots.ts`）加一行相对默认值的差异；bot 里不得写具体内容 id，也不得持有跨局的全局状态（每局的私有记忆通过 `mem` 参数传入）。
- 新增引擎错误码：必须在 `src/data/ui-text.ts` 的 `errors` 里加一行，否则 `tests/sim/fuzz-real.test.ts` 会失败（界面会显示"操作无效（code）"）。
- 新增玩家动作：参见 ENGINE_GUIDE 3.6；同时在 `src/sim/play.ts` 的 `parseCommand` / `describeState` 里支持它，并让 `sensibleBot` 会用（否则模拟会失真）。
