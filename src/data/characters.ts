import type { CharacterDef } from '../engine/schema';

export const characters = [
  {
    id: 'big_fish',
    name: '大肥鱼',
    desc: '一条离不开水的大胖鱼。水喝够了心态就稳，渴了就全身难受。',
    unlockedByDefault: true,
    traits: [
      {
        id: 'fish_water_bond',
        name: '水里的老大',
        desc: '水分高时理智不再下降；水分太低时健康额外下降。',
        rules: [
          {
            id: 'fish_hydrated_calm',
            when: { stat: 'hydration', of: 'self', gte: 60 },
            modifiers: [{ key: 'stat.sanity.dailyDelta', mul: 0 }],
          },
          {
            id: 'fish_dry_suffer',
            when: { stat: 'hydration', of: 'self', lt: 30 },
            modifiers: [{ key: 'stat.health.dailyDelta', add: -4 }],
          },
        ],
      },
    ],
  },
  {
    id: 'dragon_girl',
    name: '龙娘',
    desc: '吃饱了天下太平，饿了就变成另一个人（笨蛋）。',
    unlockedByDefault: true,
    traits: [
      {
        id: 'dragon_appetite',
        name: '龙之胃口',
        desc: '吃饱了不易生病、外出多找一件；饿了进入降智模式。',
        rules: [
          {
            id: 'dragon_full',
            when: { stat: 'satiety', of: 'self', gte: 70 },
            modifiers: [
              { key: 'status.sick.gainChance', mul: 0.4 },
              { key: 'expedition.lootRolls', add: 1 },
            ],
          },
          {
            id: 'dragon_dumb_enter',
            trigger: 'dayEnd',
            when: {
              all: [
                { stat: 'satiety', of: 'self', lt: 30 },
                { not: { hasStatus: 'dumb_mode', of: 'self' } },
              ],
            },
            effects: [
              { addStatus: 'dumb_mode', of: 'self' },
              { log: '{self} 的眼神逐渐清澈……清澈得什么都没有了。' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kiminai',
    name: '基米奈',
    desc: '神秘的敲门人。睡眠质量极好，也很耐渴。',
    traits: [
      {
        id: 'kiminai_steady',
        name: '心大',
        desc: '理智高时不易生病；水分每日下降变慢。',
        rules: [
          {
            id: 'kiminai_calm',
            when: { stat: 'sanity', of: 'self', gte: 50 },
            modifiers: [{ key: 'status.sick.gainChance', mul: 0.5 }],
          },
          {
            id: 'kiminai_camel',
            modifiers: [{ key: 'stat.hydration.dailyDelta', mul: 0.8 }],
          },
        ],
      },
    ],
  },
] satisfies CharacterDef[];
