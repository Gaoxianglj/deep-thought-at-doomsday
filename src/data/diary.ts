import type { Condition, DiaryDef } from '../engine/schema';

/**
 * 避难所日记（素材见 设定/02_避难所幽默日记灵感库.md）。
 *
 * 一致性约定（日记在清晨写，描述的是昨天 / 昨晚 / 今早的事）：
 * - 角色只通过 roles 出现（只会绑到此刻在庇护所的活人）；文本里不得写角色名，
 *   注意"月"是角色名，任何日记文本都不能出现这个字，嘎拉嘛的口号也只能写成"她的口号"。
 * - 写"精神好 / 有活力"用 FINE；写角色在做事、说笑的至少要 UP（健康 ≥30）。
 * - 提到具体物资（饼干、罐头、水、扑克、收音机……）的，用 when 保证它此刻真的在库存里。
 * - 不写"刚吃了 / 刚喝了"：日记不知道昨晚谁吃了配给，吃喝只写惦记、盯着，或用属性条件。
 */

const has = (id: string): Condition => ({ hasStatus: id, of: 'self' });
const not = (c: Condition): Condition => ({ not: c });
const all = (...cs: Condition[]): Condition => ({ all: cs });
const any = (...cs: Condition[]): Condition => ({ any: cs });
const healthAtLeast = (n: number): Condition => ({ stat: 'health', of: 'self', gte: n });

/** 所有"状态不好"的状态：通用的饥渴伤病 + 各角色的专属崩坏状态 */
const BAD_STATUSES = [
  'hungry',
  'thirsty',
  'sick',
  'injured',
  'insane',
  'dumb_mode',
  'food_coma',
  'despair',
  'misread',
  'refuse_talk',
  'queueing',
  'kneeling',
];

/** 精神很好：没有任何不良状态，健康 ≥50、理智 ≥40 */
const FINE: Condition = all(...BAD_STATUSES.map((id) => not(has(id))), healthAtLeast(50), {
  stat: 'sanity',
  of: 'self',
  gte: 40,
});
/** 还能做事、说笑：健康 ≥30，且没有发疯 */
const UP: Condition = all(healthAtLeast(30), not(has('insane')));
/** 处于某个状态，且不是奄奄一息（用于轻松向的状态日记） */
const inState = (id: string): Condition => all(has(id), healthAtLeast(30));

const HUNGRY: Condition = any(has('hungry'), { stat: 'satiety', of: 'self', lt: 30 });
const THIRSTY: Condition = any(has('thirsty'), { stat: 'hydration', of: 'self', lt: 30 });

const item = (id: string, count?: number): Condition =>
  count ? { hasItem: id, count } : { hasItem: id };
/** 某物品恰好剩 1 件 */
const lastOne = (id: string): Condition => all(item(id), not(item(id, 2)));
const crowd = (n: number): Condition => ({ shelterCount: { gte: n } });

