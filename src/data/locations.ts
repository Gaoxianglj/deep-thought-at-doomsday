import type { LocationDef } from '../engine/schema';

export const locations = [
  {
    id: 'convenience_store',
    name: '便利店',
    desc: '街角的 24 小时便利店，货架被扫荡过，但角落里总有漏网之鱼。',
    map: 'city_ruins',
    distance: 1,
    danger: 0.08,
    failSplit: { injured: 4, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 5 },
      { stat: 'health', of: 'self', add: -10 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'canned_food', weight: 5, min: 1, max: 2 },
      { item: 'bottled_water', weight: 5, min: 1, max: 2 },
      { item: 'biscuit', weight: 3, min: 1, max: 2 },
      { item: 'cold_medicine', weight: 1 },
      { item: 'playing_cards', weight: 1 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'flashlight' }, { at: 'convenience_store' }] },
        chance: 0.4,
        event: 'store_back_room',
      },
    ],
  },
  {
    id: 'pharmacy',
    name: '药房',
    desc: '白色十字已经褪成灰色，药柜里或许还有能用的东西。',
    map: 'city_ruins',
    distance: 2,
    danger: 0.18,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 5 },
      { stat: 'health', of: 'self', add: -15 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'medkit', weight: 4 },
      { item: 'cold_medicine', weight: 4, min: 1, max: 2 },
      { item: 'gas_mask', weight: 1 },
      { item: 'bottled_water', weight: 2 },
      { item: 'biscuit', weight: 1 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'gas_mask' }, { at: 'pharmacy' }] },
        chance: 0.5,
        event: 'pharmacy_vault',
      },
    ],
  },
  {
    id: 'hardware_market',
    name: '五金市场',
    desc: '迷宫一样的摊位，什么都有，什么都可能砸到你的头。',
    map: 'city_ruins',
    distance: 3,
    danger: 0.3,
    failSplit: { injured: 3, lost: 2 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 6 },
      { stat: 'health', of: 'self', add: -20 },
    ],
    lootRolls: 3,
    loot: [
      { item: 'crowbar', weight: 2 },
      { item: 'flashlight', weight: 2 },
      { item: 'door_lock', weight: 2 },
      { item: 'radio', weight: 1 },
      { item: 'map_book', weight: 1 },
      { item: 'generator_part', weight: 2 },
      { item: 'water_filter', weight: 2 },
      { item: 'seed_pack', weight: 2 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'crowbar' }, { at: 'hardware_market' }] },
        chance: 0.4,
        event: 'market_vault',
      },
    ],
  },
] satisfies LocationDef[];
