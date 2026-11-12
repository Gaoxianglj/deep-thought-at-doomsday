/** 日志：按天分组，按 kind 加样式；diary 显示为手写便签。 */
import type { LogEntry } from '../../engine';
import { cssToken, h } from '../dom';
import { fmt, T } from '../text';

function entry(e: LogEntry): HTMLElement {
  if (e.kind === 'diary') {
    return h(
      'li',
      { class: 'log__entry log__entry--diary' },
      h(
        'figure',
        { class: 'diary-note' },
        h('figcaption', { class: 'diary-note__label' }, T.run.diary),
        h('p', { class: 'diary-note__text' }, e.text),
      ),
    );
  }
  return h('li', { class: ['log__entry', `log__entry--${cssToken(e.kind)}`] }, e.text);
}

/** 显示今天与前一天（昨夜结算）的日志 */
export function logView(log: LogEntry[], today: number): HTMLElement {
  const days = [today, today - 1];
  const groups = days
    .map((d) => ({ d, items: log.filter((e) => e.day === d) }))
    .filter((g) => g.items.length > 0);
  return h(
    'div',
    { class: 'log' },
    groups.length
      ? groups.map((g) =>
          h(
            'section',
            { class: 'log__group' },
            h(
              'h3',
              { class: 'log__day' },
              g.d === today
                ? T.run.logToday
                : `${T.run.logYesterday} · ${fmt(T.run.logDay, { day: g.d })}`,
            ),
            h('ul', { class: 'log__list' }, g.items.map(entry)),
          ),
        )
      : h('p', { class: 'empty' }, T.run.logEmpty),
  );
}
