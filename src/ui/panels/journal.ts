/**
 * 日记本面板（书本造型，左右两页）：左页"今天"——当天的日记（手写感）和其他日志；
 * 右页可切换"往日记录"（按天分组）与"成员"（全体成员状态一览）。底部：沿用昨天的配给、结束这一天。
 */
import { shelterIds, type LogEntry } from '../../engine';
import { modalFrame } from '../dialog';
import { button, cssToken, h } from '../dom';
import {
  avatar,
  charName,
  emptyNote,
  statBar,
  statusPill,
  whereBadge,
} from '../components/widgets';
import { fmt, T } from '../text';
import type { PanelCtx } from './types';

function entry(e: LogEntry): HTMLElement {
  if (e.kind === 'diary') return h('li', { class: 'log-entry log-entry--diary' }, e.text);
  return h('li', { class: ['log-entry', `log-entry--${cssToken(e.kind)}`] }, e.text);
}

function todayPage(ctx: PanelCtx): HTMLElement {
  const { run } = ctx;
  const today = run.log.filter((e) => e.day === run.day);
  const diary = today.filter((e) => e.kind === 'diary');
  const others = today.filter((e) => e.kind !== 'diary');
  const lastNight = run.log.filter((e) => e.day === run.day - 1 && e.kind !== 'diary');
  return h(
    'div',
    { class: 'page page--left', attrs: { 'data-skey': 'journal-left' } },
    h('h3', { class: 'page__title' }, fmt(T.run.journalToday, { day: run.day })),
    diary.length > 0 && h('ul', { class: 'log-list log-list--diary' }, diary.map(entry)),
    others.length > 0 && h('ul', { class: 'log-list' }, others.map(entry)),
    !today.length && emptyNote(T.run.logEmpty),
    lastNight.length > 0 && [
      h('h4', { class: 'page__sub' }, T.run.journalLastNight),
      h('ul', { class: 'log-list log-list--faded' }, lastNight.map(entry)),
    ],
  );
}

function historyPage(ctx: PanelCtx): HTMLElement {
  const { run } = ctx;
  const days = [...new Set(run.log.map((e) => e.day))]
    .filter((d) => d < run.day)
    .sort((a, b) => b - a);
  if (!days.length) return emptyNote(T.run.journalHistoryEmpty);
  return h(
    'div',
    { class: 'history' },
    days.map((d) =>
      h(
        'section',
        { class: 'history__day' },
        h('h4', { class: 'page__sub' }, fmt(T.run.logDay, { day: d })),
        h('ul', { class: 'log-list' }, run.log.filter((e) => e.day === d).map(entry)),
      ),
    ),
  );
}

function membersPage(ctx: PanelCtx): HTMLElement {
  const { run, store } = ctx;
  const { content } = store;
  return h(
    'ul',
    { class: 'members' },
    run.party.map((id) => {
      const ch = run.characters[id];
      const where = ch?.where ?? 'gone';
      const alive = where === 'shelter' || where === 'away';
      return h(
        'li',
        { class: ['member', `member--${where}`] },
        h(
          'button',
          {
            class: 'member__head',
            attrs: { type: 'button' },
            on: { click: () => ctx.open({ kind: 'character', id }) },
            fkey: `member-${id}`,
          },
          avatar(run, content, id),
          h('span', { class: 'member__name' }, charName(content, id)),
          whereBadge(where),
        ),
        alive &&
          h(
            'div',
            { class: 'member__stats' },
            content.db.stats.map((s, i) => statBar(s, ch?.stats[s.id] ?? s.initial, i)),
          ),
        alive &&
          (ch?.statuses.length ?? 0) > 0 &&
          h(
            'div',
            { class: 'member__pills' },
            ch!.statuses.map((s) => statusPill(content, s, { small: true })),
          ),
      );
    }),
  );
}

export function journalPanel(ctx: PanelCtx, tab: 'history' | 'members'): HTMLElement {
  const { store, run } = ctx;
  const tabBtn = (t: 'history' | 'members', text: string): HTMLElement =>
    h(
      'button',
      {
        class: ['book-tab', tab === t && 'is-on'],
        attrs: { type: 'button', role: 'tab', 'aria-selected': tab === t ? 'true' : 'false' },
        on: { click: () => ctx.update({ kind: 'journal', tab: t }) },
        fkey: `journal-tab-${t}`,
      },
      text,
    );

  const right = h(
    'div',
    { class: 'page page--right', attrs: { 'data-skey': `journal-right-${tab}` } },
    h(
      'div',
      { class: 'book-tabs', attrs: { role: 'tablist' } },
      tabBtn('history', T.run.journalHistory),
      tabBtn('members', T.run.journalMembers),
    ),
    tab === 'history' ? historyPage(ctx) : membersPage(ctx),
  );

  return modalFrame(
    {
      label: T.run.journalTitle,
      onClose: ctx.close,
      animate: ctx.animate,
      bare: true,
      class: ['book'],
    },
    h(
      'div',
      { class: 'book__spread' },
      todayPage(ctx),
      h('span', { class: 'book__spine', attrs: { 'aria-hidden': 'true' } }),
      right,
    ),
    h(
      'div',
      { class: 'book__actions' },
      button(T.run.rationReuse, () => ctx.reuseRations(), {
        class: 'btn btn--ghost',
        disabled: !store.get().lastRations || shelterIds(run).length === 0,
        fkey: 'ration-reuse',
      }),
      button(T.run.endDay, () => ctx.endDay(), {
        class: 'btn btn--primary',
        fkey: 'journal-end-day',
      }),
    ),
  );
}
