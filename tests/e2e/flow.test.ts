/**
 * 端到端：用正式内容（src/data）走通阶段 1 的完整流程：访客入队、四条结局线、道具事件、存档。
 * 只依赖 IDS 里列出的内容 id，不依赖数值平衡。
 * 结局线的用例用 calm 内容（不抽随机事件、外出无危险）跑，只为排除随机干扰；事件链与规则都是正式数据。
 */
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  aliveIds,
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
  /** 默认解锁的角色；开局队伍取前两个 */
  defaultParty: ['big_fish', 'dragon_girl'],
  /** 第三个默认解锁的角色（凑满开局 3 人用） */
  third: 'tangbao',
  /** 通过事件解锁的角色 */
  guest: 'kiminai',
  /** 以"饿了就降智"为特性的角色 */
  dumbChar: 'dragon_girl',
  dumbStatus: 'dumb_mode',
  dumbArt: 'dumb',
  foodTag: 'food',
  waterTag: 'water',
  /** 访客入队事件的 tag（同时在世超过上限时不得出现） */
  visitorTag: 'visitor',
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
    ratsSpray: 'spray',
    storeSpecial: 'store_back_room',
  },
  items: {
    radio: 'radio',
    lock: 'door_lock',
    flashlight: 'flashlight',
    bugSpray: 'bug_spray',
  },
  /** 自救线：[部件, 安装事件, 选项, 标记] */
  selfRescue: [
    ['generator_part', 'install_generator', 'install', 'gen_installed'],
    ['water_filter', 'install_filter', 'install', 'filter_installed'],
    ['seed_pack', 'install_seeds', 'plant', 'seeds_installed'],
    ['vent_filter', 'install_vent', 'install', 'vent_installed'],
  ],
  military: {
    itemFlag: 'evac_item',
    candidates: ['gas_mask', 'flare', 'flashlight', 'map_book', 'rope'],
    broadcast: 'military_broadcast',
    respond: 'respond',
    contactFlag: 'evac_contact',
    rendezvous: 'military_rendezvous',
    delay: 3,
    show: 'show',
    giveUp: 'give_up',
  },
  caravan: {
    first: 'caravan_first_contact',
    talk: 'talk',
    visitEvent: 'caravan_visit',
    giveWater: 'give_water',
    giveFood: 'give_food',
    enough: 'enough',
    waterLeft: 'caravan_water_left',
    foodLeft: 'caravan_food_left',
    gone: 'caravan_gone',
    /** 最多来访次数（含第一次谈妥后的那次） */
    maxVisits: 6,
    /** 每次上交的份数 */
    batch: 1,
  },
  trail: {
    flyer: 'strange_flyer',
    keep: 'keep',
    flags: ['trail_1', 'trail_2', 'trail_3'],
    candidates: [
      'residential_block',
      'library',
      'pharmacy',
      'subway_station',
      'police_station',
      'hardware_market',
    ],
    clues: ['trail_clue_1', 'trail_clue_2', 'trail_clue_3'],
    clueChoice: 'read',
    train: 'underground_train',
    trainChoice: 'flashlight',
  },
  endings: {
    selfRescue: 'self_rescue',
    military: 'military_evac',
    caravan: 'caravan',
    subway: 'subway_rescue',
    wiped: 'wiped',
  },
  /** 外出：地点、对应专属事件、需携带的道具 */
  storeLoc: 'convenience_store',
  /** 内容删除容错用：要删的道具 / 事件 / 角色 */
  removeItem: 'radio',
  removeEvent: 'rats',
  removeChar: 'kiminai',
} as const;

const content: Content = buildContent(contentDB);

/** 正式内容的"安静"版：不抽随机事件、外出没有危险（排队事件、规则、事件链都不变） */
const calm: Content = (() => {
  const db: ContentDB = structuredClone(contentDB);
  for (const m of db.maps) m.eventDailyChance = 0;
  for (const l of db.locations) l.danger = 0;
  return buildContent(db);
})();

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

