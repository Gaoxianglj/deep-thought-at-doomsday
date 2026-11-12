/**
 * 端到端：用正式内容（src/data）走通阶段 0 的完整流程。
 * 只依赖 IDS 里列出的内容 id，不依赖数值平衡。
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  buildContent,
  getArtState,
  getEventView,
  newRun,
  validateSetup,
  type Action,
  type Content,
  type ContentDB,
  type Env,
  type RunState,
} from '../../src/engine';
import { startEvent } from '../../src/engine/events';
import { contentDB } from '../../src/data';
import { createSaveService } from '../../src/save';
import { makeRng } from '../../src/sim/simulate';

/** 内容替换后只需改这里 */
const IDS = {
  mapId: 'city_ruins',
  difficultyId: 'easy',
  /** 默认解锁的两名角色（开局队伍） */
  defaultParty: ['big_fish', 'dragon_girl'],
  /** 通过事件解锁的角色 */
  guest: 'kiminai',
  /** 以"饿了就降智"为特性的角色 */
  dumbChar: 'dragon_girl',
  dumbStatus: 'dumb_mode',
  dumbArt: 'dumb',
  foodTag: 'food',
  waterTag: 'water',
  food: 'canned_food',
  water: 'bottled_water',
  junk: 'biscuit',
  events: {
    knock: 'knock',
    knockLetIn: 'let_in',
    knockRefuse: 'refuse',
    welcome: 'kiminai_welcome',
    welcomeChoice: 'welcome',
    breakIn: 'break_in',
    breakInChoice: 'hold',
    rats: 'rats',
    radio: 'radio_broadcast',
    radioChoice: 'respond',
    radioFlag: 'radio_signal',
    rescue: 'rescue_arrives',
    rescueChoice: 'board',
    storeSpecial: 'store_back_room',
  },
  items: { radio: 'radio', lock: 'door_lock', flashlight: 'flashlight' },
  /** 自救线：[部件, 安装事件, 选项, 标记] */
  selfRescue: [
    ['generator_part', 'install_generator', 'install', 'gen_installed'],
    ['water_filter', 'install_filter', 'install', 'filter_installed'],
    ['seed_pack', 'install_seeds', 'plant', 'seeds_installed'],
  ],
  endings: { selfRescue: 'self_rescue', rescue: 'rescued', wiped: 'wiped' },
  /** 外出：地点、对应专属事件、需携带的道具 */
  storeLoc: 'convenience_store',
  /** 内容删除容错用：要删的道具 / 事件 / 角色 */
  removeItem: 'radio',
  removeEvent: 'rats',
  removeChar: 'kiminai',
} as const;

const content: Content = buildContent(contentDB);

// ---------- 辅助 ----------
type Run = RunState;

function must(run: Run, action: Action, c: Content = content): Run {
  const r = applyAction(run, action, c);
  expect(r.error, JSON.stringify(action)).toBeUndefined();
  return r.state;
}

function envOf(run: Run, c: Content = content): Env {
  return { run, content: c };
}

/** 选第一个可选项并继续，直到没有待处理事件 */
function resolveEvents(run: Run, c: Content = content): Run {
  let r = run;
  for (let i = 0; i < 20 && r.phase === 'event'; i++) {
    const view = getEventView(envOf(r, c));
    if (!view) break;
    if (!view.result) {
      const choice = view.choices.find((x) => x.enabled);
      r = must(r, { type: 'chooseEventOption', choiceId: choice!.id }, c);
    }
    r = must(r, { type: 'continueEvent' }, c);
  }
  return r;
}

function start(
  seed: string,
  opts: { party?: string[]; items?: Record<string, number>; unlocked?: string[] } = {},
): Run {
  const party = opts.party ?? [...IDS.defaultParty];
  const run = newRun(content, {
    seed,
    mapId: IDS.mapId,
    difficultyId: IDS.difficultyId,
    party,
    items: opts.items ?? {},
    unlocked: opts.unlocked ?? [...IDS.defaultParty],
  });
  return resolveEvents(run);
}

