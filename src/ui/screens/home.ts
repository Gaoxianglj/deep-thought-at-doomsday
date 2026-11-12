/** 主页：继续 / 新开局 / 放弃对局、已解锁伙伴、见过的结局、切换档案、设置与关于。 */
import { SAVE_VERSION } from '../../engine';
import { artImg } from '../art';
import { confirmDialog } from '../dialog';
import { button, h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';
import { resetSetup } from './setup';
import { version as appVersion } from '../../../package.json';

/** 存储持久化状态：null = 未查询；'unknown' = 浏览器不支持 */
let persisted: boolean | 'unknown' | null = null;

function storageNote(store: Store): HTMLElement {
  if (persisted === null) {
    persisted = 'unknown';
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (s?.persisted) {
      s.persisted()
        .then((v) => {
          persisted = v;
          store.touch();
        })
        .catch(() => undefined);
    }
  }
  const text =
    persisted === true
      ? T.home.storagePersisted
      : persisted === false
        ? T.home.storageNotPersisted
        : T.home.storageUnknown;
  return h('p', { class: ['about__storage', persisted === false && 'about__storage--warn'] }, text);
}

export function render(root: HTMLElement, store: Store): void {
  const { profile, run, notices } = store.get();
  const { content } = store;
  if (!profile) return;

  const startNew = async (): Promise<void> => {
    if (run) {
      const ok = await confirmDialog(T.home.newRunConfirmTitle, T.home.newRunConfirm, {
        danger: true,
      });
      if (!ok) return;
    }
    resetSetup();
    store.go('setup');
  };

  const actions = h(
    'div',
    { class: 'home__actions' },
    run &&
      button(
        [
          h('span', { class: 'btn__main' }, T.home.continue),
          h(
            'span',
            { class: 'btn__sub' },
            fmt(T.home.continueDetail, {
              map: content.maps.get(run.mapId)?.name ?? run.mapId,
              day: run.day,
            }),
          ),
        ],
        () => store.continueRun(),
        { class: 'btn btn--primary btn--block btn--stack', fkey: 'continue' },
      ),
    button(T.home.newRun, () => void startNew(), {
      class: run ? 'btn btn--block' : 'btn btn--primary btn--block',
      fkey: 'new-run',
    }),
    run &&
      button(
        T.home.abandon,
        async () => {
          const ok = await confirmDialog(T.home.abandonConfirmTitle, T.home.abandonConfirm, {
            danger: true,
          });
          if (ok) await store.abandonRun();
        },
        { class: 'btn btn--danger-ghost btn--block' },
      ),
  );

  const unlocked = profile.unlockedCharacters
    .map((id) => content.characters.get(id))
    .filter((c) => c !== undefined);
  const companions = h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.home.companions),
    unlocked.length
      ? h(
          'ul',
          { class: 'companion-grid' },
          unlocked.map((c) =>
            h(
              'li',
              { class: 'companion' },
              h(
                'div',
                { class: 'companion__portrait' },
                artImg('characters', c.id, 'normal', c.name),
              ),
              h('span', { class: 'companion__name' }, c.name),
            ),
          ),
        )
      : h('p', { class: 'empty' }, T.home.companionsEmpty),
  );

  const seen = profile.endingsSeen
    .map((id) => content.endings.get(id))
    .filter((e) => e !== undefined);
  const endings = h(
    'section',
    { class: 'section' },
    h('h2', { class: 'section__title' }, T.home.endings),
    seen.length
      ? h(
          'ul',
          { class: 'ending-list' },
          seen.map((e) =>
            h('li', { class: ['ending-list__item', `ending-list__item--${e.kind}`] }, e.name),
          ),
        )
      : h('p', { class: 'empty' }, T.home.endingsEmpty),
  );

  const about = h(
    'section',
    { class: 'section about' },
    h('h2', { class: 'section__title' }, T.home.about),
    h(
      'p',
      { class: 'about__version' },
      fmt(T.version, { version: appVersion, save: SAVE_VERSION }),
    ),
    storageNote(store),
  );

  root.append(
    h(
      'div',
      { class: 'screen screen--home' },
      h(
        'header',
        { class: 'screen__header' },
        h('h1', { class: 'screen__title' }, T.appTitle),
        h('p', { class: 'screen__subtitle' }, fmt(T.home.greeting, { name: profile.name })),
        h('p', { class: 'screen__meta' }, fmt(T.home.runsPlayed, { n: profile.runsPlayed })),
      ),
      notices.length > 0 &&
        h(
          'ul',
          { class: 'notice-list', attrs: { role: 'status' } },
          notices.map((n) => h('li', { class: 'notice-list__item' }, n)),
        ),
      actions,
      companions,
      endings,
      h(
        'div',
        { class: 'home__footer' },
        button(T.home.switchProfile, () => void store.switchProfile(), {
          class: 'btn btn--ghost btn--block',
        }),
      ),
      about,
    ),
  );
}
