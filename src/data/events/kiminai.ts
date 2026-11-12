import type { EventDef } from '../../engine/schema';

export const kiminaiEvents = [
  {
    id: 'knock',
    title: '敲门声',
    text: '咚、咚、咚。深夜，庇护所的门被人轻轻敲响。门外传来一个懒洋洋的声音：“请问……这里收留路过的吗？”',
    tags: ['visitor'],
    when: { all: [{ not: { inParty: 'kiminai' } }, { day: { gte: 3 } }] },
    cooldown: 4,
    choices: [
      {
        id: 'let_in',
        text: '开门，让她进来',
        outcomes: [
          {
            text: '门开了，一个背着大包的姑娘走了进来，自称基米奈。她环顾四周，满意地点了点头。',
            effects: [{ joinParty: 'kiminai' }, { unlock: 'kiminai' }],
            next: 'kiminai_welcome',
          },
        ],
      },
      {
        id: 'refuse',
        text: '假装没人在家',
        outcomes: [
          {
            text: '敲门声持续了一会儿，然后是远去的脚步声。也许她还会再来。',
          },
        ],
      },
    ],
  },
  {
    id: 'kiminai_welcome',
    title: '新室友',
    text: '{k} 把大包往墙角一放，说自己什么都吃、什么都睡得着。大家决定先给她安排一个最不漏风的角落。',
    weight: 0,
    roles: { k: { is: 'kiminai' } },
    choices: [
      {
        id: 'welcome',
        text: '欢迎加入',
        outcomes: [
          {
            text: '{k} 很快就和大家打成一片，并且已经在研究怎么把配给分得更均匀了。',
            effects: [{ stat: 'sanity', of: 'all', add: 5 }],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
