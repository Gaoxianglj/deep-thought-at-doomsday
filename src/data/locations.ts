import type { LocationDef } from '../engine/schema';

/**
 * 城市废墟的 10 个外出地点（docs/DESIGN.md 12.5）。
 * 危险度：低 0.1–0.12、中 0.15–0.2、中高 0.24–0.26、高 0.3。
 * 四个自救部件各只在一个远处地点掉落（约占该表 12–25%），带对钥匙道具去时 55% 触发专属事件、必得部件。
 * 便利店后仓库、药房密封药柜、五金市场上锁仓库每局只能搜空一次（flag *_emptied / *_opened）。
 */
export const locations = [
  {
    id: 'convenience_store',
    name: '便利店',
    desc: '街角的 24 小时便利店，招牌只剩一个“便”字还亮着。货架被扫荡过，但角落里总有漏网之鱼。',
    map: 'city_ruins',
    distance: 1,
    danger: 0.12,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 4 },
      { stat: 'health', of: 'self', add: -10 },
    ],
    lootRolls: 3,
    loot: [
      { item: 'canned_food', weight: 2 },
      { item: 'bottled_water', weight: 5, min: 1, max: 2 },
      { item: 'biscuit', weight: 2.5, min: 1, max: 2 },
      { item: 'rice', weight: 1.5 },
      { item: 'cold_medicine', weight: 1 },
      { item: 'playing_cards', weight: 0.6 },
      { item: 'lighter', weight: 1 },
      { item: 'flare', weight: 0.3 },
    ],
    specials: [
      {
        when: {
          all: [
            { carrying: 'flashlight' },
            { at: 'convenience_store' },
            { not: { flag: 'back_room_emptied' } },
          ],
        },
        chance: 0.35,
        event: 'store_back_room',
      },
    ],
  },
  {
    id: 'residential_block',
    name: '居民楼',
    desc: '一栋十几层的居民楼，楼道里贴满了“寻人”和“换物”的纸条。挨家挨户翻，总能翻出点过日子的东西。',
    map: 'city_ruins',
    distance: 1,
    danger: 0.12,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 4 },
      { stat: 'health', of: 'self', add: -10 },
    ],
    lootRolls: 3,
    loot: [
      { item: 'canned_food', weight: 2 },
      { item: 'bottled_water', weight: 4, min: 1, max: 2 },
      { item: 'rice', weight: 2 },
      { item: 'biscuit', weight: 2 },
      { item: 'duct_tape', weight: 1.2 },
      { item: 'lighter', weight: 1 },
      { item: 'bug_spray', weight: 1 },
      { item: 'flare', weight: 0.6 },
      { item: 'gas_mask', weight: 0.5 },
    ],
  },
  {
    id: 'pharmacy',
    name: '药房',
    desc: '白色十字已经褪成灰色，玻璃门碎了一地。药柜里或许还有能用的东西，也可能有别的什么在等着。',
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
      { item: 'gas_mask', weight: 2 },
      { item: 'bug_spray', weight: 1.5 },
      { item: 'bottled_water', weight: 2 },
    ],
    specials: [
      {
        when: {
          all: [
            { carrying: 'gas_mask' },
            { at: 'pharmacy' },
            { not: { flag: 'pharmacy_vault_opened' } },
          ],
        },
        chance: 0.25,
        event: 'pharmacy_vault',
      },
    ],
  },
  {
    id: 'library',
    name: '图书馆',
    desc: '市图书馆的穹顶塌了一半，阳光照在成排的书架上。这里很安静，安静得让人想多待一会儿。',
    map: 'city_ruins',
    distance: 2,
    danger: 0.12,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 4 },
      { stat: 'health', of: 'self', add: -10 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'map_book', weight: 2 },
      { item: 'radio', weight: 0.8 },
      { item: 'biscuit', weight: 3, min: 1, max: 2 },
      { item: 'bottled_water', weight: 2 },
      { item: 'playing_cards', weight: 0.8 },
      { item: 'duct_tape', weight: 1 },
    ],
  },
  {
    id: 'subway_station',
    name: '地铁站',
    desc: '下行的扶梯停在半截，站台深处吹来潮湿的风。通风竖井的格栅后面，隐约能看见一排排工业滤网。',
    map: 'city_ruins',
    distance: 2,
    danger: 0.24,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 5 },
      { stat: 'health', of: 'self', add: -15 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'rope', weight: 3 },
      { item: 'flashlight', weight: 2 },
      { item: 'bottled_water', weight: 4, min: 1, max: 2 },
      { item: 'biscuit', weight: 2 },
      { item: 'flare', weight: 1 },
      { item: 'vent_filter', weight: 1.5 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'rope' }, { at: 'subway_station' }] },
        chance: 0.55,
        event: 'subway_shaft',
      },
    ],
  },
  {
    id: 'police_station',
    name: '警察局',
    desc: '门口的警车被掀翻在台阶上，大厅里的公告栏还贴着最后一次紧急通知。证物室和装备间的门都歪着。',
    map: 'city_ruins',
    distance: 2,
    danger: 0.3,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 6 },
      { stat: 'health', of: 'self', add: -18 },
    ],
    lootRolls: 3,
    loot: [
      { item: 'flare', weight: 2 },
      { item: 'door_lock', weight: 2 },
      { item: 'medkit', weight: 2 },
      { item: 'gas_mask', weight: 1 },
      { item: 'crowbar', weight: 1.5 },
      { item: 'canned_food', weight: 2 },
    ],
  },
  {
    id: 'hardware_market',
    name: '五金市场',
    desc: '迷宫一样的摊位，什么都有，什么都可能砸到你的头。最里面有一排被铁链锁住的仓库。',
    map: 'city_ruins',
    distance: 3,
    danger: 0.3,
    failSplit: { injured: 3, lost: 1 },
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
      { item: 'duct_tape', weight: 2 },
      { item: 'rope', weight: 1.5 },
      { item: 'flare', weight: 1.5 },
    ],
    specials: [
      {
        when: {
          all: [
            { carrying: 'crowbar' },
            { at: 'hardware_market' },
            { not: { flag: 'market_vault_opened' } },
          ],
        },
        chance: 0.4,
        event: 'market_vault',
      },
    ],
  },
  {
    id: 'substation',
    name: '变电站',
    desc: '高压线垂在地上，像一条条死掉的黑蛇。配电室的铁门后面一片漆黑，备用发电机的零件就锁在里头。',
    map: 'city_ruins',
    distance: 3,
    danger: 0.26,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 6 },
      { stat: 'health', of: 'self', add: -20 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'duct_tape', weight: 3 },
      { item: 'flashlight', weight: 2 },
      { item: 'bottled_water', weight: 2 },
      { item: 'canned_food', weight: 1.5 },
      { item: 'generator_part', weight: 2.5 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'flashlight' }, { at: 'substation' }] },
        chance: 0.55,
        event: 'substation_room',
      },
    ],
  },
  {
    id: 'water_plant',
    name: '自来水厂',
    desc: '沉淀池的水面上漂着一层绿膜，空气里有股刺鼻的氯味。过滤车间的门上画着骷髅头。',
    map: 'city_ruins',
    distance: 3,
    danger: 0.25,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 6 },
      { stat: 'health', of: 'self', add: -18 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'bottled_water', weight: 5, min: 1, max: 2 },
      { item: 'gas_mask', weight: 1.5 },
      { item: 'duct_tape', weight: 1 },
      { item: 'water_filter', weight: 3 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'gas_mask' }, { at: 'water_plant' }] },
        chance: 0.55,
        event: 'filter_workshop',
      },
    ],
  },
  {
    id: 'greenhouse',
    name: '植物园温室',
    desc: '玻璃穹顶碎了大半，里面的植物却疯长成了一片丛林。嗡嗡声从育苗室的方向传来，听着就不太友好。',
    map: 'city_ruins',
    distance: 3,
    danger: 0.26,
    failSplit: { injured: 3, lost: 1 },
    injury: [
      { addStatus: 'injured', of: 'self', duration: 5 },
      { stat: 'health', of: 'self', add: -15 },
    ],
    lootRolls: 2,
    loot: [
      { item: 'canned_food', weight: 2 },
      { item: 'rice', weight: 2 },
      { item: 'biscuit', weight: 2 },
      { item: 'bug_spray', weight: 2 },
      { item: 'bottled_water', weight: 2 },
      { item: 'seed_pack', weight: 1.5 },
    ],
    specials: [
      {
        when: { all: [{ carrying: 'bug_spray' }, { at: 'greenhouse' }] },
        chance: 0.55,
        event: 'seedling_room',
      },
    ],
  },
] satisfies LocationDef[];
