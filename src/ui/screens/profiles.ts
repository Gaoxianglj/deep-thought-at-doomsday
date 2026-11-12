/** 档案页（横屏两栏）：左栏档案列表（进入、导出、删除）；右栏新建与导入。 */
import type { Profile } from '../../save/types';
import { menuScreen, titleBar } from '../components/shell';
import { emptyNote, sectionTitle } from '../components/widgets';
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
        attrs: { id, readonly: true, rows: 5 },
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
    { class: 'profile' },
    h(
      'div',
      { class: 'profile__info' },
      h('h3', { class: 'profile__name' }, p.name),
      h(
        'p',
        { class: 'profile__meta' },
        fmt(T.profiles.runs, { n: p.runsPlayed }),
        ' · ',
        fmt(T.profiles.updated, { date: formatDate(p.updatedAt) }),
      ),
    ),
    h(
      'div',
      { class: 'profile__actions' },
      button(T.profiles.open, () => void store.openProfile(p.id), {
        class: 'btn btn--primary btn--small',
        fkey: `open-${p.id}`,
      }),
      button(T.profiles.exportCode, () => void exportCode(store, p), {
        class: 'btn btn--ghost btn--small',
      }),
      button(T.profiles.exportJson, () => void exportJson(store, p), {
        class: 'btn btn--ghost btn--small',
      }),
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
        { class: 'btn btn--ghost btn--small btn--danger-text' },
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
      enterkeyhint: 'done',
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
    h('label', { class: 'field__label', attrs: { for: id } }, T.profiles.nameLabel),
    h(
      'div',
      { class: 'field-row' },
      input,
      h('button', { class: 'btn btn--primary', attrs: { type: 'submit' } }, T.profiles.create),
    ),
    err,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (!name) err.textContent = T.profiles.nameEmpty;
    else if ([...name].length > NAME_MAX) err.textContent = T.profiles.nameTooLong;
    else {
      err.textContent = '';
      drafts.name = '';
      input.blur();
      void store.createProfile(name);
    }
  });
  return h('section', { class: 'form-block' }, sectionTitle(T.profiles.createTitle), form);
}

function importForm(store: Store): HTMLElement {
  const taId = uid('import');
  const fileId = uid('file');
  const errId = uid('err');
  const ta = h('textarea', {
    class: 'field__input field__input--code',
    attrs: {
      id: taId,
      rows: 3,
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
    class: 'visually-hidden',
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
    h('label', { class: 'field__label', attrs: { for: taId } }, T.profiles.importLabel),
    ta,
    h(
      'div',
      { class: 'field-row' },
      h('button', { class: 'btn btn--wood', attrs: { type: 'submit' } }, T.profiles.importButton),
      h(
        'label',
        { class: 'btn btn--ghost file-btn', attrs: { for: fileId } },
        T.profiles.importFileLabel,
      ),
      file,
    ),
    err,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void doImport(ta.value);
  });
  return h('section', { class: 'form-block' }, sectionTitle(T.profiles.importTitle), form);
}

export function render(root: HTMLElement, store: Store): void {
  const { profiles } = store.get();
  root.append(
    menuScreen(
      store,
      'screen--profiles',
      null,
      titleBar(h('span', { class: 'titlebar__brand' }, T.appTitle), T.profiles.title),
      h(
        'div',
        { class: 'two-col' },
        h(
          'section',
          { class: 'paper col-main', attrs: { 'data-skey': 'profile-list' } },
          profiles.length
            ? h(
                'ul',
                { class: 'profile-list' },
                profiles.map((p) => profileItem(store, p)),
              )
            : emptyNote(T.profiles.empty),
        ),
        h(
          'section',
          { class: 'paper col-side', attrs: { 'data-skey': 'profile-forms' } },
          createForm(store),
          importForm(store),
        ),
      ),
    ),
  );
}
