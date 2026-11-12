import { describe, expect, it } from 'vitest';
import {
  applyAction,
  type Action,
  type ContentDB,
  type Env,
  type LocationDef,
  type RunState,
} from '../../src/engine';
import { changeItem } from '../../src/engine/context';
import { resolveReturn } from '../../src/engine/expedition';
import { makeEnv } from '../fixtures/content';

const TEXTS = {
  expeditionReturn: '{self} 从 {location} 平安归来，带回 {loot}（{lootCount}）。',
  expeditionInjured: '{self} 从 {location} 负伤归来，带回 {loot}（{lootCount}）。',
  expeditionLost: '{self} 没能从 {location} 回来。',
};

/** 用一个测试专用地点替换夹具中的 shop，并补上外出日志文案 */
function withLoc(loc: Partial<LocationDef>, extra?: (db: ContentDB) => void) {
  return (db: ContentDB) => {
    Object.assign(db.config.texts, TEXTS);
    db.locations = [
      {
        id: 'shop',
        name: '商店',
        map: 'bunker',
        distance: 1,
        danger: 0,
        lootRolls: 2,
        loot: [{ item: 'can', weight: 1 }],
        ...loc,
      },
    ];
    extra?.(db);
  };
}

/** 直接把角色派出去并在当天清晨结算（绕过日循环，便于逐项断言） */
function goAndReturn(env: Env, charId = 'alpha', carry: string[] = []): void {
  for (const id of carry) changeItem(env.run, id, -1);
  env.run.characters[charId].where = 'away';
  env.run.expedition = { charId, locationId: 'shop', carry, returnDay: env.run.day };
  resolveReturn(env);
}

function play(env: Env, ...actions: Action[]): RunState {
  for (const a of actions) {
    const r = applyAction(env.run, a, env.content);
    expect(r.error, JSON.stringify(a)).toBeUndefined();
    env.run = r.state;
  }
  return env.run;
}

const expLogs = (env: Env) => env.run.log.filter((l) => l.kind === 'expedition').map((l) => l.text);

