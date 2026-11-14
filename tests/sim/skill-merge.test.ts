import { describe, expect, it } from 'vitest';
import { resolveBot } from '../../src/sim/bots';
import { runSkillLadder, sampleOverrides } from '../../src/sim/skill';
import { makeRng, mergeShards } from '../../src/sim/simulate';
import { policySpec } from '../../src/sim/bots';
import { makeContent } from '../fixtures/content';

describe('sampleOverrides', () => {
  it('取值都在合法范围内，且描述串能被 resolveBot 识别', () => {
    const rng = makeRng('skill-test');
    for (let i = 0; i < 50; i++) {
      const o = sampleOverrides(rng);
      expect(o.partyBudget).toBeGreaterThanOrEqual(0.2);
      expect(o.partyBudget).toBeLessThanOrEqual(0.6);
      expect(Number.isInteger(o.lowSupplyDays)).toBe(true);
      expect(o.exploreMinHome).toBeGreaterThanOrEqual(0);
      expect(typeof resolveBot(policySpec('sensible', o))).toBe('object');
    }
  });
});

describe('runSkillLadder', () => {
  const content = makeContent((db) => {
    db.maps[0].eventDailyChance = 0.5;
  });
  const opts = {
    mapId: 'bunker',
    difficultyId: 'normal',
    runs: 20,
    search: 3,
    searchRuns: 8,
    seed: 'sk',
    maxDays: 40,
  };

  it('给出 4 个预设 + best，best 的描述串可复现', async () => {
    const rows = await runSkillLadder(content, opts);
    expect(rows.map((r) => r.label)).toEqual([
      'random',
      'turtle',
      'sensible',
      'explorer',
      'best（搜索）',
    ]);
    for (const r of rows) {
      expect(r.winRate).toBeGreaterThanOrEqual(0);
      expect(r.winRate).toBeLessThanOrEqual(1);
      expect(r.runs).toBe(20);
    }
    expect(typeof resolveBot(rows[4].spec)).toBe('object');
  });

  it('同样的参数结果完全相同（搜索也由种子决定）', async () => {
    expect(await runSkillLadder(content, opts)).toEqual(await runSkillLadder(content, opts));
  });

  it('search = 0 时不做搜索', async () => {
    const rows = await runSkillLadder(content, { ...opts, search: 0 });
    expect(rows).toHaveLength(4);
  });
});

describe('mergeShards', () => {
  it('按 i % n 分片再合并，恢复原顺序', () => {
    const all = Array.from({ length: 11 }, (_, i) => i);
    for (const jobs of [1, 2, 3, 4, 8]) {
      const shards: number[][] = Array.from({ length: jobs }, () => []);
      for (const i of all) shards[i % jobs].push(i);
      expect(mergeShards(shards, all.length)).toEqual(all);
    }
  });
});
