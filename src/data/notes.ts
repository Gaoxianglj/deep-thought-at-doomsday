import type { NoteDef } from '../engine/schema';

/** 日记本"备忘"页（见 docs/DESIGN.md 12.1）：各条结局线的进度与本局随机的目标。 */

const FACILITIES = [
  [
    'gen',
    'gen_installed',
    '发电机',
    '发电机零件',
    '变电站',
    '手电筒',
    '配电室',
    '屋里有了灯，理智下降变慢',
  ],
  [
    'filter',
    'filter_installed',
    '净水桶',
    '滤水芯',
    '自来水厂',
    '防毒面具',
    '过滤车间',
    '隔三岔五能攒出一瓶干净的水',
  ],
  [
    'seeds',
    'seeds_installed',
    '种植箱',
    '种子包',
    '植物园温室',
    '杀虫喷雾',
    '育苗室',
    '偶尔能收一把米',
  ],
  [
    'vent',
    'vent_installed',
    '通风机',
    '通风滤网',
    '地铁站',
    '绳索',
    '通风竖井',
    '空气好了，不容易生病',
  ],
] as const;

const facilityNotes: NoteDef[] = FACILITIES.flatMap(
  ([key, flag, name, part, where, tool, room, benefit], i) => [
    {
      id: `self_rescue_${key}_todo`,
      text: `${name}：还缺${part}。去${where}搜刮时偶尔能翻到；带上${tool}去，还有机会找到${room}，在那里一定能拿到。`,
      when: { not: { flag } },
      order: 11 + i,
    },
    {
      id: `self_rescue_${key}_done`,
      text: `${name}：已经装好了——${benefit}。`,
      when: { flag },
      order: 11 + i,
    },
  ],
);

export const notes = [
  {
    id: 'self_rescue_goal',
    text: '自给自足：修好发电机、净水桶、种植箱和通风机，就不必再等任何人来救。部件一到手，清晨就会提示安装。',
    order: 10,
  },
  ...facilityNotes,
  {
    id: 'evac_known',
    text: '军方撤离：接应分队要求出示 {flagItem:evac_item} 作为识别。留意收音机里的广播，回应成功就能约好会合。',
    when: { all: [{ flag: 'evac_known' }, { not: { flag: 'evac_contact' } }] },
    order: 20,
  },
  {
    id: 'evac_contact',
    text: '军方撤离：已约好三天后的清晨在街口会合。不用出门——到时候在家等着，装甲车会自己来。{flagItem:evac_item} 必须留在屋里（别让外出的人带走），拿不出来就只能碰运气。',
    when: { flag: 'evac_contact' },
    order: 20,
  },
  {
    id: 'caravan_progress',
    text: '南下车队：还差水 {flag:caravan_water_left} 份、食物 {flag:caravan_food_left} 份。车队每两天经过一次，每次可以交好几份，但不会一直等下去。',
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
    text: '地下列车：传单上说，第一个记号在 {flagLocation:trail_1}。派人外出去那里一趟就能找到。',
    when: { flag: 'trail_step', eq: 1 },
    order: 40,
  },
  {
    id: 'trail_2',
    text: '地下列车：下一个记号在 {flagLocation:trail_2}。派人外出去那里一趟就能找到。',
    when: { flag: 'trail_step', eq: 2 },
    order: 40,
  },
  {
    id: 'trail_3',
    text: '地下列车：最后一个记号在 {flagLocation:trail_3}。派人外出去那里一趟就能找到。',
    when: { flag: 'trail_step', eq: 3 },
    order: 40,
  },
  {
    id: 'train_countdown',
    text: '地下列车：列车将在 {flag:train_wait} 天后的清晨到站。不用出门，在家等着就行。',
    when: { flag: 'train_wait', gte: 1 },
    order: 39,
  },
  {
    id: 'trail_done',
    text: '地下列车：记号都找到了。不用再出门——找到最后一个记号的两天后的清晨，在家等着就行，列车会停在门口最近的地铁口（没赶上的话，三天后还会再来）。备着手电筒或打火机打信号，上车更稳。',
    when: { flag: 'trail_step', eq: 4 },
    order: 40,
  },
] satisfies NoteDef[];
