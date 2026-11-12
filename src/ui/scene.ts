/**
 * 横屏舞台：模糊压暗的背景铺底 + 居中的 16:9 场景框。
 * 场景框内按 scenes 数据的百分比坐标分层绝对定位：背景 → 物资堆与道具 → 热点 → 角色 → 头顶标记。
 * 没有场景数据的地图：渐变背景 + 角色一排站开 + 物资列在侧栏。
 */
import { shelterIds, type Content, type RunState, type SceneDef } from '../engine';
import { artImg, backgroundUrl, cssUrl } from './art';
import {
  avatar,
  charName,
  itemIcon,
  itemName,
  itemsWithTag,
  lowStats,
  portrait,
  statusPill,
  tagCount,
} from './components/widgets';
import { h, type Children } from './dom';
import { loopPhase } from './motion';
import { fmt, tagName, T } from './text';

export interface StageHandlers {
  onCharacter?(id: string): void;
  onStock?(tag: string): void;
  onProp?(itemId: string): void;
  onExpedition?(): void;
  onJournal?(): void;
}

export interface StageOptions {
  /** 场景内的东西能否点击（事件画面里只作背景） */
  interactive: boolean;
  /** 显示角色头顶标记 */
  markers?: boolean;
  /** 日记本是否有未读 */
  journalUnread?: boolean;
  class?: string;
}

const BREATH_MS = 3600;

/** 用于设置位置/尺寸的 CSS 变量（唯一允许的内联样式） */
function place(el: HTMLElement, vars: Record<string, number | string>): HTMLElement {
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(`--${k}`, typeof v === 'number' ? `${+v.toFixed(3)}` : v);
  }
  return el;
}

/** 某地图的场景；没有返回 undefined */
export function sceneFor(content: Content, mapId: string | undefined): SceneDef | undefined {
  return mapId ? content.sceneByMap.get(mapId) : undefined;
}

/** 菜单类屏幕用的背景：优先当前地图，否则第一个场景 */
export function menuBackground(content: Content, mapId?: string): string | null {
  const scene = sceneFor(content, mapId) ?? content.db.scenes?.[0];
  return scene ? backgroundUrl(scene.background) : null;
}

/** 全屏模糊背景（菜单类屏幕、舞台两侧余量） */
export function backdrop(bg: string | null, extraClass?: string): HTMLElement {
  const el = h('div', { class: ['backdrop', !bg && 'backdrop--plain', extraClass] });
  if (bg) el.style.setProperty('--bg', cssUrl(bg));
  return el;
}

interface Spot {
  x: number;
  y: number;
  h: number;
}

