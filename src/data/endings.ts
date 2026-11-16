import type { EndingDef } from '../engine/schema';

/** 五个结局（docs/DESIGN.md 12.6）。获救类结局都由事件里的 { ending } 触发。 */
export const endings = [
  {
    id: 'self_rescue',
    name: '自给自足',
    kind: 'selfRescue',
    text: '发电机嗡嗡作响，净水桶咕嘟咕嘟，通风机把地面上的灰挡在了外面，种植箱里冒出了第一片绿芽。不用再等谁来救了——这间庇护所本身，就是新的家。',
    when: {
      all: [
        { flag: 'gen_installed' },
        { flag: 'filter_installed' },
        { flag: 'seeds_installed' },
        { flag: 'vent_installed' },
      ],
    },
    priority: 50,
  },
  {
    id: 'military_evac',
    name: '军方撤离',
    kind: 'rescue',
    text: '士兵朝车厢里一摆头。装甲车的后门“哐”地关上，引擎轰鸣着碾过废墟。从小小的观察窗往外看，庇护所的屋顶越来越远，最后消失在灰色的天际线里。',
  },
  {
    id: 'caravan',
    name: '南下车队',
    kind: 'rescue',
    text: '改装卡车的货斗里挤满了陌生人，车队一路向南。夜里停车的时候，有人生起篝火，有人弹起了走调的吉他。没人知道南边有什么，但至少，车轮一直在往前走。',
  },
  {
    id: 'subway_rescue',
    name: '地下列车',
    kind: 'rescue',
    text: '车门在身后合上，车厢里亮着暖黄色的灯，座位上坐着十几个灰头土脸的陌生人。列车钻进漆黑的隧道，轨道哐当哐当地响，像一首很旧很旧的摇篮曲。有人递过来一杯热水。',
  },
  {
    id: 'wiped',
    name: '全员失联',
    kind: 'death',
    text: '庇护所里安静了下来。灰尘一层一层落在桌面和门槛上，门外的风还在吹，再也没有人来开门。',
    when: { partyAlive: { lte: 0 } },
    priority: 100,
  },
] satisfies EndingDef[];
