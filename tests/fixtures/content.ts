/**
 * 引擎测试专用的夹具内容 —— 与 src/data 的正式内容无关，正式内容怎么换都不影响引擎测试。
 * 属性初始 50；food 每天 -10，water 每天 -20，hp 不变。
 */
import {
  buildContent,
  ContentDBSchema,
  newRun,
  type Content,
  type ContentDB,
  type RunState,
} from '../../src/engine';
import type { Env } from '../../src/engine';

export function makeDB(): ContentDB {
  return {
    config: {
      rationTags: ['food', 'water'],
      logKeepDays: 5,
      fallbackEnding: 'wiped',
      texts: {
        death: '{self} 死了。',
        statusEnter: '{self} 进入了 {status}。',
        expeditionDepart: '{self} 前往 {location}。',
      },
    },
    stats: [
      { id: 'food', name: '饱食', min: 0, max: 100, initial: 50, dailyDelta: -10 },
      { id: 'water', name: '水分', min: 0, max: 100, initial: 50, dailyDelta: -20 },
      { id: 'hp', name: '健康', min: 0, max: 100, initial: 50, dailyDelta: 0, deathAtZero: true },
    ],
    statuses: [
      {
        id: 'hungry',
        name: '饥饿',
        enterWhen: { stat: 'food', of: 'self', lt: 25 },
        exitWhen: { stat: 'food', of: 'self', gte: 25 },
        rules: [{ id: 'hungry_drain', modifiers: [{ key: 'stat.hp.dailyDelta', add: -10 }] }],
      },
      {
        id: 'sick',
        name: '生病',
        duration: 3,
        blocksExpedition: true,
        artState: 'sick',
        priority: 1,
      },
      {
        id: 'silly',
        name: '降智',
        artState: 'silly',
        priority: 5,
        exitWhen: { stat: 'food', of: 'self', gte: 30 },
        rules: [
          { id: 'silly_slow', modifiers: [{ key: 'stat.food.dailyDelta', mul: 0.5 }] },
          {
            id: 'silly_trouble',
            trigger: 'dayEnd',
            effects: [{ loseRandomItem: { tag: 'food' } }, { log: '{self} 偷吃了 {lost}。' }],
          },
        ],
      },
    ],
    items: [
      {
        id: 'can',
        name: '罐头',
        tags: ['food'],
        cost: 2,
        maxAtStart: 10,
        onUse: [{ stat: 'food', of: 'self', add: 40 }],
      },
      {
        id: 'bottle',
        name: '瓶装水',
        tags: ['water'],
        cost: 1,
        maxAtStart: 10,
        onUse: [{ stat: 'water', of: 'self', add: 40 }],
      },
      {
        id: 'medkit',
        name: '药箱',
        tags: ['medicine'],
        cost: 4,
        manualUse: true,
        onUse: [
          { removeStatus: 'sick', of: 'self' },
          { stat: 'hp', of: 'self', add: 20 },
        ],
      },
      { id: 'lock', name: '门锁', tags: ['tool'], cost: 3 },
      {
        id: 'spice',
        name: '调料',
        tags: ['tool'],
        cost: 1,
        rules: [{ id: 'spice_bonus', modifiers: [{ key: 'item.food.useEffect', mul: 1.5 }] }],
      },
    ],
    characters: [
      {
        id: 'alpha',
        name: '阿尔法',
        unlockedByDefault: true,
        traits: [
          {
            id: 'appetite',
            name: '胃口',
            rules: [
              {
                id: 'alpha_full',
                when: { stat: 'food', of: 'self', gte: 70 },
                modifiers: [{ key: 'status.sick.gainChance', mul: 0 }],
              },
              {
                id: 'alpha_silly',
                trigger: 'dayEnd',
                when: {
                  all: [
                    { stat: 'food', of: 'self', lt: 30 },
                    { not: { hasStatus: 'silly', of: 'self' } },
                  ],
                },
                effects: [{ addStatus: 'silly', of: 'self' }],
              },
            ],
          },
        ],
      },
      { id: 'beta', name: '贝塔', unlockedByDefault: true, traits: [] },
      { id: 'gamma', name: '伽马', traits: [] },
    ],
    difficulties: [
      { id: 'normal', name: '普通', points: 20 },
      {
        id: 'hard',
        name: '困难',
        points: 10,
        rules: [{ id: 'hard_thirst', modifiers: [{ key: 'stat.water.dailyDelta', mul: 1.5 }] }],
      },
    ],
    weathers: [],
    maps: [
      {
        id: 'bunker',
        name: '地堡',
        partySize: { min: 1, max: 3 },
        startingPool: ['can', 'bottle', 'medkit', 'lock', 'spice'],
        eventDailyChance: 0,
        diaryPerDay: 0,
        expedition: { carrySlots: 1 },
      },
    ],
    locations: [
      {
        id: 'shop',
        name: '商店',
        map: 'bunker',
        distance: 2,
        danger: 0.1,
        lootRolls: 2,
        loot: [{ item: 'can', weight: 1 }],
      },
    ],
    events: [
      {
        id: 'break_in',
        title: '破门',
        text: '有人撞门。',
        weight: 0,
        choices: [
          {
            id: 'hold',
            text: '顶住',
            outcomes: [
              {
                when: { hasItem: 'lock' },
                text: '门锁撑住了。',
                effects: [{ item: 'lock', add: -1 }],
              },
              {
                when: { not: { hasItem: 'lock' } },
                text: '被抢走了 {lost}。',
                effects: [{ loseRandomItem: {} }],
              },
            ],
          },
          {
            id: 'chop',
            text: '用药箱砸',
            requires: { hasItem: 'medkit' },
            requiresHint: '需要药箱',
            outcomes: [{ text: '赶跑了。' }],
          },
        ],
      },
      {
        id: 'knock',
        title: '敲门声',
        text: '门外有人。',
        weight: 0,
        when: { not: { inParty: 'gamma' } },
        choices: [
          {
            id: 'open',
            text: '开门',
            outcomes: [
              {
                text: '伽马加入了。',
                effects: [{ joinParty: 'gamma' }, { unlock: 'gamma' }],
                next: 'welcome',
              },
            ],
          },
          {
            id: 'ignore',
            text: '不理',
            outcomes: [{ text: '脚步声远去。', effects: [{ queueEvent: 'break_in', delay: 2 }] }],
          },
        ],
      },
      {
        id: 'welcome',
        title: '欢迎',
        text: '大家欢迎 {who}。',
        weight: 0,
        roles: { who: { is: 'gamma' } },
        choices: [{ id: 'ok', text: '好', outcomes: [{ text: '其乐融融。' }] }],
      },
      {
        id: 'fever',
        title: '发烧',
        text: '{self} 不舒服。',
        weight: 0,
        roles: { self: {} },
        choices: [
          {
            id: 'ok',
            text: '知道了',
            outcomes: [{ text: '{self} 病了？', effects: [{ addStatus: 'sick', of: 'self' }] }],
          },
        ],
      },
    ],
    diary: [
      { id: 'argue', text: '{a} 和 {b} 吵架了。', roles: { a: {}, b: {} } },
      {
        id: 'lively',
        text: '{a} 很有活力。',
        roles: { a: { where: { not: { hasStatus: 'hungry', of: 'self' } } } },
      },
    ],
    endings: [
      {
        id: 'wiped',
        name: '全灭',
        text: '没有人活下来。',
        kind: 'death',
        when: { partyAlive: { lte: 0 } },
      },
      {
        id: 'self_rescue',
        name: '自救',
        text: '庇护所运转起来了。',
        kind: 'selfRescue',
        when: { flag: 'generator' },
        priority: 10,
      },
    ],
  };
}

/** 夹具内容；mutate 可在建索引前修改数据。会先过一遍 schema 校验。 */
export function makeContent(mutate?: (db: ContentDB) => void): Content {
  const db = makeDB();
  mutate?.(db);
  return buildContent(ContentDBSchema.parse(db));
}

export function makeEnv(
  opts: {
    party?: string[];
    items?: Record<string, number>;
    seed?: string;
    difficultyId?: string;
  } = {},
  mutate?: (db: ContentDB) => void,
): Env {
  const content = makeContent(mutate);
  const run: RunState = newRun(content, {
    seed: opts.seed ?? 'test',
    mapId: 'bunker',
    difficultyId: opts.difficultyId ?? 'normal',
    party: opts.party ?? ['alpha', 'beta'],
    items: opts.items ?? {},
    unlocked: ['alpha', 'beta'],
  });
  return { run, content };
}
