/** 把数据目录导出的数组建成按 id 查询的索引。引擎只通过 Content 访问内容。 */
import type {
  CharacterDef,
  ContentDB,
  DiaryDef,
  DifficultyDef,
  EndingDef,
  EventDef,
  GameConfig,
  ItemDef,
  LocationDef,
  MapDef,
  SceneDef,
  StatDef,
  StatusDef,
  WeatherDef,
} from './schema';

export interface Content {
  db: ContentDB;
  config: GameConfig;
  stats: Map<string, StatDef>;
  statuses: Map<string, StatusDef>;
  items: Map<string, ItemDef>;
  characters: Map<string, CharacterDef>;
  difficulties: Map<string, DifficultyDef>;
  weathers: Map<string, WeatherDef>;
  maps: Map<string, MapDef>;
  locations: Map<string, LocationDef>;
  events: Map<string, EventDef>;
  diary: Map<string, DiaryDef>;
  endings: Map<string, EndingDef>;
  /** 键是地图 id */
  sceneByMap: Map<string, SceneDef>;
}

function index<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((d) => [d.id, d]));
}

export function buildContent(db: ContentDB): Content {
  return {
    db,
    config: db.config,
    stats: index(db.stats),
    statuses: index(db.statuses),
    items: index(db.items),
    characters: index(db.characters),
    difficulties: index(db.difficulties),
    weathers: index(db.weathers),
    maps: index(db.maps),
    locations: index(db.locations),
    events: index(db.events),
    diary: index(db.diary),
    endings: index(db.endings),
    sceneByMap: new Map((db.scenes ?? []).map((s) => [s.map, s])),
  };
}
