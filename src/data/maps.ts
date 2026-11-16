import type { MapDef, Rule } from '../engine/schema';

/** 自救设施：部件 → 设施 flag → 安装事件（拿到部件的清晨自动弹出安装事件） */
const INSTALLS = [
  ['generator_part', 'gen_installed', 'install_generator'],
  ['water_filter', 'filter_installed', 'install_filter'],
  ['seed_pack', 'seeds_installed', 'install_seeds'],
  ['vent_filter', 'vent_installed', 'install_vent'],
] as const;

const installRules: Rule[] = INSTALLS.map(([part, flag, event]) => ({
  id: `queue_${event}`,
  trigger: 'dayStart',
  when: { all: [{ hasItem: part }, { not: { flag } }] },
  effects: [{ queueEvent: event }],
}));

/** 线索线：按顺序外出到 trail_1 → trail_2 → trail_3，归来当天清晨弹出对应的记号事件 */
/** 到了对的地点也不一定能找到记号（找不到就得再去一趟） */
const TRAIL_FIND_CHANCE = 1;

const trailRules: Rule[] = [1, 2, 3].map((n) => ({
  id: `trail_found_${n}`,
  trigger: 'expeditionReturn',
  chance: TRAIL_FIND_CHANCE,
  when: { all: [{ flag: 'trail_step', eq: n }, { atFlag: `trail_${n}` }] },
  effects: [{ queueEvent: `trail_clue_${n}` }],
}));

/** 把"今天出过事"转成"昨天出过事"：必须写在同一条规则的 if/then/else 里，分两条会互相覆盖 */
const rollover = (flag: string): Rule => ({
  id: `${flag}_rollover`,
  trigger: 'dayStart',
  effects: [
    {
      if: { flag },
      then: [
        { setFlag: `${flag}_recent`, value: true },
        { setFlag: flag, value: false },
      ],
      else: [{ setFlag: `${flag}_recent`, value: false }],
    },
  ],
});

/**
 * 废墟越搜越空：第 12 天起每次外出少翻一件东西；第 22 天起翻到吃喝的机会再少四成。
 * 前期物资相对宽裕（车队等需要上交物资的路线在这时最好推进），中后期逼着玩家尽快离开。
 */
const depletionRules: Rule[] = [
  {
    id: 'depletion_fewer_finds',
    when: { day: { gte: 10 } },
    modifiers: [{ key: 'expedition.lootRolls', add: -1 }],
  },
  {
    id: 'depletion_less_rations',
    when: { day: { gte: 14 } },
    modifiers: [
      { key: 'expedition.lootWeight.food', mul: 0.6 },
      { key: 'expedition.lootWeight.water', mul: 0.6 },
    ],
  },
];

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
      'rice',
      'medkit',
      'cold_medicine',
      'crowbar',
      'flashlight',
      'radio',
      'door_lock',
      'gas_mask',
      'map_book',
      'playing_cards',
      'lighter',
      'duct_tape',
      'bug_spray',
      'rope',
    ],
    eventDailyChance: 0.6,
    diaryPerDay: 1,
    expedition: { carrySlots: 2 },
    rules: [
      rollover('incident'),
      rollover('rule_broken'),
      {
        id: 'mark_explored',
        trigger: 'expeditionReturn',
        effects: [{ setFlag: 'explored', value: true }],
      },
      {
        id: 'pick_evac_item',
        trigger: 'dayStart',
        when: { not: { flag: 'evac_item' } },
        effects: [
          {
            pickFlags: {
              flags: ['evac_item'],
              from: ['gas_mask', 'flare', 'flashlight', 'map_book', 'rope'],
            },
          },
        ],
      },
      ...trailRules,
      // 列车保底：trail_clue_3 会直接排队 underground_train（沿用外出者为 self，他若已不在世则排队失效），
      // 同时写 train_wait = 3；倒数到 0 的清晨若列车还没来，就不带角色地再排一次。
      {
        id: 'train_countdown',
        trigger: 'dayStart',
        when: { flag: 'train_wait', gte: 1 },
        effects: [
          { addFlag: 'train_wait', add: -1 },
          { if: { flag: 'train_wait', eq: 0 }, then: [{ queueEvent: 'underground_train' }] },
        ],
      },
      ...installRules,
      ...depletionRules,
    ],
  },
] satisfies MapDef[];
