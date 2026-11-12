/** 事件界面（phase === 'event'）：标题、插图、正文、选项；选择后显示结果与"继续"。 */
import { getEventView } from '../../engine';
import { artImg } from '../art';
import { button, h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';

/** 防止连点：一次只处理一个动作 */
let busy = false;

async function act(fn: () => Promise<unknown>): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } finally {
    busy = false;
  }
  window.scrollTo({ top: 0 });
}

export function render(root: HTMLElement, store: Store): void {
  const run = store.get().run;
  if (!run) return;
  // 克隆：choices 的 requires 求值可能动用随机数，不能改动 store 中的对局
  const view = getEventView({ run: structuredClone(run), content: store.content });

  const header = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'topbar__info' },
      h('span', { class: 'topbar__day' }, fmt(T.run.day, { day: run.day })),
    ),
    button(T.run.menu, () => store.go('home'), {
      class: 'btn btn--ghost btn--small',
      label: T.run.toHome,
    }),
  );

  if (!view) {
    // 事件定义丢失（理论上存档层会清理）：允许继续以免卡死
    root.append(
      h(
        'div',
        { class: 'screen screen--event' },
        header,
        h('p', { class: 'empty' }, T.event.missing),
        button(T.event.continue, () => void act(() => store.dispatch({ type: 'continueEvent' })), {
          class: 'btn btn--primary btn--block',
        }),
      ),
    );
    return;
  }

  const body = view.result
    ? h(
        'div',
        { class: 'event__result', attrs: { role: 'status' } },
        view.result.text && h('p', { class: 'event__result-text' }, view.result.text),
        button(T.event.continue, () => void act(() => store.dispatch({ type: 'continueEvent' })), {
          class: 'btn btn--primary btn--block btn--large',
          fkey: 'event-continue',
        }),
      )
    : h(
        'div',
        { class: 'event__choices' },
        view.choices.map((c) =>
          h(
            'div',
            { class: ['event__choice', !c.enabled && 'event__choice--locked'] },
            button(
              c.text,
              () => void act(() => store.dispatch({ type: 'chooseEventOption', choiceId: c.id })),
              {
                class: 'btn btn--block btn--choice',
                disabled: !c.enabled,
                fkey: `choice-${c.id}`,
              },
            ),
            !c.enabled && h('p', { class: 'event__hint' }, c.hint ?? T.event.locked),
          ),
        ),
      );

  root.append(
    h(
      'div',
      { class: 'screen screen--event' },
      header,
      h(
        'article',
        { class: 'event' },
        h('h1', { class: 'event__title' }, view.title),
        h(
          'div',
          { class: 'event__art' },
          artImg('events', view.art ?? view.eventId, 'normal', view.title),
        ),
        h(
          'div',
          { class: 'event__text' },
          view.text.split(/\n+/).map((p) => h('p', null, p)),
        ),
        body,
      ),
    ),
  );
}
