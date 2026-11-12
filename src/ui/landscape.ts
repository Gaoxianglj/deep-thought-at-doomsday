/**
 * 横屏根：视口横向时铺满；竖向时宽高互换并旋转 90° 铺满（iOS 不能锁定方向）。
 * 所有界面（屏幕、模态层、提示、PWA 横幅）都必须渲染在根元素内部，才会跟着旋转。
 *
 * 尺寸基准：根高度 = 375 个设计单位，--u 为 1 个单位的像素数（宽度不足 600 单位时按宽度收紧）。
 * 场景框：16:9，高度占满；屏幕比 16:9 更窄时允许两侧略微裁切，再窄就上下留边。
 */

export const DESIGN_HEIGHT = 375;
const MIN_DESIGN_WIDTH = 600;
/** 场景框最多比根宽出这么多倍（两侧裁切），超出则改为上下留边 */
const MAX_STAGE_OVERFLOW = 1.12;

export interface LandscapeMetrics {
  rotated: boolean;
  width: number;
  height: number;
  unit: number;
  stageW: number;
  stageH: number;
}

/** 纯函数：由视口尺寸算出根的尺寸、旋转与单位 */
export function measureLandscape(vw: number, vh: number): LandscapeMetrics {
  const rotated = vh > vw;
  const width = rotated ? vh : vw;
  const height = rotated ? vw : vh;
  const unit = Math.max(0.5, Math.min(height / DESIGN_HEIGHT, width / MIN_DESIGN_WIDTH));
  const stageH = Math.min(height, (width * MAX_STAGE_OVERFLOW * 9) / 16);
  const stageW = (stageH * 16) / 9;
  return { rotated, width, height, unit, stageW, stageH };
}

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !/^(?:button|checkbox|radio|file|submit)$/.test(el.type))
  );
}

let rootEl: HTMLElement | null = null;

/** 横屏根元素（挂载后可用）；PWA 横幅等外部模块用它插入 */
export function landscapeRoot(): HTMLElement | null {
  return rootEl;
}

export function createLandscape(container: HTMLElement): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ls-root';
  rootEl = root;
  container.replaceChildren(root);

  let last: LandscapeMetrics | null = null;
  let raf = 0;

  const apply = (): void => {
    raf = 0;
    const m = measureLandscape(window.innerWidth, window.innerHeight);
    // 输入时（竖屏唤起键盘会改变视口高度）冻结布局，避免整页翻转
    if (last && isTyping() && m.rotated !== last.rotated) return;
    if (last && isTyping() && last.rotated) return;
    last = m;
    root.classList.toggle('is-rotated', m.rotated);
    const s = root.style;
    s.setProperty('--root-w', `${m.width}px`);
    s.setProperty('--root-h', `${m.height}px`);
    s.setProperty('--u', `${m.unit.toFixed(4)}px`);
    s.setProperty('--stage-w', `${m.stageW.toFixed(1)}px`);
    s.setProperty('--stage-h', `${m.stageH.toFixed(1)}px`);
  };
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  // 输入结束后补一次测量
  root.addEventListener('focusout', () => setTimeout(schedule, 50));
  return root;
}
