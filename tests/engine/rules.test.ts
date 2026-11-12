import { describe, expect, it } from 'vitest';
import {
  ConditionSchema,
  ContentDBSchema,
  EffectSchema,
  evalCondition,
  getModifier,
} from '../../src/engine';
import { applyEffects } from '../../src/engine/effects';
import { nextFloat, pickWeighted, seedToState } from '../../src/engine/rng';
import { fireTrigger } from '../../src/engine/rules';
import { makeDB, makeEnv } from '../fixtures/content';

describe('schema', () => {
  it('夹具内容通过校验', () => {
    expect(ContentDBSchema.safeParse(makeDB()).success).toBe(true);
  });
  it('拒绝写错的条件和效果', () => {
    expect(ConditionSchema.safeParse({ stat: 'food', of: 'self', gte: 1 }).success).toBe(true);
    expect(ConditionSchema.safeParse({ stat: 'food', of: 'self', atLeast: 1 }).success).toBe(false);
    expect(ConditionSchema.safeParse({ hasItm: 'can' }).success).toBe(false);
    expect(EffectSchema.safeParse({ item: 'can', add: 1.5 }).success).toBe(false);
    expect(EffectSchema.safeParse({ if: { hasItem: 'can' }, then: [{ nope: 1 }] }).success).toBe(
      false,
    );
  });
});

describe('rng', () => {
  it('同种子同序列，状态可恢复', () => {
    const a = { rng: seedToState('s') };
    const b = { rng: seedToState('s') };
    const seqA = [nextFloat(a), nextFloat(a), nextFloat(a)];
    expect([nextFloat(b), nextFloat(b), nextFloat(b)]).toEqual(seqA);
    const saved = { rng: a.rng };
    expect(nextFloat(saved)).toBe(nextFloat(a));
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('pickWeighted 忽略零权重', () => {
    const r = { rng: 1 };
    for (let i = 0; i < 50; i++)
      expect(pickWeighted(r, ['a', 'b'], (x) => (x === 'a' ? 0 : 1))).toBe('b');
    expect(pickWeighted(r, [])).toBeUndefined();
  });
});

describe('条件', () => {
  it('属性比较与 any / all 目标', () => {
    const env = makeEnv();
    env.run.characters.alpha.stats.food = 80;
    expect(evalCondition(env, { self: 'alpha' }, { stat: 'food', of: 'self', gte: 70 })).toBe(true);
    expect(evalCondition(env, {}, { stat: 'food', of: 'any', gte: 70 })).toBe(true);
    expect(evalCondition(env, {}, { stat: 'food', of: 'all', gte: 70 })).toBe(false);
    expect(evalCondition(env, {}, { stat: 'food', of: 'self', gte: 0 })).toBe(false); // 没有 self
  });
  it('物品、标签、标记、组合', () => {
    const env = makeEnv({ items: { can: 2 } });
    expect(evalCondition(env, {}, { hasItem: 'can', count: 2 })).toBe(true);
    expect(evalCondition(env, {}, { hasItem: 'can', count: 3 })).toBe(false);
    expect(evalCondition(env, {}, { hasTag: 'food' })).toBe(true);
    expect(evalCondition(env, {}, { flag: 'x' })).toBe(false);
    applyEffects(env, {}, [
      { setFlag: 'x', value: true },
      { addFlag: 'n', add: 2 },
    ]);
    expect(
      evalCondition(
        env,
        {},
        { all: [{ flag: 'x' }, { flag: 'n', gte: 2 }, { not: { flag: 'n', gt: 2 } }] },
      ),
    ).toBe(true);
    expect(evalCondition(env, {}, { any: [{ map: 'nowhere' }, { inShelter: 'beta' }] })).toBe(true);
  });
});

describe('效果', () => {
  it('属性钳制、物品不为负', () => {
    const env = makeEnv({ items: { can: 1 } });
    applyEffects(env, { self: 'alpha' }, [
      { stat: 'food', of: 'self', add: 999 },
      { item: 'can', add: -5 },
    ]);
    expect(env.run.characters.alpha.stats.food).toBe(100);
    expect(env.run.inventory.can).toBeUndefined();
  });
  it('deathAtZero 属性归零即死亡并清理计划', () => {
    const env = makeEnv();
    env.run.plan.rations.beta = { food: 'can' };
    applyEffects(env, {}, [{ stat: 'hp', of: { id: 'beta' }, add: -100 }]);
    expect(env.run.characters.beta.where).toBe('dead');
    expect(env.run.plan.rations.beta).toBeUndefined();
    expect(env.run.log.at(-1)?.text).toBe('贝塔 死了。');
  });
  it('未知 id 的效果被忽略而不是报错', () => {
    const env = makeEnv();
    expect(() =>
      applyEffects(env, { self: 'alpha' }, [
        { item: 'ghost', add: 1 },
        { addStatus: 'ghost', of: 'self' },
        { joinParty: 'ghost' },
        { stat: 'ghost', of: 'self', add: 1 },
      ]),
    ).not.toThrow();
    expect(env.run.inventory.ghost).toBeUndefined();
  });
});

describe('规则与修正', () => {
  it('特性修正随状态变化：吃饱不生病', () => {
    const env = makeEnv();
    env.run.characters.alpha.stats.food = 80;
    applyEffects(env, {}, [{ addStatus: 'sick', of: 'all' }]);
    expect(env.run.characters.alpha.statuses).toEqual([]);
    expect(env.run.characters.beta.statuses.map((s) => s.id)).toEqual(['sick']);
    env.run.characters.alpha.stats.food = 50;
    applyEffects(env, {}, [{ addStatus: 'sick', of: { id: 'alpha' } }]);
    expect(env.run.characters.alpha.statuses.map((s) => s.id)).toEqual(['sick']);
  });
  it('self 修正只影响自己；难度与道具是全局来源', () => {
    const env = makeEnv({ difficultyId: 'hard', items: { spice: 1 } });
    applyEffects(env, {}, [{ addStatus: 'silly', of: { id: 'alpha' } }]);
    expect(getModifier(env, 'stat.food.dailyDelta', -10, 'alpha')).toBe(-5);
    expect(getModifier(env, 'stat.food.dailyDelta', -10, 'beta')).toBe(-10);
    expect(getModifier(env, 'stat.water.dailyDelta', -20, 'beta')).toBe(-30);
    expect(getModifier(env, 'item.food.useEffect', 1, 'beta')).toBe(1.5);
  });
  it('trigger 规则只对在庇护所的角色触发', () => {
    const env = makeEnv({ items: { can: 3 } });
    applyEffects(env, {}, [{ addStatus: 'silly', of: { id: 'alpha' } }]);
    fireTrigger(env, 'dayEnd');
    expect(env.run.inventory.can).toBe(2);
    expect(env.run.log.at(-1)?.text).toBe('阿尔法 偷吃了 罐头。');
    env.run.characters.alpha.where = 'away';
    fireTrigger(env, 'dayEnd');
    expect(env.run.inventory.can).toBe(2);
  });
});
