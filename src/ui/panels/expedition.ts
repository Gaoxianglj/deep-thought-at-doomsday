/** 外出面板：左栏选人与携带物，右栏地点卡片；底部确认/取消，保留"配给与携带物冲突"的警告。 */
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
import { modalFrame } from '../dialog';
import { button, h } from '../dom';
import {
  avatar,
  charName,
  emptyNote,
  itemIcon,
  itemName,
  rationUsage,
  sectionTitle,
} from '../components/widgets';
import { errorText, fmt, T } from '../text';
import type { PanelCtx } from './types';

interface ExpDraft {
  /** 是否已从当前计划初始化 */
  init: boolean;
  charId: string | null;
  locationId: string | null;
  carry: Record<string, number>;
}

let draft: ExpDraft = { init: false, charId: null, locationId: null, carry: {} };

export function resetExpeditionDraft(): void {
  draft = { init: false, charId: null, locationId: null, carry: {} };
}

/** 只读预览用的 env：克隆一份，避免条件里的随机数改动 store 中的对局 */
function previewEnv(run: RunState, content: Content): Env {
  return { run: structuredClone(run), content };
}

function vehicleFor(content: Content, run: RunState, loc: LocationDef): string | undefined {
  return loc.vehicle ?? content.maps.get(run.mapId)?.expedition.vehicle;
}

function draftPlan(content: Content, run: RunState): ExpeditionPlan | null {
  if (!draft.charId || !draft.locationId) return null;
  const loc = content.locations.get(draft.locationId);
  if (!loc) return null;
  const carry = Object.entries(draft.carry).flatMap(([id, n]) => Array<string>(n).fill(id));
  const plan: ExpeditionPlan = { charId: draft.charId, locationId: draft.locationId, carry };
  const vehicle = vehicleFor(content, run, loc);
  if (vehicle) plan.vehicleId = vehicle;
  return plan;
}

/** 危险度 → 1–5 级 */
export function dangerLevel(danger: number): number {
  return Math.max(1, Math.min(5, Math.ceil(danger / 0.1 - 1e-9)));
}

function dangerIcons(danger: number): HTMLElement {
  const level = dangerLevel(danger);
  return h(
    'span',
    {
      class: ['danger', level >= 4 && 'danger--high'],
      attrs: {
        role: 'img',
        'aria-label': fmt(T.run.expeditionDanger, { pct: Math.round(danger * 100) }),
        title: fmt(T.run.expeditionDanger, { pct: Math.round(danger * 100) }),
      },
    },
    Array.from({ length: 5 }, (_, i) =>
      h('span', { class: ['danger__pip', i < level && 'is-on'] }),
    ),
  );
}

function activeView(ctx: PanelCtx): HTMLElement {
  const { run, store } = ctx;
  const { content } = store;
  const away = run.expedition!;
  return h(
    'div',
    { class: 'exp-away' },
    h('div', { class: 'exp-away__avatar' }, avatar(run, content, away.charId)),
    h(
      'p',
      { class: 'exp-away__text' },
      fmt(T.run.expeditionAway, {
        name: charName(content, away.charId),
        location: content.locations.get(away.locationId)?.name ?? away.locationId,
        day: away.returnDay,
      }),
    ),
  );
}

