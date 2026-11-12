/** 界面文案辅助：模板填充、错误码翻译。纯函数，不依赖 DOM。 */
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

/** 标签显示名 */
export function tagName(tag: string): string {
  return uiText.tagNames[tag] ?? tag;
}
