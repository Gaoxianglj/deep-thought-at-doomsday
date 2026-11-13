import { describe, expect, it } from 'vitest';
import { buildContent } from '../../src/engine';
import { contentDB } from '../../src/data';
import { randomBot, sensibleBot } from '../../src/sim/bots';
import { formatReplay, newLogEntries, replayRun } from '../../src/sim/replay';
import { simulateRun } from '../../src/sim/simulate';
import { makeContent } from '../fixtures/content';

const lively = () =>
  makeContent((db) => {
    db.maps[0].eventDailyChance = 0.6;
    for (const e of db.events) if (e.id === 'fever' || e.id === 'knock') e.weight = 1;
  });
const base = { mapId: 'bunker', difficultyId: 'normal' };

describe('replayRun', () => {
  it('与同种子的批量模拟结果完全一致（观察者不影响对局）', () => {
    const content = lively();
    for (const bot of [sensibleBot, randomBot]) {
      for (let i = 0; i < 5; i++) {
        const plain = simulateRun(content, { ...base, seed: `rp${i}`, bot });
        const { result } = replayRun(content, { ...base, seed: `rp${i}`, bot });
        expect(result).toEqual(plain);
      }
    }
  });

  it('正式内容：回放结果与批量模拟一致，步骤序号连续', () => {
    const real = buildContent(contentDB);
    const o = { mapId: real.db.maps[0].id, difficultyId: real.db.difficulties[0].id };
    const plain = simulateRun(real, { ...o, seed: 'sim-3', bot: sensibleBot });
    const replay = replayRun(real, { ...o, seed: 'sim-3', bot: sensibleBot });
    expect(replay.result).toEqual(plain);
    replay.steps.forEach((s, i) => expect(s.index).toBe(i));
    expect(replay.steps.length).toBeGreaterThan(5);
    // 每次天数前进都带着新一天的快照
    const days = replay.steps.filter((s) => s.newDay).map((s) => s.newDay!.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });

  it('记录事件的选项、选择与结果文案', () => {
    const content = lively();
    const replay = replayRun(content, { ...base, seed: 'ev1', bot: sensibleBot, maxDays: 30 });
    const withEvent = replay.steps.filter((s) => s.event);
    expect(withEvent.length).toBeGreaterThan(0);
    for (const s of withEvent) {
      expect(s.action.type).toBe('chooseEventOption');
      expect(s.event!.choices.map((c) => c.id)).toContain(s.event!.picked);
      expect(s.event!.result).toBeTruthy();
    }
  });

  it('被拒绝的动作也记录下来', () => {
    const content = lively();
    const bad = { ...sensibleBot, name: 'bad', act: () => ({ type: 'continueEvent' }) as const };
    const replay = replayRun(content, { ...base, seed: 'rej', bot: bad });
    expect(replay.steps[0].error).toBe('noEventResult');
    expect(formatReplay(content, replay, 'H')).toContain('动作被拒绝（noEventResult）');
  });
});

describe('formatReplay', () => {
  const content = lively();
  const replay = replayRun(content, { ...base, seed: 'fmt', bot: sensibleBot, maxDays: 40 });

  it('包含开局、每日表头、结局', () => {
    const text = formatReplay(content, replay, '== H ==');
    expect(text.startsWith('== H ==')).toBe(true);
    expect(text).toContain('开局队伍:');
    expect(text).toContain('── 第 1 天 ──');
    expect(text).toContain('库存:');
    expect(text).toMatch(/═ (结局|超时)/);
  });

  it('--from / --to 过滤天数', () => {
    const text = formatReplay(content, replay, 'H', { fromDay: 3, toDay: 4 });
    expect(text).not.toContain('── 第 1 天 ──');
    expect(text).not.toContain('── 第 2 天 ──');
    expect(text).toContain('── 第 3 天 ──');
    expect(text).toContain('── 第 4 天 ──');
    expect(text).not.toContain('── 第 5 天 ──');
  });

  it('brief 模式不打印每日角色表', () => {
    const full = formatReplay(content, replay, 'H');
    const brief = formatReplay(content, replay, 'H', { brief: true });
    expect(full).toContain('饱食');
    expect(brief).not.toContain('饱食 ');
    expect(brief.length).toBeLessThan(full.length);
  });

  it('崩溃的一局在末尾打印崩溃信息', () => {
    const bad = {
      ...sensibleBot,
      name: 'bad',
      act: () => {
        throw new Error('kaboom');
      },
    };
    const r = replayRun(content, { ...base, seed: 'x', bot: bad });
    expect(formatReplay(content, r, 'H')).toContain('崩溃（bot）: kaboom');
  });
});

describe('newLogEntries', () => {
  const e = (day: number, text: string) => ({ day, kind: 'info', text });
  it('追加', () => {
    expect(newLogEntries([e(1, 'a')], [e(1, 'a'), e(1, 'b')])).toEqual([e(1, 'b')]);
  });
  it('头部被 trimLog 丢掉一部分后仍能找出新增条目', () => {
    const before = [e(1, 'a'), e(2, 'b'), e(3, 'c')];
    const after = [e(3, 'c'), e(6, 'd')];
    expect(newLogEntries(before, after)).toEqual([e(6, 'd')]);
  });
  it('没有变化 / 全被换掉', () => {
    expect(newLogEntries([e(1, 'a')], [e(1, 'a')])).toEqual([]);
    expect(newLogEntries([], [e(1, 'a')])).toEqual([e(1, 'a')]);
    expect(newLogEntries([e(1, 'a')], [e(9, 'z')])).toEqual([e(9, 'z')]);
  });
});
