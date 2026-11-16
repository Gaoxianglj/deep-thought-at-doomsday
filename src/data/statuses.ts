import type { StatusDef } from '../engine/schema';

export const statuses = [
  {
    id: 'hungry',
    name: '饥饿',
    desc: '肚子在抗议，健康每天下降。',
    enterWhen: { stat: 'satiety', of: 'self', lt: 25 },
    exitWhen: { stat: 'satiety', of: 'self', gte: 30 },
    artState: 'hungry',
    priority: 2,
    rules: [{ id: 'hungry_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -15 }] }],
  },
  {
    id: 'thirsty',
    name: '口渴',
    desc: '嗓子冒烟，健康每天下降。',
    enterWhen: { stat: 'hydration', of: 'self', lt: 25 },
    exitWhen: { stat: 'hydration', of: 'self', gte: 30 },
    artState: 'thirsty',
    priority: 2,
    rules: [{ id: 'thirsty_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -20 }] }],
  },
  {
    id: 'sick',
    name: '生病',
    desc: '头晕、咳嗽、浑身没劲，无法外出。',
    duration: 4,
    blocksExpedition: true,
    artState: 'sick',
    priority: 3,
    rules: [{ id: 'sick_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -4 }] }],
  },
  {
    id: 'injured',
    name: '受伤',
    desc: '身上带着伤，无法外出。',
    duration: 5,
    blocksExpedition: true,
    artState: 'injured',
    priority: 3,
    rules: [{ id: 'injured_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -3 }] }],
  },
  {
    id: 'insane',
    name: '发疯',
    desc: '理智告急，偶尔会闯点小祸。',
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
                  { loseRandomItem: { tag: 'food', count: 1 } },
                  { log: '{self} 对着罐头说了一晚上的话，最后把它埋了。（丢失：{lost}）' },
                  { setFlag: 'incident', value: true },
                ],
              },
              {
                weight: 1,
                effects: [
                  { loseRandomItem: { tag: 'tool', count: 1 } },
                  { log: '{self} 试图“修理”一件工具，结果它再也不能用了。（丢失：{lost}）' },
                  { setFlag: 'incident', value: true },
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
    desc: '饿过头了，脑子停止运转：饱食度下降变慢，但会闯祸。',
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
                  { loseRandomItem: { tag: 'food', count: 1 } },
                  { log: '{self} 半夜偷吃了储备粮。（丢失：{lost}）' },
                  { setFlag: 'incident', value: true },
                  { setFlag: 'rule_broken', value: true },
                ],
              },
              {
                weight: 1,
                effects: [
                  { loseRandomItem: { tag: 'tool', count: 1 } },
                  { log: '{self} 把一件工具玩坏了。（丢失：{lost}）' },
                  { setFlag: 'incident', value: true },
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
    desc: '吃撑了倒头就睡：不能外出；饱食下降减半，健康和理智每天回升一点。持续 1 天。',
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
    onExit: [{ log: '{self} 伸了个大大的懒腰：“睡饱了！今天什么时候开饭？”' }],
  },
  {
    id: 'despair',
    name: '陷入绝望',
    desc: '抱膝缩在墙角不停道歉：进入时理智最多只剩 45；不能外出，自己的理智每天额外下降，夜里还会把旁人也道歉得心态发崩。最多 4 天，理智回到 55 以上就能提前振作，振作时全员理智回升。',
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
    desc: '脑回路飘到了天花板上：外出少带回一件，带回来的多是工具和破烂、少有吃喝；但理智下降减半，也不容易生病。最长 3 天，理智 ≥50 且饱食 ≥40 时恢复。',
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
    desc: '举着“本日对话配额已耗尽”的牌子：不能外出，风控光环暂停；独自冷静抄写守则，理智每天回升。持续 2 天。',
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
    desc: '脑子里的思绪正在排队：不能外出，饱食下降变慢。醒过来时常常会想起点有用的东西。持续 1 天。',
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
    desc: '背对大家跪在墙角，举着“都是我的错”的小牌子：不能外出，氛围光环暂停。进入时大家被逗笑，全员理智回升。持续 1 天。',
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
    onExit: [{ log: '{self} 从墙角站起来，又恢复了灿烂的笑容：“反省完毕！今天也要元气满满哦！”' }],
  },
] satisfies StatusDef[];
