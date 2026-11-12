import type { RunState } from '../../engine';
import type { Store } from '../store';

/** 庇护所画面上浮起的面板（同一时间最多一个） */
export type Panel =
  | { kind: 'character'; id: string }
  | { kind: 'inventory'; tag?: string; item?: string }
  | { kind: 'item'; id: string }
  | { kind: 'expedition' }
  | { kind: 'journal'; tab: 'history' | 'members' }
  | { kind: 'menu' };

export interface PanelCtx {
  store: Store;
  run: RunState;
  /** 本次渲染是面板第一次出现（播放弹出动画、定位滚动） */
  animate: boolean;
  open(p: Panel): void;
  /** 修改当前面板的参数（不重播动画） */
  update(p: Panel): void;
  close(): void;
  endDay(): void;
  reuseRations(): void;
}
