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
    rules: [{ id: 'hungry_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -8 }] }],
  },
  {
    id: 'thirsty',
    name: '口渴',
    desc: '嗓子冒烟，健康每天下降。',
    enterWhen: { stat: 'hydration', of: 'self', lt: 25 },
    exitWhen: { stat: 'hydration', of: 'self', gte: 30 },
    artState: 'thirsty',
    priority: 2,
    rules: [{ id: 'thirsty_drain', modifiers: [{ key: 'stat.health.dailyDelta', add: -10 }] }],
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
                ],
              },
              {
                weight: 1,
                effects: [
                  { loseRandomItem: { tag: 'tool', count: 1 } },
                  { log: '{self} 试图“修理”一件工具，结果它再也不能用了。（丢失：{lost}）' },
                ],
              },
              {
                weight: 1,
                effects: [
                  { stat: 'health', of: 'self', add: -5 },
                  { log: '{self} 半夜撞上了墙，坚称是墙先动的手。' },
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
                ],
              },
              {
                weight: 1,
                effects: [
                  { loseRandomItem: { tag: 'tool', count: 1 } },
                  { log: '{self} 把一件工具玩坏了。（丢失：{lost}）' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
] satisfies StatusDef[];
