/** 启动中 / 启动失败 / 内容尚未就绪 页面。 */
import { button, h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';

export function renderBoot(root: HTMLElement, store: Store): void {
  const { bootError } = store.get();
  root.append(
    h(
      'div',
      { class: 'screen screen--center' },
      h('h1', { class: 'screen__title' }, T.appTitle),
      bootError
        ? [
            h(
              'p',
              { class: 'screen__error', attrs: { role: 'alert' } },
              fmt(T.boot.failed, { error: bootError }),
            ),
            button(T.boot.retry, () => void store.boot(), { class: 'btn btn--primary' }),
          ]
        : h('p', { class: 'screen__meta', attrs: { role: 'status' } }, T.boot.loading),
    ),
  );
}

export function renderNotReady(root: HTMLElement): void {
  root.append(
    h(
      'div',
      { class: 'screen screen--center' },
      h('h1', { class: 'screen__title' }, T.appTitle),
      h('h2', { class: 'screen__subtitle' }, T.notReady.title),
      h('p', { class: 'screen__meta' }, T.notReady.body),
    ),
  );
}