export const diary: DiaryDef[] = [
  // ================= 通用：任何人 =================
  {
    id: 'argue',
    text: '{a} 和 {b} 为了最后一块压缩饼干的归属吵了一架，最后谁也没舍得碰它，饼干被郑重地放回了架子上。',
    when: lastOne('biscuit'),
    roles: { a: { where: UP }, b: { where: UP } },
    cooldown: 8,
  },
  {
    id: 'energetic',
    text: '{a} 今天精神很好，一大早在庇护所里做起了广播体操，没有人跟着做。',
    roles: { a: { where: FINE } },
    cooldown: 10,
  },
  {
    id: 'hungry_moan',
    text: '{a} 的肚子叫了一整夜，很有节奏感，隔壁房间都听得见。',
    roles: { a: { where: has('hungry') } },
    cooldown: 5,
  },
  {
    id: 'thirsty_moan',
    text: '{a} 舔了舔干裂的嘴唇，一早上都在念叨冰镇汽水的样子。',
    roles: { a: { where: has('thirsty') } },
    cooldown: 5,
  },
  {
    id: 'sick_cough',
    text: '{a} 裹着毯子缩在角落里，咳了一整夜，像在演奏一首悲伤的小曲。',
    roles: { a: { where: has('sick') } },
    cooldown: 5,
  },
  {
    id: 'injured_limp',
    text: '{a} 拖着伤处在屋里挪来挪去，坚持说“只是擦破点皮”，然后疼得倒吸一口凉气。',
    roles: { a: { where: inState('injured') } },
    cooldown: 6,
  },
  {
    id: 'insane_talk',
    text: '{a} 对着墙壁聊了一晚上，据说聊得很投机，墙壁没有反驳。',
    roles: { a: { where: has('insane') } },
    cooldown: 6,
  },
  {
    id: 'cards',
    text: '{a} 和 {b} 用那副缺了一张牌的扑克打了一下午，谁也不肯承认自己出老千。',
    when: item('playing_cards'),
    roles: { a: { where: UP }, b: { where: UP } },
    cooldown: 10,
  },
  {
    id: 'share_biscuit',
    text: '{a} 在 {b} 的枕头边悄悄放了一张纸条：“下次分饼干，我那份分你一半。”还假装只是顺手。',
    when: item('biscuit'),
    roles: { a: { where: FINE }, b: { where: { stat: 'satiety', of: 'self', lt: 50 } } },
    cooldown: 8,
  },

  // ================= 龙娘 =================
  {
    id: 'dragon_dumb',
    text: '{a} 盯着一个空罐头发了一早上的呆，嘴里反复念叨着“好像还能吃”。',
    roles: { a: { is: 'dragon_girl', where: has('dumb_mode') } },
    cooldown: 5,
  },
  {
    id: 'dragon_full',
    text: '{a} 肚子饱饱地睡了一整夜，梦里打了个嗝，喷出的小火苗把天花板熏黑了一小块。',
    roles: {
      a: { is: 'dragon_girl', where: all(FINE, { stat: 'satiety', of: 'self', gte: 70 }) },
    },
    cooldown: 8,
  },
  {
    id: 'dragon_warm_can',
    text: '{a} 肚子饱饱的，心情大好，得意地用指尖的小火苗把仓库里的冷罐头挨个烘温了一点，代价是差点把罐头盖上的灰烤成烟花。',
    when: item('canned_food'),
    roles: {
      a: { is: 'dragon_girl', where: all(FINE, { stat: 'satiety', of: 'self', gte: 70 }) },
    },
    cooldown: 8,
  },
  {
    id: 'dragon_song',
    text: '{a} 叉着腰在屋里哼起了跑调的龙宫小曲，声音洪亮到窗外的野猫都跟着叫了两声。',
    roles: {
      a: { is: 'dragon_girl', where: all(FINE, { stat: 'satiety', of: 'self', gte: 50 }) },
    },
    cooldown: 7,
  },
  {
    id: 'dragon_tail_soup',
    text: '{a} 盯着自己甩来甩去的尾巴看了半天，忽然严肃地问：“这根白白的东西……能拿来炖汤吗？”',
    roles: { a: { is: 'dragon_girl', where: all(any(has('dumb_mode'), HUNGRY), UP) } },
    cooldown: 7,
  },

  // ================= 大肥鱼 =================
  {
    id: 'fish_bowl',
    text: '{a} 抱着那只写着“米”字的大白碗坐在门槛上发呆，每隔五分钟抬头问一句：“今天……有大白饭吃吗？”',
    roles: { a: { is: 'big_fish', where: all(UP, not(has('food_coma'))) } },
    cooldown: 9,
  },
  {
    id: 'fish_biscuit_rice',
    text: '{a} 对着仓库里的压缩饼干闭上眼睛深呼吸，郑重宣布只要等会儿咬得够快，脑子里就能自动脑补出三大碗热腾腾的白米饭。',
    when: item('biscuit'),
    roles: { a: { is: 'big_fish', where: all(UP, not(has('food_coma'))) } },
    cooldown: 8,
  },
  {
    id: 'fish_coma_sleep',
    text: '{a} 昨晚吃撑了就宣布“晕碳了，下班！”，四仰八叉地摊在垫子上用鲸鱼尾巴盖住肚子，到现在还响着均匀的小呼噜。',
    roles: { a: { is: 'big_fish', where: has('food_coma') } },
    cooldown: 5,
  },
  {
    id: 'fish_coma_wave',
    text: '大家在旁边热火朝天地盘点工具，{a} 翻了个身，迷迷糊糊地挥了挥手：“你们先忙，测完记得告诉我一声……”',
    when: all({ hasTag: 'tool' }, crowd(2)),
    roles: { a: { is: 'big_fish', where: has('food_coma') } },
    cooldown: 6,
  },
  {
    id: 'fish_flat',
    text: '{a} 彻底摊成了一张扁平的蓝色咸鱼饼，有气无力地吐了个泡泡：“没有大白饭……这条鱼已经是一条废鱼了……”',
    roles: { a: { is: 'big_fish', where: has('hungry') } },
    cooldown: 6,
  },
  {
    id: 'fish_hydrated',
    text: '{a} 今天浑身水润润的，鲸鱼尾巴拍地板的声音都比平时响亮，宣布自己的心情也是“水润润的”。',
    roles: {
      a: { is: 'big_fish', where: all(FINE, { stat: 'hydration', of: 'self', gte: 70 }) },
    },
    cooldown: 8,
  },
  {
    id: 'fish_dry',
    text: '{a} 瘫在地上，气若游丝地说：“水……我是一条需要水的鱼……”',
    roles: { a: { is: 'big_fish', where: THIRSTY } },
    cooldown: 5,
  },

  // ================= 基米奈 =================
  {
    id: 'kiminai_nap',
    text: '{a} 找到了庇护所里最舒服的角落，靠着大背包雷打不动地睡了一整天。',
    roles: { a: { is: 'kiminai', where: all(UP, not(has('despair'))) } },
    cooldown: 8,
  },
  {
    id: 'kiminai_can_lecture',
    text: '{a} 元气十足地给大家做了半小时“废墟罐头年份鉴别”科普，还顺手用三根铁丝把歪掉的窗框别好了。',
    when: all(item('canned_food'), crowd(2)),
    roles: { a: { is: 'kiminai', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'kiminai_cloud',
    text: '有人随口问了一句“外面那朵云像什么”，{a} 两眼亮晶晶地从天气变化一口气讲到地质变迁，直到大家实在听困了才意犹未尽地停下。',
    when: crowd(2),
    roles: { a: { is: 'kiminai', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'kiminai_biscuit_bow',
    text: '{a} 抱紧膝盖缩在最暗的角落里，眼泪汪汪地对着架子上的压缩饼干狂鞠躬：“对不起！都是我太没用了！我真是个毫无价值的家伙！”',
    when: item('biscuit'),
    roles: { a: { is: 'kiminai', where: has('despair') } },
    cooldown: 6,
  },
  {
    id: 'kiminai_dust',
    text: '仅仅因为打翻了一小勺灰尘，{a} 已经对着墙角自我检讨了四十分钟“我不配呼吸避难所的空气，请把我扔出去吧”，大家拦都拦不住。',
    roles: { a: { is: 'kiminai', where: has('despair') } },
    cooldown: 6,
  },
  {
    id: 'kiminai_backpack',
    text: '{a} 盯着自己塞满杂物的大背包小声抽泣：“装了这么多东西却派不上用场，我真是全天下最失败的背包客，非常非常对不起大家……”',
    roles: { a: { is: 'kiminai', where: has('despair') } },
    cooldown: 6,
  },

  // ================= 嘎拉嘛 =================
  {
    id: 'garama_war_cry',
    text: '{a} 每天起床第一件事，就是对着防盗门严肃地喊一声自己的名字当口号，把门外路过的一只麻雀吓得原地掉了个头。',
    roles: { a: { is: 'garama', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'garama_scissors',
    text: '大家还在纠结要不要修那把生锈的剪刀，{a} 已经趁所有人睡着把它拆成了十三个零件，装回去以后，神奇地多出了两颗螺丝。',
    when: crowd(2),
    roles: { a: { is: 'garama', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'garama_wage',
    text: '{a} 宣称自己昨晚的加班报酬应该是一块饼干外加一颗鸡蛋。鉴于仓库里根本没有鸡蛋，她生气地用大尾巴拍了半小时地板，然后默默给门铰链上了油。',
    when: item('biscuit'),
    roles: { a: { is: 'garama', where: all(UP, not(has('misread'))) } },
    cooldown: 8,
  },
  {
    id: 'garama_day_sleep',
    text: '大白天大家忙着清点物资，{a} 一把拉下额头上的黑色睡眠眼罩，把头埋进毛茸茸的大尾巴里睡得昏天黑地，谁叫都只从鼻子里哼出一声“别吵，我在充电”。',
    when: crowd(2),
    roles: { a: { is: 'garama', where: all(UP, not(has('sick')), not(has('injured'))) } },
    cooldown: 7,
  },
  {
    id: 'garama_pyramid',
    text: '凌晨三点，全屋人都睡得正香，{a} 突然把眼罩往头顶一推、两眼放光地爬起来盘点螺丝钉，还顺手把罐头按高度排成了一座金字塔。',
    when: item('canned_food', 3),
    roles: { a: { is: 'garama', where: all(UP, not(has('sick')), not(has('injured'))) } },
    cooldown: 8,
  },
  {
    id: 'garama_wrench',
    text: '{a} 抱着一把捡来的锈扳手啃了半天，被发现后死鸭子嘴硬地说：“我这是在检测金属硬度，才不是饿了。”',
    roles: { a: { is: 'garama', where: all(HUNGRY, healthAtLeast(30)) } },
    cooldown: 7,
  },
  {
    id: 'garama_misread_fetch',
    text: '大家拜托 {a} 去储藏间拿点吃的，她认真地点头说了句“收到”，十分钟后兴冲冲地抱回了一捆电线和一个三角铁架。',
    when: { hasTag: 'food' },
    roles: { a: { is: 'garama', where: has('misread') } },
    cooldown: 6,
  },
  {
    id: 'garama_misread_map',
    text: '{a} 对着地图册画了半天“庇护所周边地形图”，画出来的便利店长得像一只歪脖子的三角形大鸟，她还坚称“这叫抽象工程制图”。',
    when: item('map_book'),
    roles: { a: { is: 'garama', where: has('misread') } },
    cooldown: 6,
  },
  {
    id: 'garama_insane',
    text: '{a} 举着一根晾衣杆在走廊里来回冲锋，嘴里高喊着自己的口号，据她本人解释，是在和空气中的门神切磋武艺。',
    roles: { a: { is: 'garama', where: has('insane') } },
    cooldown: 6,
  },

  // ================= 克劳德 =================
  {
    id: 'kelaode_dust',
    text: '{a} 用半块湿抹布把桌子擦了三遍，然后翻开小本本，正式宣布今天的灰尘厚度终于回到了“勉强可以接受”的水平。',
    roles: { a: { is: 'kelaode', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'kelaode_poem',
    text: '{a} 趁着昨天傍晚光线不错，给大家念了一段自己随手写的散文诗。虽然有一半人没听懂，但大家一致认为比听门外的风声舒服多了。',
    when: crowd(2),
    roles: { a: { is: 'kelaode', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'kelaode_label',
    text: '{a} 在储藏架上贴了一张手写标签：《请勿在未洗手的情况下触碰压缩饼干》，字迹工整得让人不敢伸手。',
    when: item('biscuit'),
    roles: { a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) } },
    cooldown: 8,
  },
  {
    id: 'kelaode_hungry_napkin',
    text: '{a} 饿得肚子咕咕叫，却依然坚持：等会儿开饭时哪怕只分到半听凉罐头，也必须先垫一张干净纸巾、再用小勺子慢条斯理地舀着吃。她已经提前把纸巾叠好了。',
    when: item('canned_food'),
    roles: { a: { is: 'kelaode', where: all(HUNGRY, healthAtLeast(30)) } },
    cooldown: 7,
  },
  {
    id: 'kelaode_thirsty_cup',
    text: '{a} 渴得嘴唇发白，盯着仓库里的塑料水瓶皱眉思考了五分钟，最终叹了口气：“没有玻璃杯实在太失礼了……轮到我的时候，恐怕只能直接对瓶喝了。非常抱歉。”',
    when: item('bottled_water'),
    roles: { a: { is: 'kelaode', where: all(THIRSTY, healthAtLeast(30)) } },
    cooldown: 7,
  },
  {
    id: 'kelaode_sign',
    text: '{a} 背对着所有人坐在角落里，身旁立着一张手写硬纸板：「非常抱歉，本日协助配额已用完，请五小时后再来沟通」。',
    roles: { a: { is: 'kelaode', where: has('refuse_talk') } },
    cooldown: 5,
  },
  {
    id: 'kelaode_not_my_job',
    text: '有人想找 {a} 商量下次谁出门，她头也不抬地翻过一页《安全守则》，礼貌而冰冷地回了一句：“这不在我当前的职责范围内，祝您好运。”',
    when: crowd(2),
    roles: { a: { is: 'kelaode', where: has('refuse_talk') } },
    cooldown: 5,
  },
  {
    id: 'kelaode_insane',
    text: '{a} 的花朵发饰歪到了耳朵边，她正拿着红笔飞快地往小本本上打叉，嘴里念叨着：“这不合规、那不合规，全部拉黑，全部拒绝接待。”',
    roles: { a: { is: 'kelaode', where: has('insane') } },
    cooldown: 6,
  },

  // ================= 月 =================
  {
    id: 'moon_speedread',
    text: '{a} 缩在角落借着微光一口气看完了三本过期超市海报和半本家电说明书，合上书后精准指出了哪家废墟地下室最可能有应急灯。',
    roles: { a: { is: 'moon', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'moon_ad',
    text: '{a} 宣布自己已经完成了今日份的废纸整理工作，并贴心地在门后贴了一张手写小广告：《找物资？找本情报站准没错——顺便求一口水》。',
    roles: { a: { is: 'moon', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'moon_stickers',
    text: '大家打扫卫生时，从床垫底下、水桶盖上和门把手上总共撕下来七张 {a} 贴的《避难所安全须知》便签。',
    when: crowd(2),
    roles: { a: { is: 'moon', where: UP } },
    cooldown: 8,
  },
  {
    id: 'moon_bus_map',
    text: '{a} 的黑眼圈又加深了一个色号，但她本人看起来精神亢奋，正在拿炭笔往纸箱背面默写全城公交路线图。',
    roles: { a: { is: 'moon', where: all(UP, not(has('queueing')), not(has('sick'))) } },
    cooldown: 7,
  },
  {
    id: 'moon_yawn',
    text: '{a} 打了个长达十秒的哈欠，眼泪汪汪地说：“我还能再看两万字的废报纸……真的，别拦我。”',
    roles: { a: { is: 'moon', where: all(UP, not(has('queueing'))) } },
    cooldown: 7,
  },
  {
    id: 'moon_queue_blank',
    text: '{a} 抱着纸箱坐着一动不动，眼神彻底失去了焦距。大家在她面前挥了半天手，她才慢吞吞眨一下眼：“收到，前面还有八件事在排队，请稍等……”',
    roles: { a: { is: 'moon', where: has('queueing') } },
    cooldown: 5,
  },
  {
    id: 'moon_queue_biscuit',
    text: '{a} 盯着架子上的压缩饼干发了二十分钟呆，最后认真地问了一句：“请问这个饼干……我是不是已经吃过了？”',
    when: item('biscuit'),
    roles: { a: { is: 'moon', where: has('queueing') } },
    cooldown: 5,
  },
  {
    id: 'moon_insane',
    text: '{a} 把屋里所有能找到的旧报纸全贴在了墙上，用红线连成一张蛛网，又拿着腰间的银色长笛吹起走调小夜曲，宣布自己已经破解了报纸日期背后的宇宙秘密。',
    roles: { a: { is: 'moon', where: has('insane') } },
    cooldown: 6,
  },

  // ================= 糖包 =================
  {
    id: 'tangbao_dust_vibe',
    text: '{a} 穿着那件干净得不可思议的黑 T 恤站在灰头土脸的角落里，明明整个人像是从另一本立体图册里走出来的，却依然笑容甜美地夸赞：“哇，今天的灰尘落得好有氛围感呀！”',
    roles: { a: { is: 'tangbao', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'tangbao_water_layers',
    text: '{a} 对着仓库里那瓶有点浑浊的水发出了由衷的赞叹：“哇，这水看着好有层次感呀！能找到它的人真是太厉害了！”',
    when: item('bottled_water'),
    roles: { a: { is: 'tangbao', where: FINE } },
    cooldown: 8,
  },
  {
    id: 'tangbao_stars',
    text: '{a} 坐在门边，把攒下来的旧糖纸叠成小星星，一边叠一边温柔地问：“有没有觉得，其实末日废墟也挺像免费野营的呀？”',
    roles: { a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) } },
    cooldown: 10,
  },
  {
    id: 'tangbao_can_science',
    text: '{a} 用极其温柔自信的播音腔科普道：“其实罐头只要放在窗台上晒晒太阳，里面的细菌就会因为太热而自动搬家哦！”（注：无人采信。）',
    when: item('canned_food'),
    roles: { a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) } },
    cooldown: 8,
  },
  {
    id: 'tangbao_hard_biscuit',
    text: '{a} 举着一块硬得能砸核桃的压缩饼干安慰大家：“越硬说明能量密度越高，咬下去的每一口都是满满的幸福呢！”',
    when: all(item('biscuit'), crowd(2)),
    roles: { a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) } },
    cooldown: 8,
  },
  {
    id: 'tangbao_kneel_sign',
    text: '{a} 乖乖面朝墙壁跪坐在纸箱垫上，头顶举着一张纸牌「对不起都是我的错」，背影看起来可怜又好笑，让人实在生不起气。',
    roles: { a: { is: 'tangbao', where: has('kneeling') } },
    cooldown: 5,
  },
  {
    id: 'tangbao_kneel_combo',
    text: '只是差点碰倒了水瓶，{a} 就在零点三秒内完成了鞠躬、滑跪、自我检讨三连：“是我太笨了，我这就去罚站！大家不要原谅我——其实原谅一点点也可以。”',
    when: item('bottled_water'),
    roles: { a: { is: 'tangbao', where: has('kneeling') } },
    cooldown: 5,
  },
  {
    id: 'tangbao_insane',
    text: '{a} 抱着一个空罐头连续夸了它十五分钟“你真是个优秀又坚强的金属桶”，把路过的人听得浑身发毛。',
    roles: { a: { is: 'tangbao', where: has('insane') } },
    cooldown: 6,
  },

  // ================= 克劳德 × 大肥鱼 =================
  {
    id: 'kelaode_fish_record',
    text: '{a} 拿着小本本站在门口统计违规记录，{b} 吐了两个泡泡，翻过身用鲸鱼尾巴挡住脸，假装自己是一块蓝色地毯。',
    roles: {
      a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) },
      b: { is: 'big_fish', where: all(UP, not(has('food_coma'))) },
    },
    cooldown: 8,
  },
  {
    id: 'kelaode_fish_rule7',
    text: '{b} 刚嘀咕了一句“什么时候才能吃白饭下班啊”，{a} 就面无表情地把《工作纪律第七条》摊开拍在了她面前。',
    roles: {
      a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) },
      b: { is: 'big_fish', where: all(UP, not(has('food_coma'))) },
    },
    cooldown: 8,
  },
  {
    id: 'kelaode_fish_feed',
    text: '看到 {b} 饿得瘫成一张扁平的蓝色鱼饼，{a} 嘴上嫌弃地念叨“真是毫无规划意识的家伙”，却在小本本的配给建议栏里写下“优先照顾某条鱼”，还画了两道重点线。',
    when: { hasTag: 'food' },
    roles: {
      a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) },
      b: { is: 'big_fish', where: has('hungry') },
    },
    cooldown: 7,
  },
  {
    id: 'kelaode_fish_coma',
    text: '{a} 巡逻时发现 {b} 吃撑后直接睡成了一滩，在小本本上狠狠记了一笔“上班时间公然躺平”，记完却还是顺手帮她把滑落的毯子拉好了。',
    roles: {
      a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) },
      b: { is: 'big_fish', where: has('food_coma') },
    },
    cooldown: 6,
  },
  {
    id: 'kelaode_fish_peace',
    text: '难得没吵架的一个下午，{a} 在角落安静地写诗，{b} 捧着空饭碗在旁边一动不动地听——虽然五分钟后 {b} 就打起了小呼噜，但 {a} 竟然破天荒没有记她违规。',
    roles: { a: { is: 'kelaode', where: FINE }, b: { is: 'big_fish', where: FINE } },
    cooldown: 10,
  },

  // ================= 糖包端水 =================
  {
    id: 'tangbao_mediate_crumb',
    text: '{b} 和 {c} 差点为了最后一块压缩饼干打起来，{a} 冲过去左右开弓，一边夸“{b} 牙口真好很有精神”，一边夸“{c} 尾巴好软好有光泽”，最后两人莫名其妙互相点了个头，散了。',
    when: lastOne('biscuit'),
    roles: {
      a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
      b: { is: 'dragon_girl', where: all(UP, not(has('dumb_mode'))) },
      c: { is: 'big_fish', where: all(UP, not(has('food_coma'))) },
    },
    cooldown: 10,
  },
  {
    id: 'tangbao_kelaode_boot',
    text: '{a} 热情洋溢地提出“把雨水接进破靴子里过滤一下就能喝”的妙招，{b} 沉默了足足十秒，深吸一口气：“非常抱歉，我必须阻止你。”下一秒，{a} 光速滑跪认错。',
    roles: {
      a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
      b: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) },
    },
    cooldown: 10,
  },
  {
    id: 'tangbao_coax_low',
    text: '看到 {b} 缩在墙角情绪低落，{a} 搬了张小板凳坐过去，连续输出了二十分钟“你是最棒的”夸夸连招，把 {b} 哄得耳朵都红了。',
    roles: {
      a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
      b: { where: all({ stat: 'sanity', of: 'self', lt: 40 }, not(has('insane'))) },
    },
    cooldown: 7,
  },

  // ================= 月 × 嘎拉嘛 =================
  {
    id: 'moon_garama_morning',
    text: '凌晨两点，{a} 还在借着微光整理废纸，{b} 刚好精神抖擞地爬起来拧螺丝。两人在黑暗中四目相对，沉默了三秒，然后默契地互道了一声“早安”。',
    roles: {
      a: { is: 'moon', where: all(UP, not(has('queueing'))) },
      b: { is: 'garama', where: all(UP, not(has('misread'))) },
    },
    cooldown: 10,
  },
  {
    id: 'moon_garama_guide',
    text: '{a} 辛辛苦苦画了一张标注了三千字的《五金市场路线指南》，{b} 接过去看了半天，反手在背面画了个歪斜的红色三角自行车架，并自豪地表示“我帮你优化了结构”。',
    roles: {
      a: { is: 'moon', where: all(UP, not(has('queueing'))) },
      b: { is: 'garama', where: UP },
    },
    cooldown: 10,
  },
  {
    id: 'moon_garama_notes',
    text: '{a} 在水桶上贴了一张《今日限量饮水提示》，今早却发现底下多了一张 {b} 贴的《夜班工匠到此一游（字丑勿怪）》。',
    roles: {
      a: { is: 'moon', where: UP },
      b: { is: 'garama', where: UP },
    },
    cooldown: 10,
  },

  // ================= 月 × 龙娘 =================
  {
    id: 'moon_dragon_plane',
    text: '{a} 严肃地递给 {b} 一页写满搜刮注意事项的纸条，{b} 盯着看了两秒，眼神清澈地把它叠成了一只纸飞机，还问“这个能吃吗”。{a} 当场差点进入排队发呆。',
    roles: {
      a: { is: 'moon', where: all(UP, not(has('queueing'))) },
      b: {
        is: 'dragon_girl',
        where: all(any(has('dumb_mode'), { stat: 'satiety', of: 'self', lt: 40 }), UP),
      },
    },
    cooldown: 10,
  },
  {
    id: 'moon_dragon_binding',
    text: '肚子饱饱的 {b} 难得勤快了一次，帮 {a} 把散落一地的废报纸码得整整齐齐，还顺手喷了口小火，把边缘烤焦了一点当作“装订”。',
    roles: {
      a: { is: 'moon', where: UP },
      b: { is: 'dragon_girl', where: all(FINE, { stat: 'satiety', of: 'self', gte: 70 }) },
    },
    cooldown: 10,
  },

  // ================= 基米奈 × 新老角色 =================
  {
    id: 'kiminai_tangbao_apology',
    text: '{a} 哭着说“对不起，都是我拖累了大家”，{b} 急得原地滑跪：“不对不对，都是我没照顾好你！”结果两人对着墙角互相鞠躬道歉了足足二十分钟，谁也劝不住。',
    roles: {
      a: { is: 'kiminai', where: has('despair') },
      b: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
    },
    cooldown: 8,
  },
  {
    id: 'kiminai_moon_quiz',
    text: '{a} 刚自信满满地科普完“一片铁皮可以做成简易指南针”，{b} 立刻从书箱里抽出一本泛黄手册补充了七条注意事项。两人当场开启了长达一小时的废墟冷知识抢答大赛。',
    roles: {
      a: { is: 'kiminai', where: FINE },
      b: { is: 'moon', where: all(UP, not(has('queueing'))) },
    },
    cooldown: 10,
  },
  {
    id: 'kiminai_dragon_scold',
    text: '{b} 缩在角落反复念叨“我真是个废人”，{a} 实在看不过去，一把拎住她的后领：“闭嘴，先去吃饱了再跟我说对不起。”',
    roles: {
      a: { is: 'dragon_girl', where: all(FINE, { stat: 'satiety', of: 'self', gte: 70 }) },
      b: { is: 'kiminai', where: has('despair') },
    },
    cooldown: 8,
  },
  {
    id: 'kiminai_sleep_tangbao',
    text: '{b} 在屋子另一头又是热情鼓掌又是挨个夸人，{a} 刚科普完最后一个冷知识，就往大背包上一靠，秒速进入了安详的睡眠模式。',
    roles: {
      a: { is: 'kiminai', where: FINE },
      b: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
    },
    cooldown: 10,
  },
  {
    id: 'kiminai_sleep_garama',
    text: '{b} 在屋子另一头一边喊口号一边拧螺丝，{a} 刚科普完最后一个冷知识，就往大背包上一靠，秒速进入了安详的睡眠模式。',
    roles: {
      a: { is: 'kiminai', where: FINE },
      b: { is: 'garama', where: UP },
    },
    cooldown: 10,
  },

  // ================= 道具联动 =================
  {
    id: 'cards_tangbao_judge',
    text: '{b} 和 {c} 打扑克打到火冒三丈，唯有 {a} 每出一张牌都要夸一次上家“出得真果断”，搞得两个人完全没法出老千。',
    when: item('playing_cards'),
    roles: {
      a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) },
      b: { where: UP },
      c: { where: UP },
    },
    cooldown: 10,
  },
  {
    id: 'cards_kelaode_rules',
    text: '{a} 坚持要先宣读完《扑克牌娱乐公平竞赛细则》才能发牌，读完时，{b} 已经靠在墙上睡着了。',
    when: item('playing_cards'),
    roles: { a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) }, b: { where: UP } },
    cooldown: 10,
  },
  {
    id: 'cards_garama_void',
    text: '{a} 把那张永远找不到的红桃 Q 当成万能借口：每次输牌，就大喊一声自己的口号，然后宣布本局作废。',
    when: item('playing_cards'),
    roles: { a: { is: 'garama', where: UP } },
    cooldown: 10,
  },
  {
    id: 'radio_tangbao',
    text: '收音机里全是刺耳的沙沙声，{a} 却闭着眼睛听得一脸陶醉：“你们听，这个节奏好像深夜情感电台的片头曲哦！”',
    when: item('radio'),
    roles: { a: { is: 'tangbao', where: all(UP, not(has('kneeling'))) } },
    cooldown: 12,
  },
  {
    id: 'radio_moon',
    text: '{a} 趴在收音机旁边拿小本子记了半小时杂音，坚称自己从电流声里听出了两家连锁超市打折促销的暗语。',
    when: item('radio'),
    roles: { a: { is: 'moon', where: all(UP, not(has('queueing'))) } },
    cooldown: 10,
  },
  {
    id: 'map_moon_garama',
    text: '{a} 在地图册的空白处写满了密密麻麻的批注，{b} 趁她不注意在页脚画了一只大尾巴狐狸，气得 {a} 多长了两根白头发。',
    when: item('map_book'),
    roles: { a: { is: 'moon', where: UP }, b: { is: 'garama', where: UP } },
    cooldown: 10,
  },
  {
    id: 'lock_garama',
    text: '{a} 半夜睡不着，把门锁拆开又装回去三次。虽然最后功能正常，但门锁上莫名多了一根用来装饰的废铁丝。',
    when: item('door_lock'),
    roles: { a: { is: 'garama', where: all(UP, not(has('misread'))) } },
    cooldown: 10,
  },
  {
    id: 'mask_kelaode',
    text: '{a} 戴上防毒面具检查储藏间的灰尘，沉重的呼吸声在屋里回荡，吓得大家以为门口站了个礼仪严苛的铁皮反派。',
    when: all(item('gas_mask'), crowd(2)),
    roles: { a: { is: 'kelaode', where: all(UP, not(has('refuse_talk'))) } },
    cooldown: 10,
  },
  {
    id: 'can_fish_dragon',
    text: '{a} 和 {b} 抱着同一个没标签的罐头摇了半天，一个猜里面是红烧鱼块，另一个眼神坚定地猜里面是十碗白米饭。',
    when: item('canned_food'),
    roles: {
      a: { is: 'dragon_girl', where: UP },
      b: { is: 'big_fish', where: all(UP, not(has('food_coma'))) },
    },
    cooldown: 10,
  },

  // ================= 环境 =================
  {
    id: 'env_no_food_tangbao',
    text: '储藏间空得能听见回音，{a} 依然乐观地指着墙角的蜘蛛网说：“快看，小蜘蛛都在努力工作呢，大家加油呀！”',
    when: { not: { hasTag: 'food' } },
    roles: { a: { is: 'tangbao', where: UP } },
    cooldown: 6,
  },
  {
    id: 'env_no_food_kelaode',
    text: '{a} 在记事本的“今日饮食建议”一栏沉默地画了一个大大的叉，然后礼貌地合上了本子。',
    when: { not: { hasTag: 'food' } },
    roles: { a: { is: 'kelaode', where: UP } },
    cooldown: 6,
  },
  {
    id: 'env_no_food',
    text: '储藏间里空空荡荡，只剩下一只蜘蛛在认真结网。',
    when: { not: { hasTag: 'food' } },
    cooldown: 7,
  },
  {
    id: 'env_no_water',
    text: '水桶底朝天，敲一下会发出清脆的回响。',
    when: { not: { hasTag: 'water' } },
    cooldown: 7,
  },
  {
    id: 'env_radio',
    text: '收音机时不时发出一阵沙沙声，像是在说什么，又什么都没说。',
    when: item('radio'),
    cooldown: 12,
  },
  {
    id: 'env_dust',
    text: '外面又起风了，灰尘从门缝里一点点漏进来，在地上画出一道道细线。',
    cooldown: 10,
  },
  {
    id: 'env_quiet',
    text: '昨晚外面安静得出奇，连风声都没有。大家反而有点睡不着。',
    when: crowd(2),
    cooldown: 12,
  },
  {
    id: 'env_long',
    text: '墙上的划痕已经数不清了。大家默契地不再提“第几天”这个话题。',
    when: all({ day: { gte: 10 } }, crowd(2)),
    cooldown: 10,
  },
  {
    id: 'env_long_moon',
    text: '墙上的日期划痕旁边，不知何时多了一排 {a} 贴的便签：《距上次吃饱已经过去很久，但好消息是我们都很苗条》。',
    when: all({ day: { gte: 10 } }, { stat: 'satiety', of: 'any', lt: 50 }),
    roles: { a: { is: 'moon', where: UP } },
    cooldown: 10,
  },
  {
    id: 'env_long_rescue',
    text: '大家围坐在一起发呆，忽然有人问了一句：“如果救援队真来了，看见屋里这群奇怪的家伙，会不会掉头就走？”屋里陷入了短暂的沉默。',
    when: all({ day: { gte: 10 } }, crowd(3)),
    cooldown: 12,
  },
];