describe('外出返回结算', () => {
  it('danger=0 必定平安：归还携带物、带回战利品、写日志、计数', () => {
    const env = makeEnv(
      { items: { lock: 1 } },
      withLoc({
        loot: [
          { item: 'can', weight: 1, min: 2, max: 2 },
          { item: 'nope', weight: 100 },
        ],
      }),
    );
    goAndReturn(env, 'alpha', ['lock']);
    expect(env.run.characters.alpha.where).toBe('shelter');
    expect(env.run.expedition).toBeNull();
    expect(env.run.inventory).toEqual({ lock: 1, can: 4 });
    expect(expLogs(env)).toEqual(['阿尔法 从 商店 平安归来，带回 罐头×4（4）。']);
    expect(env.run.counters.expeditionsReturned).toBe(1);
    expect(env.run.counters.expeditionsLost).toBeUndefined();
  });

  it('多种物品合并同类项；没有战利品时 {loot} 为空', () => {
    const env = makeEnv(
      {},
      withLoc({
        lootRolls: 6,
        loot: [
          { item: 'can', weight: 1 },
          { item: 'bottle', weight: 1 },
        ],
      }),
    );
    goAndReturn(env);
    const total = (env.run.inventory.can ?? 0) + (env.run.inventory.bottle ?? 0);
    expect(total).toBe(6);
    expect(expLogs(env)[0]).toMatch(/带回 (罐头|瓶装水)×\d(、(罐头|瓶装水)×\d)?（6）/);

    const empty = makeEnv({}, withLoc({ lootRolls: 0 }));
    goAndReturn(empty);
    expect(empty.run.inventory).toEqual({});
    expect(expLogs(empty)).toEqual(['阿尔法 从 商店 平安归来，带回 （0）。']);
  });

  it('lootRolls 修正：特性 +1 只对拥有者生效', () => {
    const mutate = withLoc({ lootRolls: 2 }, (db) => {
      db.characters
        .find((c) => c.id === 'beta')!
        .traits.push({
          id: 'scavenger',
          name: '拾荒者',
          rules: [{ id: 'scav', modifiers: [{ key: 'expedition.lootRolls', add: 1 }] }],
        });
    });
    const a = makeEnv({}, mutate);
    goAndReturn(a, 'alpha');
    expect(a.run.inventory.can).toBe(2);
    const b = makeEnv({}, mutate);
    goAndReturn(b, 'beta');
    expect(b.run.inventory.can).toBe(3);
  });

  it('lootWeight 修正：权重乘 0 的标签抽不到', () => {
    const mutate = withLoc(
      {
        lootRolls: 10,
        loot: [
          { item: 'can', weight: 1 },
          { item: 'bottle', weight: 1 },
        ],
      },
      (db) => {
        db.items.find((i) => i.id === 'lock')!.rules = [
          { id: 'no_water', modifiers: [{ key: 'expedition.lootWeight.water', mul: 0 }] },
        ];
      },
    );
    const env = makeEnv({ items: { lock: 1 } }, mutate);
    goAndReturn(env);
    expect(env.run.inventory).toEqual({ lock: 1, can: 10 });
  });

  it('受伤返回：执行 injury、战利品次数减半、日志用 expeditionInjured', () => {
    const mutate = withLoc({
      danger: 1,
      failSplit: { injured: 1, lost: 0 },
      lootRolls: 5,
      injury: [{ stat: 'hp', of: 'self', add: -20 }],
    });
    let injured = 0;
    let safe = 0;
    for (let i = 0; i < 60; i++) {
      const env = makeEnv({ seed: `inj${i}` }, mutate);
      goAndReturn(env);
      const ch = env.run.characters.alpha;
      expect(ch.where).toBe('shelter');
      if (expLogs(env)[0].includes('负伤')) {
        injured++;
        expect(ch.stats.hp).toBe(30);
        expect(env.run.inventory.can).toBe(2); // floor(5 / 2)
      } else {
        safe++; // danger 被钳到 0.95，偶尔平安
        expect(ch.stats.hp).toBe(50);
        expect(env.run.inventory.can).toBe(5);
      }
      expect(env.run.counters.expeditionsReturned).toBe(1);
    }
    expect(injured).toBeGreaterThan(45);
    expect(injured + safe).toBe(60);
  });

  it('受伤致死：仍保留带回的物品，但不再触发 specials', () => {
    const mutate = withLoc({
      danger: 1,
      failSplit: { injured: 1, lost: 0 },
      injury: [{ stat: 'hp', of: 'self', add: -100 }],
      specials: [{ chance: 1, event: 'fever' }],
    });
    let checked = 0;
    for (let i = 0; i < 10; i++) {
      const env = makeEnv({ seed: `die${i}`, items: { lock: 1 } }, mutate);
      goAndReturn(env, 'alpha', ['lock']);
      if (!expLogs(env)[0].includes('负伤')) continue;
      checked++;
      expect(env.run.characters.alpha.where).toBe('dead');
      expect(env.run.inventory).toEqual({ lock: 1, can: 1 });
      expect(env.run.eventQueue).toEqual([]);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('未能返回：携带物丢失、where=gone、无战利品、计数', () => {
    const mutate = withLoc({
      danger: 1,
      failSplit: { injured: 0, lost: 1 },
      specials: [{ chance: 1, event: 'fever' }],
    });
    let lost = 0;
    for (let i = 0; i < 40; i++) {
      const env = makeEnv({ seed: `lost${i}`, items: { lock: 1 } }, mutate);
      goAndReturn(env, 'alpha', ['lock']);
      const ch = env.run.characters.alpha;
      if (ch.where === 'shelter') continue; // 5% 平安
      lost++;
      expect(ch.where).toBe('gone');
      expect(env.run.inventory).toEqual({});
      expect(env.run.expedition).toBeNull();
      expect(env.run.eventQueue).toEqual([]);
      expect(expLogs(env)).toEqual(['阿尔法 没能从 商店 回来。']);
      expect(env.run.counters.expeditionsLost).toBe(1);
      expect(env.run.counters.expeditionsReturned).toBeUndefined();
    }
    expect(lost).toBeGreaterThan(30);
  });

  it('缺省 failSplit 时受伤与失踪都会出现', () => {
    const mutate = withLoc({ danger: 1 });
    const seen = { shelter: 0, gone: 0 };
    for (let i = 0; i < 100; i++) {
      const env = makeEnv({ seed: `split${i}` }, mutate);
      goAndReturn(env);
      const w = env.run.characters.alpha.where;
      if (w === 'shelter' || w === 'gone') seen[w]++;
    }
    expect(seen.shelter).toBeGreaterThan(25);
    expect(seen.gone).toBeGreaterThan(25);
  });

  it('expedition.danger 修正可把风险压到 0', () => {
    const mutate = withLoc({ danger: 1 }, (db) => {
      db.items.find((i) => i.id === 'lock')!.rules = [
        { id: 'safe', modifiers: [{ key: 'expedition.danger', mul: 0 }] },
      ];
    });
    for (let i = 0; i < 20; i++) {
      const env = makeEnv({ seed: `d${i}`, items: { lock: 1 } }, mutate);
      goAndReturn(env);
      expect(env.run.characters.alpha.where).toBe('shelter');
    }
  });

  it('全员失踪进入结局', () => {
    // 风险被钳到 0.95：换几个种子直到失踪
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      const e = makeEnv(
        { party: ['alpha'], items: { lock: 1 }, seed: `end${i}` },
        withLoc({ danger: 1, failSplit: { injured: 0, lost: 1 } }),
      );
      play(
        e,
        { type: 'planExpedition', charId: 'alpha', locationId: 'shop', carry: ['lock'] },
        { type: 'endDay' },
      );
      // distance 1：当晚出发，次日清晨即结算
      if (e.run.phase !== 'ended') continue;
      found = true;
      expect(e.run.day).toBe(2);
      expect(e.run.characters.alpha.where).toBe('gone');
      expect(e.run.ending).toEqual({ id: 'wiped', day: 2 });
      expect(e.run.inventory).toEqual({});
    }
    expect(found).toBe(true);
  });

  it('specials：需要携带特定道具才触发，当天清晨成为 pendingEvent 且 self 为外出者', () => {
    const mutate = withLoc({
      specials: [
        { when: { carrying: 'medkit' }, chance: 1, event: 'missing_event' },
        { when: { all: [{ carrying: 'lock' }, { at: 'shop' }] }, chance: 1, event: 'fever' },
        { chance: 1, event: 'knock' },
      ],
    });
    const env = makeEnv({ items: { lock: 1, medkit: 1 } }, mutate);
    play(
      env,
      { type: 'planExpedition', charId: 'beta', locationId: 'shop', carry: ['lock'] },
      { type: 'endDay' },
    );
    expect(env.run.day).toBe(2);
    expect(env.run.characters.beta.where).toBe('shelter');
    expect(env.run.pendingEvent).toMatchObject({ eventId: 'fever', roles: { self: 'beta' } });
    expect(env.run.eventQueue).toEqual([]); // 每次最多一条

    // 不带门锁：fever 不触发，落到无条件的 knock
    const other = makeEnv({ items: { lock: 1 } }, mutate);
    play(
      other,
      { type: 'planExpedition', charId: 'beta', locationId: 'shop', carry: [] },
      { type: 'endDay' },
    );
    expect(other.run.pendingEvent?.eventId).toBe('knock');

    // 只有带道具才触发的 special：不带时什么都没有
    const none = makeEnv(
      {},
      withLoc({ specials: [{ when: { carrying: 'lock' }, chance: 1, event: 'fever' }] }),
    );
    goAndReturn(none);
    expect(none.run.eventQueue).toEqual([]);
  });

  it('同种子结果可复现', () => {
    const mutate = withLoc({
      danger: 0.5,
      lootRolls: 4,
      loot: [
        { item: 'can', weight: 2, min: 1, max: 3 },
        { item: 'bottle', weight: 1, min: 1, max: 2 },
      ],
      injury: [{ stat: 'hp', of: 'self', add: -10 }],
    });
    for (const seed of ['r1', 'r2', 'r3']) {
      const a = makeEnv({ seed, items: { lock: 1 } }, mutate);
      const b = makeEnv({ seed, items: { lock: 1 } }, mutate);
      goAndReturn(a, 'alpha', ['lock']);
      goAndReturn(b, 'alpha', ['lock']);
      expect(a.run).toEqual(b.run);
    }
  });
});
