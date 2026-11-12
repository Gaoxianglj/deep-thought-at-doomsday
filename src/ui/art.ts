/**
 * 美术资源加载与回退：<state>.webp → normal.webp → 程序生成的占位图（奶油底 + 暖棕描边的贴纸 + 名称首字）。
 * 已知失败的 URL 缓存在内存里，重渲染不会重复请求 404。
 * 纯函数部分（artPath / artCandidates / hashHue / placeholderColors / placeholderLabel）不依赖 DOM。
 */

export type ArtCategory =
  'characters' | 'items' | 'locations' | 'events' | 'ui' | 'backgrounds' | 'endings';

const SVG_NS = 'http://www.w3.org/2000/svg';
const failed = new Set<string>();
const loaded = new Set<string>();

function baseUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function artPath(category: string, id: string, state: string, base = baseUrl()): string {
  return `${base}art/${category}/${id}/${state}.webp`;
}

/** 依次尝试的图片 URL（已去重、已排除已知失败的） */
export function artCandidates(
  category: string,
  id: string,
  state: string,
  base = baseUrl(),
  knownFailed: ReadonlySet<string> = failed,
): string[] {
  const urls = [artPath(category, id, state, base), artPath(category, id, 'normal', base)];
  return [...new Set(urls)].filter((u) => !knownFailed.has(u));
}

