/**
 * 开局向导：地图 → 难度 → 伙伴 → 物资（含种子）→ 开始。
 * 伙伴用立绘卡片，未解锁的显示剪影且不透露名字；物资页左侧物品网格带步进器，右侧"已选清单 + 剩余点数 + 开始"固定可见。
 */
import { pointsCost, type ItemDef } from '../../engine';
import { artImg, cssUrl, placeholderArt } from '../art';
import { menuScreen, titleBar } from '../components/shell';
import { emptyNote, itemIcon, sectionTitle } from '../components/widgets';
import { button, h, uid, type Children } from '../dom';
import { menuBackground } from '../scene';
import type { Store } from '../store';
import { errorText, fmt, T } from '../text';

interface Draft {
  step: number;
  mapId: string | null;
  difficultyId: string | null;
  party: string[];
  items: Record<string, number>;
  seed: string;
  starting: boolean;
}

const STEPS = [T.setup.stepMap, T.setup.stepDifficulty, T.setup.stepParty, T.setup.stepSupplies];

let draft: Draft = fresh();

function fresh(): Draft {
  return {
    step: 0,
    mapId: null,
    difficultyId: null,
    party: [],
    items: {},
    seed: '',
    starting: false,
  };
}

export function resetSetup(): void {
  draft = fresh();
}

function stepMap(store: Store): Children {
  const { content } = store;
  return h(
    'div',
    { class: 'card-row', attrs: { 'data-skey': 'setup-maps' } },
    content.db.maps.map((m) => {
      const selected = draft.mapId === m.id;
      const bg = menuBackground(content, m.id);
      const thumb = h('span', { class: ['map-card__thumb', !bg && 'map-card__thumb--plain'] });
      if (bg && content.sceneByMap.has(m.id)) thumb.style.setProperty('--bg', cssUrl(bg));
      else thumb.append(placeholderArt(m.id, m.name, 'locations'));
      return h(
        'button',
        {
          class: ['pick-card', 'map-card', selected && 'is-on'],
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          on: {
            click: () => {
              if (draft.mapId !== m.id) {
                draft.mapId = m.id;
                draft.items = {};
                draft.party = draft.party.slice(0, m.partySize.max);
              }
              draft.step = 1;
              store.touch();
            },
          },
          fkey: `map-${m.id}`,
        },
        thumb,
        h('span', { class: 'pick-card__title' }, m.name),
        h(
          'span',
          { class: 'pick-card__meta' },
          fmt(T.setup.mapParty, { min: m.partySize.min, max: m.partySize.max }),
        ),
        m.desc && h('span', { class: 'pick-card__desc' }, m.desc),
      );
    }),
  );
}

function stepDifficulty(store: Store): Children {
  const list = store.content.db.difficulties;
  return h(
    'div',
    { class: 'card-row', attrs: { 'data-skey': 'setup-diffs' } },
    list.map((d, i) => {
      const selected = draft.difficultyId === d.id;
      return h(
        'button',
        {
          class: ['pick-card', 'diff-card', selected && 'is-on'],
          attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
          on: {
            click: () => {
              draft.difficultyId = d.id;
              draft.step = 2;
              store.touch();
            },
          },
          fkey: `diff-${d.id}`,
        },
        h(
          'span',
          { class: 'diff-card__pips', attrs: { 'aria-hidden': 'true' } },
          list.map((_, k) => h('span', { class: ['diff-card__pip', k <= i && 'is-on'] })),
        ),
        h('span', { class: 'pick-card__title' }, d.name),
        h('span', { class: 'pick-card__meta' }, fmt(T.setup.diffPoints, { points: d.points })),
        d.desc && h('span', { class: 'pick-card__desc' }, d.desc),
      );
    }),
  );
}

