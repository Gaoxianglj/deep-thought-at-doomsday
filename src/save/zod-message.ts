/** 把 zod 校验错误翻译成一句给玩家看的中文。 */
import type { z } from 'zod';

const TYPE_NAMES: Record<string, string> = {
  string: '文字',
  number: '数字',
  int: '整数',
  boolean: '是/否',
  object: '对象',
  array: '列表',
  record: '对象',
  null: '空值',
};

const SECTION_NAMES: Record<string, string> = {
  profile: '档案信息',
  run: '对局数据',
  characters: '角色',
  inventory: '物品',
  stats: '属性',
  statuses: '状态',
  plan: '计划',
  expedition: '外出',
  pendingEvent: '当前事件',
  eventQueue: '事件队列',
  log: '日志',
  flags: '标记',
};

function describePath(path: readonly PropertyKey[]): string {
  if (!path.length) return '存档顶层';
  return path
    .map((p) =>
      typeof p === 'number' ? `第 ${p + 1} 项` : (SECTION_NAMES[String(p)] ?? String(p)),
    )
    .join(' › ');
}

function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      if (/received undefined/.test(issue.message)) return '缺少必要的数据';
      return `数据类型不对（应为${TYPE_NAMES[issue.expected] ?? issue.expected}）`;
    case 'too_small':
    case 'too_big':
      return '数值超出允许范围';
    case 'invalid_value':
    case 'invalid_union':
    case 'invalid_format':
    case 'invalid_key':
    case 'invalid_element':
      return '取值不合法';
    case 'unrecognized_keys':
      return '包含无法识别的字段';
    default:
      return '数据不合法';
  }
}

export function zodErrorToChinese(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return '存档内容已损坏。';
  return `存档内容已损坏（位置：${describePath(issue.path)}）：${describeIssue(issue)}。`;
}
