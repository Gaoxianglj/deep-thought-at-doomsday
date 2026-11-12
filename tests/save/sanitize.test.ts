import { describe, expect, it } from 'vitest';
import type { ContentDB, RunState } from '../../src/engine';
import { sanitizeRun } from '../../src/save';
import { makeContent, makeEnv } from '../fixtures/content';

function baseRun(): RunState {
  return makeEnv({ items: { can: 2, bottle: 2, medkit: 1 } }).run;
}

function without(mutate: (db: ContentDB) => void) {
  return makeContent(mutate);
}

describe('sanitizeRun', () => {
  it('内容未变时原样返回且不修改输入', () => {
    const run = baseRun();
    const before = structuredClone(run);
    const r = sanitizeRun(run, makeContent());
    expect(r.notices).toEqual([]);
    expect(r.run).toEqual(run);
    expect(r.run).not.toBe(run);
    expect(run).toEqual(before);
  });

  it('未知物品从库存、配给、计划携带物中静默丢弃', () => {
    const run = baseRun();
    run.plan.rations = { alpha: { food: 'can', water: 'bottle' }, beta: { food: 'can' } };
    run.plan.expedition = { charId: 'alpha', locationId: 'shop', carry: ['can', 'medkit'] };
    const content = without((db) => {
      db.items = db.items.filter((i) => i.id !== 'can');
      db.locations[0].loot = [{ item: 'bottle', weight: 1 }];
      db.events = db.events.filter((e) => e.id !== 'break_in');
      db.events.find((e) => e.id === 'knock')!.choices[1].outcomes[0].effects = [];
    });
    const r = sanitizeRun(run, content);
    expect(r.notices).toEqual([]);
    expect(r.run!.inventory).toEqual({ bottle: 2, medkit: 1 });
    expect(r.run!.plan.rations).toEqual({ alpha: { water: 'bottle' }, beta: {} });
    expect(r.run!.plan.expedition!.carry).toEqual(['medkit']);
  });

  it('未知状态丢弃；未知属性键丢弃，缺失属性补初始值', () => {
    const run = baseRun();
    run.characters.alpha.statuses = [
      { id: 'sick', since: 1, daysLeft: 2 },
      { id: 'cursed', since: 1 },
    ];
    run.characters.alpha.stats = { food: 30, mana: 9 } as Record<string, number>;
    const content = without((db) => {
      db.characters.find((c) => c.id === 'alpha')!.stats = { hp: 77 };
    });
    const r = sanitizeRun(run, content);
    const a = r.run!.characters.alpha;
    expect(a.statuses.map((s) => s.id)).toEqual(['sick']);
    expect(a.stats).toEqual({ food: 30, water: 50, hp: 77 });
  });

  it('未知的待处理事件置空并回到计划阶段', () => {
    const run = baseRun();
    run.phase = 'event';
    run.pendingEvent = { eventId: 'vanished', roles: {} };
    const r = sanitizeRun(run, makeContent());
    expect(r.run!.pendingEvent).toBeNull();
    expect(r.run!.phase).toBe('plan');
    expect(r.notices.length).toBe(1);
  });

  it('待处理事件的结果引用了不存在的选项也按失效处理', () => {
    const run = baseRun();
    run.phase = 'event';
    run.pendingEvent = {
      eventId: 'knock',
      roles: {},
      result: { choiceId: 'kick', text: 'x' },
    };
    const r = sanitizeRun(run, makeContent());
    expect(r.run!.pendingEvent).toBeNull();
    expect(r.run!.phase).toBe('plan');

    const ok = baseRun();
    ok.phase = 'event';
    ok.pendingEvent = { eventId: 'knock', roles: {}, result: { choiceId: 'open', text: 'x' } };
    expect(sanitizeRun(ok, makeContent()).run!.pendingEvent).not.toBeNull();
  });

  it('队列里的未知事件被移除', () => {
    const run = baseRun();
    run.eventQueue = [
      { eventId: 'gone_event', day: 3, roles: {} },
      { eventId: 'break_in', day: 3, roles: {} },
    ];
    const r = sanitizeRun(run, makeContent());
    expect(r.run!.eventQueue.map((q) => q.eventId)).toEqual(['break_in']);
    expect(r.notices.length).toBe(1);
  });

  it('外出目的地失效：外出者回到庇护所并归还携带物', () => {
    const run = baseRun();
    run.characters.alpha.where = 'away';
    run.inventory.can = 1;
    run.expedition = { charId: 'alpha', locationId: 'mall', carry: ['can', 'ghost'], returnDay: 4 };
    const r = sanitizeRun(run, makeContent());
    expect(r.run!.expedition).toBeNull();
    expect(r.run!.characters.alpha.where).toBe('shelter');
    expect(r.run!.inventory.can).toBe(2);
    expect(r.notices.some((n) => n.includes('阿尔法'))).toBe(true);
  });

  it('外出目的地有效时保留，只去掉未知携带物', () => {
    const run = baseRun();
    run.characters.alpha.where = 'away';
    run.expedition = { charId: 'alpha', locationId: 'shop', carry: ['can', 'ghost'], returnDay: 4 };
    const r = sanitizeRun(run, makeContent());
    expect(r.run!.expedition).toEqual({
      charId: 'alpha',
      locationId: 'shop',
      carry: ['can'],
      returnDay: 4,
    });
    expect(r.run!.characters.alpha.where).toBe('away');
  });

  it('计划中的外出失效则删除', () => {
    const run = baseRun();
    run.plan.expedition = { charId: 'alpha', locationId: 'mall', carry: [] };
    expect(sanitizeRun(run, makeContent()).run!.plan.expedition).toBeUndefined();
  });

  it('未知角色从队伍与角色表移除；正在外出则外出置空', () => {
    const run = baseRun();
    run.characters.beta.where = 'away';
    run.expedition = { charId: 'beta', locationId: 'shop', carry: [], returnDay: 4 };
    run.plan.rations = { beta: { food: 'can' } };
    run.pendingEvent = { eventId: 'fever', roles: { self: 'beta' } };
    run.phase = 'event';
    const content = without((db) => {
      db.characters = db.characters.filter((c) => c.id !== 'beta');
    });
    const r = sanitizeRun(run, content);
    expect(r.run!.party).toEqual(['alpha']);
    expect(Object.keys(r.run!.characters)).toEqual(['alpha']);
    expect(r.run!.expedition).toBeNull();
    expect(r.run!.plan.rations).toEqual({});
    expect(r.run!.pendingEvent).toBeNull();
    expect(r.notices.some((n) => n.includes('角色'))).toBe(true);
  });

  it('地图或难度失效时对局作废', () => {
    const run = baseRun();
    const noDiff = without((db) => {
      db.difficulties = db.difficulties.filter((d) => d.id !== 'normal');
    });
    const r1 = sanitizeRun(run, noDiff);
    expect(r1.run).toBeNull();
    expect(r1.notices[0]).toContain('难度');

    const odd = structuredClone(run);
    odd.mapId = 'atlantis';
    const r2 = sanitizeRun(odd, makeContent());
    expect(r2.run).toBeNull();
    expect(r2.notices[0]).toContain('地图');
  });

  it('队伍里没有活人且未结束则作废；已结束则保留', () => {
    const run = baseRun();
    const content = without((db) => {
      db.characters = db.characters.filter((c) => c.id === 'gamma');
      db.events = db.events.filter((e) => e.id !== 'welcome');
    });
    expect(sanitizeRun(run, content).run).toBeNull();

    const dead = baseRun();
    dead.characters.alpha.where = 'dead';
    dead.characters.beta.where = 'gone';
    expect(sanitizeRun(dead, makeContent()).run).toBeNull();

    dead.ending = { id: 'wiped', day: 3 };
    dead.phase = 'ended';
    expect(sanitizeRun(dead, makeContent()).run).not.toBeNull();
  });
});
