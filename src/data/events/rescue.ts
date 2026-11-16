import type { Effect, EventDef } from '../../engine/schema';

/**
 * 三条获救线（docs/DESIGN.md 12.6）：军方撤离、南下车队、地下列车。
 * 这些事件链都不定义 roles：排队事件会沿用当时绑定的角色，角色不在世了排队就会失效。
 * 例外是线索事件 trail_clue_*：由外出归来时的地图规则排队，self = 外出者（当天就会弹出）。
 */

/** 车队线参数（docs/DESIGN.md 12.6） */
const CARAVAN_BATCH = 1; // 每次上交的份数
const CARAVAN_GAP = 2; // 来访间隔（天）
const CARAVAN_VISITS = 6; // 最多来访次数（含谈妥后的第一次）
const CARAVAN_WATER = [5, 6, 7]; // 本局随机需要的水
const CARAVAN_FOOD = [4, 5, 6]; // 本局随机需要的食物
const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 上交 CARAVAN_BATCH 份某类物资：扣库存、扣 flag，扣成负数就拉回 0 */
const handIn = (tag: 'water' | 'food', flag: string): Effect[] => [
  { loseRandomItem: { tag, count: CARAVAN_BATCH, pick: 'cheapest' } },
  { addFlag: flag, add: -CARAVAN_BATCH },
  { if: { flag, lt: 0 }, then: [{ setFlag: flag, value: 0 }] },
];

const TRAIL_LOCATIONS = [
  'substation',
  'library',
  'pharmacy',
  'subway_station',
  'police_station',
  'hardware_market',
];