export function expeditionPanel(ctx: PanelCtx): HTMLElement {
  const { run, store } = ctx;
  const { content } = store;
  const frame = (body: HTMLElement, wide = true): HTMLElement =>
    modalFrame(
      {
        title: T.run.expeditionTitle,
        onClose: ctx.close,
        animate: ctx.animate,
        class: ['sheet', wide ? 'sheet--wide' : 'sheet--small', 'panel-exp'],
      },
      body,
    );

  if (run.expedition) return frame(h('div', { class: 'sheet__body' }, activeView(ctx)), false);

  const planned = run.plan.expedition;
  if (!draft.init) {
    draft = {
      init: true,
      charId: planned?.charId ?? null,
      locationId: planned?.locationId ?? null,
      carry: {},
    };
    for (const id of planned?.carry ?? []) draft.carry[id] = (draft.carry[id] ?? 0) + 1;
  }

  const env = previewEnv(run, content);
  const map = content.maps.get(run.mapId);
  const slots = map?.expedition.carrySlots ?? 0;
  const touch = (): void => store.touch();

  // 谁去
  const who = shelterIds(run).map((cid) => {
    const ch = run.characters[cid];
    const blocker = ch.statuses
      .map((s) => content.statuses.get(s.id))
      .find((d) => d?.blocksExpedition);
    const selected = draft.charId === cid;
    return h(
      'button',
      {
        class: ['who', selected && 'is-on'],
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled: !!blocker },
        on: {
          click: () => {
            draft.charId = cid;
            touch();
          },
        },
        fkey: `exp-who-${cid}`,
      },
      avatar(run, content, cid),
      h('span', { class: 'who__name' }, charName(content, cid)),
      blocker &&
        h('span', { class: 'who__why' }, fmt(T.run.expeditionBlocked, { status: blocker.name })),
    );
  });

  // 携带
  const carried = Object.values(draft.carry).reduce((a, b) => a + b, 0);
  const carryChips = content.db.items
    .filter((it) => (run.inventory[it.id] ?? 0) > 0)
    .map((it) => {
      const have = run.inventory[it.id] ?? 0;
      const n = draft.carry[it.id] ?? 0;
      const set = (v: number): void => {
        if (v <= 0) delete draft.carry[it.id];
        else draft.carry[it.id] = v;
        touch();
      };
      return h(
        'span',
        { class: ['carry', n > 0 && 'is-on'] },
        h(
          'button',
          {
            class: 'carry__add',
            attrs: {
              type: 'button',
              disabled: n >= have || carried >= slots,
              'aria-label': fmt(T.setup.increase, { name: it.name }),
              title: it.desc ?? '',
            },
            on: { click: () => set(n + 1) },
            fkey: `carry-inc-${it.id}`,
          },
          h('span', { class: 'chip__icon' }, itemIcon(content, it.id)),
          h('span', { class: 'chip__name' }, it.name),
          h('span', { class: 'chip__meta' }, n > 0 ? `${n}/${have}` : `×${have}`),
        ),
        n > 0 &&
          button('−', () => set(n - 1), {
            class: 'carry__dec',
            label: fmt(T.setup.decrease, { name: it.name }),
            fkey: `carry-dec-${it.id}`,
          }),
      );
    });

  // 去哪
  const locations = content.db.locations.filter((l) => l.map === run.mapId);
  const where = locations.map((loc) => {
    const self = draft.charId ?? shelterIds(run)[0];
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
    const selected = draft.locationId === loc.id;
    return h(
      'button',
      {
        class: ['place', selected && 'is-on', !ok && 'is-locked'],
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled: !ok },
        on: {
          click: () => {
            draft.locationId = loc.id;
            touch();
          },
        },
        fkey: `exp-where-${loc.id}`,
      },
      h('span', { class: 'place__art' }, artImg('locations', loc.id, 'normal', loc.name)),
      h(
        'span',
        { class: 'place__info' },
        h('span', { class: 'place__name' }, loc.name),
        h(
          'span',
          { class: 'place__meta' },
          h('span', { class: 'place__days' }, fmt(T.run.expeditionDays, { n: days })),
          dangerIcons(danger),
        ),
        loc.desc && h('span', { class: 'place__desc' }, loc.desc),
        !ok && h('span', { class: 'place__hint' }, loc.requiresHint ?? T.run.expeditionLocked),
      ),
    );
  });

  const plan = draftPlan(content, run);
  const error = plan ? validateExpeditionPlan(env, plan) : null;
  const reason = !draft.charId
    ? T.run.expeditionPickWho
    : !draft.locationId
      ? T.run.expeditionPickWhere
      : error
        ? errorText(error)
        : null;

  // 配给与携带物冲突（按草稿计算）
  const usage = rationUsage(run);
  for (const id of planned?.carry ?? []) usage.set(id, (usage.get(id) ?? 0) - 1);
  for (const [id, n] of Object.entries(draft.carry)) usage.set(id, (usage.get(id) ?? 0) + n);
  const conflicts = Object.keys(draft.carry)
    .map((id) => [id, usage.get(id) ?? 0] as const)
    .filter(([id, n]) => n > (run.inventory[id] ?? 0));

  const same =
    !!planned &&
    !!plan &&
    planned.charId === plan.charId &&
    planned.locationId === plan.locationId &&
    [...planned.carry].sort().join() === [...plan.carry].sort().join();

  const left = h(
    'div',
    { class: 'exp-left', attrs: { 'data-skey': 'exp-left' } },
    sectionTitle(T.run.expeditionWho),
    who.length ? h('div', { class: 'who-row' }, who) : emptyNote(T.run.noShelter),
    sectionTitle(
      fmt(T.run.expeditionCarryTitle, { n: slots }),
      slots > 0 &&
        h(
          'span',
          { class: 'sheet-title__meta' },
          fmt(T.run.carryCount, { n: carried, max: slots }),
        ),
    ),
    slots > 0 ? h('div', { class: 'chip-row' }, carryChips) : emptyNote(T.run.expeditionCarryNone),
  );
  const right = h(
    'div',
    { class: 'exp-right', attrs: { 'data-skey': 'exp-right' } },
    sectionTitle(T.run.expeditionWhere),
    locations.length
      ? h('div', { class: 'place-list' }, where)
      : emptyNote(T.run.expeditionNoLocations),
  );

  const footer = h(
    'div',
    { class: 'sheet__footer' },
    h(
      'div',
      { class: 'sheet__footer-note' },
      conflicts.length > 0 &&
        h(
          'p',
          { class: 'warn', attrs: { role: 'alert' } },
          conflicts
            .map(([id, n]) =>
              fmt(T.run.rationOver, {
                item: itemName(content, id),
                used: n,
                have: run.inventory[id] ?? 0,
              }),
            )
            .join('；'),
          ' ',
          T.run.rationOverNote,
        ),
      !conflicts.length &&
        planned &&
        same &&
        h('p', { class: 'ok-note' }, T.run.expeditionPlannedNote),
      !conflicts.length && reason && h('p', { class: 'hint' }, reason),
    ),
    planned &&
      button(
        T.run.expeditionCancel,
        async () => {
          const err = await store.dispatch({ type: 'cancelExpedition' });
          if (!err) resetExpeditionDraft();
          ctx.close();
        },
        { class: 'btn btn--ghost btn--danger-text', fkey: 'exp-cancel' },
      ),
    button(
      planned ? T.run.expeditionReplace : T.run.expeditionConfirm,
      async () => {
        if (!plan) return;
        const err = await store.dispatch({ type: 'planExpedition', ...plan });
        if (!err) ctx.close();
      },
      { class: 'btn btn--primary', disabled: !!reason || same, fkey: 'exp-confirm' },
    ),
  );

  return frame(
    h(
      'div',
      { class: 'sheet__stack' },
      h('div', { class: 'sheet__cols sheet__cols--exp' }, left, right),
      footer,
    ),
  );
}
