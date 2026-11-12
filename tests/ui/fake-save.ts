/** UI 测试用的内存版 SaveService，记录调用以便断言。 */
import type { Content, RunState } from '../../src/engine';
import type { ImportResult, LoadedRun, Profile, SaveService } from '../../src/save/types';

export interface FakeSave extends SaveService {
  calls: { method: string; args: unknown[] }[];
  runs: Map<string, RunState>;
  profiles: Map<string, Profile>;
  failSave: boolean;
}

export function createFakeSave(content: Content): FakeSave {
  const profiles = new Map<string, Profile>();
  const runs = new Map<string, RunState>();
  let last: string | null = null;
  let seq = 0;
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

  const svc: FakeSave = {
    calls: [],
    runs,
    profiles,
    failSave: false,
    async init() {},
    async listProfiles() {
      return [...profiles.values()];
    },
    async createProfile(name) {
      const now = Date.now();
      const p: Profile = {
        id: `p${++seq}`,
        name,
        createdAt: now,
        updatedAt: now,
        unlockedCharacters: content.db.characters
          .filter((c) => c.unlockedByDefault)
          .map((c) => c.id),
        endingsSeen: [],
        runsPlayed: 0,
        settings: {},
      };
      profiles.set(p.id, p);
      return structuredClone(p);
    },
    async getProfile(id) {
      const p = profiles.get(id);
      return p ? structuredClone(p) : null;
    },
    async updateProfile(p) {
      profiles.set(p.id, structuredClone(p));
    },
    async deleteProfile(id) {
      profiles.delete(id);
      runs.delete(id);
    },
    async getLastProfileId() {
      return last;
    },
    async setLastProfileId(id) {
      last = id;
    },
    async loadRun(id): Promise<LoadedRun> {
      const r = runs.get(id);
      return { run: r ? structuredClone(r) : null, notices: [] };
    },
    async saveRun(id, run) {
      svc.calls.push({ method: 'saveRun', args: [id, run] });
      if (svc.failSave) throw new Error('disk full');
      const p = profiles.get(id)!;
      const updated = { ...p, unlockedCharacters: union(p.unlockedCharacters, run.unlocked) };
      profiles.set(id, updated);
      runs.set(id, structuredClone(run));
      return structuredClone(updated);
    },
    async finishRun(id, run) {
      svc.calls.push({ method: 'finishRun', args: [id, run] });
      const p = profiles.get(id)!;
      const updated: Profile = {
        ...p,
        unlockedCharacters: union(p.unlockedCharacters, run.unlocked),
        endingsSeen: run.ending ? union(p.endingsSeen, [run.ending.id]) : p.endingsSeen,
        runsPlayed: p.runsPlayed + 1,
      };
      profiles.set(id, updated);
      runs.delete(id);
      return structuredClone(updated);
    },
    async abandonRun(id) {
      svc.calls.push({ method: 'abandonRun', args: [id] });
      runs.delete(id);
    },
    async exportJson() {
      return '{}';
    },
    async exportCode() {
      return 'DTAD0.x';
    },
    async importText(): Promise<ImportResult> {
      return { ok: false, error: '文件不是本游戏存档' };
    },
  };
  return svc;
}