export const rescueEvents = [
  // ---------- 军方撤离 ----------
  {
    id: 'military_broadcast',
    title: '军方广播',
    text: '收音机的沙沙声里忽然跳出一段清晰的录音：“……这里是第七撤离区接应分队……幸存者请回应……废墟里冒充幸存者的劫掠者太多，接应时请出示 {flagItem:evac_item} 作为识别，没有它我们不能放人上车……重复一遍……”',
    tags: ['radio'],
    when: {
      all: [{ hasItem: 'radio' }, { day: { gte: 6 } }, { not: { flag: 'evac_contact' } }],
    },
    weight: 1.5,
    cooldown: 5,
    choices: [
      {
        id: 'respond',
        text: '抓起麦克风回应',
        outcomes: [
          {
            weight: 1,
            text: '对面回应了！一个沙哑的声音记下了你们的位置：“三天后，街口会合。记住，带上 {flagItem:evac_item}。”',
            effects: [
              { setFlag: 'evac_known', value: true },
              { setFlag: 'evac_contact', value: true },
              { queueEvent: 'military_rendezvous', delay: 3 },
              { stat: 'sanity', of: 'all', add: 6 },
            ],
          },
          {
            weight: 1,
            text: '你们喊了半天，对面只有循环播放的录音。信号最终淹没在沙沙声里。至少你们记住了他们要的东西：{flagItem:evac_item}。',
            effects: [
              { setFlag: 'evac_known', value: true },
              { stat: 'sanity', of: 'all', add: -3 },
            ],
          },
        ],
      },
      {
        id: 'listen',
        text: '只是默默记下',
        outcomes: [
          {
            text: '你们把广播内容抄在了墙上：撤离区、接应、{flagItem:evac_item}。也许下次再听到时，就有勇气回应了。',
            effects: [{ setFlag: 'evac_known', value: true }],
          },
        ],
      },
    ],
  },
  {
    id: 'military_rendezvous',
    title: '街口的装甲车',
    text: '约定的日子到了。一辆涂着迷彩的装甲车停在街口，两个戴着头盔的士兵端着枪走过来，隔着几米停下：“识别物，拿出来看看。”',
    weight: 0,
    choices: [
      {
        id: 'show',
        text: '递上 {flagItem:evac_item}',
        requires: { hasFlagItem: 'evac_item' },
        requiresHint: '拿不出广播里要的识别物',
        outcomes: [
          {
            text: '士兵仔细看了看，对着对讲机说了句什么，然后侧身让开：“上车，快。”',
            effects: [{ ending: 'military_evac' }],
          },
        ],
      },
      {
        id: 'bribe',
        text: '塞给他们 3 份食物，求通融一下',
        requires: { hasTag: 'food', count: 3 },
        requiresHint: '需要 3 份食物',
        outcomes: [
          {
            weight: 1,
            text: '年轻一点的士兵犹豫了一下，接过食物，朝车厢努了努嘴。另一个假装什么也没看见。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 3 } },
              { setFlag: 'rule_broken', value: true },
              { ending: 'military_evac' },
            ],
          },
          {
            weight: 3,
            text: '士兵把枪口抬了抬：“规矩就是规矩。”他们顺手拿走了一份：{lost}，然后上车走了。也许还会有下一次广播。',
            effects: [
              { loseRandomItem: { tag: 'food', count: 1 } },
              { setFlag: 'rule_broken', value: true },
              { setFlag: 'evac_contact', value: false },
              { stat: 'sanity', of: 'all', add: -5 },
            ],
          },
        ],
      },
      {
        id: 'give_up',
        text: '只能看着他们离开',
        outcomes: [
          {
            text: '装甲车调了个头，消失在烟尘里。你们站在街口很久都没说话。也许还会有下一次广播。',
            effects: [
              { setFlag: 'evac_contact', value: false },
              { stat: 'sanity', of: 'all', add: -6 },
            ],
          },
        ],
      },
    ],
  },

  // ---------- 南下车队 ----------
  {
    id: 'caravan_first_contact',
    title: '南下的车队',
    text: '一阵喇叭声把你们从午睡里吵醒。几辆焊满铁板的卡车停在楼下，领头的女人敲了敲铁门：“我们往南走，那边据说还有电。想跟着走的话，路上的水和吃的得自己出一份。”',
    weight: 3,
    cooldown: 3,
    when: { all: [{ day: { gte: 7 } }, { not: { flag: 'caravan_known' } }] },
    choices: [
      {
        id: 'talk',
        text: '开门谈谈',
        outcomes: [
          {
            text: `领队掰着手指算了算你们的人头：“要捎上你们，还得再凑 {flag:caravan_water_left} 份水、{flag:caravan_food_left} 份吃的。我们每${CN[CARAVAN_GAP]}天经过一次，最多再来${CN[CARAVAN_VISITS - 1]}趟。凑齐了就上车。”`,
            effects: [
              { setFlag: 'caravan_known', value: true },
              { setFlag: 'caravan_visits', value: 0 },
              {
                random: CARAVAN_WATER.map((value) => ({
                  effects: [{ setFlag: 'caravan_water_left', value }],
                })),
              },
              {
                random: CARAVAN_FOOD.map((value) => ({
                  effects: [{ setFlag: 'caravan_food_left', value }],
                })),
              },
            ],
            next: 'caravan_visit',
          },
        ],
      },
      {
        id: 'hide',
        text: '隔着门不吭声',
        outcomes: [{ text: '喇叭又响了两声，卡车隆隆地开走了。也许他们还会经过这里。' }],
      },
    ],
  },
  {
    id: 'caravan_visit',
    title: '车队来了',
    text: '卡车停在楼下，领队靠在车门上翻着小本子：“还差水 {flag:caravan_water_left} 份、吃的 {flag:caravan_food_left} 份。今天能交多少？”',
    weight: 0,
    choices: [
      {
        id: 'give_water',
        text: `搬 ${CARAVAN_BATCH} 份水上车`,
        requires: {
          all: [
            { hasTag: 'water', count: CARAVAN_BATCH },
            { flag: 'caravan_water_left', gte: 1 },
          ],
        },
        requiresHint: `需要库存里有 ${CARAVAN_BATCH} 份水，且水还没交齐`,
        outcomes: [
          {
            when: {
              all: [
                { flag: 'caravan_water_left', lte: CARAVAN_BATCH },
                { flag: 'caravan_food_left', lte: 0 },
              ],
            },
            text: '最后一份水也搬上了车。领队合上本子，拍了拍车厢：“齐了，上车！”',
            effects: [...handIn('water', 'caravan_water_left'), { ending: 'caravan' }],
          },
          {
            when: {
              not: {
                all: [
                  { flag: 'caravan_water_left', lte: CARAVAN_BATCH },
                  { flag: 'caravan_food_left', lte: 0 },
                ],
              },
            },
            text: '水搬上了车，领队在本子上划了一道：“还差水 {flag:caravan_water_left} 份、吃的 {flag:caravan_food_left} 份。”',
            effects: handIn('water', 'caravan_water_left'),
            next: 'caravan_visit',
          },
        ],
      },
      {
        id: 'give_food',
        text: `搬 ${CARAVAN_BATCH} 份食物上车`,
        requires: {
          all: [
            { hasTag: 'food', count: CARAVAN_BATCH },
            { flag: 'caravan_food_left', gte: 1 },
          ],
        },
        requiresHint: `需要 ${CARAVAN_BATCH} 份食物（食物已交齐则不用再交）`,
        outcomes: [
          {
            when: {
              all: [
                { flag: 'caravan_food_left', lte: CARAVAN_BATCH },
                { flag: 'caravan_water_left', lte: 0 },
              ],
            },
            text: '最后一份吃的也搬上了车。领队合上本子，拍了拍车厢：“齐了，上车！”',
            effects: [...handIn('food', 'caravan_food_left'), { ending: 'caravan' }],
          },
          {
            when: {
              not: {
                all: [
                  { flag: 'caravan_food_left', lte: CARAVAN_BATCH },
                  { flag: 'caravan_water_left', lte: 0 },
                ],
              },
            },
            text: '吃的搬上了车，领队在本子上划了一道：“还差水 {flag:caravan_water_left} 份、吃的 {flag:caravan_food_left} 份。”',
            effects: handIn('food', 'caravan_food_left'),
            next: 'caravan_visit',
          },
        ],
      },
      {
        id: 'enough',
        text: '这次就到这儿',
        outcomes: [
          {
            when: { flag: 'caravan_visits', lte: CARAVAN_VISITS - 2 },
            text: `领队点点头：“${CN[CARAVAN_GAP]}天后我们再经过这里。”卡车喷着黑烟开走了。`,
            effects: [
              { addFlag: 'caravan_visits', add: 1 },
              { queueEvent: 'caravan_visit', delay: CARAVAN_GAP },
            ],
          },
          {
            when: { not: { flag: 'caravan_visits', lte: CARAVAN_VISITS - 2 } },
            text: '领队叹了口气：“这是最后一趟了，南边等不了太久。保重。”车队开走了，这次不会再回来。',
            effects: [
              { addFlag: 'caravan_visits', add: 1 },
              { setFlag: 'caravan_gone', value: true },
              { stat: 'sanity', of: 'all', add: -5 },
            ],
          },
        ],
      },
    ],
  },

  // ---------- 地下列车 ----------
  {
    id: 'strange_flyer',
    title: '门缝里的传单',
    text: '早上，门缝里塞进来一张对折的传单。上面用红笔画着一个褪色的地铁标志，下面写着一行字：“地下还有车在跑。跟着记号走，别告诉别人。”',
    weight: 3,
    cooldown: 3,
    when: { all: [{ day: { gte: 4 } }, { not: { flag: 'trail_started' } }] },
    choices: [
      {
        id: 'keep',
        text: '收好传单，研究一下',
        outcomes: [
          {
            text: '传单背面画着一张潦草的地图，一个圈圈住了 {flagLocation:trail_1}，旁边写着“第一个记号”。',
            effects: [
              { setFlag: 'trail_started', value: true },
              { setFlag: 'trail_step', value: 1 },
              {
                pickFlags: {
                  flags: ['trail_1', 'trail_2', 'trail_3'],
                  from: TRAIL_LOCATIONS,
                },
              },
            ],
          },
        ],
      },
      {
        id: 'toss',
        text: '八成是骗局，扔了',
        outcomes: [{ text: '传单被揉成一团扔进了角落。也许以后还会有人塞进来。' }],
      },
    ],
  },
  {
    id: 'trail_clue_1',
    title: '第一个记号',
    text: '{self} 在 {flagLocation:trail_1} 的墙角发现了一个用红漆喷的地铁标志，和传单上的一模一样。',
    weight: 0,
    choices: [
      {
        id: 'read',
        text: '仔细看看记号',
        outcomes: [
          {
            text: '标志下面有一个小小的箭头和几个字：“下一个在 {flagLocation:trail_2}”。{self} 把它记了下来。',
            effects: [
              { setFlag: 'trail_step', value: 2 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'trail_clue_2',
    title: '第二个记号',
    text: '{self} 在 {flagLocation:trail_2} 找到了第二个红漆记号，旁边还多了几道新鲜的划痕，像是有人最近刚来过。',
    weight: 0,
    choices: [
      {
        id: 'read',
        text: '顺着箭头看',
        outcomes: [
          {
            text: '箭头下面写着：“最后一个在 {flagLocation:trail_3}”。看来离终点不远了。',
            effects: [
              { setFlag: 'trail_step', value: 3 },
              { stat: 'sanity', of: 'all', add: 3 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'trail_clue_3',
    title: '最后一个记号',
    text: '{self} 在 {flagLocation:trail_3} 找到了最后一个记号。这次不是箭头，而是一行字和一张手绘的时刻表。',
    weight: 0,
    choices: [
      {
        id: 'read',
        text: '读那行字',
        outcomes: [
          {
            text: '“两天后的清晨，离你们最近的地铁口。列车只停一会儿。”{self} 把时刻表揣进怀里，一路小跑回了家。',
            effects: [
              { setFlag: 'trail_step', value: 4 },
              { setFlag: 'train_wait', value: 3 },
              { queueEvent: 'underground_train', delay: 2 },
              { stat: 'sanity', of: 'all', add: 6 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'underground_train',
    title: '地下列车',
    text: '天还没亮，你们守在最近的地铁口。铁栅栏后面亮起了一盏昏黄的灯，一列只有两节车厢的列车慢慢滑进站台，没有停稳，像是在等什么信号。',
    weight: 0,
    choices: [
      {
        id: 'flashlight',
        text: '用手电筒打三长三短',
        requires: { hasItem: 'flashlight' },
        requiresHint: '需要手电筒',
        outcomes: [
          {
            text: '光束在隧道里一闪一闪。车头的灯回了三下，车门“嗤”地一声打开了。',
            effects: [{ setFlag: 'train_wait', value: 0 }, { ending: 'subway_rescue' }],
          },
        ],
      },
      {
        id: 'lighter',
        text: '举起打火机晃一晃',
        requires: { hasItem: 'lighter' },
        requiresHint: '需要打火机',
        outcomes: [
          {
            weight: 3,
            text: '小小的火苗在黑暗里格外显眼。列车停稳了，车门打开。',
            effects: [{ setFlag: 'train_wait', value: 0 }, { ending: 'subway_rescue' }],
          },
          {
            weight: 1,
            text: '火苗被隧道风一吹就灭了。列车犹豫了几秒，还是开走了。车尾的人比了个“三”的手势——也许三天后还会来。',
            effects: [
              { setFlag: 'train_wait', value: 3 },
              { stat: 'sanity', of: 'all', add: -4 },
            ],
          },
        ],
      },
      {
        id: 'run',
        text: '冲下站台挥手大喊',
        outcomes: [
          {
            weight: 1,
            text: '你们一边跑一边喊，嗓子都喊哑了。列车终于停下，有人从车窗里伸出手把你们拉了上去。',
            effects: [{ setFlag: 'train_wait', value: 0 }, { ending: 'subway_rescue' }],
          },
          {
            weight: 1,
            text: '喊声在隧道里乱撞，列车像是受了惊，加速开走了。车尾的人比了个“三”的手势——也许三天后还会来。',
            effects: [
              { setFlag: 'train_wait', value: 3 },
              { stat: 'sanity', of: 'all', add: -6 },
            ],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