/** 选第一个可选项并继续，直到没有待处理事件；stopAt 里的事件出现时停下（不处理） */
function resolveEvents(run: Run, c: Content = content, stopAt: string[] = []): Run {
  let r = run;
  for (let i = 0; i < 20 && r.phase === 'event'; i++) {
    const view = getEventView(envOf(r, c));
    if (!view) break;
    if (!view.result && stopAt.includes(view.eventId)) break;
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
  c: Content = content,
): Run {
  const party = opts.party ?? [...IDS.defaultParty];
  const run = newRun(c, {
    seed,
    mapId: IDS.mapId,
    difficultyId: IDS.difficultyId,
    party,
    items: opts.items ?? {},
    unlocked: opts.unlocked ?? [...IDS.defaultParty, IDS.third],
  });
  return resolveEvents(run, c);
}

/** 直接把某事件设为待处理事件（须处于计划阶段） */
function force(run: Run, eventId: string, roles?: Record<string, string>, c = content): Run {
  const r = structuredClone(run);
  expect(r.phase).toBe('plan');
  expect(startEvent(envOf(r, c), eventId, roles)).toBe(true);
  return r;
}

function choose(run: Run, choiceId: string, c: Content = content): Run {
  return must(run, { type: 'chooseEventOption', choiceId }, c);
}
function proceed(run: Run, c: Content = content): Run {
  return must(run, { type: 'continueEvent' }, c);
}

/** 所有属性拉满、去掉禁止外出的状态，保证不会饿死、能派人出门 */
function fillStats(run: Run, c: Content = content): Run {
  const r = structuredClone(run);
  for (const ch of Object.values(r.characters)) {
    for (const s of c.db.stats) ch.stats[s.id] = s.max;
    ch.statuses = ch.statuses.filter((st) => !c.statuses.get(st.id)?.blocksExpedition);
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

/**
 * 在 c 内容下一天天推进（拉满属性），其他事件选第一个可选项，直到 eventId 成为待选择的事件。
 * 返回停下时的状态与经过的天数；maxDays 内没等到返回 null。
 */
function advanceTo(run: Run, eventId: string, c: Content, maxDays = 10): Run | null {
  let r = resolveEvents(run, c, [eventId]);
  for (let d = 0; d <= maxDays; d++) {
    if (r.pendingEvent?.eventId === eventId && !r.pendingEvent.result) return r;
    if (r.phase === 'ended') return null;
    r = must(fillStats(r, c), { type: 'endDay' }, c);
    r = resolveEvents(r, c, [eventId]);
  }
  return null;
}

function newSave(c: Content = content, idb: IDBFactory = new IDBFactory()) {
  return { svc: createSaveService(c, { indexedDB: idb }), idb };
}

const hasTag = (eventId: string | undefined, tag: string) =>
  !!eventId && (content.events.get(eventId)?.tags ?? []).includes(tag);

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

// ---------- 2b. 同时在世的人数上限 ----------
describe('访客人数上限', () => {
  it('已有 4 名活人时，任何访客事件都不会被随机抽到', () => {
    let fourDays = 0;
    for (let i = 0; i < 10; i++) {
      const party = [...IDS.defaultParty, IDS.third];
      let run = start(`cap-${i}`, { party });
      run.day = 6; // 满足各访客事件的天数条件
      run = proceed(choose(force(run, IDS.events.knock), IDS.events.knockLetIn));
      run = resolveEvents(run);
      expect(aliveIds(run)).toHaveLength(4);
      for (let d = 0; d < 20 && run.phase !== 'ended'; d++) {
        run = passDay(run, {
          hook: (r) => {
            const alive = aliveIds(r).length;
            if (alive >= 4) fourDays++;
            if (hasTag(r.pendingEvent?.eventId, IDS.visitorTag))
              expect(alive).toBeLessThanOrEqual(3);
          },
        });
      }
    }
    expect(fourDays).toBeGreaterThan(50);
  });
});

// ---------- 3. 自救结局 ----------
describe('自救结局', () => {
  const allParts = Object.fromEntries(IDS.selfRescue.map(([part]) => [part, 1]));

  it('四个部件 → 次日清晨依次弹出四个安装事件 → 自救结局；finishRun 记录结局并清除对局', async () => {
    let run = start('self-1', {}, calm);
    run.inventory = { ...run.inventory, ...allParts };
    const { svc } = newSave(calm);
    const profile = await svc.createProfile('测试');

    const day = run.day;
    run = must(fillStats(run, calm), { type: 'endDay' }, calm);
    expect(run.day).toBe(day + 1);
    IDS.selfRescue.forEach(([part, event, choice, flag], i) => {
      expect(run.pendingEvent?.eventId).toBe(event);
      run = choose(run, choice, calm);
      expect(run.flags[flag]).toBe(true);
      expect(run.inventory[part]).toBeUndefined();
      if (i < IDS.selfRescue.length - 1) {
        run = proceed(run, calm);
        expect(run.ending).toBeNull();
      }
    });
    await svc.saveRun(profile.id, run);
    run = proceed(run, calm);
    if (run.phase !== 'ended') run = must(fillStats(run, calm), { type: 'endDay' }, calm);

    expect(run.ending?.id).toBe(IDS.endings.selfRescue);
    expect(run.phase).toBe('ended');
    expect(applyAction(run, { type: 'endDay' }, calm).error).toBe('runEnded');

    const updated = await svc.finishRun(profile.id, run);
    expect(updated.endingsSeen).toContain(IDS.endings.selfRescue);
    expect(updated.runsPlayed).toBe(1);
    expect((await svc.loadRun(profile.id)).run).toBeNull();
  });

  it('只有三个部件：装完三个设施也不会达成，缺的那个安装事件不会出现', () => {
    const [missing, ...rest] = [...IDS.selfRescue].reverse();
    let run = start('self-3', {}, calm);
    run.inventory = { ...run.inventory, ...Object.fromEntries(rest.map(([p]) => [p, 1])) };
    for (let d = 0; d < 6 && run.phase !== 'ended'; d++) {
      run = must(fillStats(run, calm), { type: 'endDay' }, calm);
      run = resolveEvents(run, calm);
    }
    for (const [, , , flag] of rest) expect(run.flags[flag]).toBe(true);
    expect(run.flags[missing[3]]).toBeFalsy();
    expect(run.history[`event:${missing[1]}`]).toBeUndefined();
    expect(run.ending).toBeNull();
  });
});

// ---------- 4. 军方撤离 ----------
describe('军方撤离', () => {
  const M = IDS.military;

  it('第 1 天清晨就随机定下凭证：候选五选一，不同种子会不同', () => {
    const picked = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const run = start(`evac-pick-${i}`);
      const item = run.flags[M.itemFlag];
      expect(M.candidates).toContain(item);
      picked.add(item as string);
    }
    expect(picked.size).toBeGreaterThan(1);
  });

  /** 有收音机 → 广播 → 回应成功（失败就换种子）；返回回应后的状态与约定日 */
  function contact(prefix: string, extra: (item: string) => Record<string, number>) {
    for (let i = 0; i < 20; i++) {
      let run = start(`${prefix}-${i}`, {}, calm);
      const item = run.flags[M.itemFlag] as string;
      run.inventory = { ...run.inventory, [IDS.items.radio]: 1, ...extra(item) };
      run = force(run, M.broadcast, undefined, calm);
      run = choose(run, M.respond, calm);
      if (!run.flags[M.contactFlag]) continue; // 这次没联系上，换个种子
      const due = run.eventQueue.find((q) => q.eventId === M.rendezvous)?.day;
      expect(due).toBe(run.day + M.delay);
      return { run: proceed(run, calm), due: due!, item };
    }
    throw new Error('20 个种子都没联系上');
  }

  it('回应 → 3 天后装甲车到 → 出示凭证 → 军方撤离', () => {
    const { run: r0, due, item } = contact('evac', (item) => ({ [item]: 3 }));
    const run = advanceTo(r0, M.rendezvous, calm);
    expect(run).not.toBeNull();
    expect(run!.day).toBe(due);
    const show = getEventView(envOf(run!, calm))!.choices.find((c) => c.id === M.show)!;
    expect(show.enabled).toBe(true);
    expect(show.text).toContain(calm.items.get(item)!.name);
    const end = proceed(choose(run!, M.show, calm), calm);
    expect(end.ending?.id).toBe(IDS.endings.military);
    expect(end.phase).toBe('ended');
  });

  it('拿不出凭证：出示选项置灰，放弃后约定作废（evac_contact 回到 false）', () => {
    const { run: r0 } = contact('evac-no', () => ({}));
    let run = advanceTo(r0, M.rendezvous, calm)!;
    expect(run).not.toBeNull();
    const view = getEventView(envOf(run, calm))!;
    expect(view.choices.find((c) => c.id === M.show)?.enabled).toBe(false);
    run = proceed(choose(run, M.giveUp, calm), calm);
    expect(run.flags[M.contactFlag]).toBe(false);
    expect(run.ending).toBeNull();
  });

  it('没有收音机时广播事件从不出现', () => {
    for (let i = 0; i < 15; i++) {
      let run = start(`noradio-${i}`);
      run.day = 5;
      for (let d = 0; d < 15 && run.phase !== 'ended'; d++) {
        run = passDay(run, {
          hook: (r) => expect(r.pendingEvent?.eventId).not.toBe(M.broadcast),
        });
      }
      expect(run.history[`event:${M.broadcast}`]).toBeUndefined();
    }
  });
});

// ---------- 5. 南下车队 ----------
describe('南下车队', () => {
  const V = IDS.caravan;

  function meet(seed: string, stock: number): Run {
    let run = start(seed, {}, calm);
    run.inventory = { ...run.inventory, [IDS.food]: stock, [IDS.water]: stock };
    run = force(run, V.first, undefined, calm);
    run = choose(run, V.talk, calm);
    expect(run.pendingEvent?.result?.next).toBe(V.visitEvent);
    run = proceed(run, calm);
    expect(run.pendingEvent?.eventId).toBe(V.visitEvent);
    return run;
  }

  it('库存充足时一次来访里连续上交，交齐即被带走', () => {
    let run = meet('caravan-1', 30);
    const need = (run.flags[V.waterLeft] as number) + (run.flags[V.foodLeft] as number);
    expect(need).toBeGreaterThan(0);
    let batches = 0;
    while (run.phase !== 'ended' && batches < 20) {
      expect(run.pendingEvent?.eventId).toBe(V.visitEvent);
      const pick = (run.flags[V.waterLeft] as number) > 0 ? V.giveWater : V.giveFood;
      run = proceed(choose(run, pick, calm), calm);
      batches++;
    }
    expect(run.ending?.id).toBe(IDS.endings.caravan);
    expect(batches).toBe(Math.ceil(need / V.batch));
    expect(run.inventory[IDS.water] ?? 0).toBeLessThan(30);
    expect(run.inventory[IDS.food] ?? 0).toBeLessThan(30);
  });

  it(`一直"这次就到这儿"：来 ${IDS.caravan.maxVisits} 次后车队离开，不再来访`, () => {
    let run = meet('caravan-2', 4);
    for (let v = 1; v <= V.maxVisits; v++) {
      if (v > 1) {
        const next = advanceTo(run, V.visitEvent, calm, 5);
        expect(next, `第 ${v} 次来访`).not.toBeNull();
        run = next!;
      }
      run = proceed(choose(run, V.enough, calm), calm);
      expect(!!run.flags[V.gone]).toBe(v === V.maxVisits);
    }
    expect(run.eventQueue.some((q) => q.eventId === V.visitEvent)).toBe(false);
    expect(advanceTo(run, V.visitEvent, calm, 10)).toBeNull();
    expect(run.history[`event:${V.visitEvent}`]?.count).toBe(V.maxVisits);
  });
});

// ---------- 6. 地下列车 ----------
describe('地下列车', () => {
  const L = IDS.trail;
  const charId = IDS.defaultParty[0];

  /** 派人去某地点，一天天推进到返回当天清晨；返回这天清晨的状态（事件未处理） */
  function trip(run: Run, locationId: string): Run {
    let r = must(
      fillStats(run, calm),
      { type: 'planExpedition', charId, locationId, carry: [] },
      calm,
    );
    r = must(r, { type: 'endDay' }, calm);
    for (let d = 0; d < 6 && r.expedition; d++) {
      r = resolveEvents(r, calm);
      r = must(fillStats(r, calm), { type: 'endDay' }, calm);
    }
    expect(r.expedition).toBeNull();
    expect(r.characters[charId].where).toBe('shelter');
    return r;
  }

  it('传单定下三个不同的记号地点；按顺序去对的地方才出现记号；第三个记号后列车到站', () => {
    let run = start('trail-1', { items: { [IDS.items.flashlight]: 1 } }, calm);
    run = proceed(choose(force(run, L.flyer, undefined, calm), L.keep, calm), calm);
    const spots = L.flags.map((f) => run.flags[f] as string);
    for (const s of spots) expect(L.candidates).toContain(s);
    expect(new Set(spots).size).toBe(3);

    // 去错地方（第二个记号的地点）：不触发第一个记号
    run = trip(run, spots[1]);
    expect(run.pendingEvent?.eventId).not.toBe(L.clues[0]);
    run = resolveEvents(run, calm);
    expect(run.history[`event:${L.clues[0]}`]).toBeUndefined();

    L.clues.forEach((clue, i) => {
      run = trip(run, spots[i]);
      run = resolveEvents(run, calm, [clue]);
      expect(run.pendingEvent?.eventId, `第 ${i + 1} 个记号`).toBe(clue);
      expect(run.pendingEvent?.roles.self).toBe(charId);
      run = proceed(choose(run, L.clueChoice, calm), calm);
    });

    const train = advanceTo(run, L.train, calm, 5);
    expect(train).not.toBeNull();
    const end = proceed(choose(train!, L.trainChoice, calm), calm);
    expect(end.ending?.id).toBe(IDS.endings.subway);
  });

  it('不同种子的记号地点不同', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      let run = start(`trail-seed-${i}`, {}, calm);
      run = choose(force(run, L.flyer, undefined, calm), L.keep, calm);
      seen.add(L.flags.map((f) => run.flags[f]).join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------- 7. 全灭结局 ----------
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

  it('老鼠：有杀虫喷雾才能用喷雾，用掉一瓶且不丢粮食', () => {
    const stock = { [IDS.food]: 4 };
    const atRats = (items: Record<string, number>) =>
      force(start('rats-1', { items }, calm), IDS.events.rats, undefined, calm);
    const spray = (r: Run) =>
      getEventView(envOf(r, calm))!.choices.find((c) => c.id === IDS.events.ratsSpray);
    expect(spray(atRats(stock))?.enabled).toBe(false);
    const withSpray = atRats({ ...stock, [IDS.items.bugSpray]: 1 });
    expect(spray(withSpray)?.enabled).toBe(true);
    const r = choose(withSpray, IDS.events.ratsSpray, calm);
    expect(r.inventory[IDS.items.bugSpray]).toBeUndefined();
    expect(r.inventory[IDS.food]).toBe(4);
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
