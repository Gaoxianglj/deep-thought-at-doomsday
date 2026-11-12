import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Content } from '../../src/engine';
import { createSaveService, type SaveService } from '../../src/save';
import { makeContent, makeEnv } from '../fixtures/content';

function setup(content: Content = makeContent()): { svc: SaveService; idb: IDBFactory } {
  const idb = new IDBFactory();
  return { svc: createSaveService(content, { indexedDB: idb }), idb };
}

describe('档案', () => {
  it('增删改查与切换', async () => {
    const { svc } = setup();
    await svc.init();
    expect(await svc.listProfiles()).toEqual([]);

    const a = await svc.createProfile('  小明  ');
    expect(a.name).toBe('小明');
    expect(a.unlockedCharacters).toEqual(['alpha', 'beta']);
    expect(a.runsPlayed).toBe(0);
    const b = await svc.createProfile('这是一个超级超级超级超级超级超级长的名字啊啊啊啊');
    expect(b.name.length).toBeLessThanOrEqual(24);
    expect(b.id).not.toBe(a.id);

    expect((await svc.listProfiles()).map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(await svc.getProfile(a.id)).toEqual(a);
    expect(await svc.getProfile('nope')).toBeNull();

    await svc.updateProfile({ ...a, name: '改名', updatedAt: a.updatedAt + 10 });
    expect((await svc.getProfile(a.id))!.name).toBe('改名');

    expect(await svc.getLastProfileId()).toBeNull();
    await svc.setLastProfileId(a.id);
    expect(await svc.getLastProfileId()).toBe(a.id);
    await svc.setLastProfileId(b.id);
    expect(await svc.getLastProfileId()).toBe(b.id);

    await svc.saveRun(b.id, makeEnv().run);
    await svc.deleteProfile(b.id);
    expect(await svc.getProfile(b.id)).toBeNull();
    expect((await svc.loadRun(b.id)).run).toBeNull();
    expect(await svc.getLastProfileId()).toBeNull();
    expect((await svc.listProfiles()).map((p) => p.id)).toEqual([a.id]);

    await svc.setLastProfileId(a.id);
    await svc.setLastProfileId(null);
    expect(await svc.getLastProfileId()).toBeNull();
  });

  it('数据持久在同一个库里（新实例可读）', async () => {
    const { svc, idb } = setup();
    const p = await svc.createProfile('甲');
    await svc.saveRun(p.id, makeEnv().run);
    const svc2 = createSaveService(makeContent(), { indexedDB: idb });
    expect((await svc2.getProfile(p.id))!.name).toBe('甲');
    expect((await svc2.loadRun(p.id)).run).not.toBeNull();
  });
});

describe('对局', () => {
  it('saveRun 保存并并入解锁，loadRun 读回', async () => {
    const { svc } = setup();
    const p = await svc.createProfile('甲');
    const run = makeEnv().run;
    run.unlocked = ['alpha', 'beta', 'gamma'];
    const updated = await svc.saveRun(p.id, run);
    expect(updated.unlockedCharacters).toEqual(['alpha', 'beta', 'gamma']);
    expect((await svc.getProfile(p.id))!.unlockedCharacters).toContain('gamma');
    const loaded = await svc.loadRun(p.id);
    expect(loaded).toEqual({ run, notices: [] });
  });

  it('saveRun 对不存在的档案报错', async () => {
    const { svc } = setup();
    await expect(svc.saveRun('nope', makeEnv().run)).rejects.toThrow();
  });

  it('finishRun 记录结局、局数 +1、删除进行中的对局', async () => {
    const { svc } = setup();
    const p = await svc.createProfile('甲');
    const run = makeEnv().run;
    await svc.saveRun(p.id, run);
    run.ending = { id: 'wiped', day: 5 };
    run.phase = 'ended';
    run.unlocked = ['alpha', 'beta', 'gamma'];
    const after = await svc.finishRun(p.id, run);
    expect(after.endingsSeen).toEqual(['wiped']);
    expect(after.runsPlayed).toBe(1);
    expect(after.unlockedCharacters).toContain('gamma');
    expect((await svc.loadRun(p.id)).run).toBeNull();

    // 同一结局不重复记录
    const again = await svc.finishRun(p.id, run);
    expect(again.endingsSeen).toEqual(['wiped']);
    expect(again.runsPlayed).toBe(2);

    // 迟到的自动保存不会把已结束的对局写回来
    await svc.saveRun(p.id, run);
    expect((await svc.loadRun(p.id)).run).toBeNull();
  });

  it('abandonRun 删除对局但保留解锁', async () => {
    const { svc } = setup();
    const p = await svc.createProfile('甲');
    const run = makeEnv().run;
    run.unlocked = ['alpha', 'beta', 'gamma'];
    await svc.saveRun(p.id, run);
    await svc.abandonRun(p.id);
    expect((await svc.loadRun(p.id)).run).toBeNull();
    expect((await svc.getProfile(p.id))!.unlockedCharacters).toContain('gamma');
  });

  it('loadRun 执行失效引用修复；作废的对局被删除', async () => {
    const idb = new IDBFactory();
    const svc = createSaveService(makeContent(), { indexedDB: idb });
    const p = await svc.createProfile('甲');
    const run = makeEnv().run;
    run.inventory.ghost_item = 3;
    await svc.saveRun(p.id, run);

    const svc2 = createSaveService(
      makeContent((db) => {
        db.difficulties = db.difficulties.filter((d) => d.id !== 'normal');
      }),
      { indexedDB: idb },
    );
    const fixed = await svc.loadRun(p.id);
    expect(fixed.run!.inventory.ghost_item).toBeUndefined();
    const voided = await svc2.loadRun(p.id);
    expect(voided.run).toBeNull();
    expect(voided.notices[0]).toContain('难度');
    expect(await svc2.loadRun(p.id)).toEqual({ run: null, notices: [] });
    expect(await svc2.getProfile(p.id)).not.toBeNull();
  });

  it('库里存的对局版本过新时不读取', async () => {
    const idb = new IDBFactory();
    const newer = createSaveService(makeContent(), {
      indexedDB: idb,
      saveVersion: 2,
      migrations: { 1: (x) => x },
    });
    const p = await newer.createProfile('甲');
    await newer.saveRun(p.id, { ...makeEnv().run, v: 2 });
    const svc = createSaveService(makeContent(), { indexedDB: idb });
    const r = await svc.loadRun(p.id);
    expect(r.run).toBeNull();
    expect(r.notices[0]).toContain('更新');
  });
});
