import type { EventDef } from '../../engine/schema';

/**
 * 角色入队与角色专属事件（见 docs/DESIGN.md 12.2）。
 * - 访客事件：都要求 not inParty + partyAlive ≤ 3，tag visitor，冷却 5 天；收留后 next 到 weight 0 的欢迎事件。
 * - 角色事件：角色一律通过 roles 绑定（is + where）；"某人在场"的附加选项用 requires inShelter + hideIfLocked（别剧透还没见过的角色）。
 * - 违背克劳德守则的选项写 rule_broken，物资损坏写 incident（次日清晨由地图规则转成 *_recent）。
 */
export const characterEvents: EventDef[] = [
  // ================= 访客：嘎拉嘛 =================
  {
    id: 'garama_knock',
    title: '夜半门栓响',
    text: '天还没亮，防盗门外就传来“叮当”的金属碰撞声，还夹着一声刻意压低、却依然很清脆的喊叫：“嘎拉嘛！”你们抄起手边的东西摸到门边，从猫眼往外看——一个顶着毛茸茸黑狐耳、拖着白尖大尾巴的女孩正蹲在门前，额头上架着一只睡眠眼罩，正拿着一把锈扳手帮你们拧快要松脱的门铰链。',
    tags: ['visitor'],
    when: {
      all: [{ not: { inParty: 'garama' } }, { partyAlive: { lte: 3 } }, { day: { gte: 3 } }],
    },
    cooldown: 5,
    choices: [
      {
        id: 'feed',
        text: '开门，递上一份吃的',
        requires: { hasTag: 'food' },
        requiresHint: '没有可以给她的食物',
        outcomes: [
          {
            text: '门一开，她的大尾巴瞬间炸成了鸡毛掸子：“我、我只是嫌你们这扇门晃来晃去吵到我睡觉！才不是想进屋吃饭呢！”说完一口吞掉了 {lost}，抱着工具包熟门熟路地迈进了门。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { joinParty: 'garama' },
              { unlock: 'garama' },
            ],
            next: 'garama_welcome',
          },
        ],
      },
      {
        id: 'ask',
        text: '隔着门问：“你是谁？”',
        outcomes: [
          {
            text: '门外沉默了两秒，传来一个一本正经的声音：“路过的顶级机械顾问。工资要求不高，给块饼干就行。”',
            next: 'garama_haggle',
          },
        ],
      },
      {
        id: 'hide',
        text: '保持警惕，装作屋里没人',
        outcomes: [
          {
            text: '拧螺丝的声音停了。门外嘟囔了一句“真没礼貌……”，然后是哒哒远去的脚步声。等天亮了再看，门莫名比昨天好关了一点。也许以后还会遇到她。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'garama_haggle',
    title: '顶级机械顾问',
    text: '门外的人清了清嗓子，又补了一句：“嘎拉嘛！……这是我的名字，也是我的口号。”说话间，门铰链已经被她拧得一声不响了。',
    tags: ['visitor'],
    weight: 0,
    choices: [
      {
        id: 'pay_biscuit',
        text: '从门缝递出一块压缩饼干当工资',
        requires: { hasItem: 'biscuit' },
        requiresHint: '没有压缩饼干',
        outcomes: [
          {
            text: '饼干被一只手飞快地抽走了。门开了，她一边嚼一边哼：“看在工资的份上，这扇门以后归我管了。”',
            effects: [
              { item: 'biscuit', add: -1 },
              { joinParty: 'garama' },
              { unlock: 'garama' },
              { stat: 'sanity', of: { id: 'garama' }, add: 5 },
            ],
            next: 'garama_welcome',
          },
        ],
      },
      {
        id: 'owe',
        text: '“工资先欠着，进来吧”',
        outcomes: [
          {
            text: '她哼了一声：“欠薪是要记账的。”说着掏出一本黑色硬壳笔记本，认认真真地写下了第一笔，然后才跨进门来。',
            effects: [
              { joinParty: 'garama' },
              { unlock: 'garama' },
              { stat: 'sanity', of: { id: 'garama' }, add: -10 },
            ],
            next: 'garama_welcome',
          },
        ],
      },
      {
        id: 'decline',
        text: '“谢谢，不用了”',
        outcomes: [
          {
            text: '她炸毛地往后一跳，喊了声“嘎拉嘛！”就消失在晨雾里，走之前还顺手把门栓反拧了两圈。也许以后还会遇到她。',
          },
        ],
      },
    ],
  },
  {
    id: 'garama_welcome',
    title: '夜班开工',
    text: '{g} 把额头上的眼罩往上推了推，抱着黑皮笔记本绕庇护所走了一圈，在每扇门、每个柜子上都敲了敲：“结构凑合。往后夜班归我，你们安心睡。”',
    weight: 0,
    roles: { g: { is: 'garama' } },
    choices: [
      {
        id: 'thanks',
        text: '“那就拜托了”',
        outcomes: [
          {
            text: '{g} 嘴上说着“下次不干了”，身后的大尾巴却悄悄摇了起来。',
            effects: [{ stat: 'sanity', of: 'all', add: 4 }],
          },
        ],
      },
    ],
  },

  // ================= 访客：克劳德 =================
  {
    id: 'kelaode_umbrella',
    title: '雨幕下的公约',
    text: '一大早就飘起了夹着灰尘的小雨。敲门声响了，力度克制而均匀，正好三下。门外站着一位橘发女孩，发侧别着一朵雏菊发饰，长礼服整齐得像刚从干洗店取回来，头顶撑着一把只剩半边伞骨的黑伞。她打量了一眼门框上的灰，优雅地叹了口气：“打扰了。外面的空气质量严重超标。如果各位能遵守基本秩序，我可以暂住于此并提供统筹协助——这是《临时避难所安全与礼仪公约》，请过目。”',
    tags: ['visitor'],
    when: {
      all: [
        { not: { inParty: 'kelaode' } },
        { partyAlive: { lte: 3 } },
        { day: { gte: 4 } },
        { any: [{ hasTag: 'tool' }, { hasTag: 'medicine' }] },
      ],
    },
    cooldown: 5,
    choices: [
      {
        id: 'accept',
        text: '郑重接过公约，欢迎大小姐入住',
        outcomes: [
          {
            when: { inShelter: 'big_fish' },
            text: '她微微欠身，跨进门槛时小心地避开了一块水渍——然后和躺在水渍旁边的大肥鱼四目相对。两人同时嫌弃地“哼”了一声。她顺手把门口歪斜的纸箱摆成了一条直线。',
            effects: [
              { joinParty: 'kelaode' },
              { unlock: 'kelaode' },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
            next: 'kelaode_welcome',
          },
          {
            when: { not: { inShelter: 'big_fish' } },
            text: '她微微欠身致意，跨进门槛时小心地避开了一块水渍，随后顺手把门口歪斜的纸箱摆成了一条直线。屋里莫名多了一点安稳感。',
            effects: [
              { joinParty: 'kelaode' },
              { unlock: 'kelaode' },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
            next: 'kelaode_welcome',
          },
        ],
      },
      {
        id: 'ask',
        text: '问她：“你到底是从哪儿冒出来的？”',
        outcomes: [
          {
            text: '她脸上的礼貌微笑冻结了零点五秒，合上小本本鞠了一躬：“非常抱歉，该问题涉及核心隐私，我无法回答。打扰了。”说完撑着半边破伞，优雅地转身离去。',
          },
        ],
      },
      {
        id: 'decline',
        text: '觉得规矩太多，礼貌婉拒',
        outcomes: [
          {
            text: '她点头表示理解，临走前从袖口摸出一张叠得方方正正的手帕放在门槛上：“那么，祝各位生活愉快。记得勤洗手。”',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'kelaode_welcome',
    title: '统筹上任',
    text: '{c} 用两根手指捏起一块抹布，环视了一圈：“这角落的灰尘厚度超标了。不过——从今天起，这里由本小姐统筹。”',
    weight: 0,
    roles: { c: { is: 'kelaode' } },
    choices: [
      {
        id: 'sign',
        text: '在公约上签字',
        outcomes: [
          {
            text: '{c} 满意地收起公约，在小本本的第一页端端正正地画了一排小太阳。',
            effects: [{ stat: 'sanity', of: 'all', add: 3 }],
          },
        ],
      },
    ],
  },

  // ================= 访客：月 =================
  {
    id: 'moon_flyers',
    title: '循着传单找来的人',
    text: '走廊里传来沉重的纸箱拖拽声，紧接着是一阵急促的敲门声：“打扰了！请问这里是……还有人住的那间屋子吗？”门外是一个银白长发、穿着星空长裙的女孩，正费力地拖着半人高的旧书箱，眼底挂着浓重的黑眼圈，手里攥着一沓皱巴巴的传单和超市小票：“我根据一路上捡来的传单、小票和过期报纸推算出，这一片就数这里安全系数最高。能借块地板，让我把这箱资料摊开吗？”',
    tags: ['visitor'],
    when: {
      all: [
        { not: { inParty: 'moon' } },
        { partyAlive: { lte: 3 } },
        { day: { gte: 3 } },
        { any: [{ flag: 'explored' }, { hasItem: 'map_book' }, { hasItem: 'radio' }] },
      ],
    },
    cooldown: 5,
    choices: [
      {
        id: 'make_room',
        text: '挪出一块角落让她住下',
        outcomes: [
          {
            text: '她如释重负地把纸箱往墙角一墩，当场掏出炭笔，在墙上画起了《避难所周边废墟资源分布草图》。那张图看得人莫名有点振奋。',
            effects: [
              { joinParty: 'moon' },
              { unlock: 'moon' },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
            next: 'moon_welcome',
          },
        ],
      },
      {
        id: 'give_water',
        text: '塞给她一瓶水，问她是不是熬了好几个大夜',
        requires: { hasItem: 'bottled_water' },
        requiresHint: '没有瓶装水',
        outcomes: [
          {
            text: '她感动得眼泪汪汪，一口气喝掉半瓶，然后把纸箱夹层里的“存货”全掏了出来——两包压得扁扁的压缩饼干。“入伙费！”她郑重宣布。',
            effects: [
              { item: 'bottled_water', add: -1 },
              { joinParty: 'moon' },
              { unlock: 'moon' },
              { item: 'biscuit', add: 2 },
            ],
            next: 'moon_welcome',
          },
        ],
      },
      {
        id: 'decline',
        text: '委婉表示屋里实在堆不下这么多废纸',
        outcomes: [
          {
            text: '她抱紧书箱点点头：“理解，信息过载确实很危险。”临走前不忘在门框上贴了一张自印的《废墟找水小贴士》。',
          },
        ],
      },
    ],
  },
  {
    id: 'moon_welcome',
    title: '月氏情报站',
    text: '{m} 三分钟内把仓库里的东西按保质期排成了方阵，又顺手贴上一张《月氏避难所管理建议书》：“有问题可以问我。但请一次只问一个。”',
    weight: 0,
    roles: { m: { is: 'moon' } },
    choices: [
      {
        id: 'ok',
        text: '“收到，一次一个”',
        outcomes: [
          {
            text: '{m} 点点头，又往门上贴了一张《提问请排队》。',
            effects: [{ stat: 'sanity', of: 'all', add: 3 }],
          },
        ],
      },
    ],
  },

  // ================= 访客：糖包 =================
  {
    id: 'tangbao_candy',
    title: '门缝里的糖纸',
    text: '一大早，门缝底下悄悄塞进来一颗用彩色糖纸叠的小星星。门外响起一个甜度超标、像早间广播一样元气满满的声音：“屋里的朋友们早上好呀！路过发现你们把门擦得好干净，在这么乱糟糟的世界里还这么讲究，你们真是太厉害了！……那个，请问能借一小口水喝吗？不行也没关系的，都是我太冒昧了，真的非常抱歉！”',
    tags: ['visitor'],
    when: {
      all: [{ not: { inParty: 'tangbao' } }, { partyAlive: { lte: 3 } }, { day: { gte: 2 } }],
    },
    cooldown: 5,
    choices: [
      {
        id: 'let_in',
        text: '开门让她进来，递上一瓶水',
        requires: { hasItem: 'bottled_water' },
        requiresHint: '没有瓶装水',
        outcomes: [
          {
            text: '门外是一个圆润光滑、质感和整个废墟都不在一个图层的女孩。她开心得差点原地转圈，用连续十句不重样的夸夸把屋里的人夸得不好意思起来。',
            effects: [
              { item: 'bottled_water', add: -1 },
              { joinParty: 'tangbao' },
              { unlock: 'tangbao' },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
            next: 'tangbao_welcome',
          },
        ],
      },
      {
        id: 'ask',
        text: '隔着门问：“糖纸里真有糖吗？”',
        outcomes: [
          {
            text: '门外立刻传来光速认错的声音：“对不起对不起！糖早在大灾难之前就吃完了，里面只剩糖纸！是我表达不严谨，请原谅糖包！”',
            next: 'tangbao_doorstep',
          },
        ],
      },
      {
        id: 'hide',
        text: '假装屋里没人',
        outcomes: [
          {
            text: '门外传来一声极其诚恳的鞠躬撞门声，和一句“打扰了，都是我的错”。过了一会儿，门缝里又悄悄塞进来第二颗纸星星。',
            effects: [{ stat: 'sanity', of: 'all', add: 1 }],
          },
        ],
      },
    ],
  },
  {
    id: 'tangbao_doorstep',
    title: '门外的认错声',
    text: '门外的道歉还在继续，听动静，她已经鞠到第十七个躬了。',
    tags: ['visitor'],
    weight: 0,
    choices: [
      {
        id: 'let_in',
        text: '“……进来吧，水是没有多的”',
        outcomes: [
          {
            text: '她一进门就开始夸门框擦得很有品位，嗓子有点哑，但笑得格外灿烂。让人哭笑不得。',
            effects: [
              { joinParty: 'tangbao' },
              { unlock: 'tangbao' },
              { stat: 'hydration', of: { id: 'tangbao' }, add: -20 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
            next: 'tangbao_welcome',
          },
        ],
      },
      {
        id: 'send_away',
        text: '“你还是走吧”',
        outcomes: [
          {
            text: '“好的！打扰了！祝你们今天也超棒的哦！”脚步声渐渐远去，门缝里多了一颗纸星星。也许以后还会遇到她。',
          },
        ],
      },
    ],
  },
  {
    id: 'tangbao_welcome',
    title: '全糖驾到',
    text: '{t} 在屋里转了一圈，见什么夸什么：“哇，这个纸箱堆得好有层次感！这个角落的灰好有年代感！住在这里的人真的太厉害了！”',
    weight: 0,
    roles: { t: { is: 'tangbao' } },
    choices: [
      {
        id: 'thanks',
        text: '“……谢谢？”',
        outcomes: [
          {
            text: '屋里的空气好像真的甜了一点点。',
            effects: [{ stat: 'sanity', of: 'all', add: 3 }],
          },
        ],
      },
    ],
  },

  // ================= 日常：单人 =================
  {
    id: 'moon_posters',
    title: '墙上的小广告',
    text: '清晨一睁眼，庇护所四面墙上贴满了密密麻麻的小纸条——水桶上贴着《节约用水人人有责》，门把手上贴着《出门请喊口号》，连睡着的人背上都被贴了一张《长期躺平易引发肌肉退化》。{self} 正踩在纸箱上，手里拿着最后一张《月氏情报站欢迎投喂》，表情严肃得像在布展。',
    tags: ['character'],
    cooldown: 7,
    when: { shelterCount: { gte: 2 } },
    roles: {
      self: {
        is: 'moon',
        where: {
          not: {
            any: [
              { hasStatus: 'insane', of: 'self' },
              { hasStatus: 'queueing', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'read',
        text: '顺着她的意思，认真读完所有纸条',
        outcomes: [
          {
            weight: 1,
            text: '虽然看得眼花缭乱，但角落里真有一条有用的：“床底第三块砖下面有存货。”掀开一看，是一包压缩饼干！{self} 骄傲地挺起了胸。',
            effects: [
              { item: 'biscuit', add: 1 },
              { stat: 'sanity', of: 'self', add: 6 },
            ],
          },
          {
            weight: 1,
            text: '读到第四十张时，大家的眼睛已经开始转圈了。不过 {self} 非常开心，觉得自己的心血终于有人懂了。',
            effects: [
              { stat: 'sanity', of: 'all', add: -2 },
              { stat: 'sanity', of: 'self', add: 8 },
            ],
          },
        ],
      },
      {
        id: 'tear',
        text: '全部撕下来当引火纸',
        outcomes: [
          {
            text: '{self} 抱着撕下来的废纸蹲在墙角，念叨着“这些可都是我熬夜整理的精华啊”，然后整个人卡住了。不过屋里总算清净了。',
            effects: [
              { stat: 'sanity', of: 'all', add: 3 },
              { stat: 'sanity', of: 'self', add: -6 },
              { addStatus: 'queueing', of: 'self' },
            ],
          },
        ],
      },
      {
        id: 'praise',
        text: '请糖包过去夸她排版好看',
        requires: { inShelter: 'tangbao' },
        requiresHint: '糖包不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '糖包一口一个“配色好有艺术感”“字迹好可爱”，把 {self} 夸得晕头转向，当场把剩下的空白纸全贡献出来给大家记账用。',
            effects: [
              { stat: 'sanity', of: 'all', add: 4 },
              { stat: 'sanity', of: 'self', add: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kelaode_inspection',
    title: '卫生与礼仪突击检查',
    text: '{self} 戴上一双不知从哪找来的白手套，面无表情地把小本本摊在桌上：“各位，经过本小姐连日观察，庇护所的杂物堆放角度与地面灰尘指数已经严重偏离安全基线。现在开始突击卫生检查。”',
    tags: ['character'],
    cooldown: 7,
    when: { shelterCount: { gte: 2 } },
    roles: {
      self: {
        is: 'kelaode',
        where: {
          not: {
            any: [
              { hasStatus: 'refuse_talk', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'clean',
        text: '全员老老实实一起打扫一遍',
        outcomes: [
          {
            weight: 2,
            text: '大家累得腰酸背痛，但屋子变得窗明几净。{self} 满意地点点头，在小本本上给每个人画了一个小太阳。',
            effects: [
              { stat: 'satiety', of: 'all', add: -4 },
              { stat: 'hydration', of: 'all', add: -6 },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
          },
          {
            weight: 1,
            text: '扫到最里面的角落时，竟然从灰堆里翻出了一板没拆封的感冒药！{self}：“看吧，卫生就是生产力。”',
            effects: [
              { stat: 'satiety', of: 'all', add: -4 },
              { stat: 'hydration', of: 'all', add: -6 },
              { stat: 'sanity', of: 'all', add: 3 },
              { item: 'cold_medicine', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'slack',
        text: '摆烂抗议：“末日都来了还讲什么卫生！”',
        outcomes: [
          {
            text: '{self} 的脸色以肉眼可见的速度冷了下来。她合上本子，微笑道：“非常抱歉，无法与缺乏基本共识的团队继续协作。”其他人倒是心安理得地躺了一天。',
            effects: [
              { stat: 'sanity', of: 'all', add: 2 },
              { addStatus: 'refuse_talk', of: 'self' },
            ],
          },
        ],
      },
      {
        id: 'fish_mop',
        text: '让大肥鱼负责把地板蹭亮',
        requires: { inShelter: 'big_fish' },
        requiresHint: '大肥鱼不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '大肥鱼被迫拖着尾巴在地上滑行充当拖把，蹭完之后地板反而湿漉漉的。{self} 叹了口气，强忍着吐槽蹲下去自己擦干。场面过于滑稽，大家笑了好久。',
            effects: [
              { stat: 'hydration', of: { id: 'big_fish' }, add: -8 },
              { stat: 'sanity', of: 'all', add: 4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'garama_2am',
    title: '凌晨两点的战吼',
    text: '凌晨两点，所有人都还睡得迷迷糊糊，黑漆漆的储藏间里突然响起一声中气十足的战吼：“嘎拉嘛——！”紧接着是“咣当”一声巨响，好像什么金属东西翻倒了。',
    tags: ['character'],
    cooldown: 6,
    when: { shelterCount: { gte: 2 } },
    roles: { self: { is: 'garama' } },
    choices: [
      {
        id: 'flashlight',
        text: '打着手电冲进去看看',
        requires: { hasItem: 'flashlight' },
        requiresHint: '需要手电筒',
        outcomes: [
          {
            weight: 2,
            text: '光束扫过去，只见 {self} 骑在一个翻倒的铁桶上，两手各举一把螺丝刀，尾巴炸得像松鼠。原来她逮住了一只偷吃的老鼠，还顺手把破桶修好了。',
            effects: [
              { stat: 'sanity', of: 'all', add: 3 },
              { stat: 'sanity', of: 'self', add: 4 },
            ],
          },
          {
            weight: 1,
            text: '光束扫过去，{self} 正蹲在一台拆开的旧闹钟前面，眼罩歪在头顶：“别吵，我在回收资源。”零件堆里居然真有一卷还能用的胶带。',
            effects: [{ item: 'duct_tape', add: 1 }],
          },
        ],
      },
      {
        id: 'shout',
        text: '摸黑大喊：“别吵了，快睡觉！”',
        outcomes: [
          {
            text: '黑暗中传来她嘴硬的嘟囔：“我才不是在玩呢，我在做声波防盗测试！”然后是窸窸窣窣爬回角落的声音。天亮后，大家的鞋子全被她按大小排成了一队。',
            effects: [
              { stat: 'sanity', of: 'self', add: -3 },
              { stat: 'sanity', of: 'all', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'ignore',
        text: '装作没听见，翻身继续睡',
        outcomes: [
          {
            when: { all: [{ hasStatus: 'misread', of: 'self' }, { hasTag: 'tool' }] },
            text: '天亮后，大家发现 {self} 连夜把 {lost} 拆成了一堆零件，还摆成了一只三角形的大鸟。“这样更有艺术感。”她一本正经地说。',
            effects: [
              { loseRandomItem: { tag: 'tool', count: 1 } },
              { setFlag: 'incident', value: true },
            ],
          },
          {
            when: { not: { all: [{ hasStatus: 'misread', of: 'self' }, { hasTag: 'tool' }] } },
            text: '之后就安静了下来。天亮后什么也没少，只是那扇吱呀作响的门再也不响了。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'tangbao_lecture',
    title: '全糖生活妙招大讲堂',
    text: '一早，{self} 兴致勃勃地把大家叫到一起，从仓库里拿出一块压缩饼干和一瓶水，准备分享她昨晚想出来的“让食物变多小魔法”。她的眼神无比清澈真诚，声音甜得像刚出锅的糖水。',
    tags: ['character'],
    cooldown: 6,
    when: {
      all: [{ hasItem: 'biscuit' }, { hasItem: 'bottled_water' }, { shelterCount: { gte: 2 } }],
    },
    roles: { self: { is: 'tangbao', where: { not: { hasStatus: 'insane', of: 'self' } } } },
    choices: [
      {
        id: 'try',
        text: '捧场鼓掌，拿这块饼干和这瓶水照她的法子试一试',
        outcomes: [
          {
            weight: 3,
            text: '她把压缩饼干泡进水里，搅成了一锅卖相可怕的浆糊。大家一边吐槽一边分着喝完了——居然莫名有点暖胃。',
            effects: [
              { item: 'biscuit', add: -1 },
              { item: 'bottled_water', add: -1 },
              { stat: 'satiety', of: 'all', add: 8 },
              { stat: 'hydration', of: 'all', add: 10 },
              { stat: 'sanity', of: 'all', add: 2 },
            ],
          },
          {
            weight: 1,
            text: '锅烧糊了！饼干和水一起变成了一团冒烟的黑炭。浓烟里，{self} “嗖”地一下滑跪到了墙角。',
            effects: [
              { item: 'biscuit', add: -1 },
              { item: 'bottled_water', add: -1 },
              { setFlag: 'incident', value: true },
              { addStatus: 'kneeling', of: 'self' },
            ],
          },
        ],
      },
      {
        id: 'veto',
        text: '请克劳德从科学角度当场驳回',
        requires: { inShelter: 'kelaode' },
        requiresHint: '克劳德不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '克劳德推了推并不存在的眼镜，用三分钟逐条指出了这个方案的七个致命卫生漏洞。{self} 立刻九十度鞠躬：“大小姐说得太对了，我这就去面壁反省！”一场灾难被扼杀在了摇篮里。',
            effects: [
              { stat: 'sanity', of: { id: 'kelaode' }, add: 3 },
              { addStatus: 'kneeling', of: 'self' },
            ],
          },
        ],
      },
      {
        id: 'change_topic',
        text: '温柔地转移话题，夸她今天发型很好看',
        outcomes: [
          {
            text: '{self} 立刻忘了刚才的事，眉开眼笑地开始夸每个人的头发都很有末日摇滚范儿。',
            effects: [{ stat: 'sanity', of: 'all', add: 2 }],
          },
        ],
      },
    ],
  },
  {
    id: 'dragon_fire_roast',
    title: '小火苗烧烤摊',
    text: '{self} 叉着腰站在罐头堆前，指尖“噗”地冒出一撮小火苗：“本大姐今天心情好，给你们开个烧烤摊！谁要热乎的？”',
    tags: ['character'],
    cooldown: 7,
    when: { all: [{ hasItem: 'canned_food' }, { shelterCount: { gte: 2 } }] },
    roles: {
      self: {
        is: 'dragon_girl',
        where: {
          all: [
            { stat: 'satiety', of: 'self', gte: 50 },
            { not: { hasStatus: 'dumb_mode', of: 'self' } },
            { not: { hasStatus: 'insane', of: 'self' } },
          ],
        },
      },
    },
    choices: [
      {
        id: 'roast',
        text: '开一个罐头，让她烤热了大家分',
        outcomes: [
          {
            text: '罐头在火苗上咕嘟咕嘟冒泡，香味飘满了整个庇护所。大家围成一圈分着吃，{self} 还跑调地唱了两句。',
            effects: [
              { item: 'canned_food', add: -1 },
              { stat: 'satiety', of: 'all', add: 12 },
              { stat: 'sanity', of: 'all', add: 4 },
            ],
          },
        ],
      },
      {
        id: 'dry',
        text: '请她顺便把潮湿的被褥烘一烘',
        outcomes: [
          {
            weight: 3,
            text: '被褥被烘得蓬松又暖和，摸上去像刚在太阳底下晒过一整天。',
            effects: [
              { stat: 'health', of: 'all', add: 4 },
              { stat: 'sanity', of: 'all', add: 2 },
            ],
          },
          {
            weight: 1,
            text: '火苗一不小心窜大了，被角烧出了一个大洞。{self} 心虚地吹灭了手指：“这、这是透气孔！”',
            effects: [
              { stat: 'sanity', of: 'all', add: -3 },
              { setFlag: 'incident', value: true },
            ],
          },
        ],
      },
      {
        id: 'no',
        text: '“还是别在屋里玩火了”',
        outcomes: [
          {
            text: '{self} 不满地鼓起腮帮子，把火苗吹灭了：“哼，人类真是胆小。”',
            effects: [{ stat: 'sanity', of: 'self', add: -2 }],
          },
        ],
      },
    ],
  },

  // ================= 组合彩蛋 =================
  {
    id: 'kelaode_fish_quota',
    title: '白米饭与黑名单',
    text: '{a} 刚在门后贴好一张《今日饮水配额公示表》，一转身就看见 {b} 抱着水瓶吨吨吨狂喝，嘴里还含糊不清地喊着：“鱼要喝水！鱼还要吃大白饭！”小本本上的红笔瞬间悬在了半空。',
    tags: ['character', 'combo'],
    weight: 2,
    cooldown: 6,
    when: { hasItem: 'bottled_water' },
    roles: {
      a: {
        is: 'kelaode',
        where: {
          not: {
            any: [
              { hasStatus: 'refuse_talk', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
      b: {
        is: 'big_fish',
        where: {
          any: [
            { hasStatus: 'thirsty', of: 'self' },
            { hasStatus: 'hungry', of: 'self' },
            { stat: 'hydration', of: 'self', lt: 60 },
            { stat: 'satiety', of: 'self', lt: 60 },
          ],
        },
      },
    },
    choices: [
      {
        id: 'punish',
        text: '支持 {a} 按守则处罚',
        outcomes: [
          {
            text: '{a} 一把夺回水瓶，严肃地把 {b} 记进了黑名单，还没收了她藏在尾巴底下的一块饼干，充公入库。{b} 当场翻肚皮装死吐泡泡，但屋里的秩序总算保住了。',
            effects: [
              { stat: 'hydration', of: { role: 'b' }, add: 10 },
              { stat: 'sanity', of: { role: 'b' }, add: -8 },
              { stat: 'sanity', of: { role: 'a' }, add: 4 },
              { item: 'biscuit', add: 1 },
            ],
          },
        ],
      },
      {
        id: 'plead',
        text: '帮 {b} 求情，让她把这瓶水喝完：“她只是一条渴坏了的胖鱼啊”',
        outcomes: [
          {
            text: '{a} 盯着在地上打滚的 {b} 看了很久，最后无奈地合上小本本：“……真是拿你没办法。只准喝这一瓶，喝完去把地上的水渍擦干净。”说完，她自己的嘴角也松了一点。',
            effects: [
              { item: 'bottled_water', add: -1 },
              { stat: 'hydration', of: { role: 'b' }, add: 40 },
              { stat: 'sanity', of: { role: 'b' }, add: 5 },
              { stat: 'sanity', of: { role: 'a' }, add: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'moon_dragon_memo',
    title: '三千字备忘录的命运',
    text: '今天准备清点外出的补给清单。{a} 熬了一整夜，写了一份长达三千字、附带十二条避坑指南的《废墟拾荒行动手册》交给 {b}。{b} 盯着纸页看了三秒钟，瞳孔渐渐失去了对焦，试探性地咬了一下纸角。',
    tags: ['character', 'combo'],
    cooldown: 6,
    roles: {
      a: {
        is: 'moon',
        where: {
          not: {
            any: [
              { hasStatus: 'queueing', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
      b: {
        is: 'dragon_girl',
        where: {
          any: [
            { hasStatus: 'dumb_mode', of: 'self' },
            { stat: 'satiety', of: 'self', lt: 40 },
          ],
        },
      },
    },
    choices: [
      {
        id: 'feed',
        text: '赶紧把纸抢回来，拿一份吃的喂 {b}',
        requires: { hasTag: 'food' },
        requiresHint: '没有吃的',
        outcomes: [
          {
            text: '{b} 嚼完 {lost}，眼神瞬间恢复了清明，不好意思地把被咬掉一角的手册还给了 {a}。{a} 长舒一口气：“还好，这个夜没有白熬。”',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'satiety', of: { role: 'b' }, add: 30 },
              { stat: 'sanity', of: { role: 'a' }, add: 3 },
            ],
          },
        ],
      },
      {
        id: 'let_her',
        text: '任由 {b} 自由发挥',
        outcomes: [
          {
            text: '“纸飞机飞得好高！”{b} 把手册折成一架超帅的纸飞机，“嗖”地飞出了通风口。{a} 呆呆地站在原地，头顶仿佛缓缓升起一张“排队等待中”的牌子。',
            effects: [
              { stat: 'sanity', of: { role: 'b' }, add: 5 },
              { stat: 'sanity', of: 'all', add: 2 },
              { addStatus: 'queueing', of: { role: 'a' } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'tangbao_card_night',
    title: '风沙天的牌局',
    text: '外面风沙大得睁不开眼，谁也不想出门。大家翻出那副少了一张红桃 Q 的扑克牌准备打几局，结果因为规则解释权差点吵翻天。只有 {a} 坐在中间，笑眯眯地举起手：“我当裁判！谁出牌好看我就给谁鼓掌！”',
    tags: ['character', 'combo'],
    cooldown: 7,
    when: { all: [{ hasItem: 'playing_cards' }, { shelterCount: { gte: 3 } }] },
    roles: {
      a: {
        is: 'tangbao',
        where: {
          not: {
            any: [
              { hasStatus: 'insane', of: 'self' },
              { hasStatus: 'kneeling', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'sweet',
        text: '打一场和和气气的“全糖局”',
        outcomes: [
          {
            text: '无论谁出了一张单牌还是一手臭牌，{a} 都能吹出十句彩虹屁。到最后谁输谁赢已经没人关心了，所有人都笑得肚子疼。',
            effects: [
              { stat: 'sanity', of: 'all', add: 6 },
              { stat: 'satiety', of: 'all', add: -3 },
            ],
          },
        ],
      },
      {
        id: 'hardcore',
        text: '来一场硬核算牌局',
        requires: { all: [{ inShelter: 'kelaode' }, { inShelter: 'garama' }] },
        requiresHint: '需要克劳德和嘎拉嘛都在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '克劳德严格按牌理出牌，嘎拉嘛出老千被抓包就大喊“嘎拉嘛！”赖账，{a} 在中间拼命端水劝架。牌局一直打到下午才散场，克劳德在小本本上郑重记下了一笔“牌品问题”。',
            effects: [
              { stat: 'sanity', of: 'all', add: 8 },
              { stat: 'satiety', of: 'all', add: -6 },
              { stat: 'sanity', of: { id: 'garama' }, add: 4 },
              { stat: 'sanity', of: { id: 'kelaode' }, add: -4 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
      {
        id: 'sleep',
        text: '“还是各自补个觉吧”',
        outcomes: [
          {
            text: '大家各自躺下，听着风声慢慢睡着了。{a} 小声地对每个人都说了“好梦”。',
            effects: [{ stat: 'health', of: 'all', add: 3 }],
          },
        ],
      },
    ],
  },
  {
    id: 'fish_rice_quest',
    title: '大白饭寻宝行动',
    text: '{self} 抱着她那只比脸还大的白碗在仓库里转了三圈，最后眼神无比认真地提议：“我刚刚研究了一下，对面街区以前好像有家快餐店仓库！只要先给我吃一口垫垫肚子，我肯定能把大白饭背回来！”',
    tags: ['character'],
    cooldown: 7,
    when: { day: { gte: 3 } },
    roles: {
      self: {
        is: 'big_fish',
        where: {
          not: {
            any: [
              { hasStatus: 'sick', of: 'self' },
              { hasStatus: 'injured', of: 'self' },
              { hasStatus: 'food_coma', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'feed',
        text: '喂她一份吃的，放她去折腾',
        requires: { hasTag: 'food' },
        requiresHint: '没有吃的',
        outcomes: [
          {
            weight: 2,
            text: '{self} 吃下 {lost}，眼睛瞬间亮得像灯泡，哼着歌冲出了门。到了下午，她得意洋洋地抱回了一袋大米和一个罐头——然后“咚”地一声倒在门口，晕碳了。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'satiety', of: 'self', add: 20 },
              { item: 'rice', add: 1 },
              { item: 'canned_food', add: 1 },
              { addStatus: 'food_coma', of: 'self' },
            ],
          },
          {
            weight: 1,
            text: '{self} 吃下 {lost} 就冲出了门，结果被一条野狗追了三条街，空着手狼狈地逃了回来。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'satiety', of: 'self', add: 20 },
              { stat: 'health', of: 'self', add: -8 },
              { stat: 'sanity', of: 'self', add: -5 },
            ],
          },
        ],
      },
      {
        id: 'deny',
        text: '严肃地告诉她“废墟里没有现成的热白饭”',
        outcomes: [
          {
            text: '{self} 当场像一只泄了气的蓝色气球一样瘫在地上吐泡泡：“那……那我再躺五分钟，有饭了叫我……”',
            effects: [{ stat: 'sanity', of: 'self', add: -6 }],
          },
        ],
      },
    ],
  },
  {
    id: 'kiminai_apology_hole',
    title: '屋里出现了道歉黑洞',
    text: '角落里传来连续不断、快得像机关枪一样的鞠躬声：“对不起！我太没用了！昨天踩水坑弄脏鞋带也是我的错！我这就自我反省！”{self} 把头埋在膝盖里，整个人散发着浓浓的黑色气场，浓得连墙角的灰尘都想往外逃。',
    tags: ['character'],
    cooldown: 5,
    roles: {
      self: {
        is: 'kiminai',
        where: {
          any: [
            { hasStatus: 'despair', of: 'self' },
            { stat: 'sanity', of: 'self', lt: 40 },
          ],
        },
      },
    },
    choices: [
      {
        id: 'feed',
        text: '塞给她一份吃的，认真夸她其实很厉害',
        requires: { hasTag: 'food' },
        requiresHint: '没有吃的',
        outcomes: [
          {
            text: '{self} 小口啃着 {lost}，眼泪汪汪地抬起头：“真、真的没有嫌弃我吗？”三秒后，她火速擦干眼泪，满血复活。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1, pick: 'cheapest' } },
              { stat: 'sanity', of: 'self', add: 15 },
              { removeStatus: 'despair', of: 'self' },
            ],
          },
        ],
      },
      {
        id: 'tangbao',
        text: '派糖包上去进行“专业心理疏导”',
        requires: { inShelter: 'tangbao' },
        requiresHint: '糖包不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            weight: 1,
            text: '糖包安慰了两句，看她还在哭，急得原地滑跪跟着一起道歉。两个人对着墙角互相鞠躬，鞠着鞠着，突然一起笑出了声。',
            effects: [
              { stat: 'sanity', of: 'self', add: 8 },
              { removeStatus: 'despair', of: 'self' },
            ],
          },
          {
            weight: 1,
            text: '糖包安慰了两句，看她还在哭，急得原地滑跪跟着一起道歉。{self} 见状哭得更惨了：“连累你跟着道歉，我果然是避难所的祸害！”两人对着墙角上演了半小时的双人道歉大赛，谁也劝不住谁。',
            effects: [
              { stat: 'sanity', of: 'self', add: 3 },
              { addStatus: 'kneeling', of: { id: 'tangbao' } },
            ],
          },
        ],
      },
      {
        id: 'listen',
        text: '什么也不给，坐到她旁边听她把话说完',
        outcomes: [
          {
            text: '{self} 一口气道歉了半个钟头，声音越来越小，最后靠着墙抽抽搭搭地睡着了。醒来时眼睛还是红的，但总算不再对着空气鞠躬了。',
            effects: [{ stat: 'sanity', of: 'self', add: 6 }],
          },
        ],
      },
      {
        id: 'leave',
        text: '随她自我检讨一会儿，别打扰她',
        outcomes: [
          {
            text: '{self} 对着纸箱真诚忏悔了一整天。虽然没闹出别的乱子，但屋里的气氛肉眼可见地低沉了下去。',
            effects: [
              { stat: 'sanity', of: 'self', add: -4 },
              { stat: 'sanity', of: 'random', add: -3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kiminai_moon_debate',
    title: '谁才是全屋最强万事通',
    text: '昨晚不知是谁随口问了一句“旧电池里的粉末能不能用来画画”，瞬间点燃了战火！{a} 拍着大背包，眼睛亮晶晶地开始背诵化学反应原理；{b} 则直接抱出一摞废手册，开始引用第 42 页的文献。两人从昨晚一直吵到天亮，眼看还要再辩论一整天。',
    tags: ['character', 'combo'],
    cooldown: 8,
    roles: {
      a: {
        is: 'kiminai',
        where: {
          all: [
            { not: { hasStatus: 'despair', of: 'self' } },
            { stat: 'sanity', of: 'self', gte: 50 },
          ],
        },
      },
      b: {
        is: 'moon',
        where: {
          not: {
            any: [
              { hasStatus: 'queueing', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'applaud',
        text: '赶紧鼓掌叫好：“两位老师都太博学了！”',
        outcomes: [
          {
            text: '两人满意地停下抢答，还顺手把讨论出的冷知识总结成了一份《废墟实用清单》贴在门后。只是被拉着一起喝彩了一上午，嗓子都干了。',
            effects: [
              { stat: 'sanity', of: 'all', add: 4 },
              { stat: 'hydration', of: 'all', add: -4 },
              { stat: 'sanity', of: { role: 'a' }, add: 2 },
              { stat: 'sanity', of: { role: 'b' }, add: 2 },
            ],
          },
        ],
      },
      {
        id: 'bedtime',
        text: '弱弱提醒她们“先去补个觉吧，不然今天没力气干活了”',
        outcomes: [
          {
            text: '{a} 立刻笑眯眯地说“抱歉抱歉，确实太兴奋啦”，钻回角落秒睡；{b} 却因为思路被强行打断，整个人卡在了原地。不过屋里总算安静下来，能补个好觉了。',
            effects: [
              { stat: 'health', of: 'all', add: 3 },
              { addStatus: 'queueing', of: { role: 'b' } },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'garama_moon_night',
    title: '凌晨三点不睡觉联盟',
    text: '天快亮了，庇护所的角落还亮着一点微光——从凌晨三点亮到现在。{b} 借着光狂啃捡回来的电器说明书，顺手往墙上贴新写的《防盗流程图》；{a} 刚好睡醒开工，一边小声喊着口号给自己打气，一边把那张流程图改成了谁也看不懂的三角架结构图。两人盯着对方的黑眼圈，真诚发问：“你到底睡不睡觉？”',
    tags: ['character', 'combo'],
    cooldown: 7,
    roles: {
      a: { is: 'garama', where: { not: { hasStatus: 'insane', of: 'self' } } },
      b: {
        is: 'moon',
        where: {
          not: {
            any: [
              { hasStatus: 'queueing', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'inventory',
        text: '请她们顺便把仓库清点一遍',
        outcomes: [
          {
            weight: 1,
            text: '两个夜猫子把仓库翻了个底朝天，在一堆空箱子后面找到了一包被遗忘的压缩饼干。',
            effects: [{ item: 'biscuit', add: 1 }],
          },
          {
            weight: 1,
            text: '两个夜猫子把仓库翻了个底朝天，在暖气片后面摸出了一瓶落了灰的瓶装水。',
            effects: [{ item: 'bottled_water', add: 1 }],
          },
          {
            weight: 1,
            text: '清点结果出来了：“杂物若干，纸箱若干，三角形大鸟 ×1。”{a} 指着清单上的涂鸦一本正经地解释了半天，眼神越来越飘。',
            effects: [{ addStatus: 'misread', of: { role: 'a' } }],
          },
        ],
      },
      {
        id: 'lights_out',
        text: '强制熄灯，把两个人都赶去睡觉',
        outcomes: [
          {
            text: '{a} 嘟囔着“夜班才是正经班”，{b} 抱着说明书不肯撒手，但最后两个人都在黑暗里睡着了。',
            effects: [
              { stat: 'health', of: { role: 'a' }, add: 4 },
              { stat: 'health', of: { role: 'b' }, add: 4 },
              { stat: 'sanity', of: { role: 'a' }, add: -3 },
              { stat: 'sanity', of: { role: 'b' }, add: -3 },
            ],
          },
        ],
      },
      {
        id: 'join',
        text: '干脆加入她们的通宵茶话会',
        outcomes: [
          {
            text: '几个人围着微光一直聊到太阳升起，从罐头保质期一路聊到了外星人到底存不存在。',
            effects: [
              { stat: 'sanity', of: 'all', add: 4 },
              { stat: 'satiety', of: 'all', add: -4 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'kelaode_moldy_bread',
    title: '长毛的面包',
    text: '{b} 在储藏间角落里翻出了半块长着绿毛的面包，兴冲冲地举起来：“烤一烤应该还能吃吧？”一旁的 {a} 缓缓合上了手里的《安全守则》。',
    tags: ['character'],
    cooldown: 8,
    roles: {
      a: { is: 'kelaode', where: { not: { hasStatus: 'insane', of: 'self' } } },
      b: {},
    },
    choices: [
      {
        id: 'eat',
        text: '烤一烤，大家分着吃了',
        outcomes: [
          {
            text: '面包烤得焦脆，意外地还挺香。只是 {a} 全程用看罪犯的眼神盯着每一个人，在小本本上写下了长长的一段。',
            effects: [
              { stat: 'satiety', of: 'all', add: 8 },
              { addStatus: 'sick', of: { role: 'b' }, chance: 0.35 },
              { setFlag: 'rule_broken', value: true },
            ],
          },
        ],
      },
      {
        id: 'throw',
        text: '听 {a} 的，扔掉',
        outcomes: [
          {
            text: '{a} 用两根手指捏着面包丢进了垃圾袋，满意地点点头：“明智的选择。”{b} 看着垃圾袋，咽了一口口水。',
            effects: [
              { stat: 'sanity', of: { role: 'a' }, add: 4 },
              { stat: 'sanity', of: { role: 'b' }, add: -3 },
            ],
          },
        ],
      },
      {
        id: 'flame',
        text: '请龙娘用火苗高温“消毒”',
        requires: { inShelter: 'dragon_girl' },
        requiresHint: '龙娘不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '龙娘对着面包喷了一小口火，面包瞬间变成了一块炭。“高温消毒完毕！”大家看着那块炭，又看了看 {a}——{a} 罕见地笑出了声。',
            effects: [{ stat: 'sanity', of: 'all', add: 4 }],
          },
        ],
      },
    ],
  },
  {
    id: 'dragon_fish_carb',
    title: '碳水保卫战',
    text: '{a} 和 {b} 为一个严肃的学术问题吵了一整个早上：“压缩饼干泡水，到底算不算大白饭的平替？”{b} 抱着大白碗坚称算，{a} 甩着尾巴坚称不算，眼看就要演变成一场碳水保卫战。',
    tags: ['character', 'combo'],
    cooldown: 8,
    when: { hasItem: 'biscuit' },
    roles: {
      a: {
        is: 'dragon_girl',
        where: {
          not: {
            any: [
              { hasStatus: 'dumb_mode', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
      b: {
        is: 'big_fish',
        where: {
          not: {
            any: [
              { hasStatus: 'food_coma', of: 'self' },
              { hasStatus: 'insane', of: 'self' },
            ],
          },
        },
      },
    },
    choices: [
      {
        id: 'test',
        text: '做一锅饼干泡饭，实践出真知',
        requires: { hasItem: 'bottled_water' },
        requiresHint: '还需要一瓶水',
        outcomes: [
          {
            text: '饼干泡饭出锅了。{b} 吃了一口，热泪盈眶：“是大白饭的味道！”{a} 吃了一口：“是饼干的味道。”但两人都把碗舔得干干净净。',
            effects: [
              { item: 'biscuit', add: -1 },
              { item: 'bottled_water', add: -1 },
              { stat: 'satiety', of: { role: 'a' }, add: 15 },
              { stat: 'satiety', of: { role: 'b' }, add: 15 },
              { stat: 'hydration', of: { role: 'a' }, add: 15 },
              { stat: 'hydration', of: { role: 'b' }, add: 15 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
          },
        ],
      },
      {
        id: 'mediate',
        text: '请糖包来端水',
        requires: { inShelter: 'tangbao' },
        requiresHint: '糖包不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '糖包冲进战场，先夸 {a} 胃口好有活力，再夸 {b} 尾巴圆有福气，夸到最后两人都忘了原本在吵什么，开始互相夸对方的碗。',
            effects: [{ stat: 'sanity', of: 'all', add: 4 }],
          },
        ],
      },
      {
        id: 'stop',
        text: '“谁也别吵了！”',
        outcomes: [
          {
            text: '两人同时闭了嘴，各自扭头生起了闷气。',
            effects: [
              { stat: 'sanity', of: { role: 'a' }, add: -3 },
              { stat: 'sanity', of: { role: 'b' }, add: -3 },
            ],
          },
        ],
      },
    ],
  },
];
