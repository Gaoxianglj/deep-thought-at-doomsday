/**
 * 应用外壳：横屏根 → 屏幕容器 + 模态层 + 提示 + 换日幕布。
 * 订阅 store，状态变化时重渲染当前屏幕；提示消息单独渲染（不会打断输入）。
 * 重渲染时按 data-fkey 恢复焦点、按 data-skey 恢复滚动位置。
 */
import { installModalKeys, setModalHost, focusModal } from './dialog';
import { button, h } from './dom';
import { createLandscape } from './landscape';
import { prefersReducedMotion } from './motion';
import * as ending from './screens/ending';
import * as event from './screens/event';
import * as home from './screens/home';
import * as profiles from './screens/profiles';
import * as setup from './screens/setup';
import * as shelter from './screens/shelter';
import { renderBoot, renderNotReady } from './screens/status';
import type { AppState, Store, Toast } from './store';
import { fmt, T } from './text';

const TOAST_MS = { info: 3500, success: 4000, error: 6500 } as const;
const CURTAIN_MS = 1100;

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
      return renderNotReady(root, store);
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

function restoreFocus(root: HTMLElement, key: string | null): boolean {
  if (!key) return false;
  const el = root.querySelector<HTMLElement>(`[data-fkey="${CSS.escape(key)}"]`);
  if (el && !(el as HTMLButtonElement).disabled) {
    el.focus({ preventScroll: true });
    return true;
  }
  return false;
}

function saveScroll(root: HTMLElement): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-skey]')) {
    out.set(el.dataset.skey!, [el.scrollTop, el.scrollLeft]);
  }
  return out;
}

function restoreScroll(root: HTMLElement, saved: Map<string, [number, number]>): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-skey]')) {
    const pos = saved.get(el.dataset.skey!);
    if (pos) {
      el.scrollTop = pos[0];
      el.scrollLeft = pos[1];
    }
  }
}

function toastEl(store: Store, t: Toast): HTMLElement {
  return h(
    'li',
    { class: ['toast', `toast--${t.kind}`] },
    h('span', { class: 'toast__text' }, t.text),
    button('×', () => store.dismissToast(t.id), {
      class: 'btn-icon toast__close',
      label: T.common.close,
    }),
  );
}

/** 换日幕布：短暂变暗并显示"第 N 天"，可点击跳过 */
function showCurtain(curtain: HTMLElement, day: number): void {
  if (prefersReducedMotion()) return;
  curtain.replaceChildren(
    h('span', { class: 'curtain__day' }, fmt(T.run.day, { day })),
    h('span', { class: 'curtain__hint' }, T.run.tapToSkip),
  );
  curtain.hidden = false;
  curtain.classList.remove('is-playing');
  void curtain.offsetWidth;
  curtain.classList.add('is-playing');
  const done = (): void => {
    curtain.hidden = true;
    curtain.classList.remove('is-playing');
    clearTimeout(timer);
  };
  const timer = setTimeout(done, CURTAIN_MS);
  curtain.onclick = done;
}

export function mount(container: HTMLElement, store: Store): void {
  const root = createLandscape(container);
  const main = h('main', { class: 'app__main' });
  const layer = h('div', { class: 'app__layer' });
  const toastList = h('ul', {
    class: 'toasts',
    attrs: { 'aria-live': 'polite', 'aria-atomic': 'false' },
  });
  const curtain = h('div', { class: 'curtain', attrs: { hidden: true, 'aria-hidden': 'true' } });
  root.append(main, layer, toastList, curtain);
  setModalHost(layer, root);
  installModalKeys();

  let last: AppState | null = null;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const update = (): void => {
    const s = store.get();
    const screenChanged = !last || SCREEN_KEYS.some((k) => last![k] !== s[k]);
    if (screenChanged) {
      const focus = focusKey(main);
      const sameScreen = last?.screen === s.screen;
      const scroll = sameScreen ? saveScroll(main) : new Map<string, [number, number]>();
      const hadModal = !!main.querySelector('.modal');
      main.replaceChildren();
      renderScreen(main, store);
      restoreScroll(main, scroll);
      const restored = restoreFocus(main, focus);
      const modal = main.querySelector<HTMLElement>('.modal');
      if (modal && !hadModal && !restored) focusModal(modal);
      // 换日：同一局的天数增加
      const before = last?.run;
      const after = s.run;
      if (before && after && before.seed === after.seed && after.day > before.day) {
        showCurtain(curtain, after.day);
      }
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
