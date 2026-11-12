/** 极简 DOM 构建辅助。文本一律以文本节点插入（不使用 innerHTML）。 */

export type Child = Node | string | number | null | undefined | false;
export type Children = Child | readonly Children[];

export interface Props {
  class?: string | (string | false | null | undefined)[];
  /** 普通属性；false / null / undefined 表示不设置，true 表示空字符串属性 */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: { [K in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[K]) => void };
  /** 用于重渲染后恢复焦点的稳定键 */
  fkey?: string;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Children[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) {
      const cls = Array.isArray(props.class) ? props.class.filter(Boolean).join(' ') : props.class;
      if (cls) el.className = cls;
    }
    for (const [k, v] of Object.entries(props.attrs ?? {})) {
      if (v === false || v === null || v === undefined) continue;
      el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const [k, fn] of Object.entries(props.on ?? {})) {
      if (fn) el.addEventListener(k, fn as EventListener);
    }
    if (props.fkey) el.dataset.fkey = props.fkey;
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Children): void {
  if (Array.isArray(children)) {
    for (const c of children as readonly Children[]) append(el, c);
    return;
  }
  const c = children as Child;
  if (c === null || c === undefined || c === false) return;
  if (typeof c === 'string' || typeof c === 'number')
    el.appendChild(document.createTextNode(String(c)));
  else el.appendChild(c);
}

/** 按钮的简写 */
export function button(
  text: Children,
  onClick: () => void,
  opts: { class?: Props['class']; disabled?: boolean; fkey?: string; label?: string } = {},
): HTMLButtonElement {
  return h(
    'button',
    {
      class: opts.class ?? 'btn',
      attrs: { type: 'button', disabled: !!opts.disabled, 'aria-label': opts.label },
      on: { click: onClick },
      fkey: opts.fkey,
    },
    text,
  );
}

let idSeq = 0;
export function uid(prefix = 'f'): string {
  return `${prefix}-${++idSeq}`;
}

/** class 名里安全使用的片段 */
export function cssToken(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}
