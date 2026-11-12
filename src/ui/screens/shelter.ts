/** 庇护所主界面（plan 阶段）：角色、配给、库存、外出、日志、结束这一天。 */
import {
  evalCondition,
  getModifier,
  shelterIds,
  validateExpeditionPlan,
  type Content,
  type Env,
  type ExpeditionPlan,
  type LocationDef,
  type RunState,
} from '../../engine';
import { artImg } from '../art';
import { characterCard } from '../components/character-card';
import { logView } from '../components/log-view';
import { confirmDialog, openDialog } from '../dialog';
import { append, button, h, uid } from '../dom';
import type { Store } from '../store';
import { errorText, fmt, tagName, T } from '../text';

interface ExpDraft {
  /** 草稿所属的天数与种子，换天/换局时重置 */
  key: string;
  open: boolean;
  charId: string | null;
  locationId: string | null;
  carry: Record<string, number>;
}

let exp: ExpDraft = { key: '', open: false, charId: null, locationId: null, carry: {} };

function syncDraft(run: RunState): void {
  const key = `${run.seed}:${run.day}`;
  if (exp.key !== key) exp = { key, open: false, charId: null, locationId: null, carry: {} };
}

/** 只读预览用的 env：克隆一份，避免条件里的随机数改动 store 中的对局 */
function previewEnv(run: RunState, content: Content): Env {
  return { run: structuredClone(run), content };
}

function itemName(content: Content, id: string): string {
  return content.items.get(id)?.name ?? id;
}

/**
 * 各物品今晚的计划用量：配给（只算在庇护所的人）+ 外出携带。
 * 入夜先吃配给再出发，携带物不足会导致外出取消，所以一并计算。
 */
