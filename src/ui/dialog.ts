/**
 * 模态对话框（原生 <dialog>，Esc 可关闭）。挂在 body 上，不受屏幕重渲染影响。
 */
import { button, h, type Children } from './dom';
import { T } from './text';

export interface DialogHandle {
  close(): void;
  el: HTMLDialogElement;
}

/** 打开一个对话框；build 返回对话框正文。关闭后自动移除。 */
export function openDialog(
  title: string,
  build: (handle: DialogHandle) => Children,
  opts: { onClose?: () => void; class?: string } = {},
): DialogHandle {
  const titleId = `dlg-title-${Math.random().toString(36).slice(2)}`;
  const el = h('dialog', {
    class: ['dialog', opts.class],
    attrs: { 'aria-labelledby': titleId },
  });
  let closed = false;
  const handle: DialogHandle = {
    el,
    close() {
      if (closed) return;
      closed = true;
      if (el.open) el.close();
      el.remove();
      opts.onClose?.();
    },
  };
  el.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    handle.close();
  });
  el.addEventListener('click', (ev) => {
    // 点击遮罩（dialog 自身而非内容）关闭
    if (ev.target === el) handle.close();
  });
  const body = h('div', { class: 'dialog__body' }, build(handle));
  el.append(
    h(
      'div',
      { class: 'dialog__panel' },
      h(
        'header',
        { class: 'dialog__header' },
        h('h2', { class: 'dialog__title', attrs: { id: titleId } }, title),
        button('×', () => handle.close(), {
          class: 'btn btn--icon dialog__close',
          label: T.common.close,
        }),
      ),
      body,
    ),
  );
  document.body.append(el);
  if (typeof el.showModal === 'function') el.showModal();
  else el.setAttribute('open', '');
  return handle;
}

/** 二次确认；确认返回 true */
export function confirmDialog(
  title: string,
  message: string,
  opts: { confirmText?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openDialog(
      title,
      (d) => [
        h('p', { class: 'dialog__message' }, message),
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
