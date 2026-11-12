/** 背包面板（按标签分组的物品网格 + 右侧说明）与单件物品小卡片（点场景里的道具）。 */
import { shelterIds, type ItemDef } from '../../engine';
import { modalFrame } from '../dialog';
import { h } from '../dom';
import {
  avatar,
  charName,
  emptyNote,
  itemIcon,
  rationUsage,
  sectionTitle,
} from '../components/widgets';
import { fmt, tagName, T } from '../text';
import type { PanelCtx } from './types';

/** 标签顺序：配给标签在前，其余按物品出现顺序 */
function tagOrder(ctx: PanelCtx): string[] {
  const { content } = ctx.store;
  return [...new Set([...content.config.rationTags, ...content.db.items.flatMap((it) => it.tags)])];
}

/** 物品详情：大图标、名称、数量、说明、今晚用量；manualUse 的给出使用对象 */
function itemDetail(ctx: PanelCtx, id: string): HTMLElement {
  const { store, run } = ctx;
  const { content } = store;
  const it = content.items.get(id);
  if (!it) return emptyNote(T.run.inventoryPick);
  const n = run.inventory[id] ?? 0;
  const planned = rationUsage(run).get(id) ?? 0;
  const targets = shelterIds(run);
  return h(
    'div',
    { class: 'item-detail' },
    h(
      'div',
      { class: 'item-detail__head' },
      h('span', { class: 'item-detail__icon' }, itemIcon(content, id)),
      h(
        'div',
        { class: 'item-detail__title' },
        h('span', { class: 'item-detail__name' }, it.name),
        h(
          'span',
          { class: 'item-detail__meta' },
          fmt(T.run.itemCount, { n }),
          ...it.tags.map((t) => h('span', { class: 'tag-chip' }, tagName(content, t))),
        ),
      ),
    ),
    it.desc && h('p', { class: 'item-detail__desc' }, it.desc),
    planned > 0 &&
      h('p', { class: 'item-detail__planned' }, fmt(T.run.itemPlanned, { n: planned })),
    it.manualUse &&
      n > 0 && [
        sectionTitle(T.run.useOn),
        targets.length
          ? h(
              'div',
              { class: 'target-row' },
              targets.map((cid) =>
                h(
                  'button',
                  {
                    class: 'target',
                    attrs: { type: 'button' },
                    on: {
                      click: async () => {
                        const err = await store.dispatch({
                          type: 'useItem',
                          itemId: id,
                          charId: cid,
                        });
                        if (!err) store.toast(fmt(T.run.used, { item: it.name }), 'success');
                      },
                    },
                    fkey: `use-${id}-${cid}`,
                  },
                  avatar(run, content, cid),
                  h('span', { class: 'target__name' }, charName(content, cid)),
                ),
              ),
            )
          : emptyNote(T.run.noShelter),
      ],
  );
}

export function inventoryPanel(ctx: PanelCtx, panel: { tag?: string; item?: string }): HTMLElement {
  const { run, store } = ctx;
  const { content } = store;
  const owned = content.db.items.filter((it) => (run.inventory[it.id] ?? 0) > 0);
  const groups = new Map<string, ItemDef[]>();
  for (const tag of tagOrder(ctx)) groups.set(tag, []);
  const other: ItemDef[] = [];
  for (const it of owned) {
    const first = it.tags[0];
    if (first !== undefined) groups.get(first)!.push(it);
    else other.push(it);
  }
  // 当前选中：显式选择 > 定位标签的第一件 > 第一件
  const inTag = panel.tag ? owned.find((it) => it.tags.includes(panel.tag!)) : undefined;
  const selected =
    (panel.item && (run.inventory[panel.item] ?? 0) > 0 ? panel.item : undefined) ??
    inTag?.id ??
    owned[0]?.id;

  const cell = (it: ItemDef): HTMLElement =>
    h(
      'button',
      {
        class: ['cell', it.id === selected && 'is-on'],
        attrs: { type: 'button', 'aria-pressed': it.id === selected ? 'true' : 'false' },
        on: { click: () => ctx.update({ kind: 'inventory', tag: panel.tag, item: it.id }) },
        fkey: `inv-${it.id}`,
      },
      h('span', { class: 'cell__icon' }, itemIcon(content, it.id)),
      h('span', { class: 'cell__name' }, it.name),
      h('span', { class: 'count-badge cell__count' }, String(run.inventory[it.id] ?? 0)),
    );

  const sections = [...groups]
    .filter(([, list]) => list.length > 0)
    .map(([tag, list]) =>
      h(
        'section',
        {
          class: ['inv-group', tag === panel.tag && 'is-focus'],
          attrs: { 'data-tag': tag },
        },
        sectionTitle(tagName(content, tag)),
        h('div', { class: 'cell-grid' }, list.map(cell)),
      ),
    );
  if (other.length) {
    sections.push(
      h(
        'section',
        { class: 'inv-group' },
        sectionTitle(T.run.otherTag),
        h('div', { class: 'cell-grid' }, other.map(cell)),
      ),
    );
  }

  const list = h(
    'div',
    { class: 'inv-list', attrs: { 'data-skey': 'inventory' } },
    sections.length ? sections : emptyNote(T.run.inventoryEmpty),
  );
  // 第一次打开且指定了标签：把该组滚到顶部
  if (ctx.animate && panel.tag) {
    requestAnimationFrame(() => {
      const g = list.querySelector<HTMLElement>(`[data-tag="${CSS.escape(panel.tag!)}"]`);
      // .inv-list 是定位元素，offsetTop 相对它计算
      if (g) list.scrollTop = g.offsetTop;
    });
  }

  return modalFrame(
    {
      title: T.run.bag,
      onClose: ctx.close,
      animate: ctx.animate,
      class: ['sheet', 'sheet--wide', 'panel-inv'],
    },
    h(
      'div',
      { class: 'sheet__cols sheet__cols--inv' },
      list,
      h(
        'div',
        { class: 'inv-side', attrs: { 'data-skey': 'inventory-side' } },
        selected ? itemDetail(ctx, selected) : emptyNote(T.run.inventoryEmpty),
      ),
    ),
  );
}

/** 点场景里的道具：名称/描述小卡片，manualUse 的可选使用对象 */
export function itemPanel(ctx: PanelCtx, id: string): HTMLElement {
  const { content } = ctx.store;
  return modalFrame(
    {
      title: content.items.get(id)?.name ?? id,
      onClose: ctx.close,
      animate: ctx.animate,
      class: ['sheet', 'sheet--small', 'panel-item'],
    },
    h('div', { class: 'sheet__body' }, itemDetail(ctx, id)),
  );
}
