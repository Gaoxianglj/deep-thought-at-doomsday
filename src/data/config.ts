import type { GameConfig } from '../engine/schema';

export const config = {
  rationTags: ['food', 'water'],
  logKeepDays: 7,
  fallbackEnding: 'wiped',
  tagNames: { food: '食物', water: '饮水', medicine: '药品', tool: '工具', part: '部件' },
  texts: {
    death: '{self} 倒下了，再也没能站起来。',
    statusEnter: '{self} 进入了「{status}」状态。',
    statusExit: '{self} 摆脱了「{status}」状态。',
    rationMissing: '{self} 想吃点东西，翻遍了仓库也没找到 {item}。',
    expeditionDepart: '{self} 背起包出发了，目的地：{location}。',
    expeditionReturn: '{self} 从 {location} 回来了，带回 {lootCount} 件东西。{loot}',
    expeditionInjured: '{self} 挂着彩从 {location} 爬了回来，带回 {lootCount} 件东西。{loot}',
    expeditionLost: '{self} 去了 {location}，然后就再也没有回来……',
    expeditionCancelled: '{self} 临出门才发现准备带的东西不见了，去 {location} 的计划只好作罢。',
    weatherChange: '天气变成了 {weather}。',
  },
} satisfies GameConfig;
