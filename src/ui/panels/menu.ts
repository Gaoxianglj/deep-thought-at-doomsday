/** 对局菜单：继续、返回主页（对局自动保存）、设置与关于。 */
import { modalFrame } from '../dialog';
import { button, h } from '../dom';
import { aboutBlock } from '../components/about';
import { sectionTitle } from '../components/widgets';
import { T } from '../text';
import type { PanelCtx } from './types';

export function menuPanel(ctx: PanelCtx): HTMLElement {
  const { store } = ctx;
  return modalFrame(
    {
      title: T.run.menuTitle,
      onClose: ctx.close,
      animate: ctx.animate,
      class: ['sheet', 'sheet--small', 'panel-menu'],
    },
    h(
      'div',
      { class: 'sheet__body' },
      h(
        'div',
        { class: 'menu-actions' },
        button(T.run.menuResume, () => ctx.close(), {
          class: 'btn btn--primary btn--block',
          fkey: 'menu-resume',
        }),
        button(
          T.run.menuHome,
          () => {
            ctx.close();
            store.go('home');
          },
          { class: 'btn btn--wood btn--block', fkey: 'menu-home' },
        ),
      ),
      sectionTitle(T.home.about),
      aboutBlock(store),
    ),
  );
}
