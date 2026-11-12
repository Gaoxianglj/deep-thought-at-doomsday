/**
 * 庇护所场景（plan 阶段的主画面）：舞台上的角色、货架上的物资、可点击的热点，加上精简的 HUD。
 * 点场景里的东西打开对应面板；面板是屏幕的一部分，随状态重渲染。
 */
import { shelterIds, type RunState } from '../../engine';
import { confirmDialog } from '../dialog';
import { button, h } from '../dom';
import { characterPanel } from '../panels/character';
import { expeditionPanel, resetExpeditionDraft } from '../panels/expedition';
import { inventoryPanel, itemPanel } from '../panels/inventory';
import { journalPanel } from '../panels/journal';
import { menuPanel } from '../panels/menu';
import type { Panel, PanelCtx } from '../panels/types';
import { artImg } from '../art';
import { charName, itemName, rationUsage, tagCount, avatar } from '../components/widgets';
import { buildStage, sceneFor } from '../scene';
import type { Store } from '../store';
import { fmt, tagName, T } from '../text';

interface ShelterUi {
  /** 所属的对局与天数，换天/换局时重置 */
  key: string;
  panel: Panel | null;
  animate: boolean;
  /** 日记本已读到的今日日志条数 */
  seen: number;
  /** 上次渲染时各配给标签的数量（变化时跳一下） */
  counts: Record<string, number>;
}

let ui: ShelterUi = { key: '', panel: null, animate: false, seen: -1, counts: {} };

function sync(run: RunState): void {
  const key = `${run.seed}:${run.day}`;
  if (ui.key !== key) {
    ui = { key, panel: null, animate: false, seen: -1, counts: ui.counts };
    resetExpeditionDraft();
  }
}

function todayLogCount(run: RunState): number {
  return run.log.filter((e) => e.day === run.day).length;
}

