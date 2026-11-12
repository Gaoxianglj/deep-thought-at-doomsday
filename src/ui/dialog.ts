/**
 * 自绘模态层（不用原生 <dialog>.showModal()：顶层元素不会随横屏根旋转）。
 * - modalFrame()：生成"纸张"风格的模态卡片；屏幕内的面板（角色、背包……）随屏幕重渲染，也用它。
 * - openDialog() / confirmDialog()：挂在横屏根的模态层上，不受屏幕重渲染影响。
 * Esc 关闭最上层、Tab 焦点限制在最上层、点遮罩关闭，由 installModalKeys() 统一处理。
 */
import { button, h, type Children } from './dom';
import { T } from './text';

const closers = new WeakMap<HTMLElement, () => void>();
let host: HTMLElement | null = null;
let scope: HTMLElement | null = null;

/** 设置对话框的挂载点（横屏根内的模态层）与键盘处理的范围（横屏根） */
export function setModalHost(layer: HTMLElement, root: HTMLElement): void {
  host = layer;
  scope = root;
}

export interface ModalOptions {
  title?: Children;
  /** 屏幕阅读器用的标题文本（title 不是纯文本时用） */
  label?: string;
  onClose: () => void;
  class?: string | (string | false | null | undefined)[];
  /** 第一次出现时播放弹出动画 */
  animate?: boolean;
  /** 标题栏右侧的额外元素 */
  headerExtra?: Children;
  /** 没有标题栏（自定义造型的面板，如日记本） */
  bare?: boolean;
  /** 关闭按钮文本（默认 ×） */
  closeLabel?: string;
}

let titleSeq = 0;

/** 一个完整的模态：遮罩 + 卡片。返回遮罩元素（.modal） */
export function modalFrame(opts: ModalOptions, ...body: Children[]): HTMLElement {
  const titleId = `modal-title-${++titleSeq}`;
  const close = button('×', () => opts.onClose(), {
    class: 'btn-icon modal__close',
    label: opts.closeLabel ?? T.common.close,
    fkey: `modal-close-${typeof opts.title === 'string' ? opts.title : (opts.label ?? '')}`,
  });
  const panel = h(
    'section',
    {
      class: ['modal__panel', ...(Array.isArray(opts.class) ? opts.class : [opts.class])],
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': opts.title && !opts.bare ? titleId : undefined,
        'aria-label': opts.bare || !opts.title ? opts.label : undefined,
        tabindex: -1,
      },
    },
    !opts.bare &&
      h(
        'header',
        { class: 'modal__header' },
        h('h2', { class: 'modal__title', attrs: { id: titleId } }, opts.title ?? ''),
        opts.headerExtra,
        close,
      ),
    opts.bare && close,
    body,
  );
  const overlay = h(
    'div',
    { class: ['modal', opts.animate && 'is-entering'] },
    h('div', { class: 'modal__scrim', on: { click: () => opts.onClose() } }),
    panel,
  );
  closers.set(overlay, opts.onClose);
  if (opts.animate) {
    overlay.addEventListener('animationend', () => overlay.classList.remove('is-entering'), {
      once: true,
    });
  }
  return overlay;
}

/** 让新出现的模态获得焦点（第一个非关闭按钮的可聚焦元素，否则面板本身） */
export function focusModal(overlay: HTMLElement): void {
  const panel = overlay.querySelector<HTMLElement>('.modal__panel');
  if (!panel) return;
  const first = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (el) => !el.classList.contains('modal__close'),
  );
  (first ?? panel).focus({ preventScroll: true });
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function topModal(): HTMLElement | null {
  if (!scope) return null;
  const all = scope.querySelectorAll<HTMLElement>('.modal');
  return all.length ? all[all.length - 1] : null;
}

/** 全局键盘：Esc 关闭最上层模态；Tab 循环限制在最上层模态内 */
export function installModalKeys(): void {
  document.addEventListener('keydown', (ev) => {
    const top = topModal();
    if (!top) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closers.get(top)?.();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = [...top.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !top.contains(active)) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  });
}

export interface DialogHandle {
  close(): void;
  el: HTMLElement;
}

/** 打开一个对话框；build 返回对话框正文。关闭后自动移除并把焦点还给之前的元素。 */
export function openDialog(
  title: string,
  build: (handle: DialogHandle) => Children,
  opts: { onClose?: () => void; class?: string } = {},
): DialogHandle {
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  const handle: DialogHandle = {
    el: document.createElement('div'),
    close() {
      if (closed) return;
      closed = true;
      handle.el.remove();
      opts.onClose?.();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    },
  };
  const overlay = modalFrame(
    {
      title,
      onClose: () => handle.close(),
      class: ['modal__panel--dialog', opts.class],
      animate: true,
    },
    h('div', { class: 'modal__body', attrs: { 'data-skey': 'dialog' } }, build(handle)),
  );
  overlay.classList.add('modal--dialog');
  handle.el = overlay;
  (host ?? document.body).append(overlay);
  focusModal(overlay);
  return handle;
}

/** 二次确认；确认返回 true。message 可含换行，每行一段；list 为附加的问题清单。 */
export function confirmDialog(
  title: string,
  message: string,
  opts: { confirmText?: string; danger?: boolean; list?: string[] } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openDialog(
      title,
      (d) => [
        message
          .split(/\n+/)
          .filter(Boolean)
          .map((p) => h('p', { class: 'dialog__message' }, p)),
        opts.list?.length
          ? h(
              'ul',
              { class: 'dialog__list' },
              opts.list.map((li) => h('li', null, li)),
            )
          : null,
        h(
          'div',
          { class: 'dialog__actions' },
          button(T.common.cancel, () => d.close(), { class: 'btn btn--ghost' }),
          button(
            opts.confirmText ?? T.common.confirm,
            () => {
              result = true;
              d.close();
            },
            { class: opts.danger ? 'btn btn--danger' : 'btn btn--primary' },
          ),
        ),
      ],
      { onClose: () => resolve(result) },
    );
  });
}
