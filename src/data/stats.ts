import type { StatDef } from '../engine/schema';

export const stats = [
  { id: 'satiety', name: '饱食度', min: 0, max: 100, initial: 70, dailyDelta: -12 },
  { id: 'hydration', name: '水分', min: 0, max: 100, initial: 70, dailyDelta: -20 },
  {
    id: 'health',
    name: '健康',
    min: 0,
    max: 100,
    initial: 100,
    dailyDelta: 0,
    deathAtZero: true,
    deathText: '{self} 的健康归零，安静地倒在了庇护所的角落。',
  },
  { id: 'sanity', name: '理智', min: 0, max: 100, initial: 80, dailyDelta: -2 },
] satisfies StatDef[];
