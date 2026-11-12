/**
 * 结局页（横屏两栏）：左栏结局图（或占位）+ 结局名与文案；右栏坚持天数、队伍、统计、本局新解锁的伙伴、返回主页。
 */
import { artImg } from '../art';
import { menuScreen } from '../components/shell';
import { emptyNote, portrait, sectionTitle, whereBadge } from '../components/widgets';
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
  const name = def?.name ?? T.ending.unknownName;

  const counters = Object.entries(run.counters).filter(([, v]) => typeof v === 'number');
  const party = run.party.map((id) => {
    const where = run.characters[id]?.where ?? 'gone';
    const charName = content.characters.get(id)?.name ?? id;
    return h(
      'li',
      { class: ['party-chip', `party-chip--${where}`] },
      h('span', { class: 'avatar' }, portrait(null, content, id)),
      h('span', { class: 'party-chip__name' }, charName),
      whereBadge(where) ?? h('span', { class: 'badge badge--alive' }, T.ending.survivors),
    );
  });

  root.append(
    menuScreen(
      store,
      ['screen--ending', def && `screen--ending-${def.kind}`].filter(Boolean).join(' '),
      { mapId: run.mapId },
      h(
        'div',
        { class: 'ending' },
        h(
          'article',
          { class: 'paper ending-main' },
          h(
            'div',
            { class: 'ending-main__art' },
            artImg('endings', run.ending?.id ?? 'unknown', 'normal', name),
          ),
          h('p', { class: 'ending-main__kicker' }, T.ending.title),
          h('h1', { class: 'ending-main__title' }, name),
          h('p', { class: 'ending-main__days' }, fmt(T.ending.days, { day })),
          h(
            'div',
            { class: 'ending-main__text', attrs: { 'data-skey': 'ending-text' } },
            (def?.text ?? T.ending.unknownText).split(/\n+/).map((p) => h('p', null, p)),
          ),
        ),
        h(
          'aside',
          { class: 'paper ending-side' },
          h(
            'div',
            { class: 'ending-side__scroll', attrs: { 'data-skey': 'ending-side' } },
            sectionTitle(T.ending.party),
            h('ul', { class: 'party-chips' }, party),
            info.newUnlocks.length > 0 && [
              sectionTitle(T.ending.newUnlocks),
              info.newUnlocks.length
                ? h(
                    'div',
                    { class: 'unlock-row' },
                    info.newUnlocks.map((id) =>
                      h(
                        'figure',
                        { class: 'unlock' },
                        h(
                          'span',
                          { class: 'unlock__art' },
                          artImg(
                            'characters',
                            id,
                            'normal',
                            content.characters.get(id)?.name ?? id,
                          ),
                        ),
                        h(
                          'figcaption',
                          { class: 'unlock__name' },
                          content.characters.get(id)?.name ?? id,
                        ),
                      ),
                    ),
                  )
                : emptyNote(T.ending.noNewUnlocks),
            ],
            counters.length > 0 && [
              sectionTitle(T.ending.stats),
              h(
                'dl',
                { class: 'stats-list' },
                counters.map(([k, v]) =>
                  h(
                    'div',
                    { class: 'stats-list__row' },
                    h('dt', { class: 'stats-list__key' }, T.counters[k] ?? k),
                    h('dd', { class: 'stats-list__value' }, v),
                  ),
                ),
              ),
            ],
            info.newUnlocks.length === 0 && [
              sectionTitle(T.ending.newUnlocks),
              emptyNote(T.ending.noNewUnlocks),
            ],
          ),
          !info.saved && h('p', { class: 'hint', attrs: { role: 'status' } }, T.ending.saving),
          button(T.ending.backHome, () => store.leaveEnding(), {
            class: 'btn btn--primary btn--stamp btn--block',
            disabled: !info.saved,
            fkey: 'ending-home',
          }),
        ),
      ),
    ),
  );
}
