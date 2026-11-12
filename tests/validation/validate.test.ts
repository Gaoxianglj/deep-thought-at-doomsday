import { describe, expect, it } from 'vitest';
import type { ContentDB } from '../../src/engine';
import { contentDB } from '../../src/data';
import { MODIFIER_KEY_PATTERNS, validateContent, type Issue } from '../../src/validation/validate';
import { makeDB } from '../fixtures/content';

function run(mutate: (db: ContentDB) => void): Issue[] {
  const db = makeDB();
  mutate(db);
  return validateContent(db);
}
function has(issues: Issue[], level: Issue['level'], text: string): boolean {
  return issues.some((i) => i.level === level && (i.path + i.message).includes(text));
}
function expectError(mutate: (db: ContentDB) => void, text: string): void {
  const issues = run(mutate);
  expect(has(issues, 'error', text), JSON.stringify(issues, null, 1)).toBe(true);
}
function expectWarn(mutate: (db: ContentDB) => void, text: string): void {
  const issues = run(mutate);
  expect(has(issues, 'warning', text), JSON.stringify(issues, null, 1)).toBe(true);
}

describe('夹具', () => {
  it('夹具本身没有 error', () => {
    expect(validateContent(makeDB()).filter((i) => i.level === 'error')).toEqual([]);
  });
  it('非对象输入给出 error', () => {
    expect(validateContent(null)[0].level).toBe('error');
  });
});

describe('第一层：schema', () => {
  it('未知的效果种类，并按 id 定位', () => {
    const issues = run((db) => {
      (db.events[0].choices[0].outcomes[0] as { effects?: unknown }).effects = [{ foo: 1 }];
    });
    expect(has(issues, 'error', 'events[break_in].choices[hold].outcomes[0].effects[0]')).toBe(
      true,
    );
    expect(has(issues, 'error', '未知的效果种类，键为 foo')).toBe(true);
  });
  it('未知的条件种类', () => {
    expectError((db) => {
      (db.events[1] as { when?: unknown }).when = { bogus: 1 };
    }, '未知的条件种类，键为 bogus');
  });
  it('主键匹配但字段类型错，指出字段', () => {
    expectError((db) => {
      (db.events[0].choices[0].outcomes[0] as { effects?: unknown }).effects = [
        { stat: 'hp', of: 'self', add: 'x' },
      ];
    }, '字段 add 类型错误');
  });
  it('嵌套在 all 里的条件错误也能定位', () => {
    expectError((db) => {
      db.events[1].when = { all: [{ stat: 'hp', of: 'self', gte: 'a' as unknown as number }] };
    }, 'when.all[0]');
  });
  it('schema 失败时仍继续做引用检查', () => {
    const issues = run((db) => {
      (db.stats[0] as { name?: unknown }).name = 5;
      db.events[0].choices[0].outcomes[0].next = 'nope';
    });
    expect(has(issues, 'error', '字段 name 类型错误')).toBe(true);
    expect(has(issues, 'error', '不存在的事件 "nope"')).toBe(true);
  });
});

describe('第二层：引用', () => {
  it('id 重复', () => {
    expectError((db) => {
      db.items.push({ ...db.items[0] });
    }, '物品 id "can" 重复');
  });
  it('条件引用不存在的 stat', () => {
    expectError((db) => {
      db.events[1].when = { stat: 'zzz', of: 'self', lt: 1 };
    }, '不存在的属性 "zzz"');
  });
  it('条件引用不存在的状态 / 物品 / 角色 / 地点', () => {
    expectError((db) => {
      db.events[1].when = {
        all: [
          { hasStatus: 'nostatus', of: 'self' },
          { hasItem: 'noitem' },
          { inParty: 'nobody' },
          { at: 'noplace' },
        ],
      };
    }, '不存在的状态 "nostatus"');
    expectError((db) => {
      db.events[1].when = { inParty: 'nobody' };
    }, '不存在的角色 "nobody"');
    expectError((db) => {
      db.events[1].when = { at: 'noplace' };
    }, '不存在的地点 "noplace"');
  });
  it('效果引用不存在的 queueEvent / ending / unlock', () => {
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ queueEvent: 'ghost' }];
    }, '不存在的事件 "ghost"');
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ ending: 'ghost' }];
    }, '不存在的结局 "ghost"');
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ unlock: 'ghost' }];
    }, '不存在的角色 "ghost"');
  });
  it('Target { id } 与 role.is 引用检查', () => {
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ stat: 'hp', of: { id: 'ghost' }, add: 1 }];
    }, '不存在的角色 "ghost"');
    expectError((db) => {
      db.events[2].roles = { who: { is: 'ghost' } };
    }, 'roles.who.is');
  });
  it('地点 / 地图 / config 引用', () => {
    expectError((db) => {
      db.locations[0].map = 'nomap';
    }, '不存在的地图 "nomap"');
    expectError((db) => {
      db.locations[0].loot = [{ item: 'noitem', weight: 1 }];
    }, '不存在的物品 "noitem"');
    expectError((db) => {
      db.locations[0].specials = [{ chance: 0.5, event: 'ghost' }];
    }, '不存在的事件 "ghost"');
    expectError((db) => {
      db.maps[0].startingPool.push('noitem');
    }, '开局物品池引用了不存在的物品');
    expectError((db) => {
      db.config.fallbackEnding = 'nope';
    }, 'config.fallbackEnding');
  });
  it('角色 stats 覆盖：键不存在 / 越界', () => {
    expectError((db) => {
      db.characters[0].stats = { zzz: 1 };
    }, '不存在的属性 "zzz"');
    expectError((db) => {
      db.characters[0].stats = { hp: 500 };
    }, '超出属性范围');
  });
  it('rationTags 没有对应带 onUse 的物品', () => {
    expectError((db) => {
      db.config.rationTags.push('luxury');
    }, '配给标签 "luxury"');
  });
  it('递归位置里的引用也会被查到（规则 effects / random / if）', () => {
    expectError((db) => {
      db.statuses[2].rules![1].effects = [
        { random: [{ effects: [{ if: { hasItem: 'noitem' }, then: [] }] }] },
      ];
    }, '不存在的物品 "noitem"');
  });
});

