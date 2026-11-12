import { registerSW } from 'virtual:pwa-register';
import './pwa.css';

function showUpdateBanner(onUpdate: () => void): void {
  const banner = document.createElement('div');
  banner.className = 'pwa-banner';
  banner.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'pwa-banner__text';
  text.textContent = '有新版本，点此更新';

  const update = document.createElement('button');
  update.type = 'button';
  update.className = 'pwa-banner__btn pwa-banner__btn--primary';
  update.textContent = '更新';
  update.addEventListener('click', () => {
    banner.remove();
    onUpdate();
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'pwa-banner__btn';
  later.textContent = '稍后';
  later.addEventListener('click', () => banner.remove());

  banner.append(text, update, later);
  document.body.append(banner);
}

/** 仅生产构建注册 Service Worker；新版本只提示，不自动刷新。 */
export function initPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBanner(() => void updateSW(true));
    },
  });
}