/** 由 id 稳定地哈希出 0–359 的色相（FNV-1a） */
export function hashHue(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

/** 占位图配色：奶油底、暖棕描边，色相只用于一圈柔和的点缀 */
export function placeholderColors(id: string): {
  bg: string;
  fg: string;
  line: string;
  accent: string;
} {
  const hue = hashHue(id);
  return {
    bg: '#f7ecd7',
    fg: '#4a3324',
    line: '#4a3324',
    accent: `hsl(${hue} 42% 78%)`,
  };
}

/** 占位图上显示的短名：取名称首字 */
export function placeholderLabel(name: string): string {
  return [...name.trim()].slice(0, 1).join('') || '?';
}

export function markArtFailed(url: string): void {
  failed.add(url);
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function label(x: number, y: number, size: number, fill: string, text: string): SVGTextElement {
  const t = svgEl('text', {
    x,
    y,
    fill,
    'font-size': size,
    'font-weight': 800,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    class: 'art__ph-text',
  });
  t.textContent = text;
  return t;
}

/** 视图框尺寸：角色是站立的团子，场景类是横幅卡片，其余是方形贴纸 */
function placeholderBox(category: ArtCategory): { w: number; h: number } {
  if (category === 'characters') return { w: 85, h: 100 };
  if (category === 'locations' || category === 'events' || category === 'endings')
    return { w: 160, h: 100 };
  if (category === 'backgrounds') return { w: 160, h: 90 };
  return { w: 100, h: 100 };
}

/** 程序生成的占位图（内联 SVG，名称用 textContent 写入） */
export function placeholderArt(
  id: string,
  name: string,
  category: ArtCategory = 'items',
): SVGSVGElement {
  const c = placeholderColors(id);
  const { w, h } = placeholderBox(category);
  const banner = w > h;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: banner ? 'xMidYMid slice' : 'xMidYMax meet',
    class: `art__placeholder art__placeholder--${category}`,
    role: 'img',
    'aria-label': name,
  });
  const text = placeholderLabel(name);

  if (category === 'characters') {
    // 一个站着的小团子：粗描边、点点眼、肚子上写名字首字
    svg.append(
      svgEl('ellipse', { cx: 42.5, cy: 96, rx: 26, ry: 3.5, fill: 'rgba(74,51,36,.18)' }),
      svgEl('path', {
        d: 'M21 94 C18 62 22 26 42.5 24 C63 26 67 62 64 94 Q42.5 99 21 94 Z',
        fill: c.bg,
        stroke: c.line,
        'stroke-width': 3,
        'stroke-linejoin': 'round',
      }),
      svgEl('path', {
        d: 'M28 34 Q42.5 20 57 34',
        fill: 'none',
        stroke: c.accent,
        'stroke-width': 6,
        'stroke-linecap': 'round',
      }),
      svgEl('circle', { cx: 35.5, cy: 47, r: 3, fill: c.line }),
      svgEl('circle', { cx: 49.5, cy: 47, r: 3, fill: c.line }),
      svgEl('ellipse', { cx: 30, cy: 54, rx: 4, ry: 2.4, fill: c.accent }),
      svgEl('ellipse', { cx: 55, cy: 54, rx: 4, ry: 2.4, fill: c.accent }),
      svgEl('path', {
        d: 'M39.5 53 Q42.5 56 45.5 53',
        fill: 'none',
        stroke: c.line,
        'stroke-width': 2,
        'stroke-linecap': 'round',
      }),
      svgEl('circle', {
        cx: 42.5,
        cy: 75,
        r: 11,
        fill: c.accent,
        stroke: c.line,
        'stroke-width': 2,
      }),
      label(42.5, 75.5, 13, c.fg, text),
    );
    return svg;
  }

  if (category === 'items' || category === 'ui') {
    svg.append(
      svgEl('rect', {
        x: 8,
        y: 10,
        width: 84,
        height: 84,
        rx: 22,
        fill: 'rgba(74,51,36,.22)',
      }),
      svgEl('rect', {
        x: 6,
        y: 6,
        width: 84,
        height: 84,
        rx: 22,
        fill: c.bg,
        stroke: c.line,
        'stroke-width': 4,
      }),
      svgEl('circle', { cx: 48, cy: 48, r: 26, fill: c.accent }),
      label(48, 49, 32, c.fg, text),
    );
    return svg;
  }

  // 横幅：地点、事件、结局、背景。描边交给 CSS 外框，这里只画底纹、灯光与大号首字
  const stripes = svgEl('g', { opacity: 0.28 });
  for (let x = -h; x < w; x += 16) {
    stripes.append(
      svgEl('line', { x1: x, y1: h, x2: x + h, y2: 0, stroke: c.accent, 'stroke-width': 6 }),
    );
  }
  const glowId = `ph-glow-${hashHue(id)}`;
  const defs = svgEl('defs', {});
  const grad = svgEl('radialGradient', { id: glowId, cx: '50%', cy: '30%', r: '60%' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#fff6e0', 'stop-opacity': 0.95 }),
    svgEl('stop', { offset: '100%', 'stop-color': '#fff6e0', 'stop-opacity': 0 }),
  );
  defs.append(grad);
  const big = label(w / 2, h * 0.52, h * 0.5, c.line, text);
  big.setAttribute('opacity', '0.18');
  svg.append(
    defs,
    svgEl('rect', { x: 0, y: 0, width: w, height: h, fill: c.bg }),
    stripes,
    svgEl('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${glowId})` }),
    svgEl('path', {
      d: `M0 ${h * 0.78} Q${w * 0.3} ${h * 0.7} ${w * 0.55} ${h * 0.8} T${w} ${h * 0.76} V${h} H0 Z`,
      fill: c.accent,
      opacity: 0.55,
    }),
    big,
  );
  return svg;
}

/**
 * 返回一个包含图片（或占位图）的元素。图片加载失败时在原位依次回退。
 * state 对角色应传 getArtState() 的结果，其余类别一般传 'normal'。
 */
export function artImg(
  category: ArtCategory,
  id: string,
  state: string,
  name: string,
): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = `art art--${category}`;
  const queue = artCandidates(category, id, state);
  const makeImg = (url: string): HTMLImageElement => {
    const img = document.createElement('img');
    img.className = 'art__img';
    img.alt = name;
    img.draggable = false;
    img.src = url;
    return img;
  };
  // 已知可用的图片直接显示，避免重渲染时闪一下占位图
  const good = queue.find((u) => loaded.has(u));
  if (good && queue[0] === good) {
    wrap.append(makeImg(good));
    return wrap;
  }
  // 否则先显示占位图，图片加载成功后再替换（不会出现破图图标）
  wrap.classList.add('art--pending');
  wrap.append(placeholderArt(id, name, category));
  const tryNext = (): void => {
    const url = queue.shift();
    if (!url) {
      wrap.classList.remove('art--pending');
      wrap.classList.add('art--fallback');
      return;
    }
    if (failed.has(url)) return tryNext();
    const img = makeImg(url);
    img.decoding = 'async';
    img.addEventListener('load', () => {
      loaded.add(url);
      wrap.classList.remove('art--pending');
      wrap.replaceChildren(img);
    });
    img.addEventListener('error', () => {
      markArtFailed(url);
      tryNext();
    });
  };
  tryNext();
  return wrap;
}

/**
 * 背景图 URL（用于 CSS background-image）。已知缺图返回 null，调用方用渐变兜底。
 * 首次请求时在后台探测一次；失败后调用 onMissing（通常是触发重渲染）。
 */
export function backgroundUrl(id: string, onMissing?: () => void): string | null {
  const url = artPath('backgrounds', id, 'normal');
  if (failed.has(url)) return null;
  if (!loaded.has(url) && typeof Image !== 'undefined') {
    const probe = new Image();
    probe.addEventListener('load', () => loaded.add(url));
    probe.addEventListener('error', () => {
      markArtFailed(url);
      onMissing?.();
    });
    probe.src = url;
  }
  return url;
}

/** CSS url() 字面量；URL 只来自 artPath，不含引号 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/["\\]/g, '')}")`;
}