function stepParty(store: Store): Children {
  const { content } = store;
  const unlocked = new Set(store.get().profile?.unlockedCharacters ?? []);
  const map = draft.mapId ? content.maps.get(draft.mapId) : undefined;
  const max = map?.partySize.max ?? Infinity;
  const cards = content.db.characters.map((c) => {
    if (!unlocked.has(c.id)) {
      return h(
        'div',
        { class: 'hero-card is-locked', attrs: { 'aria-label': T.setup.lockedCharacter } },
        h(
          'span',
          { class: 'hero-card__art hero-card__art--silhouette' },
          artImg('characters', c.id, 'normal', T.common.unknownName),
        ),
        h('span', { class: 'hero-card__name' }, T.common.unknownName),
        h('span', { class: 'hero-card__meta' }, T.setup.lockedCharacter),
      );
    }
    const selected = draft.party.includes(c.id);
    const full = !selected && draft.party.length >= max;
    return h(
      'button',
      {
        class: ['hero-card', selected && 'is-on'],
        attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false', disabled: full },
        on: {
          click: () => {
            draft.party = selected
              ? draft.party.filter((id) => id !== c.id)
              : [...draft.party, c.id];
            store.touch();
          },
        },
        fkey: `pick-${c.id}`,
      },
      selected && h('span', { class: 'hero-card__order' }, String(draft.party.indexOf(c.id) + 1)),
      h('span', { class: 'hero-card__art' }, artImg('characters', c.id, 'normal', c.name)),
      h('span', { class: 'hero-card__name' }, c.name),
      c.cost ? h('span', { class: 'hero-card__meta' }, fmt(T.setup.cost, { cost: c.cost })) : null,
      c.desc && h('span', { class: 'hero-card__desc' }, c.desc),
      c.traits.length > 0 &&
        h(
          'span',
          { class: 'hero-card__traits' },
          c.traits.map((t) =>
            h('span', { class: 'tag-chip', attrs: { title: t.desc ?? '' } }, t.name),
          ),
        ),
    );
  });
  const n = draft.party.length;
  const ok = !!map && n >= map.partySize.min && n <= map.partySize.max;
  return [
    h('div', { class: 'hero-row', attrs: { 'data-skey': 'setup-party' } }, cards),
    h(
      'div',
      { class: 'setup-foot' },
      h(
        'p',
        { class: ['setup-foot__hint', !ok && 'is-warn'] },
        map ? fmt(T.setup.partyHint, { min: map.partySize.min, max: map.partySize.max, n }) : '',
      ),
      button(
        T.common.next,
        () => {
          draft.step = 3;
          store.touch();
        },
        { class: 'btn btn--primary', disabled: !ok, fkey: 'party-next' },
      ),
    ),
  ];
}

