import type { MapDef } from '../engine/schema';

export const maps = [
  {
    id: 'city_ruins',
    name: '城市废墟',
    desc: '曾经热闹的城市，如今只剩断壁残垣和满地的罐头盖子。',
    partySize: { min: 2, max: 3 },
    startingPool: [
      'canned_food',
      'bottled_water',
      'biscuit',
      'medkit',
      'cold_medicine',
      'crowbar',
      'flashlight',
      'radio',
      'door_lock',
      'gas_mask',
      'map_book',
      'playing_cards',
    ],
    eventDailyChance: 0.6,
    diaryPerDay: 1,
    expedition: { carrySlots: 2 },
  },
] satisfies MapDef[];
