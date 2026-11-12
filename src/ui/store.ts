/**
 * 唯一的应用状态容器。订阅/通知模式；所有玩家动作走 dispatch()。
 * 不在模块顶层访问 document / window，便于在 node 环境下测试。
 */
import {
  applyAction,
  newRun,
  validateSetup,
  type Action,
  type Content,
  type NewRunOptions,
  type RunState,
} from '../engine';
import type { ImportResult, Profile, SaveService } from '../save/types';
import { errorText, fmt, T } from './text';

export type Screen = 'boot' | 'notReady' | 'profiles' | 'home' | 'setup' | 'run' | 'ending';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface EndingInfo {
  run: RunState;
  /** 本局新解锁的角色 id */
  newUnlocks: string[];
  /** finishRun 是否已完成 */
  saved: boolean;
}

export interface AppState {
  screen: Screen;
  profiles: Profile[];
  profile: Profile | null;
  run: RunState | null;
  /** loadRun 返回的提示，在主页展示 */
  notices: string[];
  toasts: Toast[];
  ending: EndingInfo | null;
  /** 昨天结束一天时的配给计划；没有记录为 null */
  lastRations: Rations | null;
  bootError: string | null;
  /** 屏幕自身草稿状态的版本号；touch() 递增以触发重渲染 */
  rev: number;
}

export type StartOptions = Omit<NewRunOptions, 'unlocked' | 'seed'> & { seed?: string };

/** 档案 settings 里记录"昨天配给"的键（引擎每天清晨会清空配给计划） */
export const LAST_RATIONS_KEY = 'ui.lastRations';

export type Rations = Record<string, Record<string, string>>;

function readRations(v: unknown): Rations | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Rations = {};
  for (const [cid, slots] of Object.entries(v)) {
    if (!slots || typeof slots !== 'object') continue;
    const row: Record<string, string> = {};
    for (const [tag, id] of Object.entries(slots)) if (typeof id === 'string') row[tag] = id;
    if (Object.keys(row).length) out[cid] = row;
  }
  return Object.keys(out).length ? out : null;
}

