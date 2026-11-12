/** 界面文案辅助：模板填充、错误码翻译。纯函数，不依赖 DOM。 */
import type { Content } from '../engine';
import { uiText } from '../data/ui-text';

export { uiText as T };

/** 填充 {name} 占位符；未提供的占位符原样保留 */
export function fmt(tpl: string, vars: Record<string, string | number> = {}): string {
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (raw, key: string) =>
    key in vars ? String(vars[key]) : raw,
  );
}

/** 引擎 / 开局校验错误码 → 中文说明 */
export function errorText(code: string): string {
  return uiText.errors[code] ?? fmt(uiText.errors.unknown, { code });
}

/** 标签显示名：优先取内容 config.tagNames，没有则用标签原文 */
export function tagName(content: Content, tag: string): string {
  return content.config.tagNames?.[tag] ?? tag;
}
