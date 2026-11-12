/** 动效辅助：尊重 prefers-reduced-motion；循环动画在重渲染后接着原相位播放，不会跳。 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * 给循环动画设置负的 animation-delay（CSS 变量 --loop-delay），
 * 让每次重建的元素都从"当前时刻应在的相位"开始。offset 用于错开多个元素。
 */
export function loopPhase(el: HTMLElement, periodMs: number, offsetMs = 0): void {
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  const t = (now + offsetMs) % periodMs;
  el.style.setProperty('--loop-delay', `${-t.toFixed(0)}ms`);
}
