import type { CharacterDef } from '../engine/schema';

/**
 * 七位住客（数值见 docs/DESIGN.md 12.2）。
 * 被动修正默认只影响本人；scope: 'global' 的修正在本人在庇护所时影响全队。
 * "昨日事故"反应读地图规则维护的 incident_recent / rule_broken_recent。
 */
export const characters = [
  {
    id: 'dragon_girl',
    name: '龙娘',
    desc: '吃饱了是罩着全屋的大姐头；饿过头，眼神就会清澈得只剩两个字——笨蛋。',
    unlockedByDefault: true,
    traits: [
      {
        id: 'dragon_appetite',
        name: '龙之胃口',
        desc: '饱食 ≥70 时不容易生病，外出多带回一件东西；饱食 <30 的夜里会进入「降智模式」。',
        rules: [
          {
            id: 'dragon_full',
            when: { stat: 'satiety', of: 'self', gte: 70 },
            modifiers: [
              { key: 'status.sick.gainChance', mul: 0.4 },
              { key: 'expedition.lootRolls', add: 1 },
            ],
          },
          {
            id: 'dragon_dumb_enter',
            trigger: 'dayEnd',
            when: {
              all: [
                { stat: 'satiety', of: 'self', lt: 30 },
                { not: { hasStatus: 'dumb_mode', of: 'self' } },
              ],
            },
            effects: [
              { addStatus: 'dumb_mode', of: 'self' },
              { log: '{self} 的眼神逐渐清澈……清澈得什么都没有了。' },
            ],
          },
        ],
      },
      {
        id: 'dragon_flame',
        name: '小火苗',
        desc: '饱食 ≥80 的夜里，偶尔会用指尖的小火苗给大家烤热罐头，全员理智回升一点。',
        rules: [
          {
            id: 'dragon_roast',
            trigger: 'dayEnd',
            chance: 0.15,
            when: {
              all: [
                { stat: 'satiety', of: 'self', gte: 80 },
                { not: { hasStatus: 'dumb_mode', of: 'self' } },
              ],
            },
            effects: [
              { stat: 'sanity', of: 'all', add: 2 },
              {
                log: '{self} 心情很好，用指尖的小火苗把大家的罐头烤得热乎乎的，还跑调地唱了两句。',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'big_fish',
    name: '大肥鱼',
    desc: '世上只有两种大肥鱼：正在找大白饭的路上，和吃完大白饭晕碳躺平的。',
    unlockedByDefault: true,
    traits: [
      {
        id: 'fish_rice_power',
        name: '干饭大白鱼',
        desc: '吃食物的收益更高，吃大米时再高一截；饱食 ≥70 时理智几乎不掉，外出更容易翻到吃的。',
        rules: [
          {
            id: 'fish_food_gain',
            modifiers: [
              { key: 'item.food.useEffect', mul: 1.4 },
              { key: 'item.rice.useEffect', mul: 1.3 },
            ],
          },
          {
            id: 'fish_full',
            when: { stat: 'satiety', of: 'self', gte: 70 },
            modifiers: [
              { key: 'stat.sanity.dailyDelta', mul: 0.3 },
              { key: 'expedition.lootWeight.food', mul: 1.6 },
            ],
          },
        ],
      },
      {
        id: 'fish_slump',
        name: '没饭瘫痪，饭后晕碳',
        desc: '饱食 <30 时理智掉得更快，外出更危险、带回的东西更少；吃得太撑的夜里常常进入「晕碳中」。',
        rules: [
          {
            id: 'fish_starving',
            when: { stat: 'satiety', of: 'self', lt: 30 },
            modifiers: [
              { key: 'stat.sanity.dailyDelta', add: -2 },
              { key: 'expedition.danger', mul: 1.3 },
              { key: 'expedition.lootRolls', add: -1 },
            ],
          },
          {
            id: 'fish_coma_enter',
            trigger: 'dayEnd',
            chance: 0.5,
            when: {
              all: [
                { stat: 'satiety', of: 'self', gte: 85 },
                { not: { hasStatus: 'food_coma', of: 'self' } },
              ],
            },
            effects: [{ addStatus: 'food_coma', of: 'self' }],
          },
        ],
      },
    ],
  },
  {
    id: 'kiminai',
    name: '基米奈',
    desc: '平时是阳光开朗的末日小百科；一旦受挫，三秒内掉进自我否定的黑洞，开始疯狂道歉。',
    traits: [
      {
        id: 'kiminai_sunny',
        name: '阳光万事通',
        desc: '理智与健康都 ≥50 且没有绝望时：不容易生病，外出更安全、多带回一件；在家时全队理智下降变慢。',
        rules: [
          {
            id: 'kiminai_sunny_bonus',
            when: {
              all: [
                { stat: 'sanity', of: 'self', gte: 50 },
                { stat: 'health', of: 'self', gte: 50 },
                { not: { hasStatus: 'despair', of: 'self' } },
              ],
            },
            modifiers: [
              { key: 'status.sick.gainChance', mul: 0.5 },
              { key: 'expedition.danger', mul: 0.8 },
              { key: 'expedition.lootRolls', add: 1 },
              { key: 'stat.sanity.dailyDelta', add: 0.5, scope: 'global' },
            ],
          },
        ],
      },
      {
        id: 'kiminai_glass_heart',
        name: '玻璃心',
        desc: '理智 <30、身上带伤带病、或昨天庇护所出了事故时，可能「陷入绝望」。刚振作起来的几天里不会马上再崩。',
        rules: [
          {
            id: 'kiminai_despair_low',
            trigger: 'dayEnd',
            when: {
              all: [
                { stat: 'sanity', of: 'self', lt: 30 },
                { not: { hasStatus: 'despair', of: 'self' } },
                { not: { flag: 'despair_cooldown' } },
              ],
            },
            effects: [
              { addStatus: 'despair', of: 'self' },
              { log: '{self} 抱着膝盖缩进了墙角：“对不起……都是我的错……”' },
            ],
          },
          {
            id: 'kiminai_despair_hurt',
            trigger: 'dayStart',
            chance: 0.35,
            when: {
              all: [
                {
                  any: [
                    { hasStatus: 'injured', of: 'self' },
                    { hasStatus: 'sick', of: 'self' },
                  ],
                },
                { not: { hasStatus: 'despair', of: 'self' } },
                { not: { flag: 'despair_cooldown' } },
              ],
            },
            effects: [
              { addStatus: 'despair', of: 'self' },
              { log: '{self} 看着自己的伤病发呆：“我明明拍胸脯保证过没问题的……我真是个拖油瓶。”' },
            ],
          },
          {
            id: 'kiminai_despair_incident',
            trigger: 'dayStart',
            chance: 0.4,
            when: {
              all: [
                { flag: 'incident_recent' },
                { not: { hasStatus: 'despair', of: 'self' } },
                { not: { flag: 'despair_cooldown' } },
              ],
            },
            effects: [
              { addStatus: 'despair', of: 'self' },
              { log: '{self} 盯着昨晚出事的地方：“要是我多注意一点就好了……对不起，真的对不起。”' },
            ],
          },
          {
            id: 'kiminai_despair_cooldown_end',
            trigger: 'dayStart',
            chance: 0.3,
            when: { flag: 'despair_cooldown' },
            effects: [{ setFlag: 'despair_cooldown', value: false }],
          },
        ],
      },
    ],
  },
  {
    id: 'garama',
    name: '嘎拉嘛',
    desc: '嘴硬得像铁门，尾巴诚实得像风向标。白天睡得像一块砖，半夜两眼放光开始拧螺丝。',
    traits: [
      {
        id: 'garama_night_crafter',
        name: '夜班工匠',
        desc: '外出更容易翻到工具和部件；带着手电筒或撬棍出门时更安全。在家且理智 ≥40、脑子正常时，半夜巡逻让入侵类危机少一半。',
        rules: [
          {
            id: 'garama_loot',
            modifiers: [
              { key: 'expedition.lootWeight.tool', mul: 1.6 },
              { key: 'expedition.lootWeight.part', mul: 1.6 },
            ],
          },
          {
            id: 'garama_tools_safe',
            when: { any: [{ carrying: 'flashlight' }, { carrying: 'crowbar' }] },
            modifiers: [{ key: 'expedition.danger', mul: 0.75 }],
          },
          {
            id: 'garama_night_watch',
            when: {
              all: [
                { stat: 'sanity', of: 'self', gte: 40 },
                { not: { hasStatus: 'misread', of: 'self' } },
              ],
            },
            modifiers: [{ key: 'event.weight.danger', mul: 0.5, scope: 'global' }],
          },
        ],
      },
      {
        id: 'garama_misread_trait',
        name: '已读乱回',
        desc: '理智 <35 或饱食 <30 的夜里，可能进入「已读乱回」：外出带回一堆莫名其妙的破烂，但自己反而不容易慌、不容易病。',
        rules: [
          {
            id: 'garama_misread_enter',
            trigger: 'dayEnd',
            chance: 0.35,
            when: {
              all: [
                {
                  any: [
                    { stat: 'sanity', of: 'self', lt: 35 },
                    { stat: 'satiety', of: 'self', lt: 30 },
                  ],
                },
                { not: { hasStatus: 'misread', of: 'self' } },
              ],
            },
            effects: [
              { addStatus: 'misread', of: 'self' },
              { log: '大家问 {self} 水放在哪，她一本正经地递过来一块三角形铁片。' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kelaode',
    name: '克劳德',
    desc: '随身带着《安全守则》的名门大小姐。哪怕世界明天就毁灭，礼仪也必须贯彻到底。',
    stats: { sanity: 90 },
    traits: [
      {
        id: 'kelaode_risk_control',
        name: '名门风控',
        desc: '理智 ≥50 且没在冷战时：外出危险大幅降低，更容易找到药品和部件；在家时全队不容易生病。',
        rules: [
          {
            id: 'kelaode_composed',
            when: {
              all: [
                { stat: 'sanity', of: 'self', gte: 50 },
                { not: { hasStatus: 'refuse_talk', of: 'self' } },
              ],
            },
            modifiers: [
              { key: 'expedition.danger', mul: 0.5 },
              { key: 'expedition.lootWeight.medicine', mul: 1.5 },
              { key: 'expedition.lootWeight.part', mul: 1.3 },
              { key: 'status.sick.gainChance', mul: 0.75, scope: 'global' },
            ],
          },
        ],
      },
      {
        id: 'kelaode_code',
        name: '安全守则',
        desc: '昨天有人踩了她的雷（偷吃、暴力、违规），或刚从外面回来累坏了，她可能进入「拒绝对话」。',
        rules: [
          {
            id: 'kelaode_refuse_rule',
            trigger: 'dayStart',
            chance: 0.6,
            when: {
              all: [
                { flag: 'rule_broken_recent' },
                { not: { hasStatus: 'refuse_talk', of: 'self' } },
              ],
            },
            effects: [
              { log: '{self} 翻开小本本记下一笔：“看来我们的信任基础已不存在。”' },
              { addStatus: 'refuse_talk', of: 'self' },
            ],
          },
          {
            id: 'kelaode_refuse_tired',
            trigger: 'expeditionReturn',
            chance: 0.25,
            when: { not: { hasStatus: 'refuse_talk', of: 'self' } },
            effects: [
              { log: '{self} 严肃宣布：“今日精力配额已满，剩余事务将在休息后重新评估。”' },
              { addStatus: 'refuse_talk', of: 'self' },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'moon',
    name: '月',
    desc: '抱着一箱废纸的熬夜卷王，什么资料都能十分钟背完——前提是先别跟她说话，她脑子正在排队。',
    traits: [
      {
        id: 'moon_speedread',
        name: '长卷速览',
        desc: '外出多带回一件东西；队里有地图册时外出少花一天；在家且有收音机时，更容易收到电台类消息。',
        rules: [
          { id: 'moon_loot', modifiers: [{ key: 'expedition.lootRolls', add: 1 }] },
          {
            id: 'moon_map',
            when: { any: [{ hasItem: 'map_book' }, { carrying: 'map_book' }] },
            modifiers: [{ key: 'expedition.duration', add: -1 }],
          },
          {
            id: 'moon_radio',
            when: { hasItem: 'radio' },
            modifiers: [{ key: 'event.weight.radio', mul: 1.5, scope: 'global' }],
          },
        ],
      },
      {
        id: 'moon_overload',
        name: '过载排队',
        desc: '外出归来后、或理智 <40 的夜里，可能进入「排队等待中」发呆一天；醒来时常常想起点有用的东西。',
        rules: [
          {
            id: 'moon_queue_return',
            trigger: 'expeditionReturn',
            chance: 0.4,
            when: { not: { hasStatus: 'queueing', of: 'self' } },
            effects: [{ addStatus: 'queueing', of: 'self' }],
          },
          {
            id: 'moon_queue_night',
            trigger: 'dayEnd',
            chance: 0.25,
            when: {
              all: [
                { stat: 'sanity', of: 'self', lt: 40 },
                { not: { hasStatus: 'queueing', of: 'self' } },
              ],
            },
            effects: [{ addStatus: 'queueing', of: 'self' }],
          },
        ],
      },
    ],
  },
  {
    id: 'tangbao',
    name: '糖包',
    desc: '甜度超标的端水大师，天塌下来也能夸天塌得很有层次感；说错一句话就光速滑跪。',
    unlockedByDefault: true,
    traits: [
      {
        id: 'tangbao_sugar',
        name: '全糖氛围组',
        desc: '在家且没有生病、发疯或面壁时，全队理智下降明显变慢；夜里常常去哄某个人开心。',
        rules: [
          {
            id: 'tangbao_aura',
            when: {
              not: {
                any: [
                  { hasStatus: 'sick', of: 'self' },
                  { hasStatus: 'insane', of: 'self' },
                  { hasStatus: 'kneeling', of: 'self' },
                ],
              },
            },
            modifiers: [{ key: 'stat.sanity.dailyDelta', add: 1.5, scope: 'global' }],
          },
          {
            id: 'tangbao_coax',
            trigger: 'dayEnd',
            chance: 0.3,
            when: {
              not: {
                any: [
                  { hasStatus: 'sick', of: 'self' },
                  { hasStatus: 'insane', of: 'self' },
                  { hasStatus: 'kneeling', of: 'self' },
                ],
              },
            },
            effects: [
              { stat: 'sanity', of: 'random', add: 4 },
              { log: '{self} 挨个凑过去说好听话，有人被夸得嘴角都压不住了。' },
            ],
          },
        ],
      },
      {
        id: 'tangbao_clumsy',
        name: '胡说八道，光速滑跪',
        desc: '外出时更危险，也不太会找工具和部件。饱食 <40 或理智 <50 的夜里偶尔好心办坏事，弄丢一份吃的或水，然后「面壁滑跪」。',
        rules: [
          {
            id: 'tangbao_outside',
            modifiers: [
              { key: 'expedition.danger', mul: 1.3 },
              { key: 'expedition.lootWeight.tool', mul: 0.6 },
              { key: 'expedition.lootWeight.part', mul: 0.6 },
            ],
          },
          {
            id: 'tangbao_oops',
            trigger: 'dayEnd',
            chance: 0.1,
            when: {
              all: [
                {
                  any: [
                    { stat: 'satiety', of: 'self', lt: 40 },
                    { stat: 'sanity', of: 'self', lt: 50 },
                  ],
                },
                { not: { hasStatus: 'kneeling', of: 'self' } },
              ],
            },
            effects: [
              {
                random: [
                  {
                    effects: [
                      {
                        if: { hasTag: 'food' },
                        then: [
                          { loseRandomItem: { tag: 'food', count: 1 } },
                          { log: '{self} 想给大家热一热吃的，结果把 {lost} 整个打翻在了地上。' },
                        ],
                        else: [{ log: '{self} 想帮忙整理仓库，结果把空货架整个推倒了。' }],
                      },
                    ],
                  },
                  {
                    effects: [
                      {
                        if: { hasTag: 'water' },
                        then: [
                          { loseRandomItem: { tag: 'water', count: 1 } },
                          { log: '{self} 想给水桶“消消毒”，结果把 {lost} 全倒进了下水道。' },
                        ],
                        else: [{ log: '{self} 想帮忙整理仓库，结果把空货架整个推倒了。' }],
                      },
                    ],
                  },
                ],
              },
              { setFlag: 'incident', value: true },
              { addStatus: 'kneeling', of: 'self' },
            ],
          },
        ],
      },
    ],
  },
] satisfies CharacterDef[];
