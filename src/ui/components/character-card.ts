/** 角色卡片：立绘、名字、属性条、状态标签、外出/死亡标识。 */
import {
  getArtState,
  type CharState,
  type Content,
  type RunState,
  type StatDef,
} from '../../engine';
import { artImg } from '../art';
import { cssToken, h } from '../dom';
import { T } from '../text';

export function statBar(def: StatDef, value: number): HTMLElement {
  const span = def.max - def.min || 1;
  const pct = Math.max(0, Math.min(100, ((value - def.min) / span) * 100));
  const level = pct < 25 ? 'low' : pct < 50 ? 'mid' : 'ok';
  const shown = Math.round(value);
  const fill = h('span', { class: 'stat__fill' });
  // 唯一的动态尺寸：通过 CSS 变量传给样式表
  fill.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  return h(
    'div',
    { class: ['stat', `stat--${level}`, `stat--${cssToken(def.id)}`] },
    h('span', { class: 'stat__label' }, def.name),
    h(
      'span',
      {
        class: 'stat__bar',
        attrs: {
          role: 'meter',
          'aria-label': def.name,
          'aria-valuemin': def.min,
          'aria-valuemax': def.max,
          'aria-valuenow': shown,
        },
      },
      fill,
    ),
    h('span', { class: 'stat__value' }, shown),
  );
}

const WHERE_LABEL: Record<CharState['where'], string | null> = {
  shelter: null,
  away: T.run.away,
  dead: T.run.dead,
  gone: T.run.gone,
};

export function characterCard(run: RunState, content: Content, charId: string): HTMLElement {
  const ch = run.characters[charId];
  const def = content.characters.get(charId);
  const name = def?.name ?? charId;
  const where = ch?.where ?? 'gone';
  const alive = where === 'shelter' || where === 'away';
  const badge = WHERE_LABEL[where];
  const statuses = (ch?.statuses ?? [])
    .map((s) => ({ s, def: content.statuses.get(s.id) }))
    .filter((x) => x.def);

  return h(
    'li',
    { class: ['char-card', `char-card--${where}`] },
    h(
      'div',
      { class: 'char-card__portrait' },
      artImg('characters', charId, alive ? getArtState(run, content, charId) : 'normal', name),
    ),
    h(
      'div',
      { class: 'char-card__body' },
      h(
        'h3',
        { class: 'char-card__name' },
        name,
        badge && h('span', { class: ['badge', `badge--${where}`] }, badge),
      ),
      alive &&
        h(
          'div',
          { class: 'char-card__stats' },
          content.db.stats.map((s) => statBar(s, ch?.stats[s.id] ?? s.initial)),
        ),
      alive &&
        h(
          'div',
          { class: 'char-card__statuses' },
          statuses.length
            ? statuses.map(({ s, def: sd }) =>
                h(
                  'span',
                  {
                    class: ['tag', 'tag--status', `tag--${cssToken(s.id)}`],
                    attrs: { title: sd!.desc ?? '' },
                  },
                  sd!.name,
                  s.daysLeft !== undefined
                    ? h('span', { class: 'tag__days' }, ` ${s.daysLeft}`)
                    : null,
                ),
              )
            : h('span', { class: 'tag tag--ok' }, T.run.noStatus),
        ),
    ),
  );
}
