/** "设置与关于"：版本号与存储持久化状态（主页与对局菜单共用）。 */
import { SAVE_VERSION } from '../../engine';
import { h } from '../dom';
import type { Store } from '../store';
import { fmt, T } from '../text';
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

export function aboutBlock(store: Store): HTMLElement {
  return h(
    'div',
    { class: 'about' },
    h(
      'p',
      { class: 'about__version' },
      fmt(T.version, { version: appVersion, save: SAVE_VERSION }),
    ),
    storageNote(store),
  );
}