describe('第二层：数值', () => {
  it('stat min >= max / initial 越界', () => {
    expectError((db) => {
      db.stats[0].min = 100;
    }, '必须小于 max');
    expectError((db) => {
      db.stats[0].initial = 999;
    }, 'initial');
  });
  it('{ stat, set } 越界；add/set 都没有', () => {
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ stat: 'hp', of: 'self', set: 500 }];
    }, '超出属性 hp 的范围');
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ stat: 'hp', of: 'self' }];
    }, 'add 和 set 至少');
  });
  it('partySize / loot / weather duration 的 min > max', () => {
    expectError((db) => {
      db.maps[0].partySize = { min: 3, max: 1 };
    }, 'partySize');
    expectError((db) => {
      db.locations[0].loot = [{ item: 'can', weight: 1, min: 5, max: 2 }];
    }, 'loot[0]');
    expectError((db) => {
      db.weathers.push({ id: 'rain', name: '雨', duration: { min: 4, max: 2 } });
    }, 'weathers[rain].duration');
  });
  it('startingPool 物品没有 cost', () => {
    expectError((db) => {
      db.items.push({ id: 'rock', name: '石头', tags: [] });
      db.maps[0].startingPool.push('rock');
    }, '没有 cost');
  });
});

describe('第二层：Target 与占位符', () => {
  it('事件里 { role } 必须已定义，但 self 例外', () => {
    expectError((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ stat: 'hp', of: { role: 'ghost' }, add: 1 }];
    }, '未在 roles 中定义的角色 "ghost"');
    const ok = run((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ stat: 'hp', of: { role: 'self' }, add: 1 }];
    });
    expect(ok.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('规则 / 状态 / 物品上下文不得使用 { role }', () => {
    expectError((db) => {
      db.statuses[2].rules![1].effects = [{ stat: 'hp', of: { role: 'x' }, add: 1 }];
    }, '不得使用 { role');
  });
  it('未知占位符与不存在的 {item:xx}', () => {
    expectError((db) => {
      db.events[0].text = '有人 {nobody} 撞门。';
    }, '未知占位符 {nobody}');
    expectError((db) => {
      db.events[0].text = '拿着 {item:ghost}。';
    }, '不存在的物品 "ghost"');
  });
  it('{lost} 只能出现在结果文本和 log 里', () => {
    expectError((db) => {
      db.events[0].text = '丢了 {lost}。';
    }, '未知占位符 {lost}');
    expectError((db) => {
      db.config.texts.death = '{self} 丢了 {lost}';
    }, '未知占位符 {lost}');
  });
  it('config.texts 变量白名单', () => {
    expectError((db) => {
      db.config.texts.death = '{self} 在 {location} 死了';
    }, '未知占位符 {location}');
    const ok = run((db) => {
      db.config.texts.expeditionReturn = '{self} 从 {location} 带回 {loot}';
    });
    expect(ok.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('第二层：日记一致性', () => {
  it('无 roles 的日记写了角色名', () => {
    expectError((db) => {
      db.diary.push({ id: 'plain', text: '阿尔法 在发呆。' });
    }, '没有 roles 的日记文本中不得出现角色名');
  });
  it('有 roles 的日记写死了角色名', () => {
    expectError((db) => {
      db.diary[0].text = '{a} 和贝塔吵架了。';
    }, '写死了角色名');
  });
  it('定义了但没用到的 role 给 warning', () => {
    expectWarn((db) => {
      db.diary[1].roles = { a: {}, c: {} };
    }, '文本没有用到');
  });
});

describe('第二层：修正键与规则形态', () => {
  it('未知的修正键', () => {
    expectError((db) => {
      db.items[4].rules![0].modifiers = [{ key: 'weird.key', mul: 2 }];
    }, '未知的修正键');
  });
  it('修正键里的 stat / status 必须存在', () => {
    expectError((db) => {
      db.items[4].rules![0].modifiers = [{ key: 'stat.ghost.dailyDelta', add: 1 }];
    }, '不存在的属性 "ghost"');
    expectError((db) => {
      db.items[4].rules![0].modifiers = [{ key: 'status.ghost.gainChance', mul: 1 }];
    }, '不存在的状态 "ghost"');
  });
  it('合法修正键都能通过；模式表已导出', () => {
    expect(MODIFIER_KEY_PATTERNS.length).toBeGreaterThanOrEqual(9);
    const ok = run((db) => {
      db.items[4].rules![0].modifiers = [
        { key: 'expedition.lootRolls', add: 1 },
        { key: 'expedition.lootWeight.food', mul: 2 },
        { key: 'event.weight.bad', mul: 2 },
        { key: 'expedition.danger', mul: 0.5 },
      ];
    });
    expect(ok.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('modifier 缺 mul 和 add', () => {
    expectError((db) => {
      db.items[4].rules![0].modifiers = [{ key: 'expedition.danger' }];
    }, 'mul 和 add 至少');
  });
  it('有 trigger 但没有 effects；没有 trigger 却有 effects / 没有 modifiers', () => {
    expectError((db) => {
      db.statuses[2].rules![1] = { id: 'silly_trouble', trigger: 'dayEnd' };
    }, '必须有 effects');
    expectError((db) => {
      db.statuses[2].rules![0] = {
        id: 'silly_slow',
        modifiers: [{ key: 'expedition.danger', mul: 2 }],
        effects: [{ log: 'x' }],
      };
    }, '不会执行');
    expectError((db) => {
      db.statuses[2].rules![0] = { id: 'silly_slow' };
    }, '必须有 modifiers');
  });
  it('trigger 规则同时有 modifiers 给 warning', () => {
    expectWarn((db) => {
      db.statuses[2].rules![1].modifiers = [{ key: 'expedition.danger', mul: 2 }];
    }, '不会生效');
  });
});

describe('第二层：结果可用性与 chance', () => {
  it('所有 outcome 都带 when 给 warning', () => {
    expectWarn((db) => {
      db.events[0].choices[1].outcomes[0].when = { hasItem: 'lock' };
    }, '没有可用结果');
  });
  it('requires / event.when / role.where / 日记 when 中的 chance', () => {
    expectWarn((db) => {
      db.events[0].choices[1].requires = { chance: 0.5 };
    }, 'choices[chop].requires');
    expectWarn((db) => {
      db.events[1].when = { chance: 0.5 };
    }, 'events[knock].when');
    expectWarn((db) => {
      db.diary[1].when = { chance: 0.5 };
    }, 'diary[lively].when');
  });
});

describe('第三层：可达性', () => {
  it('权重 0 的事件没人引用', () => {
    expectWarn((db) => {
      db.events[0].choices[0].outcomes[0].effects = [];
      db.events[1].choices[1].outcomes[0].effects = [];
    }, 'events[break_in]');
  });
  it('没有 when 的结局无人引用', () => {
    expectWarn((db) => {
      db.endings.push({ id: 'ghost', name: '幽灵', text: '…', kind: 'other' });
    }, 'endings[ghost]');
  });
  it('状态无来源 / 物品无来源', () => {
    expectWarn((db) => {
      db.statuses.push({ id: 'orphan', name: '孤儿' });
    }, 'statuses[orphan]');
    expectWarn((db) => {
      db.items.push({ id: 'unobtainium', name: '稀有', tags: [] });
    }, 'items[unobtainium]');
  });
  it('flag 读了没设 / 设了没读', () => {
    expectWarn((db) => {
      db.endings[1].when = { flag: 'never_set' };
    }, '从未被设置的 flag "never_set"');
    expectWarn((db) => {
      db.events[0].choices[1].outcomes[0].effects = [{ setFlag: 'unused_flag', value: true }];
    }, '从未被读取');
  });
  it('角色解锁相关', () => {
    expectWarn((db) => {
      db.characters.push({ id: 'delta', name: '德尔塔', traits: [] });
    }, 'characters[delta]');
    expectError((db) => {
      for (const c of db.characters) c.unlockedByDefault = false;
    }, '没有任何默认解锁');
  });
  it('地图没有地点 / config.texts 缺键', () => {
    expectWarn((db) => {
      db.locations = [];
    }, 'maps[bunker]');
    expectWarn((db) => {
      db.config.texts = {};
    }, 'config.texts.weatherChange');
  });
});

describe('正式数据', () => {
  it.skipIf(contentDB.characters.length === 0)('contentDB 没有 error', () => {
    const errors = validateContent(contentDB).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
  });
});