/** 直接把某事件设为待处理事件（须处于计划阶段） */
function force(run: Run, eventId: string, roles?: Record<string, string>): Run {
  const r = structuredClone(run);
  expect(r.phase).toBe('plan');
  expect(startEvent(envOf(r), eventId, roles)).toBe(true);
  return r;
}

function choose(run: Run, choiceId: string): Run {
  return must(run, { type: 'chooseEventOption', choiceId });
}
function proceed(run: Run): Run {
  return must(run, { type: 'continueEvent' });
}

/** 所有属性拉满，保证不会饿死 */
function fillStats(run: Run): Run {
  const r = structuredClone(run);
  for (const ch of Object.values(r.characters)) {
    for (const s of content.db.stats) ch.stats[s.id] = s.max;
    ch.statuses = ch.statuses.filter((st) => !content.statuses.get(st.id)?.blocksExpedition);
  }
  return r;
}

/** 过一天：拉满属性（可选）→ 处理事件 → 结束当天。hook 在 endDay 之后（处理事件之前）调用。 */
function passDay(run: Run, opts: { fill?: boolean; hook?: (r: Run) => void } = {}): Run {
  let r = resolveEvents(run);
  if (r.phase === 'ended') return r;
  if (opts.fill !== false) r = fillStats(r);
  r = must(r, { type: 'endDay' });
  opts.hook?.(r);
  return r;
}

function newSave(c: Content = content, idb: IDBFactory = new IDBFactory()) {
  return { svc: createSaveService(c, { indexedDB: idb }), idb };
}

// ---------- 1. 基米奈完整流程 ----------
describe('基米奈解锁流程', () => {
  it('敲门 → 让她进来 → 加入 → 欢迎事件 → 存档解锁 → 新开局可选', async () => {
    let run = start('kim-1');
    expect(run.party).toEqual([...IDS.defaultParty]);
    expect(run.party).not.toContain(IDS.guest);

    run = force(run, IDS.events.knock);
    run = choose(run, IDS.events.knockLetIn);
    expect(run.pendingEvent?.result?.next).toBe(IDS.events.welcome);
    run = proceed(run);

    expect(run.party).toContain(IDS.guest);
    expect(run.characters[IDS.guest]?.where).toBe('shelter');
    expect(run.unlocked).toContain(IDS.guest);
    expect(run.newUnlocks).toContain(IDS.guest);
    expect(run.pendingEvent?.eventId).toBe(IDS.events.welcome);
    expect(getEventView(envOf(run))?.choices.some((c) => c.enabled)).toBe(true);
    run = proceed(choose(run, IDS.events.welcomeChoice));
    expect(run.phase).toBe('plan');

    const { svc } = newSave();
    const profile = await svc.createProfile('测试');
    expect(profile.unlockedCharacters).not.toContain(IDS.guest);
    const before = profile.unlockedCharacters;
    const saved = await svc.saveRun(profile.id, run);
    expect(saved.unlockedCharacters).toContain(IDS.guest);

    const pick = [IDS.defaultParty[0], IDS.guest];
    const base = {
      seed: 'kim-2',
      mapId: IDS.mapId,
      difficultyId: IDS.difficultyId,
      party: pick,
      items: {},
    };
    expect(validateSetup(content, { ...base, unlocked: saved.unlockedCharacters })).toEqual([]);
    expect(validateSetup(content, { ...base, unlocked: before })).toContain('characterLocked');
    const run2 = newRun(content, { ...base, unlocked: saved.unlockedCharacters });
    expect(run2.party).toEqual(pick);
  });
});

