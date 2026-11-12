import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/stage.css';
import './styles/hud.css';
import './styles/panels.css';
import './styles/event.css';
import './styles/menus.css';
import './styles/motion.css';
import { contentDB } from './data';
import { buildContent } from './engine';
import { createSaveService, installAutosave } from './save';
import { mount } from './ui/app';
import { Store } from './ui/store';
import { initPwa } from './pwa';

const container = document.querySelector<HTMLDivElement>('#app');
if (container) {
  const content = buildContent(contentDB);
  const save = createSaveService(content);
  const store = new Store(content, save);
  mount(container, store);
  installAutosave(() => store.getSnapshot(), save);
  void store.boot();
}

initPwa();
