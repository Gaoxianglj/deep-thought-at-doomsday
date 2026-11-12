/** 启动中 / 启动失败 / 内容尚未就绪 页面。 */
import { menuScreen } from '../components/shell';
import { button, h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';

export function renderBoot(root: HTMLElement, store: Store): void {
  const { bootError } = store.get();
  root.append(
    menuScreen(
      store,
      'screen--center',
      null,
      h(
        'div',
        { class: 'paper center-card' },
        h('h1', { class: 'logo__title logo__title--small' }, T.appTitle),
        bootError
          ? [
              h(
                'p',
                { class: 'warn', attrs: { role: 'alert' } },
                fmt(T.boot.failed, { error: bootError }),
              ),
              button(T.boot.retry, () => void store.boot(), { class: 'btn btn--primary' }),
            ]
          : h('p', { class: 'hint', attrs: { role: 'status' } }, T.boot.loading),
      ),
    ),
  );
}

export function renderNotReady(root: HTMLElement, store: Store): void {
  root.append(
    menuScreen(
      store,
      'screen--center',
      null,
      h(
        'div',
        { class: 'paper center-card' },
        h('h1', { class: 'logo__title logo__title--small' }, T.appTitle),
        h('h2', { class: 'center-card__title' }, T.notReady.title),
        h('p', { class: 'hint' }, T.notReady.body),
      ),
    ),
  );
}