// ---------- 2. 拒绝后的冷却 ----------
describe('拒绝基米奈后', () => {
  it('冷却期内不再随机出现，冷却过后仍可能再出现', () => {
    const cooldown = content.events.get(IDS.events.knock)!.cooldown!;
    let reappeared = 0;
    for (let i = 0; i < 25; i++) {
      let run = start(`refuse-${i}`);
      run.day = 3; // 满足事件的 day 条件
      run = force(run, IDS.events.knock);
      const day0 = run.day;
      run = proceed(choose(run, IDS.events.knockRefuse));
      expect(run.party).not.toContain(IDS.guest);
      let again = false;
      for (let d = 0; d < 30 && run.phase !== 'ended' && !again; d++) {
        run = passDay(run, {
          hook: (r) => {
            if (r.pendingEvent?.eventId === IDS.events.knock) {
              if (r.day - day0 <= cooldown) throw new Error(`冷却期内出现 (day ${r.day})`);
              again = true;
            }
          },
        });
      }
      if (again) reappeared++;
    }
    expect(reappeared).toBeGreaterThan(0);
  });
});

// ---------- 3. 自救结局 ----------
describe('自救结局', () => {
  it('三个部件 → 三个安装事件 → 自救结局；finishRun 记录结局并清除对局', async () => {
    const items = Object.fromEntries(IDS.selfRescue.map(([part]) => [part, 1]));
    let run = start('self-1');
    run.inventory = { ...run.inventory, ...items };
    const { svc } = newSave();
    const profile = await svc.createProfile('测试');

    IDS.selfRescue.forEach(([part, event, choice, flag], i) => {
      run = force(run, event);
      expect(run.pendingEvent?.eventId).toBe(event);
      run = choose(run, choice);
      expect(run.flags[flag]).toBe(true);
      expect(run.inventory[part]).toBeUndefined();
      if (i < IDS.selfRescue.length - 1) {
        run = proceed(run);
        expect(run.ending).toBeNull();
      }
    });
    await svc.saveRun(profile.id, run);
    run = proceed(run);
    if (run.phase !== 'ended') run = must(fillStats(run), { type: 'endDay' });

    expect(run.ending?.id).toBe(IDS.endings.selfRescue);
    expect(run.phase).toBe('ended');
    expect(applyAction(run, { type: 'endDay' }, content).error).toBe('runEnded');

    const updated = await svc.finishRun(profile.id, run);
    expect(updated.endingsSeen).toContain(IDS.endings.selfRescue);
    expect(updated.runsPlayed).toBe(1);
    expect((await svc.loadRun(profile.id)).run).toBeNull();
  });
});

// ---------- 4. 救援结局 ----------
describe('救援结局', () => {
  it('收音机 → 广播 → 回应 → 4 天内的清晨救援必定出现 → 选择后得救', () => {
    let done = 0;
    for (let i = 0; i < 12 && done < 3; i++) {
      let run = start(`rescue-${i}`, { items: { [IDS.items.radio]: 1 } });
      run = force(run, IDS.events.radio);
      run = choose(run, IDS.events.radioChoice);
      if (!run.flags[IDS.events.radioFlag]) continue; // 这次信号断了，换个种子
      const queued = run.eventQueue.find((q) => q.eventId === IDS.events.rescue);
      expect(queued).toBeDefined();
      const due = queued!.day;
      run = proceed(run);
      let arrived = false;
      for (let d = 0; d < 20 && !arrived; d++) {
        run = passDay(run, {
          hook: (r) => {
            const id = r.pendingEvent?.eventId;
            if (r.day < due) expect(id).not.toBe(IDS.events.rescue);
            if (r.day === due) {
              expect(id).toBe(IDS.events.rescue);
              arrived = true;
            }
          },
        });
      }
      expect(arrived).toBe(true);
      run = proceed(choose(run, IDS.events.rescueChoice));
      expect(run.ending?.id).toBe(IDS.endings.rescue);
      expect(run.phase).toBe('ended');
      done++;
    }
    expect(done).toBeGreaterThan(0);
  });

  it('没有收音机时广播事件从不出现', () => {
    for (let i = 0; i < 15; i++) {
      let run = start(`noradio-${i}`);
      run.day = 3;
      for (let d = 0; d < 15 && run.phase !== 'ended'; d++) {
        run = passDay(run, {
          hook: (r) => expect(r.pendingEvent?.eventId).not.toBe(IDS.events.radio),
        });
      }
      expect(run.history[`event:${IDS.events.radio}`]).toBeUndefined();
    }
  });
});