function rationUsage(run: RunState): Map<string, number> {
  const used = new Map<string, number>();
  for (const id of run.plan.expedition?.carry ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  for (const cid of shelterIds(run)) {
    for (const itemId of Object.values(run.plan.rations[cid] ?? {})) {
      used.set(itemId, (used.get(itemId) ?? 0) + 1);
    }
  }
  return used;
}

// ---------- 配给 ----------
/** 把昨天的配给套到今天：库存够（含本次已分配）才设置，其余跳过并统一提示 */
async function reuseRations(store: Store, run: RunState): Promise<void> {
  const last = store.get().lastRations;
  if (!last) return;
  const tags = store.content.config.rationTags;
  const left = new Map(Object.entries(run.inventory));
  for (const [id, n] of rationUsage(run)) left.set(id, (left.get(id) ?? 0) - n);
  let done = 0;
  let skipped = 0;
  for (const cid of shelterIds(run)) {
    for (const tag of tags) {
      const itemId = last[cid]?.[tag];
      if (!itemId) continue;
      if (run.plan.rations[cid]?.[tag] === itemId) {
        done++;
        continue;
      }
      const prev = run.plan.rations[cid]?.[tag];
      const free = left.get(itemId) ?? 0;
      if (free < 1) {
        skipped++;
        continue;
      }
      const err = await store.dispatch({ type: 'setRation', charId: cid, tag, itemId });
      if (err) {
        skipped++;
        continue;
      }
      left.set(itemId, free - 1);
      if (prev) left.set(prev, (left.get(prev) ?? 0) + 1);
      done++;
    }
  }
  if (skipped > 0) store.toast(fmt(T.run.rationReuseSkipped, { n: skipped }));
  else if (done === 0) store.toast(T.run.rationReuseNone);
  else store.toast(T.run.rationReuseDone, 'success');
}

function rationSection(store: Store, run: RunState): HTMLElement {
  const { content } = store;
  const tags = content.config.rationTags;
  const used = rationUsage(run);
  const ids = shelterIds(run);
  const over = [...used].filter(([id, n]) => n > (run.inventory[id] ?? 0));

  const rows = ids.map((cid) => {
    const name = content.characters.get(cid)?.name ?? cid;
    const slots = tags.map((tag) => {
      const selId = uid('ration');
      const current = run.plan.rations[cid]?.[tag];
      const options = content.db.items.filter(
        (it) => it.tags.includes(tag) && ((run.inventory[it.id] ?? 0) > 0 || it.id === current),
      );
      const select = h(
        'select',
        {
          class: 'field__select',
          attrs: { id: selId },
          fkey: `ration-${cid}-${tag}`,
          on: {
            change: () => {
              const v = select.value;
              void store.dispatch({
                type: 'setRation',
                charId: cid,
                tag,
                itemId: v === '' ? null : v,
              });
            },
          },
        },
        h('option', { attrs: { value: '' } }, T.run.rationNone),
        options.map((it) =>
          h(
            'option',
            { attrs: { value: it.id, selected: it.id === current } },
            `${it.name}（${run.inventory[it.id] ?? 0}）`,
          ),
        ),
      );
      select.value = current ?? '';
      const n = current ? (used.get(current) ?? 0) : 0;
      const have = current ? (run.inventory[current] ?? 0) : 0;
      return h(
        'div',
        { class: ['ration__slot', current && n > have && 'ration__slot--over'] },
        h(
          'label',
          { class: 'ration__tag', attrs: { for: selId } },
          fmt(T.run.rationSlot, { tag: tagName(content, tag) }),
        ),
        select,
        current &&
          h('span', { class: 'ration__usage' }, fmt(T.run.rationAllocated, { used: n, have })),
      );
    });
    return h(
      'li',
      { class: 'ration' },
      h('span', { class: 'ration__name' }, name),
      h('div', { class: 'ration__slots' }, slots),
    );
  });

  return h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.run.rations),
    button(T.run.rationReuse, () => void reuseRations(store, run), {
      class: 'btn btn--block btn--ghost',
      disabled: !store.get().lastRations || ids.length === 0,
      fkey: 'ration-reuse',
    }),
    over.length > 0 &&
      h(
        'div',
        { class: 'warn-box', attrs: { role: 'alert' } },
        h(
          'ul',
          { class: 'warn-list' },
          over.map(([id, n]) =>
            h(
              'li',
              { class: 'warn-list__item' },
              fmt(T.run.rationOver, {
                item: itemName(content, id),
                used: n,
                have: run.inventory[id] ?? 0,
              }),
            ),
          ),
        ),
        (run.plan.expedition?.carry ?? []).some((id) => over.some(([o]) => o === id)) &&
          h('p', { class: 'warn-box__note' }, T.run.rationOverNote),
      ),
    ids.length
      ? h('ul', { class: 'ration-list' }, rows)
      : h('p', { class: 'empty' }, T.run.noShelter),
  );
}

// ---------- 库存 ----------
function useItemDialog(store: Store, itemId: string): void {
  const run = store.get().run;
  if (!run) return;
  const { content } = store;
  openDialog(fmt(T.run.useTitle, { item: itemName(content, itemId) }), (d) => [
    h('p', { class: 'dialog__message' }, T.run.useOn),
    h(
      'div',
      { class: 'dialog__choices' },
      shelterIds(run).map((cid) => {
        const name = content.characters.get(cid)?.name ?? cid;
        return button(
          [h('span', { class: 'btn__icon' }, artImg('characters', cid, 'normal', name)), name],
          async () => {
            d.close();
            await store.dispatch({ type: 'useItem', itemId, charId: cid });
          },
          { class: 'btn btn--block btn--with-icon' },
        );
      }),
    ),
  ]);
}

