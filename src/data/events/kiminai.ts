import type { EventDef } from '../../engine/schema';

export const kiminaiEvents = [
  {
    id: 'knock',
    title: '敲门声',
    text: '咚、咚、咚。深夜，庇护所的门被人轻轻敲响。门外传来一个懒洋洋的声音：“请问……这里收留路过的吗？”',
    tags: ['visitor'],
    when: {
      all: [{ not: { inParty: 'kiminai' } }, { partyAlive: { lte: 3 } }, { day: { gte: 3 } }],
    },
    cooldown: 5,
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
    text: '{k} 把塞得鼓鼓囊囊的大背包往墙角一放，掏出一本自制的《末日生存百科》：“交给我吧！这种小事我有八种方案！”',
    weight: 0,
    roles: { k: { is: 'kiminai' } },
    choices: [
      {
        id: 'welcome',
        text: '欢迎加入',
        outcomes: [
          {
            text: '{k} 很快就和大家打成一片，已经开始给大家科普屋里每样东西的保质期了。',
            effects: [{ stat: 'sanity', of: 'all', add: 5 }],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
