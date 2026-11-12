/**
 * 主页（标题画面）：游戏名大标题 + 已解锁伙伴立绘一排 + 继续/新开局/放弃等按钮；
 * 右侧纸卡：见过的结局、读档提示、设置与关于、切换档案。
 */
import { artImg } from '../art';
import { aboutBlock } from '../components/about';
import { menuScreen } from '../components/shell';
import { emptyNote, sectionTitle } from '../components/widgets';
import { confirmDialog } from '../dialog';
import { button, h } from '../dom';
import { loopPhase } from '../motion';
import type { Store } from '../store';
import { fmt, T } from '../text';
import { resetSetup } from './setup';

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
    { class: 'title-actions' },
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
        { class: 'btn btn--primary btn--stamp btn--stack', fkey: 'continue' },
      ),
    button(T.home.newRun, () => void startNew(), {
      class: run ? 'btn btn--wood' : 'btn btn--primary btn--stamp',
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
        { class: 'btn btn--ghost btn--danger-text', fkey: 'abandon' },
      ),
  );

  const unlocked = profile.unlockedCharacters
    .map((id) => content.characters.get(id))
    .filter((c) => c !== undefined);
  const lineup = h(
    'div',
    { class: 'lineup', attrs: { 'aria-label': T.home.companions } },
    unlocked.length
      ? unlocked.map((c, i) => {
          const fig = h(
            'figure',
            { class: 'lineup__fig' },
            h('span', { class: 'lineup__art' }, artImg('characters', c.id, 'normal', c.name)),
            h('figcaption', { class: 'lineup__name' }, c.name),
          );
          loopPhase(fig, 3600, i * 1200);
          return fig;
        })
      : emptyNote(T.home.companionsEmpty),
  );

  const seen = profile.endingsSeen
    .map((id) => content.endings.get(id))
    .filter((e) => e !== undefined);

  const side = h(
    'aside',
    { class: 'paper home-side', attrs: { 'data-skey': 'home-side' } },
    h(
      'div',
      { class: 'home-side__profile' },
      h('span', { class: 'home-side__name' }, fmt(T.home.greeting, { name: profile.name })),
      h('span', { class: 'home-side__meta' }, fmt(T.home.runsPlayed, { n: profile.runsPlayed })),
    ),
    notices.length > 0 && [
      sectionTitle(T.home.noticesTitle),
      h(
        'ul',
        { class: 'notice-list', attrs: { role: 'status' } },
        notices.map((n) => h('li', { class: 'notice-list__item' }, n)),
      ),
    ],
    sectionTitle(T.home.endings),
    seen.length
      ? h(
          'ul',
          { class: 'ending-chips' },
          seen.map((e) => h('li', { class: ['ending-chip', `ending-chip--${e.kind}`] }, e.name)),
        )
      : emptyNote(T.home.endingsEmpty),
    sectionTitle(T.home.about),
    aboutBlock(store),
    button(T.home.switchProfile, () => void store.switchProfile(), {
      class: 'btn btn--ghost btn--block',
      fkey: 'switch-profile',
    }),
  );

  root.append(
    menuScreen(
      store,
      'screen--home',
      { mapId: run?.mapId },
      h(
        'div',
        { class: 'home' },
        h(
          'div',
          { class: 'home-main' },
          h(
            'div',
            { class: 'logo' },
            h('h1', { class: 'logo__title' }, T.appTitle),
            h('p', { class: 'logo__sub' }, T.home.subtitle),
          ),
          lineup,
          actions,
        ),
        side,
      ),
    ),
  );
}
