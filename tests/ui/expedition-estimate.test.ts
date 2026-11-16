import { describe, expect, it } from 'vitest';
import { newRun, type Env, type ExpeditionPlan } from '../../src/engine';
import {
  dangerWord,
  effectiveDanger,
  estimateTrip,
  rationStatIds,
  tripDays,
  warnThreshold,
} from '../../src/ui/panels/expedition-estimate';
import { makeContent } from '../fixtures/content';

const content = makeContent();
const setup = {
  seed: 'est',
  mapId: 'bunker',
  difficultyId: 'normal',
  party: ['alpha', 'beta'],
  items: { can: 3, bottle: 4 },
  unlocked: ['alpha', 'beta'],
};
const mkEnv = (): Env => ({ run: structuredClone(newRun(content, setup)), content });
const loc = content.db.locations[0];
const planFor = (charId: string): ExpeditionPlan => ({ charId, locationId: loc.id, carry: [] });

describe('危险文字', () => {
  it('1–5 级各有说法，最高两档提到一去不回', () => {
    expect(dangerWord(1)).toContain('安全');
    expect(dangerWord(4)).toContain('一去不回');
    expect(dangerWord(5)).toContain('一去不回');
    expect(dangerWord(99)).toBe(dangerWord(5));
  });
  it('危险值夹在 0–0.95，天数至少 1', () => {
    const env = mkEnv();
    const d = effectiveDanger(env, loc, 'alpha', planFor('alpha'));
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(0.95);
    expect(tripDays(env, loc, 'alpha', planFor('alpha'))).toBeGreaterThanOrEqual(1);
  });
});

describe('estimateTrip', () => {
  it('配给属性取自配给物品的 onUse；阈值取自状态定义，缺省 25', () => {
    expect(rationStatIds(content).sort()).toEqual(['food', 'water']);
    expect(warnThreshold(content, 'water')).toBe(25);
  });
  it('预计返回时低于阈值则报缺口', () => {
    const env = mkEnv();
    env.run.characters.alpha.stats.water = 30;
    const est = estimateTrip(env, loc, planFor('alpha'))!;
    expect(est.days).toBeGreaterThanOrEqual(1);
    expect(est.shortfalls.map((s) => s.statId)).toContain('water');
    for (const s of est.shortfalls) expect(s.value).toBeLessThan(s.threshold);
  });
  it('属性充足则没有缺口，且不改动原对局', () => {
    const env = mkEnv();
    env.run.characters.alpha.stats.water = 100;
    env.run.characters.alpha.stats.food = 100;
    const before = JSON.stringify(env.run);
    const est = estimateTrip(env, { ...loc, distance: 1 }, planFor('alpha'))!;
    expect(est.shortfalls).toEqual([]);
    expect(JSON.stringify(env.run)).toBe(before);
  });
  it('未知角色返回 null', () => {
    expect(estimateTrip(mkEnv(), loc, planFor('nobody'))).toBeNull();
  });
});