function hasUnread(run: RunState): boolean {
  const n = todayLogCount(run);
  return n > 0 && n > ui.seen;
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

// ---------- 结束这一天 ----------
async function endDay(store: Store, run: RunState): Promise<void> {
  const { content } = store;
  const tags = content.config.rationTags;
  const issues: string[] = [];
  for (const cid of shelterIds(run)) {
    const miss = tags.filter((t) => !run.plan.rations[cid]?.[t]);
    if (miss.length) {
      issues.push(
        fmt(T.run.endDayMissing, {
          name: charName(content, cid),
          tags: miss.map((t) => tagName(content, t)).join('、'),
        }),
      );
    }
  }
  for (const [id, n] of rationUsage(run)) {
    const have = run.inventory[id] ?? 0;
    if (n > have) {
      issues.push(fmt(T.run.rationOver, { item: itemName(content, id), used: n, have }));
    }
  }
  if (issues.length) {
    const ok = await confirmDialog(T.run.endDayConfirmTitle, T.run.endDayIssues, {
      list: issues,
      confirmText: T.run.endDayAnyway,
    });
    if (!ok) return;
  }
  ui.panel = null;
  await store.dispatch({ type: 'endDay' });
}

// ---------- HUD ----------
function hud(store: Store, run: RunState, ctx: PanelCtx, hasScene: boolean): HTMLElement {
  const { content } = store;
  const weather = run.weather ? content.weathers.get(run.weather.id) : undefined;

  const calendar = h(
    'div',
    { class: 'calendar', attrs: { role: 'status' } },
    h('span', { class: 'calendar__rings' }),
    h('span', { class: 'calendar__top' }, T.run.calendarTop),
    h('span', { class: 'calendar__num' }, String(run.day)),
    h('span', { class: 'calendar__bottom' }, T.run.calendarBottom),
    weather && h('span', { class: 'calendar__weather' }, weather.name),
  );

  const counts: Record<string, number> = {};
  const res = content.config.rationTags.map((tag) => {
    const n = tagCount(run, content, tag);
    counts[tag] = n;
    const bump = ui.counts[tag] !== undefined && ui.counts[tag] !== n;
    const sample = content.db.items.find((it) => it.tags.includes(tag));
    return button(
      [
        h(
          'span',
          { class: 'res__icon' },
          sample ? artImg('items', sample.id, 'normal', tagName(content, tag)) : null,
        ),
        h('span', { class: 'res__name' }, tagName(content, tag)),
        h('span', { class: ['res__num', bump && 'is-bump', n === 0 && 'is-zero'] }, String(n)),
      ],
      () => ctx.open({ kind: 'inventory', tag }),
      { class: 'res', fkey: `res-${tag}` },
    );
  });
  ui.counts = counts;

  const latest = run.log[run.log.length - 1];
  const unread = hasUnread(run);

  const away = run.expedition;
  return h(
    'div',
    { class: 'hud' },
    h('div', { class: 'hud__tl' }, calendar),
    h(
      'div',
      { class: 'hud__tr' },
      h('div', { class: 'res-bar' }, res),
      button(
        [h('span', { class: 'hud-btn__glyph hud-btn__glyph--bag' }), T.run.bag],
        () => ctx.open({ kind: 'inventory' }),
        {
          class: 'hud-btn',
          fkey: 'hud-bag',
        },
      ),
      button(
        [h('span', { class: 'hud-btn__glyph hud-btn__glyph--menu' }), T.run.menu],
        () => ctx.open({ kind: 'menu' }),
        {
          class: 'hud-btn',
          fkey: 'hud-menu',
        },
      ),
    ),
    h(
      'div',
      { class: 'hud__bl' },
      latest &&
        button(
          [
            h('span', { class: 'ticker__pin' }),
            h(
              'span',
              { class: ['ticker__text', latest.kind === 'diary' && 'ticker__text--hand'] },
              latest.text,
            ),
          ],
          () => ctx.open({ kind: 'journal', tab: 'history' }),
          {
            class: ['ticker', unread && 'ticker--unread'],
            fkey: 'hud-ticker',
            label: T.run.openJournal,
          },
        ),
    ),
    h(
      'div',
      { class: 'hud__br' },
      !hasScene &&
        h(
          'div',
          { class: 'hud__alt' },
          away &&
            h(
              'span',
              { class: 'away-sign away-sign--hud' },
              avatar(run, content, away.charId),
              h(
                'span',
                { class: 'away-sign__text' },
                h('span', { class: 'away-sign__name' }, charName(content, away.charId)),
                h(
                  'span',
                  { class: 'away-sign__day' },
                  fmt(T.run.awaySign, { day: away.returnDay }),
                ),
              ),
            ),
          button(T.run.expedition, () => ctx.open({ kind: 'expedition' }), {
            class: 'btn btn--wood',
            fkey: 'hud-exp',
          }),
          button(
            [T.run.journalTitle, unread && h('span', { class: 'red-dot red-dot--inline' })],
            () => ctx.open({ kind: 'journal', tab: 'history' }),
            {
              class: 'btn btn--wood',
              fkey: 'hud-journal',
            },
          ),
        ),
      button(T.run.endDay, () => ctx.endDay(), {
        class: 'btn btn--primary btn--stamp',
        fkey: 'end-day',
      }),
    ),
  );
}

function renderPanel(ctx: PanelCtx, panel: Panel): HTMLElement {
  switch (panel.kind) {
    case 'character':
      return characterPanel(ctx, panel.id);
    case 'inventory':
      return inventoryPanel(ctx, panel);
    case 'item':
      return itemPanel(ctx, panel.id);
    case 'expedition':
      return expeditionPanel(ctx);
    case 'journal':
      return journalPanel(ctx, panel.tab);
    case 'menu':
      return menuPanel(ctx);
  }
}

export function render(root: HTMLElement, store: Store): void {
  const run = store.get().run;
  if (!run) return;
  const { content } = store;
  sync(run);

  // 打开日记本即视为已读
  if (ui.panel?.kind === 'journal') ui.seen = todayLogCount(run);

  const ctx: PanelCtx = {
    store,
    run,
    animate: ui.animate,
    open(p) {
      if (p.kind === 'expedition') resetExpeditionDraft();
      ui.panel = p;
      ui.animate = true;
      store.touch();
    },
    update(p) {
      ui.panel = p;
      store.touch();
    },
    close() {
      ui.panel = null;
      store.touch();
    },
    endDay: () => void endDay(store, run),
    reuseRations: () => void reuseRations(store, run),
  };

  const hasScene = !!sceneFor(content, run.mapId);
  const stage = buildStage(
    run,
    content,
    {
      interactive: true,
      markers: true,
      journalUnread: hasUnread(run),
      class: ui.panel ? 'stage--behind' : undefined,
    },
    {
      onCharacter: (id) => ctx.open({ kind: 'character', id }),
      onStock: (tag) => ctx.open({ kind: 'inventory', tag }),
      onProp: (id) => ctx.open({ kind: 'item', id }),
      onExpedition: () => ctx.open({ kind: 'expedition' }),
      onJournal: () => ctx.open({ kind: 'journal', tab: 'history' }),
    },
    () => store.touch(),
  );

  root.append(
    h(
      'div',
      { class: 'screen screen--shelter' },
      stage,
      hud(store, run, ctx, hasScene),
      ui.panel && renderPanel(ctx, ui.panel),
    ),
  );
  ui.animate = false;
}