function inventorySection(store: Store, run: RunState): HTMLElement {
  const { content } = store;
  const order = new Map(content.db.items.map((it, i) => [it.id, i]));
  const entries = Object.entries(run.inventory)
    .filter(([id, n]) => n > 0 && content.items.has(id))
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const canUse = shelterIds(run).length > 0;
  return h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.run.inventory),
    entries.length
      ? h(
          'ul',
          { class: 'inventory' },
          entries.map(([id, n]) => {
            const it = content.items.get(id)!;
            return h(
              'li',
              { class: 'inventory__item' },
              h('span', { class: 'inventory__icon' }, artImg('items', id, 'normal', it.name)),
              h(
                'span',
                { class: 'inventory__info' },
                h(
                  'span',
                  { class: 'inventory__name' },
                  it.name,
                  h('span', { class: 'inventory__count' }, ` ×${n}`),
                ),
                it.desc && h('span', { class: 'inventory__desc' }, it.desc),
              ),
              it.manualUse &&
                button(T.run.use, () => useItemDialog(store, id), {
                  class: 'btn btn--small',
                  disabled: !canUse,
                  fkey: `use-${id}`,
                }),
            );
          }),
        )
      : h('p', { class: 'empty' }, T.run.inventoryEmpty),
  );
}

// ---------- 外出 ----------
function vehicleFor(content: Content, run: RunState, loc: LocationDef): string | undefined {
  return loc.vehicle ?? content.maps.get(run.mapId)?.expedition.vehicle;
}

function draftPlan(content: Content, run: RunState): ExpeditionPlan | null {
  if (!exp.charId || !exp.locationId) return null;
  const loc = content.locations.get(exp.locationId);
  if (!loc) return null;
  const carry = Object.entries(exp.carry).flatMap(([id, n]) => Array<string>(n).fill(id));
  const plan: ExpeditionPlan = { charId: exp.charId, locationId: exp.locationId, carry };
  const vehicle = vehicleFor(content, run, loc);
  if (vehicle) plan.vehicleId = vehicle;
  return plan;
}

