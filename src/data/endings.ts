import type { EndingDef } from '../engine/schema';

/** 五个结局（docs/DESIGN.md 12.6）。获救类结局都由事件里的 { ending } 触发。 */
export const endings = [
  {
    id: 'self_rescue',
    name: '自给自足',
    kind: 'selfRescue',
    text: '发电机嗡嗡作响，净水桶咕嘟咕嘟，通风机把地面上的灰挡在了外面，种植箱里冒出了第一片绿芽。你们不再等待救援——这间庇护所本身，就是新的家。',
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
    text: '士兵核对过凭证，朝车厢里一摆头。装甲车的后门“哐”地关上，引擎轰鸣着碾过废墟。从小小的观察窗往外看，庇护所的屋顶越来越远，最后消失在灰色的天际线里。',
  },
  {
    id: 'caravan',
    name: '南下车队',
    kind: 'rescue',
    text: '你们挤在一辆改装卡车的货斗里，身边是陌生人和成箱的水。车队一路向南，晚上围着篝火分罐头，有人弹起了走调的吉他。没人知道南边有什么，但至少，大家在一起往前走。',
  },
  {
    id: 'subway_rescue',
    name: '地下列车',
    kind: 'rescue',
    text: '车门在身后合上，车厢里亮着暖黄色的灯，座位上坐着十几个和你们一样灰头土脸的人。列车钻进漆黑的隧道，轨道哐当哐当地响，像一首很旧很旧的摇篮曲。有人递过来一杯热水。',
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
