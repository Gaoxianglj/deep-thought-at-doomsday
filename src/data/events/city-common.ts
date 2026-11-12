import type { EventDef } from '../../engine/schema';

export const cityCommonEvents = [
  {
    id: 'break_in',
    title: '破门',
    text: '半夜，门外传来沉重的撞击声，有人想闯进来抢东西。',
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
            when: { not: { hasItem: 'door_lock' } },
            text: '门被撞开了，他们翻箱倒柜带走了一些东西：{lost}。',
            effects: [{ loseRandomItem: { count: 2 } }],
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
            text: '撬棍在手，气势先赢了一半。闯入者落荒而逃。',
          },
          {
            weight: 1,
            text: '赶跑了闯入者，但混乱中有人被划伤了。',
            effects: [{ stat: 'health', of: 'random', add: -10 }],
          },
        ],
      },
      {
        id: 'hide',
        text: '躲起来，祈祷他们快走',
        outcomes: [
          {
            weight: 1,
            text: '他们没发现储藏间，随便拿了点东西就走了：{lost}。',
            effects: [{ loseRandomItem: { count: 1 } }],
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
    cooldown: 3,
    choices: [
      {
        id: 'medicine',
        text: '喂一片感冒药',
        requires: { hasItem: 'cold_medicine' },
        requiresHint: '没有感冒药',
        outcomes: [
          {
            text: '药起效了，{self} 睡了一觉，第二天又能活蹦乱跳。',
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
            text: '{self} 没能扛住，病倒了。',
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
    choices: [
      {
        id: 'drive_away',
        text: '想办法赶走它们',
        outcomes: [
          {
            when: { hasItem: 'flashlight' },
            text: '手电筒一照，老鼠们纷纷四散逃走。你们守住了粮食。',
          },
          {
            when: { not: { hasItem: 'flashlight' } },
            text: '黑灯瞎火的，老鼠溜得比你们追得快，还叼走了：{lost}。',
            effects: [{ loseRandomItem: { tag: 'food', count: 1 } }],
          },
        ],
      },
      {
        id: 'ignore',
        text: '眼不见为净',
        outcomes: [
          {
            text: '第二天一看，老鼠们吃得很尽兴：{lost}。',
            effects: [{ loseRandomItem: { tag: 'food', count: 2 } }],
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
            text: '水里有股怪味，{self} 喝完肚子疼了一天。',
            effects: [{ stat: 'health', of: 'self', add: -8 }],
          },
        ],
      },
      {
        id: 'patch',
        text: '堵住漏洞，省得麻烦',
        outcomes: [
          {
            text: '{self} 费了一番功夫，总算把漏洞堵上了。累是累，但心里踏实。',
            effects: [{ stat: 'sanity', of: 'self', add: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'night_noise',
    title: '半夜的响动',
    text: '{self} 在半夜听到走廊深处有奇怪的声音，像是什么东西在拖着脚走路。',
    tags: ['danger'],
    roles: { self: { where: { not: { hasStatus: 'injured', of: 'self' } } } },
    cooldown: 4,
    choices: [
      {
        id: 'look_with_light',
        text: '拿手电去看看',
        requires: { hasItem: 'flashlight' },
        requiresHint: '需要手电筒',
        outcomes: [
          {
            text: '光束扫过去，只是一只迷路的流浪猫，嘴里还叼着一个罐头。{self} 小心翼翼地换了回来。',
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
        outcomes: [{ text: '第二天什么事也没有。有些事不知道比知道好。' }],
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
            text: '纸箱里竟然是整整齐齐的罐头和饮用水！{self} 像做贼一样把它们全抱了回来。',
            effects: [
              { item: 'canned_food', add: 2 },
              { item: 'bottled_water', add: 2 },
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
            text: '呛人的气体还没出来，{self} 已经把里面的急救用品一股脑装进了包。',
            effects: [
              { item: 'medkit', add: 1 },
              { item: 'cold_medicine', add: 2 },
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
            text: '铁链应声而断。{self} 在里面翻出了不少好东西。',
            effects: [
              { item: 'door_lock', add: 1 },
              { item: 'flashlight', add: 1 },
            ],
          },
          {
            weight: 1,
            text: '撬开的瞬间，货架上的东西哗啦啦砸了下来。{self} 带着一身淤青和一个门锁回了家。',
            effects: [
              { item: 'door_lock', add: 1 },
              { stat: 'health', of: 'self', add: -8 },
            ],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
