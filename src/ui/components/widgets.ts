/** 跨屏幕复用的小部件与查询辅助：属性条、状态胶囊、立绘、物品图标、配给用量…… */
import {
  getArtState,
  shelterIds,
  type Content,
  type RunState,
  type StatDef,
  type StatusDef,
} from '../../engine';
import { artImg } from '../art';
import { cssToken, h, type Children } from '../dom';
import { T } from '../text';

export function charName(content: Content, id: string): string {
  return content.characters.get(id)?.name ?? id;
}

export function itemName(content: Content, id: string): string {
  return content.items.get(id)?.name ?? id;
}

/** 属性是否过低（≤ 范围的 25%） */
export function isLow(def: StatDef, value: number): boolean {
  return value <= def.min + (def.max - def.min) * 0.25;
}

/** 过低的属性（按 stats 顺序） */
export function lowStats(run: RunState, content: Content, charId: string): StatDef[] {
  const ch = run.characters[charId];
  if (!ch) return [];
  return content.db.stats.filter((s) => isLow(s, ch.stats[s.id] ?? s.initial));
}

/**
 * 状态的色调。数据里没有"好/坏"字段：会让某项属性每日下降、或禁止外出的视为负面，其余中性。
 */
export function statusTone(def: StatusDef | undefined): 'bad' | 'neutral' {
  if (!def) return 'neutral';
  if (def.blocksExpedition) return 'bad';
  for (const r of def.rules ?? []) {
    for (const m of r.modifiers ?? []) {
      if (/^stat\..+\.dailyDelta$/.test(m.key) && (m.add ?? 0) < 0) return 'bad';
    }
  }
  return 'neutral';
}

export function statusPill(
  content: Content,
  s: { id: string; daysLeft?: number },
  opts: { small?: boolean } = {},
): HTMLElement | null {
  const def = content.statuses.get(s.id);
  if (!def) return null;
  return h(
    'span',
    {
      class: ['pill', `pill--${statusTone(def)}`, opts.small && 'pill--small'],
      attrs: { title: def.desc ?? '' },
    },
    def.name,
    s.daysLeft !== undefined && !opts.small
      ? h('span', { class: 'pill__days' }, String(s.daysLeft))
      : null,
  );
}

/** 有描边的圆头属性条；低值变砖红并轻微跳动。index 决定配色（与内容 id 无关） */
export function statBar(def: StatDef, value: number, index: number): HTMLElement {
  const span = def.max - def.min || 1;
  const pct = Math.max(0, Math.min(100, ((value - def.min) / span) * 100));
  const low = isLow(def, value);
  const shown = Math.round(value);
  const fill = h('span', { class: 'meter__fill' });
  fill.style.setProperty('--fill', `${pct.toFixed(1)}%`);
  return h(
    'div',
    { class: ['meter', `meter--c${index % 4}`, low && 'meter--low'] },
    h('span', { class: 'meter__label' }, def.name),
    h(
      'span',
      {
        class: 'meter__track',
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
    h('span', { class: 'meter__value' }, shown),
  );
}

/** 角色立绘（活人按状态取图） */
export function portrait(run: RunState | null, content: Content, id: string): HTMLElement {
  const ch = run?.characters[id];
  const alive = ch && (ch.where === 'shelter' || ch.where === 'away');
  const state = run && alive ? getArtState(run, content, id) : 'normal';
  return artImg('characters', id, state, charName(content, id));
}

export function itemIcon(content: Content, id: string): HTMLElement {
  return artImg('items', id, 'normal', itemName(content, id));
}

/** 圆形头像框（立绘的上半身） */
export function avatar(run: RunState | null, content: Content, id: string): HTMLElement {
  return h('span', { class: 'avatar' }, portrait(run, content, id));
}

/**
 * 各物品今晚的计划用量：配给（只算在庇护所的人）+ 外出携带。
 * 入夜先吃配给再出发，携带物不足会导致外出取消，所以一并计算。
 */
export function rationUsage(run: RunState): Map<string, number> {
  const used = new Map<string, number>();
  for (const id of run.plan.expedition?.carry ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  for (const cid of shelterIds(run)) {
    for (const itemId of Object.values(run.plan.rations[cid] ?? {})) {
      used.set(itemId, (used.get(itemId) ?? 0) + 1);
    }
  }
  return used;
}

/** 带某标签的库存总数 */
export function tagCount(run: RunState, content: Content, tag: string): number {
  let n = 0;
  for (const [id, c] of Object.entries(run.inventory)) {
    if (c > 0 && content.items.get(id)?.tags.includes(tag)) n += c;
  }
  return n;
}

/** 库存中带某标签的物品（按内容顺序） */
export function itemsWithTag(run: RunState, content: Content, tag: string): [string, number][] {
  return content.db.items
    .filter((it) => it.tags.includes(tag) && (run.inventory[it.id] ?? 0) > 0)
    .map((it) => [it.id, run.inventory[it.id]]);
}

/** 纸张小标题 */
export function sectionTitle(text: Children, extra?: Children): HTMLElement {
  return h('h3', { class: 'sheet-title' }, h('span', { class: 'sheet-title__text' }, text), extra);
}

export function emptyNote(text: string): HTMLElement {
  return h('p', { class: 'empty' }, text);
}

const WHERE_LABEL = { away: T.run.away, dead: T.run.dead, gone: T.run.gone } as const;

export function whereBadge(where: string): HTMLElement | null {
  if (where === 'shelter') return null;
  const text = WHERE_LABEL[where as keyof typeof WHERE_LABEL];
  return text ? h('span', { class: ['badge', `badge--${cssToken(where)}`] }, text) : null;
}
