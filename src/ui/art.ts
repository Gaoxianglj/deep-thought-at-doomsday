/**
 * 美术资源加载与回退：<state>.png → normal.png → 程序生成的占位图（id 哈希色相 + 名称）。
 * 已知失败的 URL 缓存在内存里，重渲染不会重复请求 404。
 * 纯函数部分（artPath / artCandidates / hashHue / placeholderColors）不依赖 DOM。
 */

export type ArtCategory = 'characters' | 'items' | 'locations' | 'events' | 'ui';

const SVG_NS = 'http://www.w3.org/2000/svg';
const failed = new Set<string>();
const loaded = new Set<string>();

function baseUrl(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

export function artPath(category: string, id: string, state: string, base = baseUrl()): string {
  return `${base}art/${category}/${id}/${state}.png`;
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

export function placeholderColors(id: string): { bg: string; fg: string; accent: string } {
  const hue = hashHue(id);
  return {
    bg: `hsl(${hue} 35% 22%)`,
    accent: `hsl(${hue} 45% 38%)`,
    fg: `hsl(${hue} 60% 88%)`,
  };
}

/** 占位图上显示的短名：取名称前 2 个字符 */
export function placeholderLabel(name: string): string {
  return [...name.trim()].slice(0, 2).join('') || '?';
}

export function markArtFailed(url: string): void {
  failed.add(url);
}

/** 程序生成的占位图（内联 SVG，名称用 textContent 写入） */
export function placeholderArt(id: string, name: string): SVGSVGElement {
  const c = placeholderColors(id);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('class', 'art__placeholder');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', name);
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', '100');
  rect.setAttribute('height', '100');
  rect.setAttribute('fill', c.bg);
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '50');
  circle.setAttribute('cy', '50');
  circle.setAttribute('r', '34');
  circle.setAttribute('fill', c.accent);
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', '50');
  text.setAttribute('y', '50');
  text.setAttribute('fill', c.fg);
  text.setAttribute('font-size', '24');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.textContent = placeholderLabel(name);
  svg.append(rect, circle, text);
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
    img.decoding = 'async';
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
  wrap.append(placeholderArt(id, name));
  const tryNext = (): void => {
    const url = queue.shift();
    if (!url) return;
    if (failed.has(url)) return tryNext();
    const img = makeImg(url);
    img.addEventListener('load', () => {
      loaded.add(url);
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
