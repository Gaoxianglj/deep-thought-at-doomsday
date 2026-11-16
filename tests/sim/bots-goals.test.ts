import { describe, expect, it } from 'vitest';
import { applyAction, type Action, type ContentDB, type Env } from '../../src/engine';
import { makePolicyBot, sensibleBot, turtleBot, type Bot } from '../../src/sim/bots';
import { makeRng } from '../../src/sim/simulate';
import { makeEnv } from '../fixtures/content';

/** 让 bot 在计划阶段一直行动，直到它安排外出（返回该动作）或结束这一天（返回 null） */
function firstExpedition(env: Env, bot: Bot): Extract<Action, { type: 'planExpedition' }> | null {
  const rng = makeRng('goal-test');
  const mem = {};
  for (let i = 0; i < 30; i++) {
    const action = bot.act(env, rng, mem);
    if (action.type === 'planExpedition') return action;
    if (action.type === 'endDay') return null;
    const res = applyAction(env.run, action, env.content);
    expect(res.error).toBeUndefined();
    env.run = res.state;
  }
  throw new Error('bot 没有结束计划');
}

/** 近处的 shop（默认会先去）+ 远处的 mall；地图在外出归来时检查"是不是去了 trail_1 记的地点" */
function trailDB(db: ContentDB): void {
  db.locations[0].distance = 1;
  db.locations.push({
    id: 'mall',
    name: '商场',
    map: 'bunker',
    distance: 3,
    danger: 0.2,
    lootRolls: 1,
    loot: [{ item: 'can', weight: 1 }],
  });
  db.maps[0].startingFlags = { trail_1: 'mall' };
  db.maps[0].rules = [
    // 通用规则：任何外出归来都触发 —— 不能让每个地点都变成"目标"
    {
      id: 'explored',
      trigger: 'expeditionReturn',
      effects: [{ setFlag: 'explored', value: true }],
    },
    {
      id: 'trail_check',
      trigger: 'expeditionReturn',
      when: { all: [{ atFlag: 'trail_1' }, { not: { flag: 'trail_found' } }] },
      effects: [{ setFlag: 'trail_found', value: true }],
    },
  ];
}

/** 远处的 vault_site：带着门锁去才可能触发专属事件，事件给部件，部件让"安装"事件入池 */
function vaultDB(db: ContentDB): void {
  db.locations[0].distance = 1;
  db.items.push({ id: 'gen_part', name: '零件', tags: ['part'] });
  db.locations.push({
    id: 'vault_site',
    name: '金库',
    map: 'bunker',
    distance: 3,
    danger: 0.2,
    lootRolls: 1,
    loot: [{ item: 'can', weight: 1 }],
    specials: [{ when: { carrying: 'lock' }, chance: 0.5, event: 'vault' }],
  });
  db.events.push(
    {
      id: 'vault',
      title: '金库',
      text: '找到了零件。',
      weight: 0,
      choices: [
        {
          id: 'take',
          text: '拿走',
          outcomes: [{ text: '拿到了。', effects: [{ item: 'gen_part', add: 1 }] }],
        },
      ],
    },
    {
      id: 'install',
      title: '安装',
      text: '装上零件。',
      when: { all: [{ hasItem: 'gen_part' }, { not: { flag: 'generator' } }] },
      choices: [
        {
          id: 'ok',
          text: '装',
          outcomes: [
            {
              text: '装好了。',
              effects: [
                { item: 'gen_part', add: -1 },
                { setFlag: 'generator', value: true },
              ],
            },
          ],
        },
      ],
    },
  );
}

const plenty = { can: 10, bottle: 10, lock: 1 };

/** 开局点数有限，库存直接写进状态（不走开局购买） */
function stocked(stock: Record<string, number>, mutate: (db: ContentDB) => void): Env {
  const e = makeEnv({}, mutate);
  e.run.inventory = { ...stock };
  return e;
}

describe('目的地评估：去"会触发东西"的地方', () => {
  it('外出归来时的全局规则命中某地点 → 去那里（而不是默认的近处）', () => {
    const plan = firstExpedition(stocked(plenty, trailDB), sensibleBot);
    expect(plan?.locationId).toBe('mall');
  });

  it('goalWeight=0 时保持原来的探索顺序；任何外出都触发的通用规则不算目标', () => {
    const noGoal = makePolicyBot('x', { goalWeight: 0 });
    expect(firstExpedition(stocked(plenty, trailDB), noGoal)?.locationId).toBe('shop');
    const env = stocked(plenty, trailDB);
    env.run.flags.trail_found = true; // 记号已找到：只剩通用规则
    expect(firstExpedition(env, sensibleBot)?.locationId).toBe('shop');
  });

  it('龟缩型平时不出门，但有目标时会出门', () => {
    expect(firstExpedition(stocked(plenty, trailDB), turtleBot)?.locationId).toBe('mall');
    const env = stocked(plenty, trailDB);
    env.run.flags.trail_found = true;
    expect(firstExpedition(env, turtleBot)).toBeNull();
  });

  it('地点专属事件：带上对的钥匙道具去，且事件给的东西能解锁新内容', () => {
    const plan = firstExpedition(stocked(plenty, vaultDB), sensibleBot);
    expect(plan?.locationId).toBe('vault_site');
    expect(plan?.carry).toEqual(['lock']);
  });

  it('专属事件给的东西已经没用了（设施已装好）→ 不再当作目标', () => {
    const env = stocked(plenty, vaultDB);
    env.run.flags.generator = true;
    expect(firstExpedition(env, sensibleBot)?.locationId).toBe('shop');
  });

  it('评估不改动真实对局状态（含随机数）', () => {
    const env = stocked(plenty, (db) => {
      vaultDB(db);
      db.locations[1].specials![0].when = { all: [{ carrying: 'lock' }, { chance: 0.5 }] };
    });
    const before = structuredClone(env.run);
    sensibleBot.act(env, makeRng('x'), {});
    expect(env.run).toEqual(before);
  });
});

/** 车队式上交：每次交 2 份水，交齐（water_left 归零）即触发获救结局 */
function caravanDB(db: ContentDB): void {
  db.endings.push({ id: 'convoy', name: '车队', text: '走了。', kind: 'rescue' });
  db.events.push({
    id: 'caravan',
    title: '车队',
    text: '车队要水。',
    weight: 0,
    choices: [
      {
        id: 'give',
        text: '交 2 份水',
        outcomes: [
          {
            text: '交了。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 2 } },
              { addFlag: 'water_left', add: -2 },
              { if: { flag: 'water_left', lte: 0 }, then: [{ ending: 'convoy' }] },
            ],
          },
        ],
      },
      { id: 'refuse', text: '先不交', outcomes: [{ text: '车队走了。' }] },
    ],
  });
}

function caravanChoice(bottles: number, waterLeft: number): string | undefined {
  const env = stocked({ can: 10, bottle: bottles }, caravanDB);
  env.run.flags.water_left = waterLeft;
  env.run.phase = 'event';
  env.run.pendingEvent = { eventId: 'caravan', roles: {} };
  const action = sensibleBot.act(env, makeRng('c'), {});
  return action.type === 'chooseEventOption' ? action.choiceId : undefined;
}

describe('上交物资的打分', () => {
  it('物资宽裕就上交', () => {
    expect(caravanChoice(20, 6)).toBe('give');
  });

  it('物资紧张就先不交', () => {
    expect(caravanChoice(3, 6)).toBe('refuse');
  });

  it('最后一批能直接触发结局时，紧张也交', () => {
    expect(caravanChoice(3, 2)).toBe('give');
  });
});
