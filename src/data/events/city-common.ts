import type { Condition, EventDef } from '../../engine/schema';

/** 库存里至少有一件东西（"丢/坏掉一样东西"之前先确认有东西可丢，否则文案里的 {lost} 会是空的） */
const HAS_ANY: Condition = {
  any: ['food', 'water', 'medicine', 'tool', 'part'].map((tag) => ({ hasTag: tag })),
};

export const cityCommonEvents = [
  {
    id: 'break_in',
    title: '破门',
    text: '天还没亮，门外就传来沉重的撞击声，有人想趁天没亮闯进来抢东西。',
    tags: ['danger'],
    when: { day: { gte: 4 } },
    cooldown: 6,
    choices: [
      {
        id: 'hold',
        text: '顶住门',
        outcomes: [
          {
            when: { hasItem: 'door_lock' },
            text: '门锁撑住了冲击，闯入者骂骂咧咧地走了。不过门锁也彻底坏了。',
            effects: [{ item: 'door_lock', add: -1 }],
          },
          {
            weight: 1,
            when: { all: [{ not: { hasItem: 'door_lock' } }, HAS_ANY] },
            text: '用后背死死抵着门，撞击声一下比一下重……最后外面骂了一句，走了。有人的肩膀青了一大块。',
            effects: [{ stat: 'health', of: 'random', add: -8 }],
          },
          {
            weight: 1,
            when: { all: [{ not: { hasItem: 'door_lock' } }, HAS_ANY] },
            text: '门还是被撞开了一条缝，有人伸手进来胡乱抓了一把就跑：{lost}。',
            effects: [{ loseRandomItem: { count: 1 } }, { setFlag: 'incident', value: true }],
          },
          {
            when: { all: [{ not: { hasItem: 'door_lock' } }, { not: HAS_ANY }] },
            text: '门被撞开了。他们把屋子翻了个底朝天，什么值钱的也没找到，骂骂咧咧地走了。',
            effects: [{ stat: 'sanity', of: 'all', add: -3 }],
          },
        ],
      },
      {
        id: 'fight',
        text: '抄起撬棍反击',
        requires: { hasItem: 'crowbar' },
        requiresHint: '需要撬棍',
        outcomes: [
          {
            weight: 3,
            text: '撬棍在手，气势先赢了一半。闯入者落荒而逃，门口留下一摊血迹。',
            effects: [{ setFlag: 'rule_broken', value: true }],
          },
          {
            weight: 1,
            text: '赶跑了闯入者，但混乱中有人被划伤了。',
            effects: [
              { stat: 'health', of: 'random', add: -10 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
      {
        id: 'hide',
        text: '躲起来，祈祷他们快走',
        outcomes: [
          {
            weight: 1,
            when: HAS_ANY,
            text: '他们没发现储藏间，随便拿了点东西就走了：{lost}。',
            effects: [{ loseRandomItem: { count: 1 } }, { setFlag: 'incident', value: true }],
          },
          {
            weight: 1,
            text: '他们在门口转了转，居然什么也没拿就走了。',
          },
        ],
      },
    ],
  },
  {
    id: 'fever',
    title: '有人发烧了',
    text: '{self} 的脸红得像煮熟的虾，说话也有点飘。',
    tags: ['illness'],
    roles: { self: { where: { not: { hasStatus: 'sick', of: 'self' } } } },
    cooldown: 4,
    choices: [
      {
        id: 'medicine',
        text: '喂一片感冒药',
        requires: { hasItem: 'cold_medicine' },
        requiresHint: '没有感冒药',
        outcomes: [
          {
            text: '药起效了，{self} 睡了一觉，烧很快就退了。',
            effects: [
              { item: 'cold_medicine', add: -1 },
              { stat: 'health', of: 'self', add: 5 },
            ],
          },
        ],
      },
      {
        id: 'tough_it_out',
        text: '多喝热水，硬扛过去',
        outcomes: [
          {
            weight: 2,
            text: '{self} 硬撑了一整天，脸色越来越差，终于还是病倒了。',
            effects: [{ addStatus: 'sick', of: 'self' }],
          },
          {
            weight: 1,
            text: '{self} 出了一身汗，居然好了。体质不错。',
          },
        ],
      },
    ],
  },
  {
    id: 'rats',
    title: '老鼠开会',
    text: '储藏间里传来窸窸窣窣的声音。一群老鼠似乎把这里当成了自助餐厅。',
    tags: ['pest'],
    // 也会由"墙里的鼠窝"排队触发（不检查 when），所以结果仍按有没有吃的分开写
    when: { hasTag: 'food' },
    cooldown: 6,
    choices: [
      {
        id: 'drive_away',
        text: '想办法赶走它们',
        outcomes: [
          {
            when: { hasItem: 'flashlight' },
            text: '手电筒一照，老鼠们吱吱叫着四散逃走，什么也没来得及叼走。',
          },
          {
            when: { all: [{ not: { hasItem: 'flashlight' } }, { hasTag: 'food' }] },
            text: '储藏间里黑灯瞎火的，老鼠溜得比人追得快，还叼走了：{lost}。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1 } },
              { setFlag: 'incident', value: true },
            ],
          },
          {
            when: { all: [{ not: { hasItem: 'flashlight' } }, { not: { hasTag: 'food' } }] },
            text: '摸黑追了半天，老鼠在空荡荡的储藏间里转了一圈，失望地走了。',
          },
        ],
      },
      {
        id: 'spray',
        text: '拿杀虫喷雾招呼它们',
        requires: { hasItem: 'bug_spray' },
        requiresHint: '需要杀虫喷雾',
        outcomes: [
          {
            text: '刺鼻的雾气一喷，老鼠们吱吱叫着钻回了墙缝。喷雾也见底了。',
            effects: [{ item: 'bug_spray', add: -1 }],
          },
        ],
      },
      {
        id: 'ignore',
        text: '眼不见为净',
        outcomes: [
          {
            when: { hasTag: 'food' },
            text: '过了半天再去看，老鼠们吃得很尽兴：{lost}。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 2 } },
              { setFlag: 'incident', value: true },
            ],
          },
          {
            when: { not: { hasTag: 'food' } },
            text: '储藏间里本来就没什么可吃的，老鼠们啃了两口纸箱，悻悻地走了。',
          },
        ],
      },
    ],
  },
  {
    id: 'leak',
    title: '天花板在漏水',
    text: '{self} 发现天花板在滴水，水质看起来……还行？',
    tags: ['water'],
    cooldown: 4,
    roles: { self: { where: { not: { hasStatus: 'insane', of: 'self' } } } },
    choices: [
      {
        id: 'collect',
        text: '拿桶接水，煮开再喝',
        outcomes: [
          {
            weight: 3,
            text: '{self} 接了一大桶水，煮开后味道意外地不错。',
            effects: [{ stat: 'hydration', of: 'all', add: 15 }],
          },
          {
            weight: 1,
            text: '煮开了也盖不住一股铁锈味——看来有些东西是煮不掉的。{self} 喝完肚子疼了一天。',
            effects: [{ stat: 'health', of: 'self', add: -8 }],
          },
        ],
      },
      {
        id: 'patch',
        text: '堵住漏洞，省得麻烦',
        outcomes: [
          {
            when: { hasItem: 'duct_tape' },
            text: '{self} 用胶带缠了三圈，漏洞服服帖帖。胶带还剩不少。',
            effects: [{ stat: 'sanity', of: 'self', add: 3 }],
          },
          {
            when: { all: [{ not: { hasItem: 'duct_tape' } }, HAS_ANY] },
            text: '{self} 拿破布塞了半天，水还是顺着墙往下淌，把墙角的一样东西泡坏了：{lost}。',
            effects: [{ loseRandomItem: { count: 1 } }, { setFlag: 'incident', value: true }],
          },
          {
            when: { all: [{ not: { hasItem: 'duct_tape' } }, { not: HAS_ANY }] },
            text: '{self} 拿破布塞了半天，水还是顺着墙往下淌。好在墙角本来就空空的，什么也没泡坏。',
            effects: [{ stat: 'sanity', of: 'self', add: -2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'night_noise',
    title: '天亮前的响动',
    text: '天还没亮，{self} 就被走廊深处奇怪的声音弄醒了，像是什么东西在拖着脚走路。',
    tags: ['danger'],
    roles: { self: { where: { not: { hasStatus: 'injured', of: 'self' } } } },
    when: { day: { gte: 2 } },
    cooldown: 4,
    choices: [
      {
        id: 'look_with_light',
        text: '拿手电去看看',
        requires: { hasItem: 'flashlight' },
        requiresHint: '需要手电筒',
        outcomes: [
          {
            text: '光束扫过去，只是一只迷路的流浪猫，嘴里还叼着一个罐头。{self} 学了半天猫叫，居然把罐头哄了下来。',
            effects: [{ item: 'canned_food', add: 1 }],
          },
        ],
      },
      {
        id: 'peek',
        text: '摸黑悄悄看一眼',
        outcomes: [
          {
            weight: 2,
            text: '{self} 绊了一跤，摔得不轻。',
            effects: [{ addStatus: 'injured', of: 'self', duration: 3 }],
          },
          {
            weight: 1,
            text: '什么都没有，只是风。',
          },
        ],
      },
      {
        id: 'blanket',
        text: '蒙头装睡',
        outcomes: [{ text: '天亮以后，什么事也没有。有些事不知道比知道好。' }],
      },
    ],
  },
  {
    id: 'store_back_room',
    title: '便利店的后仓库',
    text: '{self} 打着手电，在便利店后面发现了一扇半掩的小门。门后摆着几个落灰的纸箱。',
    weight: 0,
    choices: [
      {
        id: 'open',
        text: '打开纸箱',
        outcomes: [
          {
            text: '纸箱里竟然是整整齐齐的罐头、饮用水和一袋大米！{self} 像做贼一样把它们全抱了回来——后仓库这下彻底空了。',
            effects: [
              { item: 'canned_food', add: 2 },
              { item: 'bottled_water', add: 2 },
              { item: 'rice', add: 1 },
              { setFlag: 'back_room_emptied', value: true },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'pharmacy_vault',
    title: '药房的密封药柜',
    text: '{self} 戴着防毒面具，在药房深处发现了一个被封住的药柜，里面散发着刺鼻的气味。',
    weight: 0,
    choices: [
      {
        id: 'open',
        text: '撕开封条',
        outcomes: [
          {
            text: '呛人的气体还没出来，{self} 已经把里面的急救用品一股脑装进了包。药柜这下空了。',
            effects: [
              { item: 'medkit', add: 1 },
              { item: 'cold_medicine', add: 2 },
              { setFlag: 'pharmacy_vault_opened', value: true },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'market_vault',
    title: '五金市场的上锁仓库',
    text: '{self} 在五金市场深处找到一间被铁链锁住的仓库，手里的撬棍突然显得格外可靠。',
    weight: 0,
    choices: [
      {
        id: 'pry',
        text: '撬开它',
        outcomes: [
          {
            weight: 2,
            text: '铁链应声而断。{self} 在里面翻出了一卷胶带、一捆绳子和一台还能响的收音机。',
            effects: [
              { item: 'duct_tape', add: 1 },
              { item: 'rope', add: 1 },
              { item: 'radio', add: 1 },
              { setFlag: 'market_vault_opened', value: true },
            ],
          },
          {
            weight: 1,
            text: '撬开的瞬间，货架上的东西哗啦啦砸了下来，撬棍也弯成了问号。{self} 带着一身淤青、一个门锁和一卷胶带回了家。',
            effects: [
              { item: 'door_lock', add: 1 },
              { item: 'duct_tape', add: 1 },
              { item: 'crowbar', add: -1 },
              { stat: 'health', of: 'self', add: -8 },
              { setFlag: 'market_vault_opened', value: true },
            ],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