function expeditionSection(store: Store, run: RunState): HTMLElement {
  const { content } = store;
  const section = h(
    'section',
    { class: 'section expedition' },
    h('h2', { class: 'section__title' }, T.run.expedition),
  );

  if (run.expedition) {
    section.append(h('p', { class: 'empty' }, T.run.expeditionActive));
    return section;
  }

  const planned = run.plan.expedition;
  if (planned) {
    const who = content.characters.get(planned.charId)?.name ?? planned.charId;
    const where = content.locations.get(planned.locationId)?.name ?? planned.locationId;
    section.append(
      h(
        'div',
        { class: 'expedition__planned card' },
        h(
          'p',
          { class: 'expedition__summary' },
          fmt(T.run.expeditionPlanned, { name: who, location: where }),
        ),
        planned.carry.length > 0 &&
          h(
            'p',
            { class: 'expedition__carry' },
            fmt(T.run.expeditionCarry, {
              items: planned.carry.map((id) => itemName(content, id)).join('、'),
            }),
          ),
        button(T.run.expeditionCancel, () => void store.dispatch({ type: 'cancelExpedition' }), {
          class: 'btn btn--ghost',
          fkey: 'exp-cancel',
        }),
      ),
    );
    return section;
  }

  if (!exp.open) {
    section.append(
      button(
        T.run.expeditionNew,
        () => {
          exp.open = true;
          store.touch();
        },
        { class: 'btn btn--block', fkey: 'exp-open', disabled: shelterIds(run).length === 0 },
      ),
    );
    return section;
  }

  const env = previewEnv(run, content);
  const map = content.maps.get(run.mapId);
  const slots = map?.expedition.carrySlots ?? 0;

  // 谁去
  const who = shelterIds(run).map((cid) => {
    const ch = run.characters[cid];
    const name = content.characters.get(cid)?.name ?? cid;
    const blocker = ch.statuses
      .map((s) => content.statuses.get(s.id))
      .find((d) => d?.blocksExpedition);
    const selected = exp.charId === cid;
    return h(
      'button',
      {
        class: ['pick', 'pick--compact', selected && 'pick--selected'],
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled: !!blocker },
        on: {
          click: () => {
            exp.charId = cid;
            store.touch();
          },
        },
        fkey: `exp-who-${cid}`,
      },
      h('span', { class: 'pick__portrait' }, artImg('characters', cid, 'normal', name)),
      h('span', { class: 'pick__name' }, name),
      blocker &&
        h('span', { class: 'pick__meta' }, fmt(T.run.expeditionBlocked, { status: blocker.name })),
    );
  });

  // 去哪
  const locations = content.db.locations.filter((l) => l.map === run.mapId);
  const where = locations.map((loc) => {
    const self = exp.charId ?? shelterIds(run)[0];
    const plan: ExpeditionPlan = { charId: self ?? '', locationId: loc.id, carry: [] };
    const ok = evalCondition(env, { self, expedition: plan }, loc.requires);
    const days = Math.max(
      1,
      Math.round(getModifier(env, 'expedition.duration', loc.distance, self, { expedition: plan })),
    );
    const danger = Math.min(
      0.95,
      Math.max(0, getModifier(env, 'expedition.danger', loc.danger, self, { expedition: plan })),
    );
    const selected = exp.locationId === loc.id;
    return h(
      'button',
      {
        class: ['location', selected && 'location--selected', !ok && 'location--locked'],
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled: !ok },
        on: {
          click: () => {
            exp.locationId = loc.id;
            store.touch();
          },
        },
        fkey: `exp-where-${loc.id}`,
      },
      h('span', { class: 'location__art' }, artImg('locations', loc.id, 'normal', loc.name)),
      h(
        'span',
        { class: 'location__info' },
        h('span', { class: 'location__name' }, loc.name),
        h(
          'span',
          { class: 'location__meta' },
          fmt(T.run.expeditionDays, { n: days }),
          ' · ',
          h(
            'span',
            { class: ['location__danger', danger >= 0.3 && 'location__danger--high'] },
            fmt(T.run.expeditionDanger, { pct: Math.round(danger * 100) }),
          ),
        ),
        loc.desc && h('span', { class: 'location__desc' }, loc.desc),
        !ok && h('span', { class: 'location__hint' }, loc.requiresHint ?? T.run.expeditionLocked),
      ),
    );
  });

  // 携带
  const carried = Object.values(exp.carry).reduce((a, b) => a + b, 0);
  const carryRows = Object.entries(run.inventory)
    .filter(([id, n]) => n > 0 && content.items.has(id))
    .map(([id, have]) => {
      const n = exp.carry[id] ?? 0;
      const name = itemName(content, id);
      const set = (v: number) => {
        if (v <= 0) delete exp.carry[id];
        else exp.carry[id] = v;
        store.touch();
      };
      return h(
        'li',
        { class: 'supply supply--compact' },
        h(
          'span',
          { class: 'supply__info' },
          h('span', { class: 'supply__name' }, name),
          h('span', { class: 'supply__meta' }, `×${have}`),
        ),
        h(
          'span',
          { class: 'stepper' },
          button('−', () => set(n - 1), {
            class: 'btn btn--icon stepper__btn',
            disabled: n <= 0,
            label: fmt(T.setup.decrease, { name }),
            fkey: `carry-dec-${id}`,
          }),
          h('output', { class: 'stepper__value' }, n),
          button('+', () => set(n + 1), {
            class: 'btn btn--icon stepper__btn',
            disabled: n >= have || carried >= slots,
            label: fmt(T.setup.increase, { name }),
            fkey: `carry-inc-${id}`,
          }),
        ),
      );
    });

  const plan = draftPlan(content, run);
  const error = plan ? validateExpeditionPlan(env, plan) : null;
  const reason = !exp.charId
    ? T.run.expeditionPickWho
    : !exp.locationId
      ? T.run.expeditionPickWhere
      : error
        ? errorText(error)
        : null;

  append(section, [
    h('h3', { class: 'section__subtitle' }, T.run.expeditionWho),
    h('div', { class: 'pick-row' }, who),
    h('h3', { class: 'section__subtitle' }, T.run.expeditionWhere),
    locations.length
      ? h('div', { class: 'location-list' }, where)
      : h('p', { class: 'empty' }, T.run.expeditionNoLocations),
    h('h3', { class: 'section__subtitle' }, fmt(T.run.expeditionCarryTitle, { n: slots })),
    slots > 0
      ? h('ul', { class: 'supply-list' }, carryRows)
      : h('p', { class: 'empty' }, T.run.expeditionCarryNone),
    reason && h('p', { class: 'expedition__reason' }, reason),
    h(
      'div',
      { class: 'expedition__actions' },
      button(
        T.common.cancel,
        () => {
          exp.open = false;
          exp.charId = null;
          exp.locationId = null;
          exp.carry = {};
          store.touch();
        },
        { class: 'btn btn--ghost', fkey: 'exp-close' },
      ),
      button(
        T.run.expeditionConfirm,
        async () => {
          if (!plan) return;
          const err = await store.dispatch({ type: 'planExpedition', ...plan });
          if (!err) {
            exp.open = false;
            exp.carry = {};
            store.touch();
          }
        },
        { class: 'btn btn--primary', disabled: !!reason, fkey: 'exp-confirm' },
      ),
    ),
  ]);
  return section;
}