/** 按队伍顺序分配站位；站位不够时在最后一个站位附近错开 */
export function assignSpots(ids: string[], spots: Spot[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  ids.forEach((id, i) => {
    if (i < spots.length) {
      out.set(id, spots[i]);
      return;
    }
    const base = spots[spots.length - 1];
    const k = i - spots.length + 1;
    const dir = k % 2 === 1 ? -1 : 1;
    out.set(id, {
      x: Math.max(6, Math.min(94, base.x + dir * 7 * Math.ceil(k / 2))),
      y: Math.min(99, base.y + 2),
      h: base.h,
    });
  });
  return out;
}

/** 没有场景数据时的默认站位：一排站开 */
function defaultSpots(n: number): Spot[] {
  const count = Math.max(1, n);
  return Array.from({ length: count }, (_, i) => ({
    // 避开左下角的日志条与右侧的物资栏
    x: count === 1 ? 46 : 32 + (34 * i) / (count - 1),
    y: 92,
    h: 50,
  }));
}

function clickable(
  tag: 'button' | 'div',
  interactive: boolean,
  cls: (string | false | undefined)[],
  label: string,
  onClick: (() => void) | undefined,
  children: Children,
): HTMLElement {
  if (interactive && onClick) {
    return h(
      'button',
      {
        class: [...cls, 'is-clickable'],
        attrs: { type: 'button', 'aria-label': label },
        on: { click: onClick },
      },
      children,
    );
  }
  return h(
    tag === 'button' ? 'div' : tag,
    { class: cls, attrs: { 'aria-hidden': 'true' } },
    children,
  );
}

function stockArea(
  run: RunState,
  content: Content,
  area: SceneDef['stockAreas'][number],
  opts: StageOptions,
  handlers: StageHandlers,
): HTMLElement {
  const total = tagCount(run, content, area.tag);
  const icons: HTMLElement[] = [];
  for (const [id, n] of itemsWithTag(run, content, area.tag)) {
    for (let i = 0; i < n && icons.length < area.max; i++) {
      const el = h('span', { class: 'stock__item' }, itemIcon(content, id));
      icons.push(el);
    }
  }
  const shown = Math.max(1, icons.length);
  // 每个槽位的宽度（占区域宽的百分比）；放不下时物品自然重叠，最后一件仍落在区域内
  const unitPct = ((area.h * 9) / (area.w * 16)) * 100;
  const capPct = 0.82 * unitPct;
  const itemPct = Math.min(96, 0.92 * unitPct * 1.2);
  const slot = shown > 1 ? Math.min(capPct, (96 - itemPct) / (shown - 1)) : capPct;
  const el = clickable(
    'div',
    opts.interactive,
    ['stock', total === 0 && 'stock--empty'],
    fmt(T.run.stockArea, { tag: tagName(content, area.tag), n: total }),
    handlers.onStock && (() => handlers.onStock!(area.tag)),
    [
      h('span', { class: 'stock__row' }, icons),
      total > 0 && h('span', { class: 'count-badge stock__badge' }, String(total)),
    ],
  );
  return place(el, { x: area.x, y: area.y, w: area.w, h: area.h, slot: `${slot.toFixed(2)}%` });
}

function propEl(
  run: RunState,
  content: Content,
  id: string,
  pos: { x: number; y: number; w: number },
  opts: StageOptions,
  handlers: StageHandlers,
): HTMLElement | null {
  const n = run.inventory[id] ?? 0;
  if (n <= 0 || !content.items.has(id)) return null;
  const el = clickable(
    'div',
    opts.interactive,
    ['prop'],
    itemName(content, id),
    handlers.onProp && (() => handlers.onProp!(id)),
    [itemIcon(content, id), n > 1 && h('span', { class: 'count-badge prop__badge' }, String(n))],
  );
  return place(el, { x: pos.x, y: pos.y, w: pos.w });
}

function figure(
  run: RunState,
  content: Content,
  id: string,
  spot: Spot,
  index: number,
  opts: StageOptions,
  handlers: StageHandlers,
): HTMLElement {
  const body = h('span', { class: 'figure__body' }, portrait(run, content, id));
  loopPhase(body, BREATH_MS, index * 1100);
  const el = clickable(
    'div',
    opts.interactive,
    ['figure'],
    fmt(T.run.openCharacter, { name: charName(content, id) }),
    handlers.onCharacter && (() => handlers.onCharacter!(id)),
    [h('span', { class: 'figure__shadow' }), body],
  );
  return place(el, { x: spot.x, y: spot.y, h: spot.h, z: Math.round(spot.y * 10) });
}

function marker(run: RunState, content: Content, id: string, spot: Spot): HTMLElement {
  const ch = run.characters[id];
  const low = lowStats(run, content, id);
  const rations = content.config.rationTags
    .map((t) => run.plan.rations[id]?.[t])
    .filter((x): x is string => !!x);
  const pills = (ch?.statuses ?? [])
    .slice(0, 3)
    .map((s) => statusPill(content, s, { small: true }));
  const el = h(
    'div',
    { class: 'marker', attrs: { 'aria-hidden': 'true' } },
    low.length > 0 &&
      h(
        'span',
        { class: 'marker__alert' },
        fmt(T.run.lowStat, { stat: low.map((s) => s.name).join('、') }),
      ),
    pills.length > 0 && h('span', { class: 'marker__pills' }, pills),
    h(
      'span',
      { class: 'nameplate' },
      h('span', { class: 'nameplate__name' }, charName(content, id)),
      rations.length > 0 &&
        h(
          'span',
          { class: 'nameplate__rations' },
          rations.map((r) => h('span', { class: 'nameplate__ration' }, itemIcon(content, r))),
        ),
    ),
  );
  return place(el, { x: spot.x, y: spot.y - spot.h, z: Math.round(spot.y * 10) });
}

function hotspots(
  run: RunState,
  content: Content,
  scene: SceneDef,
  opts: StageOptions,
  handlers: StageHandlers,
): HTMLElement[] {
  const out: HTMLElement[] = [];
  const door = scene.hotspots.expedition;
  const planned = run.plan.expedition;
  const doorEl = clickable(
    'div',
    opts.interactive,
    ['hotspot', 'hotspot--door'],
    T.run.openExpedition,
    handlers.onExpedition,
    [
      door.art && artImg('ui', door.art, 'normal', T.run.openExpedition),
      !planned && !run.expedition && h('span', { class: 'door-label' }, T.run.expedition),
      planned &&
        h(
          'span',
          {
            class: 'door-tag',
            attrs: {
              title: fmt(T.run.plannedSign, {
                name: charName(content, planned.charId),
                location: content.locations.get(planned.locationId)?.name ?? planned.locationId,
              }),
            },
          },
          h('span', { class: 'door-tag__kicker' }, T.run.plannedKicker),
          h(
            'span',
            { class: 'door-tag__route' },
            fmt(T.run.plannedRoute, {
              name: charName(content, planned.charId),
              location: content.locations.get(planned.locationId)?.name ?? planned.locationId,
            }),
          ),
        ),
    ],
  );
  out.push(place(doorEl, { x: door.x, y: door.y, w: door.w, h: door.h }));

  const away = run.expedition;
  if (away) {
    const sign = h(
      'div',
      {
        class: 'away-sign',
        attrs: {
          title: fmt(T.run.awaySignTitle, {
            name: charName(content, away.charId),
            location: content.locations.get(away.locationId)?.name ?? away.locationId,
          }),
        },
      },
      avatar(run, content, away.charId),
      h(
        'span',
        { class: 'away-sign__text' },
        h('span', { class: 'away-sign__name' }, charName(content, away.charId)),
        h('span', { class: 'away-sign__day' }, fmt(T.run.awaySign, { day: away.returnDay })),
      ),
    );
    out.push(place(sign, { x: door.x, y: door.y + door.h }));
  }

  const j = scene.hotspots.journal;
  const book = h(
    'span',
    { class: 'journal-book' },
    j.art && artImg('ui', j.art, 'normal', T.run.journalTitle),
  );
  loopPhase(book, 4200);
  const journalEl = clickable(
    'div',
    opts.interactive,
    ['hotspot', 'hotspot--journal', opts.journalUnread && 'has-unread'],
    T.run.openJournal,
    handlers.onJournal,
    [book, opts.journalUnread && h('span', { class: 'red-dot' })],
  );
  out.push(place(journalEl, { x: j.x, y: j.y, w: j.w, h: j.h }));
  return out;
}

/** 没有场景时的物资侧栏 */
function stockSide(run: RunState, content: Content, handlers: StageHandlers): HTMLElement {
  const tags = [
    ...new Set(content.db.items.flatMap((it) => ((run.inventory[it.id] ?? 0) > 0 ? it.tags : []))),
  ];
  return h(
    'div',
    { class: 'stock-side' },
    h('p', { class: 'stock-side__title' }, T.run.stockSide),
    tags.map((tag) =>
      h(
        'button',
        {
          class: 'stock-side__row',
          attrs: { type: 'button' },
          on: { click: () => handlers.onStock?.(tag) },
        },
        h(
          'span',
          { class: 'stock-side__icons' },
          itemsWithTag(run, content, tag)
            .slice(0, 3)
            .map(([id]) => h('span', { class: 'stock-side__icon' }, itemIcon(content, id))),
        ),
        h('span', { class: 'stock-side__name' }, tagName(content, tag)),
        h('span', { class: 'count-badge' }, String(tagCount(run, content, tag))),
      ),
    ),
  );
}

/** 整个舞台（铺底 + 场景框）。interactive=false 时只作背景 */
export function buildStage(
  run: RunState,
  content: Content,
  opts: StageOptions,
  handlers: StageHandlers = {},
  onArtMissing?: () => void,
): HTMLElement {
  const scene = sceneFor(content, run.mapId);
  const bg = scene ? backgroundUrl(scene.background, onArtMissing) : null;
  const ids = shelterIds(run);
  const spots = assignSpots(ids, scene?.spots ?? defaultSpots(ids.length));

  const frame = h('div', { class: ['stage__frame', !scene && 'stage__frame--plain'] });
  if (bg) frame.style.setProperty('--bg', cssUrl(bg));

  const stockLayer = h('div', { class: 'stage__layer stage__layer--stock' });
  const hotLayer = h('div', { class: 'stage__layer stage__layer--hot' });
  const charLayer = h('div', { class: 'stage__layer stage__layer--chars' });
  const markLayer = h('div', { class: 'stage__layer stage__layer--marks' });

  if (scene) {
    for (const area of scene.stockAreas)
      stockLayer.append(stockArea(run, content, area, opts, handlers));
    for (const [id, pos] of Object.entries(scene.props)) {
      const p = propEl(run, content, id, pos, opts, handlers);
      if (p) stockLayer.append(p);
    }
    hotLayer.append(...hotspots(run, content, scene, opts, handlers));
  }
  ids.forEach((id, i) => {
    const spot = spots.get(id)!;
    charLayer.append(figure(run, content, id, spot, i, opts, handlers));
    if (opts.markers) markLayer.append(marker(run, content, id, spot));
  });

  frame.append(h('div', { class: 'stage__bg' }), stockLayer, hotLayer, charLayer, markLayer);
  return h(
    'div',
    { class: ['stage', opts.class] },
    backdrop(bg, 'stage__backdrop'),
    frame,
    !scene && opts.interactive && stockSide(run, content, handlers),
  );
}
