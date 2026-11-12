/**
 * 自动保存：串行队列（同一时间只有一次写入，等待中的只保留最新一份），
 * 以及 visibilitychange(hidden) / pagehide 时的补存。不使用 beforeunload。
 */
import type { RunState } from '../engine/schema';
import type { SaveService } from './types';

export interface SaveSnapshot {
  profileId: string;
  run: RunState;
}

export interface SaveQueue {
  /** 排队保存；返回在这份（或覆盖它的更新一份）写完后 resolve 的 Promise */
  save(snapshot: SaveSnapshot): Promise<void>;
  /** 等待当前与排队中的保存全部完成 */
  flush(): Promise<void>;
}

export function createSaveQueue(
  service: Pick<SaveService, 'saveRun'>,
  onError: (e: unknown) => void = (e) => console.error('[save] 自动保存失败', e),
): SaveQueue {
  let pending: SaveSnapshot | null = null;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending) {
      const snap = pending;
      pending = null;
      try {
        await service.saveRun(snap.profileId, snap.run);
      } catch (e) {
        onError(e);
      }
    }
    running = null;
  }

  const queue: SaveQueue = {
    save(snapshot) {
      // 立即拍下快照，之后 UI 改动 run 不影响这份
      pending = { profileId: snapshot.profileId, run: structuredClone(snapshot.run) };
      if (!running) running = drain();
      return running;
    },
    flush() {
      return running ?? Promise.resolve();
    },
  };
  return queue;
}

/**
 * 页面隐藏/卸载时补存。返回卸载函数。
 * 传入 queue 可与 UI 的"每个动作后保存"共用同一条串行队列。
 */
export function installAutosave(
  getSnapshot: () => SaveSnapshot | null,
  service: Pick<SaveService, 'saveRun'>,
  queue: SaveQueue = createSaveQueue(service),
): () => void {
  const saveNow = () => {
    const snap = getSnapshot();
    if (snap) void queue.save(snap);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') saveNow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', saveNow);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', saveNow);
  };
}
