/** 菜单类屏幕（档案、主页、开局、结局……）的外壳：模糊压暗的庇护所背景 + 安全区内的内容。 */
import { h, type Children } from '../dom';
import { backdrop, menuBackground } from '../scene';
import type { Store } from '../store';

export function menuScreen(
  store: Store,
  cls: string,
  opts: { mapId?: string } | null,
  ...children: Children[]
): HTMLElement {
  return h(
    'div',
    { class: ['screen', 'screen--menu', cls] },
    backdrop(menuBackground(store.content, opts?.mapId), 'backdrop--menu'),
    h('div', { class: 'menu-safe' }, children),
  );
}

/** 木牌风格的屏幕标题条：左侧返回、中间标题、右侧附加 */
export function titleBar(left: Children, title: Children, right?: Children): HTMLElement {
  return h(
    'header',
    { class: 'titlebar' },
    h('div', { class: 'titlebar__side' }, left),
    h('h1', { class: 'titlebar__title' }, title),
    h('div', { class: 'titlebar__side titlebar__side--end' }, right),
  );
}
