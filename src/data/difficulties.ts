import type { DifficultyDef } from '../engine/schema';

export const difficulties = [
  {
    id: 'easy',
    name: '简单',
    desc: '饿得慢一些、渴得慢一些，外出也安全一些，适合热身。',
    points: 27,
    rules: [
      {
        id: 'easy_bounty',
        modifiers: [
          { key: 'expedition.danger', mul: 0.9 },
          { key: 'expedition.lootWeight.food', mul: 1.1 },
          { key: 'expedition.lootWeight.water', mul: 1.1 },
          { key: 'stat.satiety.dailyDelta', mul: 0.9 },
          { key: 'stat.hydration.dailyDelta', mul: 0.9 },
        ],
      },
    ],
  },
  { id: 'normal', name: '普通', desc: '标准的末日体验。', points: 22 },
  {
    id: 'hard',
    name: '困难',
    desc: '物资紧张，外出更危险，翻到吃喝的机会更少。',
    points: 17,
    rules: [
      {
        id: 'hard_scarcity',
        modifiers: [
          { key: 'expedition.danger', mul: 1.2 },
          { key: 'expedition.lootWeight.food', mul: 0.9 },
          { key: 'expedition.lootWeight.water', mul: 0.9 },
        ],
      },
    ],
  },
] satisfies DifficultyDef[];
