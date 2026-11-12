import type { Condition, DiaryDef } from '../engine/schema';

const fine: Condition = {
  all: [
    { stat: 'satiety', of: 'self', gte: 60 },
    { not: { hasStatus: 'hungry', of: 'self' } },
    { not: { hasStatus: 'sick', of: 'self' } },
  ],
};

export const diary: DiaryDef[] = [
  {
    id: 'argue',
    text: '{a} 和 {b} 为了最后一块饼干的归属吵了一架，最后饼干掉在地上，两人沉默地分了碎渣。',
    when: { shelterCount: { gte: 2 } },
    roles: { a: {}, b: {} },
    cooldown: 5,
  },
  {
    id: 'energetic',
    text: '{a} 今天精神很好，在庇护所里做起了广播体操，没有人跟着做。',
    roles: { a: { where: fine } },
    cooldown: 4,
  },
  {
    id: 'hungry_moan',
    text: '{a} 的肚子叫得很有节奏感，隔壁房间都听得见。',
    roles: { a: { where: { hasStatus: 'hungry', of: 'self' } } },
    cooldown: 4,
  },
  {
    id: 'thirsty_moan',
    text: '{a} 舔了舔干裂的嘴唇，盯着水瓶看了整整十分钟。',
    roles: { a: { where: { hasStatus: 'thirsty', of: 'self' } } },
    cooldown: 4,
  },
  {
    id: 'sick_cough',
    text: '{a} 裹着毯子缩在角落里，咳嗽声此起彼伏，像在演奏一首悲伤的小曲。',
    roles: { a: { where: { hasStatus: 'sick', of: 'self' } } },
    cooldown: 4,
  },
  {
    id: 'insane_talk',
    text: '{a} 对着墙壁聊了一晚上，据说聊得很投机，墙壁没有反驳。',
    roles: { a: { where: { hasStatus: 'insane', of: 'self' } } },
    cooldown: 4,
  },
  {
    id: 'cards',
    text: '{a} 和 {b} 用那副缺了一张牌的扑克打了一下午，谁也不肯承认自己出老千。',
    when: { hasItem: 'playing_cards' },
    roles: { a: {}, b: {} },
    cooldown: 5,
  },
  {
    id: 'share_biscuit',
    text: '{a} 偷偷把自己的那份饼干掰了一半塞给 {b}，还假装只是顺手。',
    when: { hasTag: 'food' },
    roles: { a: { where: fine }, b: { where: { stat: 'satiety', of: 'self', lt: 60 } } },
    cooldown: 6,
  },
  {
    id: 'dragon_dumb',
    text: '{a} 盯着一个空罐头发呆，嘴里反复念叨着“好像还能吃”。',
    roles: {
      a: { is: 'dragon_girl', where: { hasStatus: 'dumb_mode', of: 'self' } },
    },
    cooldown: 3,
  },
  {
    id: 'dragon_full',
    text: '{a} 吃饱喝足，满足地打了个嗝，喷出的小火苗把天花板熏黑了一小块。',
    roles: { a: { is: 'dragon_girl', where: { stat: 'satiety', of: 'self', gte: 70 } } },
    cooldown: 5,
  },
  {
    id: 'fish_hydrated',
    text: '{a} 抱着水瓶咕咚咕咚喝了半天，宣布今天心情“水润润的”。',
    roles: { a: { is: 'big_fish', where: { stat: 'hydration', of: 'self', gte: 60 } } },
    cooldown: 5,
  },
  {
    id: 'fish_dry',
    text: '{a} 瘫在地上，气若游丝地说：“水……我是一条需要水的鱼……”',
    roles: { a: { is: 'big_fish', where: { stat: 'hydration', of: 'self', lt: 30 } } },
    cooldown: 4,
  },
  {
    id: 'kiminai_nap',
    text: '{a} 找到了庇护所里最舒服的角落，雷打不动地睡了一整天。',
    roles: { a: { is: 'kiminai' } },
    cooldown: 6,
  },
  {
    id: 'env_no_food',
    text: '储藏间里空空荡荡，只剩下一只蜘蛛在认真结网。',
    when: { not: { hasTag: 'food' } },
    cooldown: 4,
  },
  {
    id: 'env_no_water',
    text: '水桶底朝天，敲一下会发出清脆的回响。',
    when: { not: { hasTag: 'water' } },
    cooldown: 4,
  },
  {
    id: 'env_radio',
    text: '收音机时不时发出一阵沙沙声，像是在说什么，又什么都没说。',
    when: { hasItem: 'radio' },
    cooldown: 5,
  },
  {
    id: 'env_dust',
    text: '外面又起风了，灰尘从门缝里一点点漏进来，在地上画出一道道细线。',
    cooldown: 4,
  },
  {
    id: 'env_long',
    text: '墙上的划痕已经数不清了。大家默契地不再提“第几天”这个话题。',
    when: { day: { gte: 10 } },
    cooldown: 6,
  },
];
