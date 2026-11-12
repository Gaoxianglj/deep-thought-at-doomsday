import type { EndingDef } from '../engine/schema';

export const endings = [
  {
    id: 'self_rescue',
    name: '自给自足',
    kind: 'selfRescue',
    text: '发电机嗡嗡作响，净水器咕嘟咕嘟，种植箱里冒出了第一片绿芽。你们不再等待救援——庇护所本身就是新的家。',
    when: {
      all: [{ flag: 'gen_installed' }, { flag: 'filter_installed' }, { flag: 'seeds_installed' }],
    },
    priority: 50,
  },
  {
    id: 'rescued',
    name: '得救了',
    kind: 'rescue',
    text: '引擎声由远及近，救援队的灯光扫过废墟。你们互相搀扶着走出庇护所，回头看了一眼那个住了很久的地方，居然有点舍不得。',
  },
  {
    id: 'wiped',
    name: '全员失联',
    kind: 'death',
    text: '庇护所里安静了下来。灰尘落在没吃完的罐头上，收音机还在沙沙地响，再也没有人回应它。',
    when: { partyAlive: { lte: 0 } },
    priority: 100,
  },
] satisfies EndingDef[];
