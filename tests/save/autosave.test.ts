import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '../../src/engine';
import { createSaveQueue, installAutosave } from '../../src/save';
import { makeEnv } from '../fixtures/content';

function fakeService() {
  const saved: number[] = [];
  let release: (() => void)[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  return {
    saved,
    get maxConcurrent() {
      return maxConcurrent;
    },
    releaseAll() {
      const r = release;
      release = [];
      r.forEach((f) => f());
    },
    async saveRun(_id: string, run: RunState) {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise<void>((res) => release.push(res));
      saved.push(run.day);
      concurrent--;
      return {} as never;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('保存队列', () => {
  it('串行写入，等待中的只保留最新一份', async () => {
    const svc = fakeService();
    const q = createSaveQueue(svc);
    const run = makeEnv().run;
    for (const day of [1, 2, 3, 4]) void q.save({ profileId: 'p', run: { ...run, day } });
    await tick();
    svc.releaseAll(); // 完成第 1 份
    await tick();
    svc.releaseAll(); // 完成最新的第 4 份
    await q.flush();
    expect(svc.saved).toEqual([1, 4]);
    expect(svc.maxConcurrent).toBe(1);
  });

  it('保存时拍快照，之后修改 run 不影响写入内容', async () => {
    const svc = fakeService();
    const q = createSaveQueue(svc);
    const run = makeEnv().run;
    const p = q.save({ profileId: 'p', run });
    run.day = 99;
    await tick();
    svc.releaseAll();
    await p;
    expect(svc.saved).toEqual([1]);
  });

  it('保存失败不会卡住队列', async () => {
    const errors: unknown[] = [];
    let n = 0;
    const q = createSaveQueue(
      {
        saveRun: async () => {
          if (n++ === 0) throw new Error('boom');
          return {} as never;
        },
      },
      (e) => errors.push(e),
    );
    const run = makeEnv().run;
    await q.save({ profileId: 'p', run });
    await q.save({ profileId: 'p', run });
    expect(errors.length).toBe(1);
    expect(n).toBe(2);
  });
});

describe('installAutosave', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('页面隐藏和 pagehide 时补存，卸载后不再监听', async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const win = new EventTarget();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', win);
    const calls: string[] = [];
    const run = makeEnv().run;
    const off = installAutosave(() => ({ profileId: 'p', run }), {
      saveRun: async (id) => {
        calls.push(id);
        return {} as never;
      },
    });
    doc.dispatchEvent(new Event('visibilitychange')); // visible：不存
    await tick();
    expect(calls.length).toBe(0);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    win.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(calls.length).toBe(2);
    off();
    win.dispatchEvent(new Event('pagehide'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(calls.length).toBe(2);
  });
});
