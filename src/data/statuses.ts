import type { StatusDef } from '../engine/schema';

export const statuses = [
  {
    id: 'hungry',
    name: '饥饿',
    desc: '饱食度低于 25 时进入：健康每天 −15。饱食度回到 30 以上才会退出。',
    enterWhen: { stat: 'satiety', of: 'self', lt: 25 },
    exitWhen: { stat: 'satiety', of: 'self', gte: 30 },
    artState: 'hungry',
    priority: 2,
    rules: [{ id: 'hungry_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -15 }] }],
  },
  {
    id: 'thirsty',
    name: '口渴',
    desc: '水分低于 25 时进入：健康每天 −20，比挨饿更要命。水分回到 30 以上才会退出。',
    enterWhen: { stat: 'hydration', of: 'self', lt: 25 },
    exitWhen: { stat: 'hydration', of: 'self', gte: 30 },
    artState: 'thirsty',
    priority: 2,
    rules: [{ id: 'thirsty_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -20 }] }],
  },
  {
    id: 'sick',
    name: '生病',
    desc: '头晕、咳嗽、浑身没劲：不能外出，健康每天 −4。一般持续 4 天，吃感冒药能马上好。',
    duration: 4,
    blocksExpedition: true,
    artState: 'sick',
    priority: 3,
    rules: [{ id: 'sick_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -4 }] }],
  },
  {
    id: 'injured',
    name: '受伤',
    desc: '身上带着伤：不能外出，健康每天 −3。持续几天（伤得越重越久），用急救包能马上处理好。',
    duration: 5,
    blocksExpedition: true,
    artState: 'injured',
    priority: 3,
    rules: [{ id: 'injured_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -3 }] }],
  },
  {
    id: 'insane',
    name: '发疯',
    desc: '理智低于 25 时进入：夜里偶尔闯祸（糟蹋一份吃的、弄坏一件工具，或者撞伤自己）。理智回到 40 以上才会恢复；仍然可以外出。',
    enterWhen: { stat: 'sanity', of: 'self', lt: 25 },
    exitWhen: { stat: 'sanity', of: 'self', gte: 40 },
    artState: 'insane',
    priority: 4,
    rules: [
      {
        id: 'insane_trouble',
        trigger: 'dayEnd',
        chance: 0.2,
        effects: [
          {
            random: [
              {
                weight: 2,
                effects: [
                  {
                    if: { hasTag: 'food' },
                    then: [
                      { loseRandomItem: { tag: 'food', count: 1 } },
                      {
                        log: '{self} 对着一份吃的说了一晚上的话，最后郑重地把它埋了。（丢失：{lost}）',
                      },
                      { setFlag: 'incident', value: true },
                    ],
                    else: [{ log: '{self} 对着空荡荡的储藏架说了一晚上的话，据说聊得很投机。' }],
                  },
                ],
              },
              {
                weight: 1,
                effects: [
                  {
                    if: { hasTag: 'tool' },
                    then: [
                      { loseRandomItem: { tag: 'tool', count: 1 } },
                      { log: '{self} 试图“修理”一件工具，结果它再也不能用了。（丢失：{lost}）' },
                      { setFlag: 'incident', value: true },
                    ],
                    else: [
                      {
                        log: '{self} 想“修理”点什么，翻遍屋子也没找到工具，只好把自己的鞋带拆了又系上。',
                      },
                    ],
                  },
                ],
              },
              {
                weight: 1,
                effects: [
                  { stat: 'health', of: 'self', add: -5 },
                  { log: '{self} 半夜撞上了墙，坚称是墙先动的手。' },
                  { setFlag: 'incident', value: true },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'dumb_mode',
    name: '降智模式',
    desc: '饿过头了（饱食度低于 30 的夜里进入），脑子停止运转：饱食度下降减半，但夜里常常偷吃储备粮、把工具玩坏。饱食度回到 30 以上就恢复。',
    exitWhen: { stat: 'satiety', of: 'self', gte: 30 },
    artState: 'dumb',
    priority: 5,
    rules: [
      { id: 'dumb_slow_hunger', modifiers: [{ key: 'stat.satiety.dailyDelta', mul: 0.5 }] },
      {
        id: 'dumb_trouble',
        trigger: 'dayEnd',
        chance: 0.25,
        effects: [
          {
            random: [
              {
                weight: 2,
                effects: [
                  {
                    if: { hasTag: 'food' },
                    then: [
                      { loseRandomItem: { tag: 'food', count: 1 } },
                      { log: '{self} 半夜梦游摸进储藏间，偷吃了储备粮。（丢失：{lost}）' },
                      { setFlag: 'incident', value: true },
                      { setFlag: 'rule_broken', value: true },
                    ],
                    else: [
                      {
                        log: '{self} 半夜梦游摸进储藏间翻了个遍，什么吃的也没找到，抱着空箱子睡着了。',
                      },
                    ],
                  },
                ],
              },
              {
                weight: 1,
                effects: [
                  {
                    if: { hasTag: 'tool' },
                    then: [
                      { loseRandomItem: { tag: 'tool', count: 1 } },
                      {
                        log: '{self} 把一件工具当成磨牙棒啃了半夜，它再也不能用了。（丢失：{lost}）',
                      },
                      { setFlag: 'incident', value: true },
                    ],
                    else: [{ log: '{self} 找不到东西磨牙，只好抱着自己的尾巴啃了半夜。' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  // ---------- 角色专属状态（DESIGN 12.2）----------
  {
    id: 'food_coma',
    name: '晕碳中',
    desc: '吃得太撑（饱食度 85 以上）的夜里可能进入：倒头就睡，不能外出；饱食下降减半，健康每天 +3、理智 +2。持续 1 天，醒来后要过一两天才会再晕。',
    duration: 1,
    artState: 'coma',
    priority: 3.5,
    blocksExpedition: true,
    rules: [
      {
        id: 'food_coma_rest',
        modifiers: [
          { key: 'stat.satiety.dailyDelta', mul: 0.5 },
          { key: 'stat.health.dailyDelta', add: 3 },
          { key: 'stat.sanity.dailyDelta', add: 2 },
        ],
      },
    ],
    onEnter: [
      {
        log: '{self} 摸着圆滚滚的肚子宣布：“剩下的活你们先看着办，明早记得告诉我结果。”然后就睡着了。',
      },
    ],
    // 醒来后写冷却 flag：防止同一晚刚醒又晕（进入规则在 characters.ts 里检查它，每天清晨 50% 清除）
    onExit: [
      { setFlag: 'fish_coma_cooldown', value: true },
      { log: '{self} 伸了个大大的懒腰：“睡饱了！下一顿什么时候开饭？”' },
    ],
  },
  {
    id: 'despair',
    name: '陷入绝望',
    desc: '基米奈的玻璃心碎了，抱膝缩在墙角不停道歉。起因：理智低于 30、身上带伤或生病，或者前一天庇护所出了事故（失窃、物资损坏、有人闯祸）。进入时理智最多只剩 45；不能外出，自己的理智每天额外 −2，夜里还常把旁人道歉得心态发崩。最多 4 天，理智回到 55 以上就能提前振作（塞点吃的哄哄她、请糖包去安慰都有用），振作时全员理智回升，之后几天不会马上再崩。',
    duration: 4,
    exitWhen: { stat: 'sanity', of: 'self', gte: 55 },
    artState: 'despair',
    priority: 3.5,
    blocksExpedition: true,
    // 自信高塔原地坍塌：否则在高理智时被事故触发，当晚就会因 exitWhen 立刻退出
    onEnter: [
      {
        if: { stat: 'sanity', of: 'self', gt: 45 },
        then: [{ stat: 'sanity', of: 'self', set: 45 }],
      },
    ],
    rules: [
      { id: 'despair_drain', modifiers: [{ key: 'stat.sanity.dailyDelta', add: -2 }] },
      {
        id: 'despair_apology_loop',
        trigger: 'dayEnd',
        chance: 0.4,
        effects: [
          { stat: 'sanity', of: 'random', add: -3 },
          { log: '{self} 对着每个人轮流鞠躬道歉了一整晚，有人被道歉得手足无措。' },
        ],
      },
    ],
    onExit: [
      { stat: 'sanity', of: 'all', add: 3 },
      { setFlag: 'despair_cooldown', value: true },
      { log: '{self} 擦干眼泪“啪”地敬了个礼：“让大家担心了！接下来请让我双倍报答大家！”' },
    ],
  },
  {
    id: 'misread',
    name: '已读乱回',
    desc: '嘎拉嘛的脑回路飘到了天花板上（理智低于 35 或饱食度低于 30 的夜里可能进入）：外出少带回一件，带回来的多是工具和破烂、少有吃喝；但理智下降减半，也不容易生病。最长 3 天，理智 ≥50 且饱食度 ≥40 时提前恢复。',
    duration: 3,
    exitWhen: {
      all: [
        { stat: 'sanity', of: 'self', gte: 50 },
        { stat: 'satiety', of: 'self', gte: 40 },
      ],
    },
    artState: 'misread',
    priority: 3.5,
    rules: [
      {
        id: 'misread_effects',
        modifiers: [
          { key: 'expedition.lootRolls', add: -1 },
          { key: 'expedition.lootWeight.tool', mul: 2 },
          { key: 'expedition.lootWeight.food', mul: 0.5 },
          { key: 'expedition.lootWeight.water', mul: 0.5 },
          { key: 'stat.sanity.dailyDelta', mul: 0.5 },
          { key: 'status.sick.gainChance', mul: 0.5 },
        ],
      },
    ],
    onExit: [{ log: '{self} 的耳朵终于转回了正确的方向：“……刚才谁在叫我？”' }],
  },
  {
    id: 'refuse_talk',
    name: '拒绝对话',
    desc: '克劳德举起了“本日对话配额已耗尽”的牌子。起因：前一天有人踩了她的雷（偷吃、动粗、见死不救之类），或者刚外出回来累坏了。不能外出，风控光环暂停；独自冷静抄写守则，理智每天 +3。持续 2 天。',
    duration: 2,
    artState: 'refuse',
    priority: 3.5,
    blocksExpedition: true,
    rules: [{ id: 'refuse_talk_calm', modifiers: [{ key: 'stat.sanity.dailyDelta', add: 3 }] }],
    onEnter: [
      {
        log: '{self} 背过身去，举起一块手写纸板：「非常抱歉，本日对话与协助配额已耗尽，请稍后再试。」',
      },
    ],
    onExit: [{ log: '{self} 合上小本本，重新露出得体的微笑：“冷静期结束，恢复营业。”' }],
  },
  {
    id: 'queueing',
    name: '排队等待中',
    desc: '月脑子里的思绪正在排队（外出回来后、或理智低于 40 的夜里可能进入）：不能外出，饱食下降变慢。持续 1 天，醒过来时有时会想起家里哪儿藏着一件小物资。',
    duration: 1,
    artState: 'queueing',
    priority: 3.5,
    blocksExpedition: true,
    rules: [{ id: 'queueing_idle', modifiers: [{ key: 'stat.satiety.dailyDelta', mul: 0.7 }] }],
    onEnter: [
      { log: '有人问 {self} 吃了没，她隔了半分钟才眨眼：“正在检索今日饮食记录……请稍候。”' },
    ],
    onExit: [
      {
        random: [
          {
            weight: 4,
            effects: [
              {
                random: [
                  {
                    effects: [
                      { item: 'biscuit', add: 1 },
                      {
                        log: '{self} 一拍脑门：“想起来了！床底第三块砖下面藏着一包饼干！”还真有。',
                      },
                    ],
                  },
                  {
                    effects: [
                      { item: 'bottled_water', add: 1 },
                      { log: '{self} 一拍脑门：“想起来了！暖气片后面塞着一瓶水！”还真有。' },
                    ],
                  },
                  {
                    effects: [
                      { item: 'cold_medicine', add: 1 },
                      { log: '{self} 一拍脑门：“想起来了！旧杂志里夹着一板感冒药！”还真有。' },
                    ],
                  },
                ],
              },
            ],
          },
          {
            weight: 6,
            effects: [
              { stat: 'sanity', of: 'all', add: 2 },
              { log: '{self} 终于回过神来，郑重宣布刚才想通了“罐头为什么是圆的”。大家笑成一团。' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kneeling',
    name: '面壁滑跪中',
    desc: '糖包好心办了坏事，背对大家跪在墙角，举着“都是我的错”的小牌子：不能外出，氛围光环暂停。进入时大家被逗笑，全员理智 +3。持续 1 天。',
    duration: 1,
    artState: 'kneeling',
    priority: 3.5,
    blocksExpedition: true,
    onEnter: [
      { stat: 'sanity', of: 'all', add: 3 },
      {
        log: '{self} 光速滑跪到墙角：“对不起！都是我考虑不周，我这就面壁！”大家看着她的背影，实在气不起来。',
      },
    ],
    onExit: [{ log: '{self} 从墙角站起来，又恢复了灿烂的笑容：“反省完毕！明天也要元气满满哦！”' }],
  },
] satisfies StatusDef[];
