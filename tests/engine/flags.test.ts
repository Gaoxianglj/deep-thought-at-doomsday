import { describe, expect, it } from 'vitest';
import { evalCondition, formatText, getNotes } from '../../src/engine';
import { applyEffects } from '../../src/engine/effects';
import { makeEnv } from '../fixtures/content';

describe('flag 驱动的随机目标', () => {
  it('pickFlags：不重复、可复现、写入 from 里的值', () => {
    const pick = (seed: string) => {
      const env = makeEnv({ seed });
      applyEffects(env, {}, [
        { pickFlags: { flags: ['t1', 't2', 't3'], from: ['a', 'b', 'c', 'd', 'e'] } },
      ]);
      return [env.run.flags.t1, env.run.flags.t2, env.run.flags.t3];
    };
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const v = pick(`s${i}`);
      expect(new Set(v).size).toBe(3);
      v.forEach((x) => expect(['a', 'b', 'c', 'd', 'e']).toContain(x));
      seen.add(v.join(','));
    }
    expect(seen.size).toBeGreaterThan(5); // 确实是随机的
    expect(pick('same')).toEqual(pick('same'));
  });

  it('pickFlags：from 不够时只写能写的', () => {
    const env = makeEnv();
    applyEffects(env, {}, [{ pickFlags: { flags: ['x', 'y'], from: ['only'] } }]);
    expect(env.run.flags.x).toBe('only');
    expect(env.run.flags.y).toBeUndefined();
  });

  it('hasFlagItem / flagItem：按 flag 里的物品 id 判断与增减', () => {
    const env = makeEnv({ items: { lock: 1 } });
    expect(evalCondition(env, {}, { hasFlagItem: 'need' })).toBe(false); // 未设置
    applyEffects(env, {}, [{ setFlag: 'need', value: 'lock' }]);
    expect(evalCondition(env, {}, { hasFlagItem: 'need' })).toBe(true);
    expect(evalCondition(env, {}, { hasFlagItem: 'need', count: 2 })).toBe(false);
    applyEffects(env, {}, [{ flagItem: 'need', add: -1 }]);
    expect(env.run.inventory.lock).toBeUndefined();
    applyEffects(env, {}, [
      { setFlag: 'need', value: 'ghost' },
      { flagItem: 'need', add: 3 },
    ]);
    expect(env.run.inventory.ghost).toBeUndefined(); // 不是有效物品：无效果
  });

  it('atFlag：外出地点等于 flag 里的地点', () => {
    const env = makeEnv();
    const plan = { charId: 'alpha', locationId: 'shop', carry: [] };
    expect(evalCondition(env, { expedition: plan }, { atFlag: 'goal' })).toBe(false);
    applyEffects(env, {}, [{ setFlag: 'goal', value: 'shop' }]);
    expect(evalCondition(env, { expedition: plan }, { atFlag: 'goal' })).toBe(true);
    expect(evalCondition(env, {}, { atFlag: 'goal' })).toBe(false); // 没有外出
  });

  it('文案模板：{flag:} {flagItem:} {flagLocation:}', () => {
    const env = makeEnv();
    applyEffects(env, {}, [
      { setFlag: 'n', value: 4 },
      { setFlag: 'it', value: 'lock' },
      { setFlag: 'loc', value: 'shop' },
    ]);
    expect(formatText(env, {}, '还差 {flag:n} 份，带上{flagItem:it}去{flagLocation:loc}')).toBe(
      '还差 4 份，带上门锁去商店',
    );
    expect(formatText(env, {}, '{flag:none} {flagItem:n} {flagLocation:it}')).toBe(
      '{flag:none} {flagItem:n} {flagLocation:it}',
    );
  });

  it('备忘：按 when 过滤、按 order 排序、套模板', () => {
    const env = makeEnv({}, (db) => {
      db.notes = [
        { id: 'b', text: '第二条 {flag:n}', order: 2, when: { flag: 'n' } },
        { id: 'a', text: '第一条', order: 1 },
        { id: 'c', text: '不显示', when: { flag: 'never' } },
      ];
    });
    expect(getNotes(env).map((n) => n.text)).toEqual(['第一条']);
    applyEffects(env, {}, [{ setFlag: 'n', value: 3 }]);
    expect(getNotes(env)).toEqual([
      { id: 'a', text: '第一条' },
      { id: 'b', text: '第二条 3' },
    ]);
  });
});

describe('loseRandomItem 的 pick', () => {
  it('cheapest：先拿价格最低的，同价拿库存多的', () => {
    const env = makeEnv({ items: { can: 2, bottle: 3, medkit: 1 } }); // can 2 点、bottle 1 点、medkit 4 点
    applyEffects(env, {}, [{ loseRandomItem: { count: 4, pick: 'cheapest' } }]);
    expect(env.run.inventory).toEqual({ can: 1, medkit: 1 });
  });
  it('cheapest + tag', () => {
    const env = makeEnv({ items: { can: 2, bottle: 3 } });
    applyEffects(env, {}, [{ loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } }]);
    expect(env.run.inventory).toEqual({ can: 1, bottle: 3 });
  });
});

describe('away 条件', () => {
  it('self / { id } 在外出时为真，在家时为假', () => {
    const env = makeEnv();
    expect(evalCondition(env, { self: 'alpha' }, { away: 'self' })).toBe(false);
    env.run.characters.alpha.where = 'away';
    expect(evalCondition(env, { self: 'alpha' }, { away: 'self' })).toBe(true);
    expect(evalCondition(env, {}, { away: { id: 'alpha' } })).toBe(true);
    expect(evalCondition(env, {}, { away: 'any' })).toBe(false);
  });
});

describe('带在身上的道具对这趟外出生效', () => {
  it('道具规则：在库存或本次携带中都算，且只算一次', async () => {
    const { getModifier } = await import('../../src/engine');
    const env = makeEnv({ items: { lock: 1 } }, (db) => {
      db.items.find((i) => i.id === 'lock')!.rules = [
        { id: 'lock_safe', modifiers: [{ key: 'expedition.danger', mul: 0.5 }] },
      ];
    });
    const plan = { charId: 'alpha', locationId: 'shop', carry: ['lock'] };
    expect(getModifier(env, 'expedition.danger', 0.2, 'alpha', { expedition: plan })).toBeCloseTo(
      0.1,
    );
    delete env.run.inventory.lock; // 出发后离开库存
    expect(getModifier(env, 'expedition.danger', 0.2, 'alpha', { expedition: plan })).toBeCloseTo(
      0.1,
    );
    expect(getModifier(env, 'expedition.danger', 0.2, 'alpha')).toBeCloseTo(0.2); // 与外出无关的计算不算
  });
});