export function isContentReady(content: Content): boolean {
  return content.maps.size > 0 && content.characters.size > 0 && content.difficulties.size > 0;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function defaultSeed(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .toUpperCase();
}

export class Store {
  readonly content: Content;
  readonly save: SaveService;
  private state: AppState = {
    screen: 'boot',
    profiles: [],
    profile: null,
    run: null,
    notices: [],
    toasts: [],
    ending: null,
    lastRations: null,
    bootError: null,
    rev: 0,
  };
  private listeners = new Set<() => void>();
  private toastSeq = 0;
  /** 串行化存档写入，保证顺序 */
  private saveChain: Promise<unknown> = Promise.resolve();
  private readonly makeSeed: () => string;

  constructor(content: Content, save: SaveService, opts: { makeSeed?: () => string } = {}) {
    this.content = content;
    this.save = save;
    this.makeSeed = opts.makeSeed ?? defaultSeed;
  }

  // ---------- 订阅 ----------
  get(): Readonly<AppState> {
    return this.state;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const fn of this.listeners) fn();
  }
  /** 屏幕自己的草稿状态变化时调用，触发重渲染 */
  touch(): void {
    this.set({ rev: this.state.rev + 1 });
  }
  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  // ---------- 提示 ----------
  toast(text: string, kind: Toast['kind'] = 'info'): number {
    const id = ++this.toastSeq;
    this.set({ toasts: [...this.state.toasts, { id, text, kind }] });
    return id;
  }
  dismissToast(id: number): void {
    if (!this.state.toasts.some((t) => t.id === id)) return;
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) });
  }

  go(screen: Screen): void {
    this.set({ screen });
  }

  /** 自动存档（页面切到后台时补存）用的快照 */
  getSnapshot(): { profileId: string; run: RunState } | null {
    const { profile, run } = this.state;
    return profile && run && run.phase !== 'ended' ? { profileId: profile.id, run } : null;
  }

  // ---------- 启动与档案 ----------
  async boot(): Promise<void> {
    if (!isContentReady(this.content)) {
      this.set({ screen: 'notReady' });
      return;
    }
    try {
      await this.save.init();
      const profiles = await this.save.listProfiles();
      const lastId = await this.save.getLastProfileId();
      this.set({ profiles, bootError: null });
      if (lastId && profiles.some((p) => p.id === lastId)) {
        await this.openProfile(lastId, { resume: true });
      } else {
        this.set({ screen: 'profiles' });
      }
    } catch (e) {
      this.set({ bootError: errMsg(e), screen: 'boot' });
    }
  }

  async refreshProfiles(): Promise<void> {
    try {
      this.set({ profiles: await this.save.listProfiles() });
    } catch (e) {
      this.toast(fmt(T.toast.loadFailed, { error: errMsg(e) }), 'error');
    }
  }

  /** 选定档案并读取进行中的对局。resume = 有对局时直接回到对局画面 */
  async openProfile(id: string, opts: { resume?: boolean } = {}): Promise<void> {
    try {
      const profile = await this.save.getProfile(id);
      if (!profile) {
        await this.refreshProfiles();
        this.set({ screen: 'profiles' });
        return;
      }
      await this.save.setLastProfileId(id);
      const { run, notices } = await this.save.loadRun(id);
      this.set({
        profile,
        run,
        notices,
        ending: null,
        lastRations: run ? readRations(profile.settings[LAST_RATIONS_KEY]) : null,
      });
      if (run?.phase === 'ended') {
        await this.finish(run);
        return;
      }
      this.set({ screen: opts.resume && run ? 'run' : 'home' });
      if (opts.resume && run) for (const n of notices) this.toast(fmt(T.toast.notice, { text: n }));
    } catch (e) {
      this.toast(fmt(T.toast.loadFailed, { error: errMsg(e) }), 'error');
      this.set({ screen: 'profiles' });
    }
  }

  async createProfile(name: string): Promise<Profile | null> {
    try {
      const profile = await this.save.createProfile(name);
      await this.refreshProfiles();
      await this.openProfile(profile.id);
      return profile;
    } catch (e) {
      this.toast(errMsg(e), 'error');
      return null;
    }
  }

  async deleteProfile(id: string): Promise<void> {
    try {
      await this.save.deleteProfile(id);
      if (this.state.profile?.id === id) {
        await this.save.setLastProfileId(null);
        this.set({ profile: null, run: null, notices: [], lastRations: null });
      }
      await this.refreshProfiles();
      this.toast(T.profiles.deleted, 'success');
    } catch (e) {
      this.toast(errMsg(e), 'error');
    }
  }

  async importText(text: string): Promise<ImportResult> {
    const result = await this.save.importText(text);
    if (result.ok) {
      await this.refreshProfiles();
      this.toast(fmt(T.profiles.imported, { name: result.profile.name }), 'success');
      for (const n of result.notices) this.toast(fmt(T.toast.notice, { text: n }));
    }
    return result;
  }

  async switchProfile(): Promise<void> {
    this.set({ profile: null, run: null, notices: [], ending: null, lastRations: null });
    await this.refreshProfiles();
    this.set({ screen: 'profiles' });
  }

  // ---------- 对局 ----------
  /** 校验开局选项，返回错误码（空 = 合法） */
  checkSetup(o: StartOptions): string[] {
    const unlocked = this.state.profile?.unlockedCharacters ?? [];
    return validateSetup(this.content, { ...o, seed: o.seed ?? '', unlocked });
  }

  /** 开新局（会覆盖进行中的对局）。返回错误码列表，空 = 成功 */
  async startRun(o: StartOptions): Promise<string[]> {
    const profile = this.state.profile;
    if (!profile) return ['noProfile'];
    const errors = this.checkSetup(o);
    if (errors.length) return errors;
    const seed = o.seed?.trim() || this.makeSeed();
    const run = newRun(this.content, {
      ...o,
      seed,
      unlocked: profile.unlockedCharacters,
    });
    this.set({ run, notices: [], ending: null, lastRations: null, screen: 'run' });
    await this.rememberRations(null);
    await this.persist(run);
    return [];
  }

  continueRun(): void {
    if (this.state.run) this.set({ screen: 'run' });
  }

  async abandonRun(): Promise<void> {
    const profile = this.state.profile;
    if (!profile) return;
    try {
      await this.queue(() => this.save.abandonRun(profile.id));
      this.set({ run: null, notices: [] });
      this.toast(T.home.abandoned);
    } catch (e) {
      this.toast(errMsg(e), 'error');
    }
  }

  /**
   * 玩家动作：调引擎 → 成功则更新状态并保存；对局结束则结算并进入结局页。
   * 返回引擎错误码（成功为 undefined）。
   */
  async dispatch(action: Action): Promise<string | undefined> {
    const run = this.state.run;
    if (!run) return 'noRun';
    const result = applyAction(run, action, this.content);
    if (result.error) {
      this.toast(errorText(result.error), 'error');
      return result.error;
    }
    const rations = action.type === 'endDay' ? readRations(run.plan.rations) : null;
    this.set({ run: result.state, ...(rations ? { lastRations: rations } : {}) });
    this.announceUnlocks(run, result.state);
    if (rations) await this.rememberRations(rations);
    await this.persist(result.state);
    return undefined;
  }

  leaveEnding(): void {
    this.set({ ending: null, screen: 'home' });
  }

  /** 保存对局；若已结束则走结算流程 */
  private async persist(run: RunState): Promise<void> {
    if (run.phase === 'ended') {
      await this.finish(run);
      return;
    }
    const profile = this.state.profile;
    if (!profile) return;
    await this.queue(async () => {
      try {
        const updated = await this.save.saveRun(profile.id, run);
        this.acceptProfile(updated);
      } catch (e) {
        this.toast(fmt(T.toast.saveFailed, { error: errMsg(e) }), 'error');
      }
    });
  }

  private async finish(run: RunState): Promise<void> {
    const profile = this.state.profile;
    this.set({
      run: null,
      screen: 'ending',
      ending: { run, newUnlocks: this.computeNewUnlocks(run), saved: false },
    });
    if (!profile) return;
    await this.queue(async () => {
      try {
        const updated = await this.save.finishRun(profile.id, run);
        this.acceptProfile(updated);
      } catch (e) {
        this.toast(fmt(T.toast.saveFailed, { error: errMsg(e) }), 'error');
      }
      const ending = this.state.ending;
      if (ending?.run === run) {
        this.set({ ending: { ...ending, newUnlocks: this.computeNewUnlocks(run), saved: true } });
      }
    });
  }

  /** 用存档层返回的档案替换当前档案 */
  private acceptProfile(updated: Profile): void {
    // 保留本地写入但存档层可能未回传的 settings 键
    const settings = { ...this.state.profile?.settings, ...updated.settings };
    this.set({ profile: { ...updated, settings } });
  }

  /** 对比动作前后的 run.newUnlocks，有新伙伴解锁就提示 */
  private announceUnlocks(before: RunState, after: RunState): void {
    const seen = new Set(before.newUnlocks);
    const names = after.newUnlocks
      .filter((id) => !seen.has(id))
      .map((id) => this.content.characters.get(id)?.name)
      .filter((n): n is string => !!n);
    if (names.length) this.toast(fmt(T.toast.unlocked, { names: names.join('、') }), 'success');
  }

  private computeNewUnlocks(run: RunState): string[] {
    return [...new Set(run.newUnlocks)].filter((id) => this.content.characters.has(id));
  }

  /** 把昨天的配给写进档案 settings，刷新后还在 */
  private async rememberRations(rations: Rations | null): Promise<void> {
    await this.queue(async () => {
      // 排队执行时才读取最新档案，避免用旧快照覆盖前面存档写入的解锁
      const profile = this.state.profile;
      if (!profile) return;
      const settings = { ...profile.settings };
      if (rations) settings[LAST_RATIONS_KEY] = rations;
      else delete settings[LAST_RATIONS_KEY];
      const next = { ...profile, settings };
      this.set({ profile: next });
      try {
        await this.save.updateProfile(next);
      } catch {
        // 只影响"沿用昨天的配给"，忽略
      }
    });
  }

  private queue<R>(fn: () => Promise<R>): Promise<R> {
    const p = this.saveChain.then(fn, fn);
    this.saveChain = p.catch(() => undefined);
    return p;
  }
}
