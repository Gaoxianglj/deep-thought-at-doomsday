/** 档案页：列表、新建、进入、删除、导入、导出。 */
import type { Profile } from '../../save/types';
import { confirmDialog, openDialog } from '../dialog';
import { button, h, uid } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';

const NAME_MAX = 24;

/** 输入框草稿：重渲染时保留 */
const drafts = { name: '', importText: '', importError: '' };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function exportCode(store: Store, p: Profile): Promise<void> {
  let code: string;
  try {
    code = await store.save.exportCode(p.id);
  } catch (e) {
    store.toast(fmt(T.profiles.exportFailed, { error: errMsg(e) }), 'error');
    return;
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(code);
    store.toast(T.profiles.copied, 'success');
  } catch {
    openDialog(T.profiles.copyFallbackTitle, () => {
      const id = uid('code');
      const ta = h('textarea', {
        class: 'field__input field__input--code',
        attrs: { id, readonly: true, rows: 6 },
      });
      ta.value = code;
      ta.addEventListener('focus', () => ta.select());
      queueMicrotask(() => {
        ta.focus();
        ta.select();
      });
      return [
        h('label', { class: 'field__label', attrs: { for: id } }, T.profiles.copyFallbackBody),
        ta,
      ];
    });
  }
}

async function exportJson(store: Store, p: Profile): Promise<void> {
  try {
    const json = await store.save.exportJson(p.id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = p.name.replace(/[\\/:*?"<>|\s]+/g, '_');
    const date = new Date().toISOString().slice(0, 10);
    const a = h('a', { attrs: { href: url, download: `dtad-${safeName}-${date}.json` } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    store.toast(T.profiles.downloaded);
  } catch (e) {
    store.toast(fmt(T.profiles.exportFailed, { error: errMsg(e) }), 'error');
  }
}

function profileItem(store: Store, p: Profile): HTMLElement {
  return h(
    'li',
    { class: 'profile-list__item card' },
    h(
      'div',
      { class: 'profile-list__info' },
      h('h3', { class: 'profile-list__name' }, p.name),
      h(
        'p',
        { class: 'profile-list__meta' },
        fmt(T.profiles.runs, { n: p.runsPlayed }),
        ' · ',
        fmt(T.profiles.updated, { date: formatDate(p.updatedAt) }),
      ),
    ),
    h(
      'div',
      { class: 'profile-list__actions' },
      button(T.profiles.open, () => void store.openProfile(p.id), {
        class: 'btn btn--primary',
        fkey: `open-${p.id}`,
      }),
      button(T.profiles.exportCode, () => void exportCode(store, p), { class: 'btn btn--ghost' }),
      button(T.profiles.exportJson, () => void exportJson(store, p), { class: 'btn btn--ghost' }),
      button(
        T.profiles.delete,
        async () => {
          const ok = await confirmDialog(
            T.profiles.deleteConfirmTitle,
            fmt(T.profiles.deleteConfirm, { name: p.name }),
            { confirmText: T.common.delete, danger: true },
          );
          if (ok) await store.deleteProfile(p.id);
        },
        { class: 'btn btn--danger-ghost' },
      ),
    ),
  );
}

function createForm(store: Store): HTMLElement {
  const id = uid('name');
  const errId = uid('err');
  const input = h('input', {
    class: 'field__input',
    attrs: {
      id,
      type: 'text',
      maxlength: NAME_MAX,
      placeholder: T.profiles.namePlaceholder,
      autocomplete: 'off',
      'aria-describedby': errId,
    },
    fkey: 'profile-name',
  });
  input.value = drafts.name;
  input.addEventListener('input', () => (drafts.name = input.value));
  const err = h('p', { class: 'field__error', attrs: { id: errId, 'aria-live': 'polite' } });
  const form = h(
    'form',
    { class: 'form' },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', attrs: { for: id } }, T.profiles.nameLabel),
      input,
      err,
    ),
    h('button', { class: 'btn btn--primary', attrs: { type: 'submit' } }, T.profiles.create),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) err.textContent = T.profiles.nameEmpty;
    else if ([...name].length > NAME_MAX) err.textContent = T.profiles.nameTooLong;
    else {
      err.textContent = '';
      drafts.name = '';
      void store.createProfile(name);
    }
  });
  return h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.profiles.createTitle),
    form,
  );
}

function importForm(store: Store): HTMLElement {
  const taId = uid('import');
  const fileId = uid('file');
  const errId = uid('err');
  const ta = h('textarea', {
    class: 'field__input field__input--code',
    attrs: {
      id: taId,
      rows: 4,
      placeholder: T.profiles.importPlaceholder,
      'aria-describedby': errId,
    },
    fkey: 'import-text',
  });
  ta.value = drafts.importText;
  ta.addEventListener('input', () => (drafts.importText = ta.value));
  const err = h(
    'p',
    { class: 'field__error', attrs: { id: errId, 'aria-live': 'polite' } },
    drafts.importError,
  );
  const file = h('input', {
    class: 'field__file',
    attrs: { id: fileId, type: 'file', accept: '.json,application/json,text/plain' },
  });
  const doImport = async (text: string): Promise<void> => {
    if (!text.trim()) {
      drafts.importError = T.profiles.importEmpty;
      store.touch();
      return;
    }
    const r = await store.importText(text);
    drafts.importError = r.ok ? '' : r.error;
    if (r.ok) drafts.importText = '';
    store.touch();
  };
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      await doImport(await f.text());
    } catch {
      drafts.importError = T.profiles.fileReadFailed;
      store.touch();
    }
    file.value = '';
  });
  const form = h(
    'form',
    { class: 'form' },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', attrs: { for: taId } }, T.profiles.importLabel),
      ta,
    ),
    h('button', { class: 'btn', attrs: { type: 'submit' } }, T.profiles.importButton),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', attrs: { for: fileId } }, T.profiles.importFileLabel),
      file,
    ),
    err,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void doImport(ta.value);
  });
  return h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.profiles.importTitle),
    form,
  );
}

export function render(root: HTMLElement, store: Store): void {
  const { profiles } = store.get();
  root.append(
    h(
      'div',
      { class: 'screen screen--profiles' },
      h(
        'header',
        { class: 'screen__header' },
        h('h1', { class: 'screen__title' }, T.profiles.title),
      ),
      profiles.length
        ? h(
            'ul',
            { class: 'profile-list' },
            profiles.map((p) => profileItem(store, p)),
          )
        : h('p', { class: 'empty' }, T.profiles.empty),
      createForm(store),
      importForm(store),
    ),
  );
}
