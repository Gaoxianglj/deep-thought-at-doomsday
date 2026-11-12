/**
 * 事件画面（phase === 'event'）：场景在背后压暗模糊，中间一张"信纸"卡片。
 * 左栏事件插图，右栏标题、正文、选项；选择后右栏换成结果 + "继续"。相关角色以小立绘站在卡片旁。
 */
import { getEventView } from '../../engine';
import { artImg } from '../art';
import { charName, portrait } from '../components/widgets';
import { button, h } from '../dom';
import { buildStage } from '../scene';
import type { Store } from '../store';
import { fmt, T } from '../text';

/** 防止连点：一次只处理一个动作 */
let busy = false;
/** 记录上一次渲染的事件，换事件/出结果时卡片重新弹出 */
let lastKey = '';

async function act(fn: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } finally {
    busy = false;
  }
}

export function render(root: HTMLElement, store: Store): void {
  const run = store.get().run;
  if (!run) return;
  const { content } = store;
  // 克隆：choices 的 requires 求值可能动用随机数，不能改动 store 中的对局
  const view = getEventView({ run: structuredClone(run), content });
  const cont = (): void => void act(() => store.dispatch({ type: 'continueEvent' }));

  const key = `${run.seed}:${run.day}:${view?.eventId ?? ''}:${view?.result ? 1 : 0}`;
  const animate = key !== lastKey;
  lastKey = key;

  const stage = buildStage(run, content, { interactive: false, class: 'stage--event' }, {}, () =>
    store.touch(),
  );
  const topbar = h(
    'div',
    { class: 'event-top' },
    h('span', { class: 'event-top__day' }, fmt(T.run.day, { day: run.day })),
    button(T.run.menu, () => store.go('home'), {
      class: 'hud-btn',
      label: T.run.toHome,
      fkey: 'event-menu',
    }),
  );

  if (!view) {
    // 事件定义丢失（理论上存档层会清理）：允许继续以免卡死
    root.append(
      h(
        'div',
        { class: 'screen screen--event' },
        stage,
        topbar,
        h(
          'div',
          { class: 'letter-wrap' },
          h(
            'article',
            { class: 'letter letter--narrow' },
            h('p', { class: 'letter__text' }, T.event.missing),
            button(T.event.continue, cont, { class: 'btn btn--primary', fkey: 'event-continue' }),
          ),
        ),
      ),
    );
    return;
  }

  const roles = [...new Set(Object.values(view.roles))].filter((id) => run.characters[id]);

  const side = view.result
    ? h(
        'div',
        { class: 'letter__result', attrs: { role: 'status' } },
        h('p', { class: 'letter__kicker' }, T.event.result),
        view.result.text &&
          h(
            'div',
            { class: 'letter__text letter__text--result' },
            view.result.text.split(/\n+/).map((p) => h('p', null, p)),
          ),
        button(T.event.continue, cont, {
          class: 'btn btn--primary btn--wide',
          fkey: 'event-continue',
        }),
      )
    : h(
        'div',
        { class: 'letter__choices' },
        view.choices.map((c) =>
          h(
            'div',
            { class: ['choice', !c.enabled && 'choice--locked'] },
            button(
              c.text,
              () => void act(() => store.dispatch({ type: 'chooseEventOption', choiceId: c.id })),
              { class: 'btn btn--choice', disabled: !c.enabled, fkey: `choice-${c.id}` },
            ),
            !c.enabled && h('p', { class: 'choice__hint' }, c.hint ?? T.event.locked),
          ),
        ),
      );

  const cast =
    roles.length > 0 &&
    h(
      'div',
      { class: 'letter-cast', attrs: { 'aria-label': T.event.involved } },
      roles.map((id) =>
        h(
          'figure',
          { class: 'cast' },
          h('span', { class: 'cast__art' }, portrait(run, content, id)),
          h('figcaption', { class: 'cast__name' }, charName(content, id)),
        ),
      ),
    );

  root.append(
    h(
      'div',
      { class: 'screen screen--event' },
      stage,
      topbar,
      h(
        'div',
        { class: 'letter-wrap' },
        h(
          'article',
          {
            class: ['letter', animate && 'is-entering'],
            attrs: { 'aria-labelledby': 'event-title' },
          },
          h(
            'div',
            { class: 'letter__art' },
            artImg('events', view.art ?? view.eventId, 'normal', view.title),
            cast,
          ),
          h(
            'div',
            { class: 'letter__body', attrs: { 'data-skey': 'event-body' } },
            h('h1', { class: 'letter__title', attrs: { id: 'event-title' } }, view.title),
            !view.result &&
              h(
                'div',
                { class: 'letter__text' },
                view.text.split(/\n+/).map((p) => h('p', null, p)),
              ),
            side,
          ),
        ),
      ),
    ),
  );
}
