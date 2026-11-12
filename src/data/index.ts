// 占位：由任务 C4 填充。导出形状固定为 `contentDB: ContentDB`。
import type { ContentDB } from '../engine/schema';

export const contentDB: ContentDB = {
  config: { rationTags: [], logKeepDays: 7, fallbackEnding: 'wiped', texts: {} },
  stats: [],
  statuses: [],
  items: [],
  characters: [],
  difficulties: [],
  weathers: [],
  maps: [],
  locations: [],
  events: [],
  diary: [],
  endings: [],
};
