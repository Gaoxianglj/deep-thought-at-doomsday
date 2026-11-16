import type { StatDef } from '../engine/schema';

export const stats = [
  { id: 'satiety', name: '饱食度', min: 0, max: 100, initial: 70, dailyDelta: -10 },
  { id: 'hydration', name: '水分', min: 0, max: 100, initial: 70, dailyDelta: -10 },
  {
    id: 'health',
    name: '健康',
    min: 0,
    max: 100,
    initial: 100,
    dailyDelta: 0,
    deathAtZero: true,
    deathText: '{self} 没能撑过这一夜。（死因：{causes}）',
  },
  { id: 'sanity', name: '理智', min: 0, max: 100, initial: 80, dailyDelta: -2 },
] satisfies StatDef[];
