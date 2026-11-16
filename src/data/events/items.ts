import type { Condition, EventDef } from '../../engine/schema';

/** 库存里至少有一件东西（"丢/坏掉一样东西"之前先确认有东西可丢，否则文案里的 {lost} 会是空的） */
const HAS_ANY: Condition = {
  any: ['food', 'water', 'medicine', 'tool', 'part'].map((tag) => ({ hasTag: tag })),
};

/**
 * 道具事件（docs/DESIGN.md 12.7）：60 Seconds 式"用不用某件东西"。
 * 好结果常常消耗或损坏道具；失窃 / 损坏写 incident，暴力 / 不道德写 rule_broken。
 * 会用 queueEvent 带来后续回报的事件不定义 roles（排队事件沿用绑定的角色，角色不在世排队就失效）。
 */
export const itemEvents: EventDef[] = [
  {
    id: 'cold_night',
    title: '寒夜',
    text: '昨夜气温骤降，墙上结了一层白霜，到现在也没回暖。大家裹着所有能找到的布料，牙齿还是打颤。',
    tags: ['weather'],
    when: { day: { gte: 3 } },
    cooldown: 6,
    choices: [
      {
        id: 'fire',
        text: '用打火机生一小堆火',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            weight: 3,
            text: '小火堆噼噼啪啪地烧着，大家围成一圈烤手，有人开始讲冷笑话。',
            effects: [
              { stat: 'sanity', of: 'all', add: 5 },
              { stat: 'health', of: 'all', add: 3 },
            ],
          },
          {
            weight: 1,
            text: '火是生起来了，打火机却“咔哒咔哒”再也打不出火苗——油用完了。',
            effects: [
              { stat: 'sanity', of: 'all', add: 5 },
              { stat: 'health', of: 'all', add: 3 },
              { item: 'lighter', add: -1 },
            ],
          },
        ],
      },
      {
        id: 'burn_cards',
        text: '把扑克牌也扔进火里，烧旺一点',
        requires: { all: [{ hasItem: 'lighter' }, { hasItem: 'playing_cards' }] },
        requiresHint: '需要打火机和扑克牌',
        outcomes: [
          {
            text: '五十三张牌烧出了一堆旺火，屋里暖和得像过年。只是以后再也没有牌打了。',
            effects: [
              { item: 'playing_cards', add: -1 },
              { stat: 'health', of: 'all', add: 6 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
          },
        ],
      },
      {
        id: 'huddle',
        text: '挤在一起硬扛',
        outcomes: [
          {
            weight: 2,
            text: '又冻了一整夜，谁都没睡好，第二天早上每个人都在流鼻涕。',
            effects: [
              { stat: 'health', of: 'all', add: -4 },
              { stat: 'sanity', of: 'all', add: -2 },
            ],
          },
          {
            weight: 1,
            text: '挤着挤着居然暖和起来了，还有人打起了呼噜。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'rat_nest',
    title: '墙里的鼠窝',
    text: '{a} 发现墙根有个洞，里面传出一窝小老鼠吱吱的叫声。再不管，储藏间迟早被它们搬空。',
    tags: ['pest'],
    when: { all: [{ day: { gte: 4 } }, { hasTag: 'food', count: 2 }] },
    cooldown: 7,
    roles: { a: {} },
    choices: [
      {
        id: 'spray',
        text: '往洞里猛喷杀虫喷雾',
        requires: { hasItem: 'bug_spray' },
        requiresHint: '需要杀虫喷雾',
        outcomes: [
          {
            text: '{a} 把一整罐喷雾都灌进了洞里。墙里安静了，屋里也臭了一整天。',
            effects: [{ item: 'bug_spray', add: -1 }],
          },
        ],
      },
      {
        id: 'smoke',
        text: '点火把它们熏出来',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            weight: 2,
            text: '浓烟灌进洞里，老鼠们拖家带口地从另一头逃走了。',
          },
          {
            weight: 1,
            text: '火星溅到了旁边的纸箱上，等扑灭时已经烧掉了一样东西：{lost}。',
            effects: [{ loseRandomItem: { count: 1 } }, { setFlag: 'incident', value: true }],
          },
        ],
      },
      {
        id: 'seal',
        text: '用胶带把洞口封死',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            text: '{a} 用掉了大半卷胶带，把洞口缠得严严实实。墙里的吱吱声越来越远。',
            effects: [{ item: 'duct_tape', add: -1 }],
          },
        ],
      },
      {
        id: 'ignore',
        text: '先不管它',
        outcomes: [
          {
            text: '当天夜里老鼠就摸进了储藏间：{lost}。看样子它们还会再来。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1 } },
              { setFlag: 'incident', value: true },
              { queueEvent: 'rats', delay: 2 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'wasp_nest',
    title: '通风口的马蜂',
    text: '通风口里嗡嗡作响，{a} 凑近一看，一窝马蜂正在里面安家，个头比拇指还大。',
    tags: ['pest'],
    when: { day: { gte: 3 } },
    cooldown: 12,
    roles: { a: {} },
    choices: [
      {
        id: 'spray',
        text: '杀虫喷雾伺候',
        requires: { hasItem: 'bug_spray' },
        requiresHint: '需要杀虫喷雾',
        outcomes: [
          {
            text: '{a} 戴上三层手套，对着通风口一通狂喷。马蜂下雨似的掉了一地，喷雾也空了。',
            effects: [
              { item: 'bug_spray', add: -1 },
              { stat: 'sanity', of: 'all', add: 2 },
            ],
          },
        ],
      },
      {
        id: 'burn',
        text: '用打火机烧掉蜂窝',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            weight: 2,
            text: '蜂窝“呼”地烧成了一团。{a} 拍掉袖子上的火星，得意地叉起了腰。',
          },
          {
            weight: 1,
            text: '火一点，马蜂全冲了出来。{a} 被蛰得满头包，在屋里绕圈跑。',
            effects: [{ stat: 'health', of: { role: 'a' }, add: -10 }],
          },
        ],
      },
      {
        id: 'tape',
        text: '用胶带把通风口封上',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            text: '马蜂被关在了外面，可屋里也闷得像个罐头。至少没人挨蛰。',
            effects: [
              { item: 'duct_tape', add: -1 },
              { stat: 'sanity', of: 'all', add: -2 },
            ],
          },
        ],
      },
      {
        id: 'leave',
        text: '井水不犯河水',
        outcomes: [
          {
            weight: 1,
            text: '马蜂好像对你们没什么兴趣。可大家还是绕着通风口提心吊胆地走了好几天。',
            effects: [{ stat: 'sanity', of: 'all', add: -2 }],
          },
          {
            weight: 2,
            text: '当天夜里一只马蜂飞了下来，正好蛰在 {a} 的脸上。肿得像个包子。',
            effects: [
              { stat: 'health', of: { role: 'a' }, add: -8 },
              { stat: 'sanity', of: { role: 'a' }, add: -4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'storm_leak',
    title: '暴雨夜',
    text: '暴雨下了一整夜，储藏间的天花板裂开一道缝，雨水正好滴在物资堆上。{a} 一早推开储藏间的门，愣在了原地。',
    tags: ['water'],
    when: { all: [{ day: { gte: 3 } }, HAS_ANY] },
    cooldown: 9,
    roles: { a: {} },
    choices: [
      {
        id: 'tape',
        text: '爬上去用胶带封住裂缝',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            weight: 2,
            text: '{a} 踩着椅子把裂缝封得严严实实，顺手还用盆接了一盆雨水。',
            effects: [{ item: 'bottled_water', add: 1 }],
          },
          {
            weight: 1,
            text: '裂缝比想象的长，一整卷胶带全用完了，好歹是封住了。接下的雨水够喝一顿。',
            effects: [
              { item: 'duct_tape', add: -1 },
              { item: 'bottled_water', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'bucket',
        text: '拿盆接着，顺便攒点雨水',
        outcomes: [
          {
            weight: 2,
            text: '接了整整两盆雨水，煮开了能喝。',
            effects: [{ item: 'bottled_water', add: 2 }],
          },
          {
            weight: 1,
            text: '盆满了没人发现，水漫进了物资堆，泡坏了一样东西：{lost}。好在还剩一盆能喝。',
            effects: [
              { loseRandomItem: { count: 1 } },
              { setFlag: 'incident', value: true },
              { item: 'bottled_water', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'move',
        text: '把物资全挪开，随它漏',
        outcomes: [
          {
            text: '大家折腾了一上午，把所有东西搬到了另一头。累得腰都直不起来。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'radio_static',
    title: '收音机出毛病了',
    text: '收音机突然只剩刺耳的噪音，旋钮也松垮垮的。{a} 拍了拍它，它回了一声更大的噪音。',
    tags: ['radio'],
    when: { all: [{ hasItem: 'radio' }, { day: { gte: 3 } }] },
    cooldown: 8,
    roles: { a: {} },
    choices: [
      {
        id: 'tape',
        text: '拆开外壳，用胶带把松掉的线缠好',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            text: '{a} 鼓捣了一下午，收音机终于恢复了熟悉的沙沙声。胶带用掉了一整卷。',
            effects: [
              { item: 'duct_tape', add: -1 },
              { stat: 'sanity', of: { role: 'a' }, add: 4 },
            ],
          },
        ],
      },
      {
        id: 'smack',
        text: '用力拍两下，老办法',
        outcomes: [
          {
            weight: 1,
            text: '“啪啪”两下，收音机居然真的好了。{a} 一脸“我就说吧”。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
          {
            weight: 1,
            text: '“啪”的一声，有个零件飞了出去。收音机彻底不响了。',
            effects: [
              { item: 'radio', add: -1 },
              { setFlag: 'incident', value: true },
            ],
          },
        ],
      },
      {
        id: 'leave',
        text: '先不管它',
        outcomes: [
          {
            text: '收音机就这么一直滋啦滋啦地响着，吵得大家一整天都心烦意乱。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'radio_music',
    title: '世界尽头的电台',
    text: '{a} 转着收音机的旋钮，在一片沙沙声里，忽然收到了一个只放老歌的电台。主播的声音懒洋洋的，像是一个人在世界尽头值夜班。',
    tags: ['radio'],
    when: { hasItem: 'radio' },
    cooldown: 8,
    roles: { a: {} },
    choices: [
      {
        id: 'listen',
        text: '调大音量，一起听',
        outcomes: [
          {
            text: '一首接一首的老歌，有人跟着哼，有人偷偷抹眼泪。当晚大家都睡得很好。',
            effects: [{ stat: 'sanity', of: 'all', add: 5 }],
          },
        ],
      },
      {
        id: 'search',
        text: '继续往下调，找找有用的消息',
        outcomes: [
          {
            weight: 2,
            text: '一个自称“夜猫子”的主播在念各地幸存者交换的避险技巧，{a} 认认真真记了满满两页。',
            effects: [
              { stat: 'sanity', of: 'all', add: 2 },
              { stat: 'health', of: { role: 'a' }, add: 3 },
            ],
          },
          {
            weight: 1,
            text: '调到一个频道，里面一直在重复一段求救信号，越听越揪心。{a} 关掉了收音机。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'helicopter',
    title: '头顶的直升机',
    text: '螺旋桨的轰鸣声由远及近，一架直升机低低地掠过街区，探照灯在废墟上扫来扫去，像是在搜寻什么。',
    when: { day: { gte: 4 } },
    weight: 0.8,
    cooldown: 8,
    choices: [
      {
        id: 'flare',
        text: '冲上楼顶点燃信号弹',
        requires: { hasItem: 'flare' },
        requiresHint: '需要信号弹',
        outcomes: [
          {
            weight: 2,
            text: '红光冲天而起。直升机盘旋了一圈，空投下一个绑着降落伞的箱子：罐头、水，还有一个急救包。',
            effects: [
              { item: 'flare', add: -1 },
              { item: 'canned_food', add: 2 },
              { item: 'bottled_water', add: 3 },
              { item: 'medkit', add: 1 },
            ],
          },
          {
            weight: 1,
            text: '直升机悬停了片刻，舱门里扔下一个小包裹就飞走了。包裹里是两瓶水和一盒感冒药。',
            effects: [
              { item: 'flare', add: -1 },
              { item: 'bottled_water', add: 2 },
              { item: 'cold_medicine', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'fire',
        text: '在楼顶点一堆信号火',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            weight: 1,
            text: '直升机似乎看见了，扔下两瓶水就转头飞走了。',
            effects: [{ item: 'bottled_water', add: 2 }],
          },
          {
            weight: 2,
            text: '火还没烧旺，直升机就已经飞远了。大家望着天空发了好一会儿呆。',
            effects: [{ stat: 'sanity', of: 'all', add: -2 }],
          },
        ],
      },
      {
        id: 'wave',
        text: '跑到楼顶拼命挥衣服',
        outcomes: [
          {
            weight: 1,
            text: '有人从舱门探出身子朝你们挥了挥手，扔下一瓶水。',
            effects: [{ item: 'bottled_water', add: 1 }],
          },
          {
            weight: 3,
            text: '直升机连停都没停。衣服挥得胳膊都酸了。',
            effects: [{ stat: 'sanity', of: 'all', add: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'gas_leak',
    title: '黄绿色的烟雾',
    text: '一股黄绿色的烟雾从下水道里冒出来，顺着门缝往屋里钻，闻起来像烂鸡蛋混着漂白水。',
    tags: ['hazard'],
    when: { day: { gte: 5 } },
    cooldown: 9,
    choices: [
      {
        id: 'mask',
        text: '戴上防毒面具，去把门缝堵上',
        requires: { hasItem: 'gas_mask' },
        requiresHint: '需要防毒面具',
        outcomes: [
          {
            text: '戴面具的人呼哧呼哧地把门缝塞得严严实实，像个铁皮反派。烟雾很快散了。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
      {
        id: 'tape',
        text: '用胶带把门缝和通风口全封死',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            text: '一整卷胶带贴完，烟雾被挡在了外面。屋里有点闷，但总比中毒强。',
            effects: [{ item: 'duct_tape', add: -1 }],
          },
        ],
      },
      {
        id: 'towel',
        text: '用湿毛巾捂住口鼻，等它散',
        outcomes: [
          {
            weight: 2,
            text: '烟雾在屋里飘了一个钟头才散，有人开始头晕咳嗽。',
            effects: [{ addStatus: 'sick', of: 'random', chance: 0.7, duration: 3 }],
          },
          {
            weight: 1,
            text: '风向变了，烟雾很快飘走了。虚惊一场。',
          },
        ],
      },
    ],
  },
  {
    id: 'stranger_trapped',
    title: '坑里的人',
    text: '{a} 在外面倒垃圾时，听见路边的塌陷坑里有人在喊救命。坑有三四米深，下面的人一条腿卡在了钢筋里。',
    when: { day: { gte: 3 } },
    once: true,
    roles: { a: { where: { not: { hasStatus: 'injured', of: 'self' } } } },
    choices: [
      {
        id: 'rope',
        text: '放绳子下去拉他上来',
        requires: { hasItem: 'rope' },
        requiresHint: '需要绳索',
        outcomes: [
          {
            weight: 3,
            text: '那人被拉了上来，千恩万谢，从包里掏出一个急救包硬塞给 {a}。',
            effects: [
              { item: 'medkit', add: 1 },
              { stat: 'sanity', of: 'all', add: 4 },
            ],
          },
          {
            weight: 1,
            text: '人刚抓住坑沿，绳子就被钢筋割断了。好歹人救上来了，他留下一个急救包作为谢礼。',
            effects: [
              { item: 'rope', add: -1 },
              { item: 'medkit', add: 1 },
              { stat: 'sanity', of: 'all', add: 4 },
            ],
          },
        ],
      },
      {
        id: 'climb',
        text: '{a} 自己跳下去帮忙',
        outcomes: [
          {
            weight: 1,
            text: '{a} 把那人托了上去，自己再手脚并用地爬上来。那人留下两包压缩饼干就一瘸一拐地走了。',
            effects: [
              { item: 'biscuit', add: 2 },
              { stat: 'sanity', of: 'all', add: 4 },
            ],
          },
          {
            weight: 1,
            text: '人是救上来了，{a} 却在爬出来时踩空，崴了脚。',
            effects: [
              { addStatus: 'injured', of: { role: 'a' }, duration: 3 },
              { stat: 'sanity', of: 'all', add: 2 },
            ],
          },
        ],
      },
      {
        id: 'leave',
        text: '假装没听见',
        outcomes: [
          {
            text: '呼救声断断续续地响到了傍晚，然后就再也没有了。那天晚上谁都没有说话。',
            effects: [
              { stat: 'sanity', of: 'all', add: -6 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'collapsed_corridor',
    title: '塌了一半的楼道',
    text: '隔壁楼道塌了一半，{a} 透过缝隙看见里面有一户人家的储藏柜，柜门还关得好好的。',
    when: { day: { gte: 4 } },
    once: true,
    roles: { a: {} },
    choices: [
      {
        id: 'crowbar',
        text: '用撬棍撬开一条路',
        requires: { hasItem: 'crowbar' },
        requiresHint: '需要撬棍',
        outcomes: [
          {
            weight: 2,
            text: '水泥块被一块块撬开。储藏柜里有两个罐头和一卷胶带。',
            effects: [
              { item: 'canned_food', add: 2 },
              { item: 'duct_tape', add: 1 },
            ],
          },
          {
            weight: 1,
            text: '撬到一半，撬棍卡进了钢筋里，怎么也拔不出来。{a} 只来得及摸出一个罐头。',
            effects: [
              { item: 'canned_food', add: 1 },
              { item: 'crowbar', add: -1 },
            ],
          },
        ],
      },
      {
        id: 'rope',
        text: '系上绳子，从上面吊下去',
        requires: { hasItem: 'rope' },
        requiresHint: '需要绳索',
        outcomes: [
          {
            weight: 2,
            text: '{a} 吊在半空中打开了柜门，拎上来一个罐头和两瓶水。',
            effects: [
              { item: 'canned_food', add: 1 },
              { item: 'bottled_water', add: 2 },
            ],
          },
          {
            weight: 1,
            text: '{a} 荡过去的时候撞在了墙上，好在手里还攥着一个罐头。',
            effects: [
              { item: 'canned_food', add: 1 },
              { stat: 'health', of: { role: 'a' }, add: -8 },
            ],
          },
        ],
      },
      {
        id: 'leave',
        text: '太危险了，算了',
        outcomes: [{ text: '{a} 盯着那个柜子看了很久，最后还是回来了。' }],
      },
    ],
  },
  {
    id: 'card_night',
    title: '牌局',
    text: '闲着没事干，{a} 掏出那副少了红桃 Q 的扑克牌拍在桌上：“来一局？”{b} 已经在撸袖子了。',
    when: { hasItem: 'playing_cards' },
    cooldown: 10,
    roles: { a: {}, b: {} },
    choices: [
      {
        id: 'play',
        text: '打牌，不赌东西',
        outcomes: [
          {
            weight: 3,
            text: '一直打到天黑，笑声差点把房顶掀了。',
            effects: [{ stat: 'sanity', of: 'all', add: 6 }],
          },
          {
            weight: 1,
            text: '打到一半，{a} 和 {b} 为了那张不存在的红桃 Q 该算谁的争得面红耳赤——明明什么也没赌，吵的纯粹是面子。两人谁也不理谁，旁观的人倒是看得很开心。',
            effects: [
              { stat: 'sanity', of: { role: 'a' }, add: -3 },
              { stat: 'sanity', of: { role: 'b' }, add: -3 },
              { stat: 'sanity', of: 'all', add: 2 },
            ],
          },
        ],
      },
      {
        id: 'bet',
        text: '赌今天的晚饭（输的人少吃半顿）',
        outcomes: [
          {
            text: '{a} 赢走了 {b} 的半顿晚饭，吃得心满意足。{b} 饿着肚子发誓再也不赌了。',
            effects: [
              { stat: 'satiety', of: { role: 'a' }, add: 10 },
              { stat: 'satiety', of: { role: 'b' }, add: -10 },
              { stat: 'sanity', of: { role: 'b' }, add: -4 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
      {
        id: 'pass',
        text: '今天就算了吧',
        outcomes: [{ text: '{a} 失望地把牌收了起来。' }],
      },
    ],
  },
  {
    id: 'map_reading',
    title: '地图册上的红圈',
    text: '{a} 昨天抱着地图册研究了一下午，在密密麻麻的批注里发现了一处用红笔圈起来的“物资点”，就在两条街外。',
    when: { hasItem: 'map_book' },
    cooldown: 8,
    roles: { a: { where: { not: { hasStatus: 'injured', of: 'self' } } } },
    choices: [
      {
        id: 'go',
        text: '让 {a} 照着地图去看看',
        outcomes: [
          {
            weight: 2,
            text: '红圈的位置是一个没被发现的地下储物间。{a} 带回了一个罐头和两瓶水。',
            effects: [
              { item: 'canned_food', add: 1 },
              { item: 'bottled_water', add: 2 },
            ],
          },
          {
            weight: 1,
            text: '地方是找到了，但早就被人搬空了，地上只剩几个空罐头。{a} 白跑了一趟。',
            effects: [{ stat: 'sanity', of: { role: 'a' }, add: -3 }],
          },
        ],
      },
      {
        id: 'burn',
        text: '天太冷了，拿地图册当柴火生一堆火',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            text: '火烧得很旺，大家暖和了一整天。只是地图册烧掉了一大半，基本没法用了。',
            effects: [
              { item: 'map_book', add: -1 },
              { stat: 'health', of: 'all', add: 4 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
          },
        ],
      },
      {
        id: 'later',
        text: '先记下来，以后再说',
        outcomes: [{ text: '{a} 在红圈旁边画了个问号，合上了地图册。' }],
      },
    ],
  },
  {
    id: 'basement_door',
    title: '地下室的门',
    text: '{a} 在庇护所最里面发现了一扇以前没注意到的铁门，门后是通往地下室的楼梯，黑得伸手不见五指，还飘出一股霉味。',
    when: { day: { gte: 3 } },
    once: true,
    roles: { a: { where: { not: { hasStatus: 'injured', of: 'self' } } } },
    choices: [
      {
        id: 'flashlight',
        text: '打着手电筒下去',
        requires: { hasItem: 'flashlight' },
        requiresHint: '需要手电筒',
        outcomes: [
          {
            weight: 2,
            text: '手电照亮了一排落灰的货架：一个罐头、一袋大米，还有一卷胶带。',
            effects: [
              { item: 'canned_food', add: 1 },
              { item: 'rice', add: 1 },
              { item: 'duct_tape', add: 1 },
            ],
          },
          {
            weight: 1,
            text: '手电闪了几下就灭了，怎么拍都不亮。{a} 摸黑拎回一包压缩饼干。',
            effects: [
              { item: 'flashlight', add: -1 },
              { item: 'biscuit', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'mask',
        text: '戴上防毒面具，摸着墙下去',
        requires: { hasItem: 'gas_mask' },
        requiresHint: '需要防毒面具',
        outcomes: [
          {
            text: '霉味被挡在了面具外面。{a} 摸到了一个铁皮药箱，里面有一盒感冒药和一瓶水。',
            effects: [
              { item: 'cold_medicine', add: 1 },
              { item: 'bottled_water', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'dark',
        text: '摸黑下去',
        outcomes: [
          {
            weight: 1,
            text: '{a} 一脚踩空，从楼梯上滚了下去。',
            effects: [{ addStatus: 'injured', of: { role: 'a' }, duration: 3 }],
          },
          {
            weight: 1,
            text: '{a} 在黑暗里摸到了一包压缩饼干，然后头也不回地跑了上来。',
            effects: [{ item: 'biscuit', add: 1 }],
          },
        ],
      },
      {
        id: 'shut',
        text: '把门关上，当没看见',
        outcomes: [{ text: '铁门被重新关上，还顶了一把椅子。' }],
      },
    ],
  },
  {
    id: 'looters_scout',
    title: '踩点的人',
    text: '从昨天起，就有两个陌生人在楼下转悠，时不时抬头往你们的窗户看。看样子是在踩点。',
    tags: ['danger'],
    when: { day: { gte: 3 } },
    cooldown: 6,
    choices: [
      {
        id: 'lock',
        text: '把门锁装好，加固门窗',
        requires: { hasItem: 'door_lock' },
        requiresHint: '需要门锁',
        outcomes: [
          {
            text: '当晚他们来试了试门，没撬动，骂骂咧咧地走了。',
          },
        ],
      },
      {
        id: 'flare',
        text: '从窗口扔一颗点燃的信号弹吓唬他们',
        requires: { hasItem: 'flare' },
        requiresHint: '需要信号弹',
        outcomes: [
          {
            text: '红光在楼下炸开，两个人连滚带爬地跑了，估计以为这里有一支武装小队。',
            effects: [{ item: 'flare', add: -1 }],
          },
        ],
      },
      {
        id: 'crowbar',
        text: '拎着撬棍下楼“打个招呼”',
        requires: { hasItem: 'crowbar' },
        requiresHint: '需要撬棍',
        outcomes: [
          {
            weight: 2,
            text: '对方看了看撬棍，又看了看你们的脸色，识趣地走了。',
          },
          {
            weight: 1,
            text: '话没说两句就动起了手。对方被打跑了，但混乱中有人挂了彩。',
            effects: [
              { stat: 'health', of: 'random', add: -10 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
      {
        id: 'food',
        text: '扔给他们一份吃的，求个平安',
        requires: { hasTag: 'food' },
        requiresHint: '没有食物',
        outcomes: [
          {
            text: '一份 {lost} 从窗口扔了下去。他们捡起来，冲窗户点点头，走了。',
            effects: [{ loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } }],
          },
        ],
      },
      {
        id: 'ignore',
        text: '当没看见',
        outcomes: [
          {
            text: '傍晚他们走了。但你们总觉得，他们已经记住了这个地方。',
            effects: [{ queueEvent: 'break_in', delay: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'beggar',
    title: '门口的乞讨者',
    text: '一个瘦得脱了形的老人敲开了门，手里捧着一个空罐头盒：“行行好，一口吃的，一口水都行。”',
    when: { day: { gte: 2 } },
    cooldown: 8,
    choices: [
      {
        id: 'food',
        text: '分他一份吃的',
        requires: { hasTag: 'food' },
        requiresHint: '没有食物',
        outcomes: [
          {
            text: '老人接过 {lost}，眼眶一下就红了，一遍一遍地说“好人有好报”。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'sanity', of: 'all', add: 3 },
              { queueEvent: 'beggar_return', delay: 3 },
            ],
          },
        ],
      },
      {
        id: 'water',
        text: '分他一份水',
        requires: { hasTag: 'water' },
        requiresHint: '没有水',
        outcomes: [
          {
            text: '老人捧着 {lost} 小口小口地喝，喝完把瓶子也仔细收了起来。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 1, pick: 'cheapest' } },
              { stat: 'sanity', of: 'all', add: 3 },
              { queueEvent: 'beggar_return', delay: 3 },
            ],
          },
        ],
      },
      {
        id: 'refuse',
        text: '关上门',
        outcomes: [
          {
            text: '门外安静了很久，然后是慢慢远去的脚步声。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
      {
        id: 'rob',
        text: '抢走他身上的包',
        outcomes: [
          {
            weight: 1,
            text: '包里有一包压缩饼干。老人没有反抗，只是看着你们。那个眼神让人很久都忘不掉。',
            effects: [
              { item: 'biscuit', add: 1 },
              { stat: 'sanity', of: 'all', add: -6 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
          {
            weight: 1,
            text: '包里只有一张泛黄的全家福。老人默默把照片捡了回去。',
            effects: [
              { stat: 'sanity', of: 'all', add: -8 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'beggar_return',
    title: '老人又来了',
    text: '前几天那个老人又来了，这次腰板挺直了些。他把一个布包放在门口：“前几天那一口，我记着呢。”',
    weight: 0,
    choices: [
      {
        id: 'open',
        text: '打开布包',
        outcomes: [
          {
            text: '布包里是一个崭新的急救包。',
            effects: [{ item: 'medkit', add: 1 }],
          },
          {
            text: '布包里是两个罐头和一瓶水。',
            effects: [
              { item: 'canned_food', add: 2 },
              { item: 'bottled_water', add: 1 },
            ],
          },
          {
            text: '布包里是一卷胶带和一个打火机，还有一张纸条：“修修补补，日子就能过下去。”',
            effects: [
              { item: 'duct_tape', add: 1 },
              { item: 'lighter', add: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'stray_cat',
    title: '窗台上的橘猫',
    text: '一只瘦巴巴的橘猫蹲在窗台上，隔着玻璃冲你们“喵”了一声，尾巴卷成一个问号。',
    when: { day: { gte: 2 } },
    once: true,
    choices: [
      {
        id: 'feed',
        text: '分它一点吃的',
        requires: { hasTag: 'food' },
        requiresHint: '没有食物',
        outcomes: [
          {
            text: '橘猫狼吞虎咽地吃完了 {lost}，在窗台上打了个滚，舔着爪子走了。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'sanity', of: 'all', add: 4 },
              { queueEvent: 'cat_gift', delay: 2 },
            ],
          },
        ],
      },
      {
        id: 'pet',
        text: '隔着窗户逗逗它',
        outcomes: [
          {
            text: '橘猫跟着手指转了好几圈，最后发现没吃的，嫌弃地走了。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
      {
        id: 'shoo',
        text: '赶走它',
        outcomes: [{ text: '橘猫跳下窗台，头也不回地走了。' }],
      },
    ],
  },
  {
    id: 'cat_gift',
    title: '橘猫的回礼',
    text: '那只橘猫又来了，嘴里叼着什么东西，“啪”地放在门口，然后一脸骄傲地看着你们。',
    weight: 0,
    choices: [
      {
        id: 'look',
        text: '看看是什么',
        outcomes: [
          {
            weight: 2,
            text: '是一只死老鼠。……谢谢？大家笑成了一团。',
            effects: [{ stat: 'sanity', of: 'all', add: 4 }],
          },
          {
            weight: 1,
            text: '是一包没拆封的压缩饼干！真不知道它是从哪儿叼来的。',
            effects: [{ item: 'biscuit', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'injured_dog',
    title: '瘸腿的大黄狗',
    text: '门口趴着一条瘸了腿的大黄狗，伤口还在渗血。它看着你们，尾巴有气无力地摇了两下。',
    when: { day: { gte: 3 } },
    once: true,
    choices: [
      {
        id: 'medkit',
        text: '用急救包给它处理伤口',
        requires: { hasItem: 'medkit' },
        requiresHint: '需要急救包',
        outcomes: [
          {
            text: '大黄狗疼得直哼哼，却一动不动地让你们包扎。包完它舔了舔你们的手，一瘸一拐地走了。',
            effects: [
              { item: 'medkit', add: -1 },
              { stat: 'sanity', of: 'all', add: 5 },
              { queueEvent: 'dog_return', delay: 3 },
            ],
          },
        ],
      },
      {
        id: 'splint',
        text: '用胶带和木条给它绑个夹板',
        requires: { hasItem: 'duct_tape' },
        requiresHint: '需要胶带',
        outcomes: [
          {
            weight: 2,
            text: '夹板绑得歪歪扭扭，但大黄狗好像舒服多了。它在门口睡了一觉才走。',
            effects: [
              { item: 'duct_tape', add: -1 },
              { stat: 'sanity', of: 'all', add: 4 },
              { queueEvent: 'dog_return', delay: 3 },
            ],
          },
          {
            weight: 1,
            text: '大黄狗被胶带的声音吓了一跳，挣开夹板跑了。胶带也缠成了一团废了。',
            effects: [
              { item: 'duct_tape', add: -1 },
              { stat: 'sanity', of: 'all', add: -2 },
            ],
          },
        ],
      },
      {
        id: 'leave',
        text: '自身难保，顾不上它',
        outcomes: [
          {
            text: '第二天早上，门口已经没有狗了，只留下一小摊血迹。',
            effects: [{ stat: 'sanity', of: 'all', add: -4 }],
          },
        ],
      },
    ],
  },
  {
    id: 'dog_return',
    title: '大黄狗回来了',
    text: '那条大黄狗回来了，腿已经不瘸了。它叼着一个脏兮兮的背包，放在你们脚边，然后蹲坐着等夸奖。',
    weight: 0,
    choices: [
      {
        id: 'open',
        text: '摸摸头，打开背包',
        outcomes: [
          {
            text: '背包里有一个手电筒和一瓶水。好狗！',
            effects: [
              { item: 'flashlight', add: 1 },
              { item: 'bottled_water', add: 1 },
            ],
          },
          {
            text: '背包里有两个罐头和一盒感冒药。好狗！',
            effects: [
              { item: 'canned_food', add: 2 },
              { item: 'cold_medicine', add: 1 },
            ],
          },
          {
            text: '背包里有一捆绳子和一袋大米。好狗！',
            effects: [
              { item: 'rope', add: 1 },
              { item: 'rice', add: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sick_neighbor',
    title: '隔壁的咳嗽声',
    text: '隔壁传来撕心裂肺的咳嗽声，响了一整夜。早上，一个小女孩隔着墙缝小声问：“你们……有药吗？我妈妈烧得很厉害。”',
    when: { day: { gte: 4 } },
    once: true,
    choices: [
      {
        id: 'medicine',
        text: '从墙缝塞一盒感冒药过去',
        requires: { hasItem: 'cold_medicine' },
        requiresHint: '需要感冒药',
        outcomes: [
          {
            text: '墙那边传来小女孩带着哭腔的“谢谢”。当天夜里，咳嗽声小了很多。',
            effects: [
              { item: 'cold_medicine', add: -1 },
              { stat: 'sanity', of: 'all', add: 5 },
              { queueEvent: 'neighbor_thanks', delay: 2 },
            ],
          },
        ],
      },
      {
        id: 'mask',
        text: '戴上防毒面具，过去照顾一晚',
        requires: { hasItem: 'gas_mask' },
        requiresHint: '需要防毒面具',
        outcomes: [
          {
            text: '戴着面具守了一夜，换了七八次冷毛巾。天亮时，那位母亲的烧退了。',
            effects: [
              { stat: 'sanity', of: 'all', add: 3 },
              { queueEvent: 'neighbor_thanks', delay: 2 },
            ],
          },
        ],
      },
      {
        id: 'visit',
        text: '什么也不带，直接过去看看',
        outcomes: [
          {
            text: '你们帮着熬了一锅热水，陪小女孩说了半天话。回来以后，有人开始打喷嚏。',
            effects: [
              { addStatus: 'sick', of: 'random', chance: 0.5, duration: 3 },
              { stat: 'sanity', of: 'all', add: 3 },
              { queueEvent: 'neighbor_thanks', delay: 2 },
            ],
          },
        ],
      },
      {
        id: 'refuse',
        text: '假装没听见',
        outcomes: [
          {
            text: '咳嗽声又响了两夜，然后就停了。没人敢去想那意味着什么。',
            effects: [{ stat: 'sanity', of: 'all', add: -5 }],
          },
        ],
      },
    ],
  },
  {
    id: 'neighbor_thanks',
    title: '墙缝里的纸包',
    text: '隔壁的小女孩从墙缝里塞过来一个纸包，上面用蜡笔画着一个歪歪扭扭的笑脸。',
    weight: 0,
    choices: [
      {
        id: 'open',
        text: '打开纸包',
        outcomes: [
          {
            text: '纸包里是两小袋大米，用橡皮筋扎得整整齐齐。',
            effects: [{ item: 'rice', add: 2 }],
          },
          {
            text: '纸包里是一卷胶带和一瓶水，还有一张纸条：“妈妈说要谢谢你们。”',
            effects: [
              { item: 'duct_tape', add: 1 },
              { item: 'bottled_water', add: 1 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'peddler',
    title: '推购物车的货郎',
    text: '一个推着购物车的男人停在门口，车上挂满了叮叮当当的杂货：“换东西吗？我只收水和吃的——哦，还有地图，我在找路。”',
    when: { day: { gte: 5 } },
    cooldown: 7,
    choices: [
      {
        id: 'water',
        text: '用 3 份水换一件工具',
        requires: { hasTag: 'water', count: 3 },
        requiresHint: '需要 3 份水',
        outcomes: [
          {
            text: '你们交出了 {lost}，换来一卷胶带。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 3, pick: 'cheapest' } },
              { item: 'duct_tape', add: 1 },
            ],
          },
          {
            text: '你们交出了 {lost}，换来一个打火机。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 3, pick: 'cheapest' } },
              { item: 'lighter', add: 1 },
            ],
          },
          {
            text: '你们交出了 {lost}，换来一捆绳子。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 3, pick: 'cheapest' } },
              { item: 'rope', add: 1 },
            ],
          },
          {
            text: '你们交出了 {lost}，换来一罐杀虫喷雾。',
            effects: [
              { loseRandomItem: { tag: 'water', count: 3, pick: 'cheapest' } },
              { item: 'bug_spray', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'food',
        text: '用 2 份食物换一个急救包',
        requires: { hasTag: 'food', count: 2 },
        requiresHint: '需要 2 份食物',
        outcomes: [
          {
            text: '你们交出了 {lost}。货郎从购物车底下摸出一个急救包，拍了拍上面的灰。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 2, pick: 'cheapest' } },
              { item: 'medkit', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'map',
        text: '把地图册换给他',
        requires: { hasItem: 'map_book' },
        requiresHint: '需要地图册',
        outcomes: [
          {
            text: '货郎捧着地图册两眼放光，把三个罐头和三瓶水一股脑推了过来：“值，太值了！”',
            effects: [
              { item: 'map_book', add: -1 },
              { item: 'canned_food', add: 3 },
              { item: 'bottled_water', add: 3 },
            ],
          },
        ],
      },
      {
        id: 'no',
        text: '不换了',
        outcomes: [{ text: '货郎耸耸肩，推着叮当作响的购物车走远了。' }],
      },
    ],
  },
];