function stepSupplies(store: Store): Children {
  const { content } = store;
  const map = draft.mapId ? content.maps.get(draft.mapId) : undefined;
  const diff = draft.difficultyId ? content.difficulties.get(draft.difficultyId) : undefined;
  if (!map || !diff) return [];
  const spent = pointsCost(content, draft.party, draft.items);
  const left = diff.points - spent;
  const partyCost = pointsCost(content, draft.party, {});

  const pool = map.startingPool
    .map((id) => content.items.get(id))
    .filter((it): it is ItemDef => it !== undefined && it.cost !== undefined);
  const cells = pool.map((it) => {
    const n = draft.items[it.id] ?? 0;
    const cost = it.cost ?? 0;
    const atMax = it.maxAtStart !== undefined && n >= it.maxAtStart;
    const set = (v: number) => {
      if (v <= 0) delete draft.items[it.id];
      else draft.items[it.id] = v;
      store.touch();
    };
    return h(
      'li',
      { class: ['supply', n > 0 && 'is-on'], attrs: { title: it.desc ?? '' } },
      h('span', { class: 'supply__icon' }, itemIcon(content, it.id)),
      h(
        'span',
        { class: 'supply__info' },
        h('span', { class: 'supply__name' }, it.name),
        h(
          'span',
          { class: 'supply__meta' },
          cost === 0 ? T.setup.free : fmt(T.setup.cost, { cost }),
          it.maxAtStart !== undefined ? ` · ${fmt(T.setup.max, { max: it.maxAtStart })}` : '',
        ),
      ),
      h(
        'span',
        { class: 'stepper' },
        button('−', () => set(n - 1), {
          class: 'stepper__btn',
          disabled: n <= 0,
          label: fmt(T.setup.decrease, { name: it.name }),
          fkey: `dec-${it.id}`,
        }),
        h('output', { class: 'stepper__value', attrs: { 'aria-live': 'polite' } }, n),
        button('+', () => set(n + 1), {
          class: 'stepper__btn',
          disabled: atMax || cost > left,
          label: fmt(T.setup.increase, { name: it.name }),
          fkey: `inc-${it.id}`,
        }),
      ),
    );
  });

  const free = Object.entries(map.startingItems ?? {}).filter(
    ([id, n]) => n > 0 && content.items.has(id),
  );
  const chosen = Object.entries(draft.items).filter(([id, n]) => n > 0 && content.items.has(id));

  const errors = store.checkSetup({
    mapId: map.id,
    difficultyId: diff.id,
    party: draft.party,
    items: draft.items,
  });
  const seedId = uid('seed');
  const seedInput = h('input', {
    class: 'field__input field__input--small',
    attrs: {
      id: seedId,
      type: 'text',
      placeholder: T.setup.seedPlaceholder,
      autocomplete: 'off',
      enterkeyhint: 'done',
      maxlength: 64,
    },
    fkey: 'seed',
  });
  seedInput.value = draft.seed;
  seedInput.addEventListener('input', () => (draft.seed = seedInput.value));

  const start = async (): Promise<void> => {
    if (draft.starting) return;
    draft.starting = true;
    store.touch();
    const errs = await store.startRun({
      mapId: map.id,
      difficultyId: diff.id,
      party: draft.party,
      items: draft.items,
      seed: draft.seed,
    });
    if (errs.length) {
      draft.starting = false;
      store.toast(errs.map(errorText).join(' '), 'error');
      store.touch();
    } else resetSetup();
  };

  const chip = (id: string, n: number): HTMLElement =>
    h(
      'li',
      { class: 'mini-item' },
      h('span', { class: 'mini-item__icon' }, itemIcon(content, id)),
      h('span', { class: 'mini-item__name' }, content.items.get(id)!.name),
      h('span', { class: 'mini-item__n' }, `×${n}`),
    );

  return h(
    'div',
    { class: 'two-col two-col--supplies' },
    h(
      'section',
      { class: 'paper col-main', attrs: { 'data-skey': 'setup-supplies' } },
      pool.length ? h('ul', { class: 'supply-grid' }, cells) : emptyNote(T.setup.noSupplies),
    ),
    h(
      'aside',
      { class: 'paper col-side summary', attrs: { 'data-skey': 'setup-summary' } },
      h(
        'div',
        { class: ['points', left < 0 && 'is-over'], attrs: { role: 'status' } },
        h('span', { class: 'points__num' }, String(left)),
        h('span', { class: 'points__label' }, fmt(T.setup.points, { left, total: diff.points })),
        partyCost > 0 &&
          h('span', { class: 'points__sub' }, fmt(T.setup.partyCost, { cost: partyCost })),
      ),
      sectionTitle(T.setup.summary),
      chosen.length
        ? h(
            'ul',
            { class: 'mini-list' },
            chosen.map(([id, n]) => chip(id, n)),
          )
        : emptyNote(T.setup.summaryEmpty),
      free.length > 0 && [
        sectionTitle(T.setup.freeItems),
        h(
          'ul',
          { class: 'mini-list' },
          free.map(([id, n]) => chip(id, n)),
        ),
      ],
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', attrs: { for: seedId } }, T.setup.seedLabel),
        seedInput,
      ),
      errors.length > 0 &&
        h(
          'div',
          { class: 'warn', attrs: { role: 'alert' } },
          h('p', null, T.setup.cannotStart),
          h(
            'ul',
            null,
            errors.map((e) => h('li', null, errorText(e))),
          ),
        ),
      button(T.setup.start, () => void start(), {
        class: 'btn btn--primary btn--stamp btn--block',
        disabled: errors.length > 0 || draft.starting,
        fkey: 'start',
      }),
    ),
  );
}

export function render(root: HTMLElement, store: Store): void {
  // 前置步骤缺失时回退
  if (draft.step >= 1 && !draft.mapId) draft.step = 0;
  if (draft.step >= 2 && !draft.difficultyId) draft.step = 1;

  const body =
    draft.step === 0
      ? stepMap(store)
      : draft.step === 1
        ? stepDifficulty(store)
        : draft.step === 2
          ? stepParty(store)
          : stepSupplies(store);

  const back = (): void => {
    if (draft.step === 0) {
      resetSetup();
      store.go('home');
    } else {
      draft.step -= 1;
      store.touch();
    }
  };

  const steps = h(
    'ol',
    {
      class: 'steps',
      attrs: { 'aria-label': fmt(T.setup.stepOf, { n: draft.step + 1, total: STEPS.length }) },
    },
    STEPS.map((label, i) =>
      h(
        'li',
        {
          class: ['steps__item', i === draft.step && 'is-current', i < draft.step && 'is-done'],
        },
        h('span', { class: 'steps__num' }, String(i + 1)),
        h('span', { class: 'steps__label' }, label),
      ),
    ),
  );

  root.append(
    menuScreen(
      store,
      'screen--setup',
      { mapId: draft.mapId ?? undefined },
      titleBar(
        button(T.common.back, back, { class: 'btn btn--ghost btn--small', fkey: 'setup-back' }),
        STEPS[draft.step],
        steps,
      ),
      h('div', { class: 'setup-body' }, body),
    ),
  );
}
