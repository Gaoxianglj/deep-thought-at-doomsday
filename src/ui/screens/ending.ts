/** 结局页：结局名称/文案、存活天数、本局统计、本局新解锁、返回主页。 */
import { artImg } from '../art';
import { button, h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';

export function render(root: HTMLElement, store: Store): void {
  const info = store.get().ending;
  const { content } = store;
  if (!info) {
    queueMicrotask(() => store.go('home'));
    return;
  }
  const { run } = info;
  const def = run.ending ? content.endings.get(run.ending.id) : undefined;
  const day = run.ending?.day ?? run.day;

  const counters = Object.entries(run.counters).filter(([, v]) => typeof v === 'number');
  const party = run.party.map((id) => {
    const where = run.characters[id]?.where ?? 'gone';
    const name = content.characters.get(id)?.name ?? id;
    const label = where === 'dead' ? T.run.dead : where === 'gone' ? T.run.gone : '';
    return h(
      'li',
      { class: ['ending__member', `ending__member--${where}`] },
      h('span', { class: 'ending__portrait' }, artImg('characters', id, 'normal', name)),
      h('span', { class: 'ending__name' }, name),
      label && h('span', { class: ['badge', `badge--${where}`] }, label),
    );
  });

  root.append(
    h(
      'div',
      { class: ['screen', 'screen--ending', def && `screen--ending-${def.kind}`] },
      h(
        'header',
        { class: 'ending__header' },
        h('p', { class: 'ending__kicker' }, T.ending.title),
        h('h1', { class: 'ending__name-title' }, def?.name ?? T.ending.unknownName),
        h('p', { class: 'ending__days' }, fmt(T.ending.days, { day })),
      ),
      h(
        'div',
        { class: 'ending__text' },
        (def?.text ?? T.ending.unknownText).split(/\n+/).map((p) => h('p', null, p)),
      ),
      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, T.ending.party),
        h('ul', { class: 'ending__party' }, party),
      ),
      counters.length > 0 &&
        h(
          'section',
          { class: 'section' },
          h('h2', { class: 'section__title' }, T.ending.stats),
          h(
            'dl',
            { class: 'stats-list' },
            counters.map(([k, v]) => [
              h('dt', { class: 'stats-list__key' }, T.counters[k] ?? k),
              h('dd', { class: 'stats-list__value' }, v),
            ]),
          ),
        ),
      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, T.ending.newUnlocks),
        info.newUnlocks.length
          ? h(
              'ul',
              { class: 'companion-grid' },
              info.newUnlocks.map((id) => {
                const name = content.characters.get(id)?.name ?? id;
                return h(
                  'li',
                  { class: 'companion companion--new' },
                  h(
                    'div',
                    { class: 'companion__portrait' },
                    artImg('characters', id, 'normal', name),
                  ),
                  h('span', { class: 'companion__name' }, name),
                );
              }),
            )
          : h('p', { class: 'empty' }, T.ending.noNewUnlocks),
      ),
      !info.saved &&
        h('p', { class: 'ending__saving', attrs: { role: 'status' } }, T.ending.saving),
      button(T.ending.backHome, () => store.leaveEnding(), {
        class: 'btn btn--primary btn--block btn--large',
        disabled: !info.saved,
        fkey: 'ending-home',
      }),
    ),
  );
}