// ---------- 结束这一天 ----------
async function endDay(store: Store, run: RunState): Promise<void> {
  const { content } = store;
  const tags = content.config.rationTags;
  const missing = shelterIds(run).filter((cid) => tags.some((t) => !run.plan.rations[cid]?.[t]));
  const over = [...rationUsage(run)].some(([id, n]) => n > (run.inventory[id] ?? 0));
  const messages: string[] = [];
  if (missing.length) {
    messages.push(
      fmt(T.run.endDayNoRation, {
        tags: tags.map((t) => tagName(content, t)).join('/'),
        names: missing.map((id) => content.characters.get(id)?.name ?? id).join('、'),
      }),
    );
  }
  if (over) messages.push(T.run.endDayOver);
  if (messages.length) {
    const ok = await confirmDialog(T.run.endDayConfirmTitle, messages.join('\n'));
    if (!ok) return;
  }
  await store.dispatch({ type: 'endDay' });
  window.scrollTo({ top: 0 });
}

export function render(root: HTMLElement, store: Store): void {
  const run = store.get().run;
  if (!run) return;
  const { content } = store;
  syncDraft(run);

  const weather = run.weather ? content.weathers.get(run.weather.id) : undefined;
  const away = run.expedition;
  const awayName = away ? (content.characters.get(away.charId)?.name ?? away.charId) : '';
  const awayLoc = away ? (content.locations.get(away.locationId)?.name ?? away.locationId) : '';

  root.append(
    h(
      'div',
      { class: 'screen screen--shelter' },
      h(
        'header',
        { class: 'topbar' },
        h(
          'div',
          { class: 'topbar__info' },
          h('h1', { class: 'topbar__day' }, fmt(T.run.day, { day: run.day })),
          weather &&
            h('span', { class: 'topbar__weather' }, fmt(T.run.weather, { weather: weather.name })),
        ),
        button(T.run.menu, () => store.go('home'), {
          class: 'btn btn--ghost btn--small',
          label: T.run.toHome,
        }),
      ),
      away &&
        h(
          'p',
          { class: 'banner banner--away', attrs: { role: 'status' } },
          fmt(T.run.awayBanner, { name: awayName, location: awayLoc, day: away.returnDay }),
        ),
      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, T.run.team),
        h(
          'ul',
          { class: 'char-list' },
          run.party.map((id) => characterCard(run, content, id)),
        ),
      ),
      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, T.run.log),
        logView(run.log, run.day),
      ),
      rationSection(store, run),
      inventorySection(store, run),
      expeditionSection(store, run),
      h(
        'div',
        { class: 'end-day' },
        button(T.run.endDay, () => void endDay(store, run), {
          class: 'btn btn--primary btn--block btn--large',
          fkey: 'end-day',
        }),
      ),
    ),
  );
}
