/**
 * 存档版本迁移。migrations[n] 把版本 n 的信封（SaveEnvelope 形状的原始数据）升到 n+1。
 * 新增迁移：SAVE_VERSION 加 1，并在这里登记 migrations[旧版本]。
 * 迁移函数只处理原始数据（unknown），不要依赖 zod 校验过的类型。
 */
import { SAVE_VERSION } from '../engine/schema';

export type Migration = (raw: unknown) => unknown;
export type MigrationTable = Record<number, Migration>;

export const migrations: MigrationTable = {};

export class MigrationError extends Error {
  readonly kind: 'tooNew' | 'noVersion' | 'missingStep';
  readonly version: number | null;
  constructor(kind: 'tooNew' | 'noVersion' | 'missingStep', version: number | null) {
    super(`migration failed: ${kind} (${version})`);
    this.kind = kind;
    this.version = version;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** 读取信封里的版本号；不是正整数返回 null */
export function envelopeVersion(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const v = raw.version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * 依次执行迁移直到 target。版本高于 target 抛 MigrationError('tooNew')。
 * 每步之后把 version 设为 n+1，并同步 run.v（若有 run）。
 */
export function migrateEnvelope(
  raw: unknown,
  table: MigrationTable = migrations,
  target: number = SAVE_VERSION,
): unknown {
  let version = envelopeVersion(raw);
  if (version === null) throw new MigrationError('noVersion', null);
  if (version > target) throw new MigrationError('tooNew', version);
  let cur = raw;
  while (version < target) {
    const step = table[version];
    if (!step) throw new MigrationError('missingStep', version);
    cur = step(cur);
    version += 1;
    if (isRecord(cur)) {
      cur = { ...cur, version };
      const run = (cur as Record<string, unknown>).run;
      if (isRecord(run)) (cur as Record<string, unknown>).run = { ...run, v: version };
    }
  }
  return cur;
}