// ---------- 5. 全灭结局 ----------
describe('全灭结局', () => {
  it('不给配给一路结束当天 → 全灭，每个角色都有死亡日志', () => {
    let run = start('wipe-1');
    const party = [...IDS.defaultParty];
    const deaths = new Set<string>();
    for (let d = 0; d < 80 && run.phase !== 'ended'; d++) {
      run = passDay(run, { fill: false });
      for (const l of run.log) if (l.kind === 'death') deaths.add(`${l.day}|${l.text}`);
    }
    expect(run.phase).toBe('ended');
    expect(run.ending?.id).toBe(IDS.endings.wiped);
    for (const id of run.party) {
      expect(run.characters[id].where).toBe('dead');
      const name = content.characters.get(id)!.name;
      expect(
        [...deaths].some((t) => t.includes(name)),
        `${name} 缺少死亡日志`,
      ).toBe(true);
    }
    for (const id of party) expect(run.party).toContain(id);
  });
});

// ---------- 6. 道具改变事件 ----------
describe('道具改变事件结果', () => {
  it('破门：有门锁时消耗门锁并保住物资；没门锁时丢物资，结果文案不同', () => {
    const stock = { [IDS.junk]: 6 };
    const resolve = (items: Record<string, number>) =>
      choose(force(start('door-1', { items }), IDS.events.breakIn), IDS.events.breakInChoice);

    const withLock = resolve({ ...stock, [IDS.items.lock]: 1 });
    expect(withLock.inventory[IDS.items.lock]).toBeUndefined();
    expect(withLock.inventory[IDS.junk]).toBe(6);

    const noLock = resolve(stock);
    expect(noLock.inventory[IDS.junk] ?? 0).toBeLessThan(6);
    expect(noLock.pendingEvent?.result?.text).not.toBe(withLock.pendingEvent?.result?.text);
  });
});

