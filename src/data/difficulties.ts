import type { DifficultyDef } from '../engine/schema';

export const difficulties = [
  { id: 'easy', name: '简单', desc: '物资充裕，适合热身。', points: 30 },
  { id: 'normal', name: '普通', desc: '标准的末日体验。', points: 22 },
  {
    id: 'hard',
    name: '困难',
    desc: '物资紧张，饿得更快，外出更危险。',
    points: 15,
    rules: [
      {
        id: 'hard_hunger',
        modifiers: [
          { key: 'stat.satiety.dailyDelta', mul: 1.2, scope: 'global' },
          { key: 'expedition.danger', mul: 1.3, scope: 'global' },
        ],
      },
    ],
  },
] satisfies DifficultyDef[];
