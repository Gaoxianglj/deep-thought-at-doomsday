import { describe, expect, it } from 'vitest';
import type { ContentDB } from '../../src/engine';
import { LAST_RATIONS_KEY, Store } from '../../src/ui/store';
import { errorText } from '../../src/ui/text';
import { makeContent } from '../fixtures/content';
import { createFakeSave } from './fake-save';

/** 让"敲门声"在第 1 天必定出现，"破门"的顶住选项直接触发结局 */
function eventful(db: ContentDB): void {
  db.maps[0].eventDailyChance = 1;
  for (const e of db.events) e.weight = 0;
  const knock = db.events.find((e) => e.id === 'knock')!;
  knock.weight = 1;
  knock.once = true;
  const hold = db.events.find((e) => e.id === 'break_in')!.choices[0];
  for (const o of hold.outcomes) o.effects = [...(o.effects ?? []), { ending: 'self_rescue' }];
}

async function setup(mutate?: (db: ContentDB) => void) {
  const content = makeContent(mutate);
  const save = createFakeSave(content);
  const store = new Store(content, save, { makeSeed: () => 'seed' });
  await store.boot();
  await store.createProfile('测试');
  return { content, save, store };
}

describe('Store', () => {
  it('boot 无档案时进入档案页，新建档案后进入主页', async () => {
    const content = makeContent();
    const save = createFakeSave(content);
    const store = new Store(content, save);
    await store.boot();
    expect(store.get().screen).toBe('profiles');
    await store.createProfile('A');
    expect(store.get().screen).toBe('home');
    expect(store.get().profile?.name).toBe('A');
  });

  it('内容为空时进入"内容尚未就绪"', async () => {
    const content = makeContent((db) => {
      db.maps = [];
      db.locations = [];
    });
    const store = new Store(content, createFakeSave(content));
    await store.boot();
    expect(store.get().screen).toBe('notReady');
  });

  it('开局后保存，动作成功会保存', async () => {
    const { save, store } = await setup();
    const errors = await store.startRun({
      mapId: 'bunker',
      difficultyId: 'normal',
      party: ['alpha', 'beta'],
      items: { can: 2 },
    });
    expect(errors).toEqual([]);
    expect(store.get().screen).toBe('run');
    const before = save.calls.filter((c) => c.method === 'saveRun').length;
    const err = await store.dispatch({
      type: 'setRation',
      charId: 'alpha',
      tag: 'food',
      itemId: 'can',
    });
    expect(err).toBeUndefined();
    expect(store.get().run?.plan.rations.alpha?.food).toBe('can');
    const saves = save.calls.filter((c) => c.method === 'saveRun');
    expect(saves.length).toBe(before + 1);
    expect(save.runs.get(store.get().profile!.id)?.plan.rations.alpha?.food).toBe('can');
  });

  it('开局校验失败返回错误码，不保存', async () => {
    const { save, store } = await setup();
    const errors = await store.startRun({
      mapId: 'bunker',
      difficultyId: 'normal',
      party: ['alpha', 'gamma'],
      items: {},
    });
    expect(errors).toContain('characterLocked');
    expect(save.calls.length).toBe(0);
    expect(store.get().run).toBeNull();
  });

  it('引擎报错时不保存，并给出中文提示', async () => {
    const { save, store } = await setup();
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    const n = save.calls.length;
    const run = store.get().run;
    const err = await store.dispatch({ type: 'chooseEventOption', choiceId: 'x' });
    expect(err).toBe('noPendingEvent');
    expect(save.calls.length).toBe(n);
    expect(store.get().run).toBe(run);
    expect(store.get().toasts.at(-1)?.text).toBe(errorText('noPendingEvent'));
    expect(store.get().toasts.at(-1)?.kind).toBe('error');
  });

  it('新解锁角色会产生提示，并更新档案', async () => {
    const { store } = await setup(eventful);
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    expect(store.get().run?.phase).toBe('event');
    expect(store.get().run?.pendingEvent?.eventId).toBe('knock');
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'open' });
    expect(store.get().profile?.unlockedCharacters).toContain('gamma');
    const toast = store.get().toasts.find((t) => t.kind === 'success');
    expect(toast?.text).toContain('伽马');
  });

  it('对局结束会调用 finishRun 并进入结局页', async () => {
    const { save, store } = await setup(eventful);
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    // 不开门 → 2 天后破门事件
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'ignore' });
    await store.dispatch({ type: 'continueEvent' });
    expect(store.get().run?.phase).toBe('plan');
    await store.dispatch({ type: 'endDay' });
    await store.dispatch({ type: 'endDay' });
    expect(store.get().run?.pendingEvent?.eventId).toBe('break_in');
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'hold' });
    expect(save.calls.some((c) => c.method === 'finishRun')).toBe(false);
    await store.dispatch({ type: 'continueEvent' });
    const finish = save.calls.filter((c) => c.method === 'finishRun');
    expect(finish.length).toBe(1);
    const s = store.get();
    expect(s.screen).toBe('ending');
    expect(s.run).toBeNull();
    expect(s.ending?.run.ending?.id).toBe('self_rescue');
    expect(s.ending?.saved).toBe(true);
    expect(s.profile?.endingsSeen).toContain('self_rescue');
    expect(s.profile?.runsPlayed).toBe(1);
    expect(store.getSnapshot()).toBeNull();
  });

  it('结局页列出本局新解锁', async () => {
    const { store } = await setup((db) => {
      eventful(db);
      // 开门后欢迎事件结束即触发结局
      db.events.find((e) => e.id === 'welcome')!.choices[0].outcomes[0].effects = [
        { ending: 'self_rescue' },
      ];
    });
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'open' });
    await store.dispatch({ type: 'continueEvent' });
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'ok' });
    await store.dispatch({ type: 'continueEvent' });
    expect(store.get().screen).toBe('ending');
    expect(store.get().ending?.newUnlocks).toEqual(['gamma']);
  });

  it('结束一天时记下配给，并写入档案 settings', async () => {
    const { store } = await setup();
    await store.startRun({
      mapId: 'bunker',
      difficultyId: 'normal',
      party: ['alpha'],
      items: { can: 2 },
    });
    expect(store.get().lastRations).toBeNull();
    await store.dispatch({ type: 'setRation', charId: 'alpha', tag: 'food', itemId: 'can' });
    await store.dispatch({ type: 'endDay' });
    expect(store.get().lastRations).toEqual({ alpha: { food: 'can' } });
    expect(store.get().profile?.settings[LAST_RATIONS_KEY]).toEqual({ alpha: { food: 'can' } });
  });

  it('保存失败只提示，不阻塞游戏', async () => {
    const { save, store } = await setup();
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    save.failSave = true;
    const err = await store.dispatch({ type: 'endDay' });
    expect(err).toBeUndefined();
    expect(store.get().run?.day).toBe(2);
    expect(store.get().toasts.some((t) => t.kind === 'error' && t.text.includes('disk full'))).toBe(
      true,
    );
  });

  it('重新打开档案时恢复进行中的对局（含事件中途）', async () => {
    const { content, save, store } = await setup(eventful);
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    await store.dispatch({ type: 'chooseEventOption', choiceId: 'ignore' });
    const store2 = new Store(content, save);
    await store2.boot();
    const s = store2.get();
    expect(s.screen).toBe('run');
    expect(s.run?.phase).toBe('event');
    expect(s.run?.pendingEvent?.result).toBeDefined();
  });

  it('放弃对局', async () => {
    const { save, store } = await setup();
    await store.startRun({ mapId: 'bunker', difficultyId: 'normal', party: ['alpha'], items: {} });
    await store.abandonRun();
    expect(store.get().run).toBeNull();
    expect(save.runs.size).toBe(0);
  });
});