// ---------- 7. 外出与专属事件 ----------
describe('外出', () => {
  function trip(seed: string, carry: string[]): { run: Run } {
    const charId = IDS.defaultParty[0];
    let run = start(seed, { items: { [IDS.items.flashlight]: 1 } });
    run = fillStats(run);
    run = must(run, {
      type: 'planExpedition',
      charId,
      locationId: IDS.storeLoc,
      carry,
    });
    run = must(run, { type: 'endDay' });
    for (let d = 0; d < 6 && run.expedition; d++) run = passDay(run);
    return { run };
  }

  it('专属事件在返回当天清晨出现，self 为外出者', () => {
    const charId = IDS.defaultParty[0];
    let seen = 0;
    for (let i = 0; i < 40 && seen === 0; i++) {
      let run = fillStats(start(`trip2-${i}`, { items: { [IDS.items.flashlight]: 1 } }));
      run = must(run, {
        type: 'planExpedition',
        charId,
        locationId: IDS.storeLoc,
        carry: [IDS.items.flashlight],
      });
      for (let d = 0; d < 6; d++) {
        run = must(fillStats(resolveEvents(run)), { type: 'endDay' });
        if (run.pendingEvent?.eventId === IDS.events.storeSpecial) {
          expect(run.pendingEvent.roles.self).toBe(charId);
          expect(run.characters[charId].where).toBe('shelter');
          seen++;
          break;
        }
        if (!run.expedition) break;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('不携带时从不触发', () => {
    for (let i = 0; i < 30; i++) {
      const { run } = trip(`trip-n-${i}`, []);
      expect(run.history[`event:${IDS.events.storeSpecial}`]).toBeUndefined();
    }
  });
});

// ---------- 8. 降智模式 ----------
describe('降智模式', () => {
  it('饿了获得降智状态与美术状态，喂饱后消失', () => {
    let run = start('dumb-1', { items: { [IDS.food]: 3 } });
    const id = IDS.dumbChar;
    run = fillStats(run);
    run.characters[id].stats.satiety = 20;
    run = must(run, { type: 'endDay' });
    expect(run.characters[id].statuses.some((s) => s.id === IDS.dumbStatus)).toBe(true);
    expect(getArtState(run, content, id)).toBe(IDS.dumbArt);

    run = resolveEvents(run);
    run.characters[id].stats.hydration = 100;
    run = must(run, { type: 'setRation', charId: id, tag: IDS.foodTag, itemId: IDS.food });
    run = must(run, { type: 'endDay' });
    expect(run.characters[id].statuses.some((s) => s.id === IDS.dumbStatus)).toBe(false);
    expect(getArtState(run, content, id)).not.toBe(IDS.dumbArt);
  });
});

// ---------- 9. 日记一致性 ----------
describe('日记与日志文本', () => {
  const PLACEHOLDER = /\{[^}]*\}/;

  it('30 个种子 × 30 天：日记只提到此刻在庇护所的活人，且没有未解析占位符', () => {
    const everyone = [...IDS.defaultParty, IDS.guest];
    const names = content.db.characters.map((c) => [c.id, c.name] as const);
    let awayDays = 0;
    let hungryDays = 0;
    for (let i = 0; i < 30; i++) {
      const rng = makeRng(`diary-${i}`);
      let run = newRun(content, {
        seed: `diary-${i}`,
        mapId: IDS.mapId,
        difficultyId: IDS.difficultyId,
        party: everyone,
        items: { [IDS.junk]: 10, [IDS.water]: 12 },
        unlocked: everyone,
      });
      const seen = new Set<string>();
      const check = (r: Run) => {
        for (const l of r.log) {
          expect(l.text, `${l.kind}: ${l.text}`).not.toMatch(PLACEHOLDER);
        }
        for (const l of r.log) {
          if (l.kind !== 'diary' || l.day !== r.day) continue;
          const key = `${l.day}|${l.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (const [cid, name] of names) {
            if (l.text.includes(name)) {
              expect(r.characters[cid]?.where, `${l.text}（第 ${r.day} 天）`).toBe('shelter');
            }
          }
        }
        if (Object.values(r.characters).some((c) => c.where === 'away')) awayDays++;
        if (Object.values(r.characters).some((c) => c.statuses.some((s) => s.id === 'hungry')))
          hungryDays++;
      };
      check(run);
      for (let step = 0; step < 400 && run.day <= 30 && run.phase !== 'ended'; step++) {
        if (run.phase === 'event') {
          run = resolveEvents(run);
          continue;
        }
        if (!run.expedition && !run.plan.expedition && rng() < 0.5) {
          const shelter = run.party.filter((p) => run.characters[p].where === 'shelter');
          const charId = shelter[Math.floor(rng() * shelter.length)];
          const locs = content.db.locations.filter((l) => l.map === IDS.mapId);
          const loc = locs[Math.floor(rng() * locs.length)];
          const r = applyAction(
            run,
            { type: 'planExpedition', charId, locationId: loc.id, carry: [] },
            content,
          );
          if (!r.error) run = r.state;
        }
        // 只给一部分人配给，让有人挨饿
        run.party.forEach((p, idx) => {
          if (run.characters[p].where !== 'shelter' || (idx + Math.floor(run.day / 5)) % 2) return;
          for (const [tag, item] of [
            [IDS.foodTag, IDS.junk],
            [IDS.waterTag, IDS.water],
          ] as const) {
            const r = applyAction(
              run,
              { type: 'setRation', charId: p, tag, itemId: item },
              content,
            );
            if (!r.error) run = r.state;
          }
        });
        run = must(run, { type: 'endDay' });
        check(run);
      }
    }
    expect(awayDays).toBeGreaterThan(0);
    expect(hungryDays).toBeGreaterThan(0);
  });
});

// ---------- 10. 存档往返 ----------
describe('存档往返', () => {
  /** 与随机数无关的确定性动作序列 */
  function scripted(run: Run, step: number): Run {
    let r = resolveEvents(run);
    if (r.phase === 'ended') return r;
    if (step % 3 === 0 && !r.expedition) {
      const t = applyAction(
        r,
        { type: 'planExpedition', charId: r.party[0], locationId: IDS.storeLoc, carry: [] },
        content,
      );
      if (!t.error) r = t.state;
    }
    for (const id of r.party) {
      if (r.characters[id].where !== 'shelter') continue;
      for (const [tag, item] of [
        [IDS.foodTag, IDS.junk],
        [IDS.waterTag, IDS.water],
      ] as const) {
        const t = applyAction(r, { type: 'setRation', charId: id, tag, itemId: item }, content);
        if (!t.error) r = t.state;
      }
    }
    return must(r, { type: 'endDay' });
  }

  it('中途（已选未继续的事件 + 进行中的外出）导出再导入，深度相等且后续一致', async () => {
    let run = start('rt-1', { items: { [IDS.junk]: 8, [IDS.water]: 10 } });
    run = must(fillStats(run), {
      type: 'planExpedition',
      charId: IDS.defaultParty[0],
      locationId: content.db.locations.find((l) => l.distance >= 2)!.id,
      carry: [],
    });
    run = must(run, { type: 'endDay' });
    run = fillStats(resolveEvents(run));
    expect(run.expedition).not.toBeNull();
    run = choose(force(run, IDS.events.rats), content.events.get(IDS.events.rats)!.choices[0].id);
    expect(run.pendingEvent?.result).toBeDefined();

    const a = newSave();
    const pa = await a.svc.createProfile('甲');
    await a.svc.saveRun(pa.id, run);
    const code = await a.svc.exportCode(pa.id);

    const b = newSave();
    const imported = await b.svc.importText(code);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.hasRun).toBe(true);
    const loaded = await b.svc.loadRun(imported.profile.id);
    expect(loaded.notices).toEqual([]);
    expect(loaded.run).toEqual(run);

    let x = run;
    let y = loaded.run!;
    for (let step = 1; step <= 12 && x.phase !== 'ended'; step++) {
      x = scripted(x, step);
      y = scripted(y, step);
      expect(y).toEqual(x);
    }
  });
});

// ---------- 11. 内容删除容错 ----------
describe('内容删除容错', () => {
  it('删掉道具、事件、角色后读取旧存档：不抛异常、有提示、能继续', async () => {
    const everyone = [...IDS.defaultParty, IDS.guest];
    let run = newRun(content, {
      seed: 'rm-1',
      mapId: IDS.mapId,
      difficultyId: IDS.difficultyId,
      party: everyone,
      items: { [IDS.items.radio]: 1, [IDS.food]: 4, [IDS.water]: 6 },
      unlocked: everyone,
    });
    run = resolveEvents(run);
    run.eventQueue.push({ eventId: IDS.removeEvent, day: run.day + 5, roles: {} });
    run = force(run, IDS.removeEvent);
    const { svc, idb } = newSave();
    const p = await svc.createProfile('甲');
    await svc.saveRun(p.id, run);

    const db: ContentDB = structuredClone(contentDB);
    db.items = db.items.filter((i) => i.id !== IDS.removeItem);
    db.events = db.events.filter((e) => e.id !== IDS.removeEvent);
    db.characters = db.characters.filter((c) => c.id !== IDS.removeChar);
    const reduced = buildContent(db);
    const svc2 = createSaveService(reduced, { indexedDB: idb });
    const { run: loaded, notices } = await svc2.loadRun(p.id);
    expect(notices.length).toBeGreaterThan(0);
    expect(loaded).not.toBeNull();
    expect(loaded!.inventory[IDS.removeItem]).toBeUndefined();
    expect(loaded!.party).not.toContain(IDS.removeChar);

    let r = resolveEvents(loaded!, reduced);
    for (let d = 0; d < 8 && r.phase !== 'ended'; d++) {
      r = resolveEvents(r, reduced);
      if (r.phase === 'ended') break;
      r = must(r, { type: 'endDay' }, reduced);
    }
    expect(r.day).toBeGreaterThan(loaded!.day);
  });
});
