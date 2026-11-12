/** 开局向导：地图 → 难度 → 伙伴 → 物资（含种子）→ 开始。 */
import { pointsCost, type ItemDef } from '../../engine';
import { artImg } from '../art';
import { button, h, uid, type Children } from '../dom';
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

function choiceCard(
  selected: boolean,
  title: string,
  desc: string | undefined,
  meta: string | undefined,
  onClick: () => void,
  fkey: string,
): HTMLElement {
  return h(
    'button',
    {
      class: ['choice', selected && 'choice--selected'],
      attrs: { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
      on: { click: onClick },
      fkey,
    },
    h('span', { class: 'choice__title' }, title),
    meta && h('span', { class: 'choice__meta' }, meta),
    desc && h('span', { class: 'choice__desc' }, desc),
  );
}

function stepMap(store: Store): HTMLElement[] {
  return store.content.db.maps.map((m) =>
    choiceCard(
      draft.mapId === m.id,
      m.name,
      m.desc,
      fmt(T.setup.mapParty, { min: m.partySize.min, max: m.partySize.max }),
      () => {
        if (draft.mapId !== m.id) {
          draft.mapId = m.id;
          draft.items = {};
          draft.party = draft.party.slice(0, m.partySize.max);
        }
        draft.step = 1;
        store.touch();
      },
      `map-${m.id}`,
    ),
  );
}

function stepDifficulty(store: Store): HTMLElement[] {
  return store.content.db.difficulties.map((d) =>
    choiceCard(
      draft.difficultyId === d.id,
      d.name,
      d.desc,
      fmt(T.setup.diffPoints, { points: d.points }),
      () => {
        draft.difficultyId = d.id;
        draft.step = 2;
        store.touch();
      },
      `diff-${d.id}`,
    ),
  );
}

function stepParty(store: Store): Children[] {
  const { content } = store;
  const unlocked = new Set(store.get().profile?.unlockedCharacters ?? []);
  const map = draft.mapId ? content.maps.get(draft.mapId) : undefined;
  const max = map?.partySize.max ?? Infinity;
  const cards = content.db.characters.map((c) => {
    if (!unlocked.has(c.id)) {
      return h(
        'li',
        { class: 'pick pick--locked', attrs: { 'aria-label': T.setup.lockedCharacter } },
        h('span', { class: 'pick__portrait pick__portrait--silhouette' }, '?'),
        h('span', { class: 'pick__name' }, T.common.unknownName),
        h('span', { class: 'pick__meta' }, T.setup.lockedCharacter),
      );
    }
    const selected = draft.party.includes(c.id);
    const full = !selected && draft.party.length >= max;
    return h(
      'li',
      { class: 'pick-wrap' },
      h(
        'button',
        {
          class: ['pick', selected && 'pick--selected'],
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
        h('span', { class: 'pick__portrait' }, artImg('characters', c.id, 'normal', c.name)),
        h('span', { class: 'pick__name' }, c.name),
        c.cost ? h('span', { class: 'pick__meta' }, fmt(T.setup.cost, { cost: c.cost })) : null,
        c.desc && h('span', { class: 'pick__desc' }, c.desc),
        c.traits.length > 0 &&
          h(
            'span',
            { class: 'pick__traits' },
            c.traits.map((t) =>
              h('span', { class: 'tag', attrs: { title: t.desc ?? '' } }, t.name),
            ),
          ),
      ),
    );
  });
  const n = draft.party.length;
  const ok = !!map && n >= map.partySize.min && n <= map.partySize.max;
  return [
    h(
      'p',
      { class: ['setup__hint', !ok && 'setup__hint--warn'] },
      map ? fmt(T.setup.partyHint, { min: map.partySize.min, max: map.partySize.max, n }) : '',
    ),
    h('ul', { class: 'pick-grid' }, cards),
    h(
      'div',
      { class: 'setup__nav' },
      button(
        T.common.next,
        () => {
          draft.step = 3;
          store.touch();
        },
        { class: 'btn btn--primary btn--block', disabled: !ok, fkey: 'party-next' },
      ),
    ),
  ];
}

function stepSupplies(store: Store): Children[] {
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
  const rows = pool.map((it) => {
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
      { class: 'supply' },
      h('span', { class: 'supply__icon' }, artImg('items', it.id, 'normal', it.name)),
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
        it.desc && h('span', { class: 'supply__desc' }, it.desc),
      ),
      h(
        'span',
        { class: 'stepper' },
        button('−', () => set(n - 1), {
          class: 'btn btn--icon stepper__btn',
          disabled: n <= 0,
          label: fmt(T.setup.decrease, { name: it.name }),
          fkey: `dec-${it.id}`,
        }),
        h('output', { class: 'stepper__value', attrs: { 'aria-live': 'polite' } }, n),
        button('+', () => set(n + 1), {
          class: 'btn btn--icon stepper__btn',
          disabled: atMax || cost > left,
          label: fmt(T.setup.increase, { name: it.name }),
          fkey: `inc-${it.id}`,
        }),
      ),
    );
  });

  const free = Object.entries(map.startingItems ?? {})
    .filter(([id, n]) => n > 0 && content.items.has(id))
    .map(([id, n]) => `${content.items.get(id)!.name} ×${n}`);

  const errors = store.checkSetup({
    mapId: map.id,
    difficultyId: diff.id,
    party: draft.party,
    items: draft.items,
  });
  const seedId = uid('seed');
  const seedInput = h('input', {
    class: 'field__input',
    attrs: {
      id: seedId,
      type: 'text',
      placeholder: T.setup.seedPlaceholder,
      autocomplete: 'off',
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

  return [
    h(
      'div',
      { class: ['points', left < 0 && 'points--over'], attrs: { role: 'status' } },
      fmt(T.setup.points, { left, total: diff.points }),
      partyCost > 0 &&
        h('span', { class: 'points__sub' }, fmt(T.setup.partyCost, { cost: partyCost })),
    ),
    pool.length
      ? h('ul', { class: 'supply-list' }, rows)
      : h('p', { class: 'empty' }, T.setup.noSupplies),
    free.length > 0 && h('p', { class: 'setup__free' }, `${T.setup.freeItems}：${free.join('、')}`),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', attrs: { for: seedId } }, T.setup.seedLabel),
      seedInput,
    ),
    errors.length > 0 &&
      h(
        'div',
        { class: 'setup__errors', attrs: { role: 'alert' } },
        h('p', null, T.setup.cannotStart),
        h(
          'ul',
          null,
          errors.map((e) => h('li', null, errorText(e))),
        ),
      ),
    h(
      'div',
      { class: 'setup__nav' },
      button(T.setup.start, () => void start(), {
        class: 'btn btn--primary btn--block',
        disabled: errors.length > 0 || draft.starting,
        fkey: 'start',
      }),
    ),
  ];
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

  root.append(
    h(
      'div',
      { class: 'screen screen--setup' },
      h(
        'header',
        { class: 'screen__header screen__header--bar' },
        button(T.common.back, back, { class: 'btn btn--ghost btn--small', fkey: 'setup-back' }),
        h(
          'div',
          { class: 'screen__heading' },
          h('h1', { class: 'screen__title' }, STEPS[draft.step]),
          h(
            'p',
            { class: 'screen__meta' },
            fmt(T.setup.stepOf, { n: draft.step + 1, total: STEPS.length }),
          ),
        ),
      ),
      h(
        'ol',
        { class: 'steps', attrs: { 'aria-hidden': 'true' } },
        STEPS.map((_, i) =>
          h('li', {
            class: [
              'steps__item',
              i === draft.step && 'steps__item--current',
              i < draft.step && 'steps__item--done',
            ],
          }),
        ),
      ),
      h('div', { class: ['setup__body', draft.step < 2 && 'choice-list'] }, body),
    ),
  );
}
