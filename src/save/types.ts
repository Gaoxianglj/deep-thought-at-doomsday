/**
 * 存档层的数据结构与对外接口（契约）。UI 只依赖这个文件里的类型，不直接碰 IndexedDB。
 * 实现见 src/save/ 其余文件；设计见 docs/DESIGN.md 第 7 节。
 */
import { z } from 'zod';
import { RunStateSchema, type RunState } from '../engine/schema';

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(24),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** 已解锁的角色 id（含默认解锁）。内容里已不存在的 id 保留但不显示 */
  unlockedCharacters: z.array(z.string()),
  endingsSeen: z.array(z.string()),
  runsPlayed: z.number().int().min(0),
  settings: z.record(z.string(), z.unknown()),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** 导出文件 / 存档码的内容 */
export const SaveEnvelopeSchema = z.object({
  format: z.literal('dtad-save'),
  /** 存档版本号（= 导出时的 SAVE_VERSION），迁移依据 */
  version: z.number().int().min(1),
  exportedAt: z.number(),
  profile: ProfileSchema,
  /** 进行中的对局；没有则为 null */
  run: RunStateSchema.nullable(),
});
export type SaveEnvelope = z.infer<typeof SaveEnvelopeSchema>;

/** 读取对局的结果。notices 是给玩家看的中文提示（如"部分内容已失效并被移除"） */
export interface LoadedRun {
  run: RunState | null;
  notices: string[];
}

export type ImportResult =
  | { ok: true; profile: Profile; hasRun: boolean; notices: string[] }
  /** error 是可以直接展示给玩家的中文说明 */
  | { ok: false; error: string };

export interface SaveService {
  /** 打开数据库并申请持久化存储（navigator.storage.persist，失败不报错） */
  init(): Promise<void>;

  listProfiles(): Promise<Profile[]>;
  /** 新建档案，unlockedCharacters 初始为内容中 unlockedByDefault 的角色 */
  createProfile(name: string): Promise<Profile>;
  getProfile(id: string): Promise<Profile | null>;
  updateProfile(profile: Profile): Promise<void>;
  /** 删除档案及其进行中的对局 */
  deleteProfile(id: string): Promise<void>;
  getLastProfileId(): Promise<string | null>;
  setLastProfileId(id: string | null): Promise<void>;

  /** 读取进行中的对局：迁移 → 校验 → 失效引用修复。没有或已作废则 run 为 null */
  loadRun(profileId: string): Promise<LoadedRun>;
  /** 保存对局，并把 run.unlocked 并入档案的 unlockedCharacters。返回更新后的档案 */
  saveRun(profileId: string, run: RunState): Promise<Profile>;
  /** 对局结束：记录结局到 endingsSeen、runsPlayed +1、并入解锁、删除进行中的对局 */
  finishRun(profileId: string, run: RunState): Promise<Profile>;
  /** 放弃进行中的对局（解锁保留） */
  abandonRun(profileId: string): Promise<void>;

  /** 导出为 JSON 字符串（SaveEnvelope） */
  exportJson(profileId: string): Promise<string>;
  /** 导出为文本存档码（DTAD1.… 或不支持压缩时的 DTAD0.…） */
  exportCode(profileId: string): Promise<string>;
  /**
   * 导入 JSON 文本或存档码（自动识别）。作为新档案写入（id 冲突时生成新 id，重名时加后缀）。
   * 任何错误都以 { ok: false, error } 返回，不抛异常。
   */
  importText(text: string): Promise<ImportResult>;
}
