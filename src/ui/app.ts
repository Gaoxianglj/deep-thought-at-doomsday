/**
 * 应用外壳：订阅 store，状态变化时重渲染当前屏幕；提示消息单独渲染（不会打断输入）。
 * 重渲染时按 data-fkey 恢复焦点。
 */
import { button, h } from './dom';
import * as ending from './screens/ending';
import * as event from './screens/event';
import * as home from './screens/home';
import * as profiles from './screens/profiles';
import * as setup from './screens/setup';
import * as shelter from './screens/shelter';
import { renderBoot, renderNotReady } from './screens/status';
import type { AppState, Store, Toast } from './store';
import { T } from './text';

const TOAST_MS = { info: 3500, success: 4000, error: 6500 } as const;

/** 影响屏幕内容的字段（toasts 除外） */
const SCREEN_KEYS = [
  'screen',
  'profiles',
  'profile',
  'run',
  'notices',
  'ending',
  'bootError',
  'rev',
] as const satisfies readonly (keyof AppState)[];

function renderScreen(root: HTMLElement, store: Store): void {
  const s = store.get();
  switch (s.screen) {
    case 'boot':
      return renderBoot(root, store);
    case 'notReady':
      return renderNotReady(root);
    case 'profiles':
      return profiles.render(root, store);
    case 'home':
      return home.render(root, store);
    case 'setup':
      return setup.render(root, store);
    case 'run':
      if (!s.run) return home.render(root, store);
      return s.run.phase === 'event' ? event.render(root, store) : shelter.render(root, store);
    case 'ending':
      return ending.render(root, store);
  }
}

/** 记录可恢复的焦点（输入框内容由各屏幕自己的草稿状态保存） */
function focusKey(root: HTMLElement): string | null {
  const active = document.activeElement as HTMLElement | null;
  return active && root.contains(active) ? (active.dataset.fkey ?? null) : null;
}

function restoreFocus(root: HTMLElement, key: string | null): void {
  if (!key) return;
  const el = root.querySelector<HTMLElement>(`[data-fkey="${CSS.escape(key)}"]`);
  if (el && !(el as HTMLButtonElement).disabled) el.focus({ preventScroll: true });
}

function toastEl(store: Store, t: Toast): HTMLElement {
  return h(
    'li',
    { class: ['toast', `toast--${t.kind}`] },
    h('span', { class: 'toast__text' }, t.text),
    button('×', () => store.dismissToast(t.id), {
      class: 'btn btn--icon toast__close',
      label: T.common.close,
    }),
  );
}

export function mount(container: HTMLElement, store: Store): void {
  const main = h('main', { class: 'app__main' });
  const toastList = h('ul', {
    class: 'toasts',
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
  });
  container.replaceChildren(h('div', { class: 'app' }, main, toastList));

  let last: AppState | null = null;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const update = (): void => {
    const s = store.get();
    const screenChanged = !last || SCREEN_KEYS.some((k) => last![k] !== s[k]);
    if (screenChanged) {
      const focus = focusKey(main);
      const sameScreen = last?.screen === s.screen;
      main.replaceChildren();
      renderScreen(main, store);
      restoreFocus(main, focus);
      if (!sameScreen) window.scrollTo({ top: 0 });
    }
    if (!last || last.toasts !== s.toasts) {
      toastList.replaceChildren(...s.toasts.map((t) => toastEl(store, t)));
      for (const t of s.toasts) {
        if (!timers.has(t.id)) {
          timers.set(
            t.id,
            setTimeout(() => {
              timers.delete(t.id);
              store.dismissToast(t.id);
            }, TOAST_MS[t.kind]),
          );
        }
      }
    }
    last = s;
  };

  store.subscribe(update);
  update();
}
