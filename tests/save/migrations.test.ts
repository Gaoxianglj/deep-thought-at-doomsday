import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../../src/engine';
import {
  createSaveService,
  migrateEnvelope,
  MigrationError,
  migrations,
  type MigrationTable,
} from '../../src/save';
import { makeContent, makeEnv } from '../fixtures/content';

describe('迁移', () => {
  it('当前版本的迁移表覆盖 1..SAVE_VERSION-1', () => {
    for (let v = 1; v < SAVE_VERSION; v++) expect(typeof migrations[v]).toBe('function');
  });

  it('当前版本原样通过', () => {
    const env = { format: 'dtad-save', version: SAVE_VERSION, run: null };
    expect(migrateEnvelope(env)).toEqual(env);
  });

  it('按顺序依次执行迁移链并更新版本号', () => {
    const calls: number[] = [];
    const table: MigrationTable = {
      1: (raw) => {
        calls.push(1);
        const r = raw as { run: { a: number } };
        return { ...r, run: { ...r.run, b: r.run.a + 1 } };
      },
      2: (raw) => {
        calls.push(2);
        const r = raw as { run: { b: number } };
        return { ...r, run: { ...r.run, c: r.run.b * 10 } };
      },
    };
    const out = migrateEnvelope({ version: 1, run: { a: 1, v: 1 } }, table, 3);
    expect(calls).toEqual([1, 2]);
    expect(out).toEqual({ version: 3, run: { a: 1, b: 2, c: 20, v: 3 } });

    calls.length = 0;
    expect(migrateEnvelope({ version: 2, run: { b: 5 } }, table, 3)).toEqual({
      version: 3,
      run: { b: 5, c: 50, v: 3 },
    });
    expect(calls).toEqual([2]);
  });

  it('版本过新、缺版本号、缺迁移步骤', () => {
    const kind = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof MigrationError ? e.kind : 'other';
      }
      return 'none';
    };
    expect(kind(() => migrateEnvelope({ version: 5 }, {}, 3))).toBe('tooNew');
    expect(kind(() => migrateEnvelope({}, {}, 3))).toBe('noVersion');
    expect(kind(() => migrateEnvelope({ version: 1 }, { 1: (x) => x }, 3))).toBe('missingStep');
  });

  it('导入与读取都会走迁移（注入假迁移）', async () => {
    const content = makeContent();
    const run = makeEnv().run;
    // 伪造一个"版本 1"的存档：物品字段叫 stock，迁移到版本 2 时改名为 inventory
    const legacyRun: Record<string, unknown> = { ...run, stock: run.inventory };
    delete legacyRun.inventory;
    const now = Date.now();
    const legacy = {
      format: 'dtad-save',
      version: 1,
      exportedAt: now,
      profile: {
        id: 'old',
        name: '老档',
        createdAt: now,
        updatedAt: now,
        unlockedCharacters: ['alpha'],
        endingsSeen: [],
        runsPlayed: 3,
        settings: {},
      },
      run: legacyRun,
    };
    const table: MigrationTable = {
      1: (raw) => {
        const r = raw as { run: Record<string, unknown> | null };
        if (!r.run) return r;
        const { stock, ...rest } = r.run;
        return { ...r, run: { ...rest, inventory: stock } };
      },
    };
    const svc = createSaveService(content, {
      indexedDB: new IDBFactory(),
      migrations: table,
      saveVersion: 2,
    });
    const res = await svc.importText(JSON.stringify(legacy));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const loaded = await svc.loadRun(res.profile.id);
    expect(loaded.run!.inventory).toEqual(run.inventory);
    expect(loaded.run!.v).toBe(2);

    // 不带迁移的旧版服务无法读新版（版本 2）导出
    const exported = await svc.exportJson(res.profile.id);
    const oldSvc = createSaveService(content, { indexedDB: new IDBFactory(), saveVersion: 1 });
    const r2 = await oldSvc.importText(exported);
    expect(r2.ok).toBe(false);
  });
});
