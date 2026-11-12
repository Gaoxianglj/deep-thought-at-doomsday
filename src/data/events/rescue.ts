import type { EventDef } from '../../engine/schema';

export const rescueEvents = [
  {
    id: 'radio_broadcast',
    title: '沙沙声中的人声',
    text: '收音机在沙沙声里突然冒出一段断断续续的人声：“……这里是……临时救援站……收到请回答……”',
    tags: ['radio'],
    when: {
      all: [{ hasItem: 'radio' }, { not: { flag: 'radio_signal' } }, { day: { gte: 3 } }],
    },
    cooldown: 4,
    weight: 2,
    choices: [
      {
        id: 'respond',
        text: '拿起麦克风回应',
        outcomes: [
          {
            weight: 3,
            text: '对面回应了！对方记下了你们的位置，说几天后会派人来。',
            effects: [
              { setFlag: 'radio_signal', value: true },
              { queueEvent: 'rescue_arrives', delay: 4 },
              { stat: 'sanity', of: 'all', add: 10 },
            ],
          },
          {
            weight: 1,
            text: '信号断了，只剩一片沙沙声。也许下次能接上。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
      {
        id: 'ignore',
        text: '关掉收音机，谨慎为上',
        outcomes: [{ text: '你们决定不冒这个险。收音机重新安静下来。' }],
      },
    ],
  },
  {
    id: 'rescue_arrives',
    title: '救援到达',
    text: '远处传来引擎的轰鸣。几束强光扫过废墟，有人用扩音器喊：“有人吗？我们是来接你们的！”',
    weight: 0,
    choices: [
      {
        id: 'board',
        text: '冲出去挥手',
        outcomes: [
          {
            text: '你们一路挥着手跑向救援车。',
            effects: [{ ending: 'rescued' }],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
