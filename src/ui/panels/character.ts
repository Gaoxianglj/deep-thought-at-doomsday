/** 角色面板：左栏大立绘 + 名字 + 特性；右栏属性条、状态、配给芯片、可对其使用的物品。 */
import { h } from '../dom';
import { modalFrame } from '../dialog';
import {
  charName,
  emptyNote,
  itemIcon,
  portrait,
  rationUsage,
  sectionTitle,
  statBar,
  statusPill,
  statusTone,
  whereBadge,
} from '../components/widgets';
import { fmt, tagName, T } from '../text';
import type { PanelCtx } from './types';

function rationRow(ctx: PanelCtx, charId: string, tag: string): HTMLElement {
  const { store, run } = ctx;
  const { content } = store;
  const current = run.plan.rations[charId]?.[tag];
  const used = rationUsage(run);
  const options = content.db.items.filter(
    (it) => it.tags.includes(tag) && ((run.inventory[it.id] ?? 0) > 0 || it.id === current),
  );
  const set = (itemId: string | null): void => {
    void store.dispatch({ type: 'setRation', charId, tag, itemId });
  };
  const none = h(
    'button',
    {
      class: ['chip', 'chip--none', !current && 'is-on'],
      attrs: { type: 'button', 'aria-pressed': current ? 'false' : 'true' },
      on: { click: () => set(null) },
      fkey: `ration-${charId}-${tag}-none`,
    },
    h('span', { class: 'chip__name' }, T.run.rationNone),
  );
  const chips = options.map((it) => {
    const on = it.id === current;
    const have = run.inventory[it.id] ?? 0;
    const n = used.get(it.id) ?? 0;
    return h(
      'button',
      {
        class: ['chip', on && 'is-on', n > have && 'is-over', have === 0 && 'is-out'],
        attrs: { type: 'button', 'aria-pressed': on ? 'true' : 'false', title: it.desc ?? '' },
        on: { click: () => set(on ? null : it.id) },
        fkey: `ration-${charId}-${tag}-${it.id}`,
      },
      h('span', { class: 'chip__icon' }, itemIcon(content, it.id)),
      h('span', { class: 'chip__name' }, it.name),
      h('span', { class: 'chip__meta' }, `${n}/${have}`),
    );
  });
  return h(
    'div',
    { class: 'ration-row' },
    h('span', { class: 'ration-row__tag' }, tagName(content, tag)),
    h(
      'div',
      { class: 'chip-row' },
      none,
      chips.length
        ? chips
        : h(
            'span',
            { class: 'chip-row__empty' },
            fmt(T.run.rationNoStock, { tag: tagName(content, tag) }),
          ),
    ),
  );
}

function useRow(ctx: PanelCtx, charId: string): HTMLElement {
  const { store, run } = ctx;
  const { content } = store;
  const usable = content.db.items.filter((it) => it.manualUse && (run.inventory[it.id] ?? 0) > 0);
  if (!usable.length) return emptyNote(T.run.useItemsNone);
  return h(
    'div',
    { class: 'chip-row' },
    usable.map((it) =>
      h(
        'button',
        {
          class: 'chip chip--use',
          attrs: {
            type: 'button',
            title: it.desc ?? '',
            'aria-label': fmt(T.run.useOnChar, { name: charName(content, charId), item: it.name }),
          },
          on: {
            click: async () => {
              const err = await store.dispatch({ type: 'useItem', itemId: it.id, charId });
              if (!err) store.toast(fmt(T.run.used, { item: it.name }), 'success');
            },
          },
          fkey: `use-${charId}-${it.id}`,
        },
        h('span', { class: 'chip__icon' }, itemIcon(content, it.id)),
        h('span', { class: 'chip__name' }, it.name),
        h('span', { class: 'chip__meta' }, fmt(T.run.itemCount, { n: run.inventory[it.id] ?? 0 })),
      ),
    ),
  );
}

export function characterPanel(ctx: PanelCtx, charId: string): HTMLElement {
  const { store, run } = ctx;
  const { content } = store;
  const def = content.characters.get(charId);
  const ch = run.characters[charId];
  const name = charName(content, charId);
  const where = ch?.where ?? 'gone';
  const alive = where === 'shelter' || where === 'away';
  const statuses = (ch?.statuses ?? []).filter((s) => content.statuses.has(s.id));

  const left = h(
    'div',
    { class: 'char-hero' },
    h('div', { class: 'char-hero__art' }, portrait(run, content, charId)),

    def?.desc && h('p', { class: 'char-hero__desc' }, def.desc),
    def?.traits.length
      ? h(
          'ul',
          { class: 'trait-list' },
          def.traits.map((t) =>
            h(
              'li',
              { class: 'trait' },
              h('span', { class: 'trait__name' }, t.name),
              t.desc && h('span', { class: 'trait__desc' }, t.desc),
            ),
          ),
        )
      : null,
  );

  const right = h(
    'div',
    { class: 'char-detail', attrs: { 'data-skey': `char-${charId}` } },
    alive &&
      h(
        'div',
        { class: 'meter-grid' },
        content.db.stats.map((s, i) => statBar(s, ch?.stats[s.id] ?? s.initial, i)),
      ),
    alive && sectionTitle(T.run.statuses),
    alive &&
      (statuses.length
        ? h(
            'ul',
            { class: 'status-list' },
            statuses.map((s) => {
              const sd = content.statuses.get(s.id)!;
              return h(
                'li',
                { class: ['status-item', `status-item--${statusTone(sd)}`] },
                statusPill(content, s),
                sd.desc && h('span', { class: 'status-item__desc' }, sd.desc),
              );
            }),
          )
        : h('p', { class: 'empty empty--ok' }, T.run.noStatus)),
    where === 'shelter'
      ? [
          sectionTitle(T.run.rationTitle),
          content.config.rationTags.map((tag) => rationRow(ctx, charId, tag)),
          sectionTitle(T.run.useItems),
          useRow(ctx, charId),
        ]
      : alive && emptyNote(fmt(T.run.rationNotHere, { name })),
  );

  return modalFrame(
    {
      title: name,
      headerExtra: whereBadge(where),
      onClose: ctx.close,
      animate: ctx.animate,
      class: ['sheet', 'sheet--wide', 'panel-char'],
    },
    h('div', { class: 'sheet__cols' }, left, right),
  );
}
