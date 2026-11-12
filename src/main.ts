import './style.css';
import { contentDB } from './data';
import { buildContent } from './engine';
import { createSaveService, installAutosave } from './save';
import { mount } from './ui/app';
import { Store } from './ui/store';

const container = document.querySelector<HTMLDivElement>('#app');
if (container) {
  const content = buildContent(contentDB);
  const save = createSaveService(content);
  const store = new Store(content, save);
  mount(container, store);
  installAutosave(() => store.getSnapshot(), save);
  void store.boot();
}
