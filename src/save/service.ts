/**
 * SaveService 的 IndexedDB 实现。库 dtad：profiles（键 = 档案 id）、runs（键 = 档案 id）、meta。
 * 读取/导入流程：解码 → 迁移 → zod 校验 → sanitize。
 */
import type { Content } from '../engine/content';
import { RunStateSchema, SAVE_VERSION, type RunState } from '../engine/schema';
import { encodeSaveCode, MSG, parseSaveText, SaveError } from './codec';
import { openDb, reqToPromise, tx } from './db';
import {
  envelopeVersion,
  migrateEnvelope,
  MigrationError,
  type MigrationTable,
} from './migrations';
import { sanitizeRun } from './sanitize';
import {
  ProfileSchema,
  SaveEnvelopeSchema,
  type ImportResult,
  type LoadedRun,
  type Profile,
  type SaveEnvelope,
  type SaveService,
} from './types';
import { zodErrorToChinese } from './zod-message';

export interface SaveServiceOptions {
  dbName?: string;
  indexedDB?: IDBFactory;
  /** 测试用：替换迁移表与目标版本 */
  migrations?: MigrationTable;
  saveVersion?: number;
}

interface RunRecord {
  version: number;
  run: unknown;
}

const NAME_MAX = 24;
const LAST_PROFILE_KEY = 'lastProfileId';

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // 非安全上下文
    }
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function cleanName(name: string): string {
  const n = name.trim().slice(0, NAME_MAX);
  return n || '幸存者';
}

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const cand = base.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!taken.has(cand)) return cand;
  }
}

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function createSaveService(content: Content, opts: SaveServiceOptions = {}): SaveService {
  const dbName = opts.dbName ?? 'dtad';
  const table = opts.migrations;
  const target = opts.saveVersion ?? SAVE_VERSION;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    if (!dbPromise) {
      const factory = opts.indexedDB ?? globalThis.indexedDB;
      if (!factory) return Promise.reject(new Error('IndexedDB 不可用'));
      dbPromise = openDb(factory, dbName);
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function readProfile(t: IDBTransaction, id: string): Promise<Profile | null> {
    const raw: unknown = await reqToPromise(t.objectStore('profiles').get(id));
    const p = ProfileSchema.safeParse(raw);
    return p.success ? p.data : null;
  }

  async function allProfiles(t: IDBTransaction): Promise<Profile[]> {
    const raws: unknown[] = await reqToPromise(t.objectStore('profiles').getAll());
    const out: Profile[] = [];
    for (const r of raws) {
      const p = ProfileSchema.safeParse(r);
      if (p.success) out.push(p.data);
    }
    return out;
  }

  function mustProfile(p: Profile | null, id: string): Profile {
    if (!p) throw new Error(`档案不存在：${id}`);
    return p;
  }

  /** 迁移 + 校验 + sanitize。raw 为信封形状的原始数据。 */
  function upgradeEnvelope(
    raw: unknown,
  ): { ok: true; env: SaveEnvelope; notices: string[] } | { ok: false; error: string } {
    let migrated: unknown;
    try {
      migrated = migrateEnvelope(raw, table, target);
    } catch (e) {
      if (e instanceof MigrationError) {
        if (e.kind === 'tooNew') {
          return {
            ok: false,
            error: `这个存档来自更新版本的游戏（存档版本 ${e.version}），请先更新游戏再导入。`,
          };
        }
        if (e.kind === 'noVersion') return { ok: false, error: '存档内容已损坏（缺少版本号）。' };
        return { ok: false, error: '这个存档版本太旧，当前游戏无法升级它。' };
      }
      return { ok: false, error: '存档升级失败，内容可能已损坏。' };
    }
    const parsed = SaveEnvelopeSchema.safeParse(migrated);
    if (!parsed.success) return { ok: false, error: zodErrorToChinese(parsed.error) };
    const env = parsed.data;
    const notices: string[] = [];
    if (env.run) {
      const s = sanitizeRun(env.run, content);
      notices.push(...s.notices);
      env.run = s.run;
    }
    return { ok: true, env, notices };
  }

  async function loadRunInternal(profileId: string): Promise<LoadedRun> {
    const d = await db();
    const { profile, rec } = await tx(d, ['profiles', 'runs'], 'readonly', async (t) => ({
      profile: (await reqToPromise(t.objectStore('profiles').get(profileId))) as unknown,
      rec: (await reqToPromise(t.objectStore('runs').get(profileId))) as RunRecord | undefined,
    }));
    if (!rec) return { run: null, notices: [] };
    const version = typeof rec.version === 'number' ? rec.version : target;
    if (version > target) {
      return { run: null, notices: ['这局存档来自更新版本的游戏，请先更新游戏再继续。'] };
    }
    let migrated: unknown;
    try {
      migrated = migrateEnvelope(
        { format: 'dtad-save', version, exportedAt: 0, profile, run: rec.run },
        table,
        target,
      );
    } catch {
      return { run: null, notices: ['进行中的对局无法升级到当前版本，已无法继续。'] };
    }
    const runRaw = isRecord(migrated) ? migrated.run : undefined;
    const parsed = RunStateSchema.safeParse(runRaw);
    if (!parsed.success) {
      return { run: null, notices: ['进行中的对局数据已损坏，无法继续（档案和解锁已保留）。'] };
    }
    const s = sanitizeRun(parsed.data, content);
    if (!s.run) {
      // 对局已作废：删除，避免每次启动都提示
      await tx(d, ['runs'], 'readwrite', async (t) => {
        await reqToPromise(t.objectStore('runs').delete(profileId));
      });
    }
    return s;
  }

  const service: SaveService = {
    async init() {
      await db();
      try {
        const storage = (globalThis.navigator as Navigator | undefined)?.storage;
        await storage?.persist?.();
      } catch {
        // 申请持久化失败不影响游戏
      }
    },

    async listProfiles() {
      const d = await db();
      const list = await tx(d, ['profiles'], 'readonly', allProfiles);
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async createProfile(name) {
      const d = await db();
      const now = Date.now();
      const profile: Profile = {
        id: newId(),
        name: cleanName(name),
        createdAt: now,
        updatedAt: now,
        unlockedCharacters: content.db.characters
          .filter((c) => c.unlockedByDefault)
          .map((c) => c.id),
        endingsSeen: [],
        runsPlayed: 0,
        settings: {},
      };
      await tx(d, ['profiles'], 'readwrite', async (t) => {
        await reqToPromise(t.objectStore('profiles').put(profile, profile.id));
      });
      return profile;
    },

    async getProfile(id) {
      const d = await db();
      return tx(d, ['profiles'], 'readonly', (t) => readProfile(t, id));
    },

    async updateProfile(profile) {
      const p = ProfileSchema.parse(profile);
      const d = await db();
      await tx(d, ['profiles'], 'readwrite', async (t) => {
        await reqToPromise(t.objectStore('profiles').put(p, p.id));
      });
    },

    async deleteProfile(id) {
      const d = await db();
      await tx(d, ['profiles', 'runs', 'meta'], 'readwrite', async (t) => {
        await reqToPromise(t.objectStore('profiles').delete(id));
        await reqToPromise(t.objectStore('runs').delete(id));
        const last: unknown = await reqToPromise(t.objectStore('meta').get(LAST_PROFILE_KEY));
        if (last === id) await reqToPromise(t.objectStore('meta').delete(LAST_PROFILE_KEY));
      });
    },

    async getLastProfileId() {
      const d = await db();
      const v: unknown = await tx(d, ['meta'], 'readonly', (t) =>
        reqToPromise(t.objectStore('meta').get(LAST_PROFILE_KEY)),
      );
      return typeof v === 'string' ? v : null;
    },

    async setLastProfileId(id) {
      const d = await db();
      await tx(d, ['meta'], 'readwrite', async (t) => {
        const store = t.objectStore('meta');
        if (id === null) await reqToPromise(store.delete(LAST_PROFILE_KEY));
        else await reqToPromise(store.put(id, LAST_PROFILE_KEY));
      });
    },

    loadRun: loadRunInternal,

    async saveRun(profileId, run: RunState) {
      const d = await db();
      return tx(d, ['profiles', 'runs'], 'readwrite', async (t) => {
        const p = mustProfile(await readProfile(t, profileId), profileId);
        const updated: Profile = {
          ...p,
          unlockedCharacters: union(p.unlockedCharacters, run.unlocked),
          updatedAt: Date.now(),
        };
        await reqToPromise(t.objectStore('profiles').put(updated, profileId));
        const runs = t.objectStore('runs');
        const existing: unknown = await reqToPromise(runs.get(profileId));
        // 已结束的对局若已被 finishRun 删除，迟到的自动保存不再把它写回来
        if (!(run.ending && existing === undefined)) {
          const rec: RunRecord = { version: target, run };
          await reqToPromise(runs.put(rec, profileId));
        }
        return updated;
      });
    },

    async finishRun(profileId, run) {
      const d = await db();
      return tx(d, ['profiles', 'runs'], 'readwrite', async (t) => {
        const p = mustProfile(await readProfile(t, profileId), profileId);
        const endings = run.ending ? union(p.endingsSeen, [run.ending.id]) : p.endingsSeen;
        const updated: Profile = {
          ...p,
          endingsSeen: endings,
          runsPlayed: p.runsPlayed + 1,
          unlockedCharacters: union(p.unlockedCharacters, run.unlocked),
          updatedAt: Date.now(),
        };
        await reqToPromise(t.objectStore('profiles').put(updated, profileId));
        await reqToPromise(t.objectStore('runs').delete(profileId));
        return updated;
      });
    },

    async abandonRun(profileId) {
      const d = await db();
      await tx(d, ['runs'], 'readwrite', async (t) => {
        await reqToPromise(t.objectStore('runs').delete(profileId));
      });
    },

    async exportJson(profileId) {
      const profile = mustProfile(await service.getProfile(profileId), profileId);
      const { run } = await loadRunInternal(profileId);
      const env: SaveEnvelope = {
        format: 'dtad-save',
        version: target,
        exportedAt: Date.now(),
        profile,
        run,
      };
      return JSON.stringify(env);
    },

    async exportCode(profileId) {
      return encodeSaveCode(await service.exportJson(profileId));
    },

    async importText(text) {
      try {
        return await importInternal(text);
      } catch (e) {
        if (e instanceof SaveError) return { ok: false, error: e.message };
        return { ok: false, error: '导入失败：无法写入本地存储，请检查浏览器设置后重试。' };
      }
    },
  };

  async function importInternal(text: string): Promise<ImportResult> {
    const raw = await parseSaveText(text);
    if (!isRecord(raw) || raw.format !== 'dtad-save') return { ok: false, error: MSG.notOurs };
    if (envelopeVersion(raw) === null) {
      return { ok: false, error: '存档内容已损坏（缺少版本号）。' };
    }
    const up = upgradeEnvelope(raw);
    if (!up.ok) return up;
    const { env, notices } = up;
    const d = await db();
    const profile = await tx(d, ['profiles', 'runs'], 'readwrite', async (t) => {
      const existing = await allProfiles(t);
      const ids = new Set(existing.map((p) => p.id));
      const names = new Set(existing.map((p) => p.name));
      const p: Profile = {
        ...env.profile,
        id: ids.has(env.profile.id) ? newId() : env.profile.id,
        name: uniqueName(cleanName(env.profile.name), names),
        updatedAt: Date.now(),
      };
      if (env.run) p.unlockedCharacters = union(p.unlockedCharacters, env.run.unlocked);
      await reqToPromise(t.objectStore('profiles').put(p, p.id));
      if (env.run) {
        const rec: RunRecord = { version: target, run: env.run };
        await reqToPromise(t.objectStore('runs').put(rec, p.id));
      }
      return p;
    });
    return { ok: true, profile, hasRun: !!env.run, notices };
  }

  return service;
}
