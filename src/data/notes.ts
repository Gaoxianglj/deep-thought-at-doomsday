import type { NoteDef } from '../engine/schema';

/** 日记本"备忘"页（见 docs/DESIGN.md 12.1）：各条结局线的进度与本局随机的目标。 */

const FACILITIES = [
  ['gen', 'gen_installed', '发电机', '发电机零件', '变电站的配电室（带手电筒）'],
  ['filter', 'filter_installed', '净水桶', '滤水芯', '自来水厂的过滤车间（带防毒面具）'],
  ['seeds', 'seeds_installed', '种植箱', '种子包', '植物园温室的育苗室（带杀虫喷雾）'],
  ['vent', 'vent_installed', '通风机', '通风滤网', '地铁站的通风竖井（带绳索）'],
] as const;

const facilityNotes: NoteDef[] = FACILITIES.flatMap(([key, flag, name, part, where], i) => [
  {
    id: `self_rescue_${key}_todo`,
    text: `${name}：还缺${part}，可能在${where}。`,
    when: { not: { flag } },
    order: 11 + i,
  },
  {
    id: `self_rescue_${key}_done`,
    text: `${name}：已经装好了。`,
    when: { flag },
    order: 11 + i,
  },
]);

export const notes = [
  {
    id: 'self_rescue_goal',
    text: '自给自足：修好发电机、净水桶、种植箱和通风机，就不必再等任何人来救。',
    order: 10,
  },
  ...facilityNotes,
  {
    id: 'evac_known',
    text: '军方撤离：接应分队要求出示 {flagItem:evac_item} 作为识别。留意收音机里的广播。',
    when: { all: [{ flag: 'evac_known' }, { not: { flag: 'evac_contact' } }] },
    order: 20,
  },
  {
    id: 'evac_contact',
    text: '军方撤离：已约定在街口会合，记得备好 {flagItem:evac_item}。',
    when: { flag: 'evac_contact' },
    order: 20,
  },
  {
    id: 'caravan_progress',
    text: '南下车队：还差水 {flag:caravan_water_left} 份、食物 {flag:caravan_food_left} 份。车队每 2 天经过一次，最多来 8 次。',
    when: { all: [{ flag: 'caravan_known' }, { not: { flag: 'caravan_gone' } }] },
    order: 30,
  },
  {
    id: 'caravan_gone',
    text: '南下车队：已经走了，不会再来。',
    when: { flag: 'caravan_gone' },
    order: 30,
  },
  {
    id: 'trail_1',
    text: '地下列车：传单上说，第一个记号在 {flagLocation:trail_1}。',
    when: { flag: 'trail_step', eq: 1 },
    order: 40,
  },
  {
    id: 'trail_2',
    text: '地下列车：下一个记号在 {flagLocation:trail_2}。',
    when: { flag: 'trail_step', eq: 2 },
    order: 40,
  },
  {
    id: 'trail_3',
    text: '地下列车：最后一个记号在 {flagLocation:trail_3}。',
    when: { flag: 'trail_step', eq: 3 },
    order: 40,
  },
  {
    id: 'trail_done',
    text: '地下列车：记号都找到了，列车会在最近的地铁口停靠。最好备着手电筒打信号。',
    when: { flag: 'trail_step', eq: 4 },
    order: 40,
  },
] satisfies NoteDef[];
