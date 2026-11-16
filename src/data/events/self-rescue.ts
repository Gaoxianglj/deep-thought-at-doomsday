import type { EventDef } from '../../engine/schema';

/**
 * 自救线（docs/DESIGN.md 12.6）：四个设施。
 * 安装事件由地图规则在"持有部件且设施未装"的清晨排队；部件专属事件由地点 specials 触发（self = 外出者）。
 */
export const selfRescueEvents = [
  // ---------- 安装 ----------
  {
    id: 'install_generator',
    title: '修好发电机',
    text: '仓库角落里的旧发电机一直是个摆设。现在缺失的核心零件终于到手，是时候让它重新转起来了。',
    tags: ['build'],
    weight: 0,
    choices: [
      {
        id: 'install',
        text: '动手安装',
        outcomes: [
          {
            text: '拧螺丝、接电线、祈祷……发电机咳嗽了两声，终于稳定地嗡嗡响了起来。头顶的灯泡亮了。',
            effects: [
              { item: 'generator_part', add: -1 },
              { setFlag: 'gen_installed', value: true },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
          },
        ],
      },
      {
        id: 'garama',
        text: '交给嘎拉嘛',
        requires: { inShelter: 'garama' },
        requiresHint: '嘎拉嘛不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '嘎拉嘛把眼罩往头顶一推，趴在发电机底下鼓捣了一下午，爬出来时满脸黑油：“嘎拉嘛！”发电机的声音比说明书上写的还要平稳。',
            effects: [
              { item: 'generator_part', add: -1 },
              { setFlag: 'gen_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'install_filter',
    title: '装上滤水芯',
    text: '庇护所里有一台破旧的净水桶，只差一根滤水芯。现在它就躺在手边。',
    tags: ['build'],
    weight: 0,
    choices: [
      {
        id: 'install',
        text: '装上滤水芯',
        outcomes: [
          {
            text: '浑浊的水流过滤芯，从另一头流出来的竟然是清亮的。守在净水桶旁边，忍不住欢呼了一声。',
            effects: [
              { item: 'water_filter', add: -1 },
              { setFlag: 'filter_installed', value: true },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
          },
        ],
      },
      {
        id: 'garama',
        text: '交给嘎拉嘛',
        requires: { inShelter: 'garama' },
        requiresHint: '嘎拉嘛不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '嘎拉嘛把净水桶整个拆开又装了回去，顺手用剩下的零件做了个漏斗。出水快了一倍。',
            effects: [
              { item: 'water_filter', add: -1 },
              { setFlag: 'filter_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'install_seeds',
    title: '种下种子',
    text: '角落里有个空的种植箱，旁边的种子包像是在招手：“种我，种我。”',
    tags: ['build'],
    weight: 0,
    choices: [
      {
        id: 'plant',
        text: '把种子种下去',
        outcomes: [
          {
            text: '浇了点水，认真地盖上土。几天后，也许会有惊喜。',
            effects: [
              { item: 'seed_pack', add: -1 },
              { setFlag: 'seeds_installed', value: true },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
          },
        ],
      },
      {
        id: 'garama',
        text: '交给嘎拉嘛',
        requires: { inShelter: 'garama' },
        requiresHint: '嘎拉嘛不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '嘎拉嘛用废水管搭了一套滴灌，还给种植箱装了一盏小灯。围着它看了半天，好像能看见种子在发芽。',
            effects: [
              { item: 'seed_pack', add: -1 },
              { setFlag: 'seeds_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'install_vent',
    title: '换上通风滤网',
    text: '庇护所的通风机一直在咳灰，叶片转得有气无力。新的通风滤网就在手边。',
    tags: ['build'],
    weight: 0,
    choices: [
      {
        id: 'install',
        text: '换上滤网',
        outcomes: [
          {
            text: '旧滤网一拆下来，灰簌簌地落了一地。新滤网装上后，屋里的空气第一次闻起来不像地下室。',
            effects: [
              { item: 'vent_filter', add: -1 },
              { setFlag: 'vent_installed', value: true },
              { stat: 'sanity', of: 'all', add: 5 },
            ],
          },
        ],
      },
      {
        id: 'garama',
        text: '交给嘎拉嘛',
        requires: { inShelter: 'garama' },
        requiresHint: '嘎拉嘛不在庇护所',
        hideIfLocked: true,
        outcomes: [
          {
            text: '嘎拉嘛顺手给通风机的轴承上了油，还把呼呼作响的叶片校正了角度。屋里安静了不少。',
            effects: [
              { item: 'vent_filter', add: -1 },
              { setFlag: 'vent_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
    ],
  },

  // ---------- 部件专属事件（带对钥匙道具去对的地方） ----------
  {
    id: 'subway_shaft',
    title: '通风竖井',
    text: '{self} 在地铁站尽头找到了一口通风竖井，格栅已经锈穿了。往下看，几米深的地方卡着一整排工业滤网。',
    weight: 0,
    choices: [
      {
        id: 'descend',
        text: '把绳子系牢，下去拿',
        outcomes: [
          {
            weight: 2,
            text: '{self} 顺着绳子滑下去，拆下一张最完整的滤网，又一点点爬了上来。手心磨破了，但东西到手了。',
            effects: [{ item: 'vent_filter', add: 1 }],
          },
          {
            weight: 1,
            text: '爬到一半，绳子在锈边上磨断了！{self} 摔在竖井底部，好在抱着滤网摸到了检修梯。绳子是没法要了。',
            effects: [
              { item: 'vent_filter', add: 1 },
              { item: 'rope', add: -1 },
              { stat: 'health', of: 'self', add: -10 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'substation_room',
    title: '配电室',
    text: '{self} 打着手电钻进变电站的配电室。光束扫过一排排开关柜，最里面的铁架上贴着一张标签：“备用发电机组·核心件”。',
    weight: 0,
    choices: [
      {
        id: 'take',
        text: '小心地取下来',
        outcomes: [
          {
            weight: 3,
            text: '{self} 避开地上的积水和断线，把那块沉甸甸的零件抱了出来。',
            effects: [{ item: 'generator_part', add: 1 }],
          },
          {
            weight: 1,
            text: '撬零件的时候一根断线打出了火花，{self} 被电得一哆嗦，手电筒也摔坏了。好在零件抱住了。',
            effects: [
              { item: 'generator_part', add: 1 },
              { item: 'flashlight', add: -1 },
              { stat: 'health', of: 'self', add: -8 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'filter_workshop',
    title: '过滤车间',
    text: '{self} 戴上防毒面具，推开画着骷髅头的门。车间里弥漫着黄绿色的雾，一排排过滤罐上还插着没用过的滤水芯。',
    weight: 0,
    choices: [
      {
        id: 'take',
        text: '屏住呼吸冲进去',
        outcomes: [
          {
            weight: 3,
            text: '面具里全是自己的喘气声。{self} 拔下一根滤水芯，头也不回地跑了出来。',
            effects: [{ item: 'water_filter', add: 1 }],
          },
          {
            weight: 1,
            text: '滤水芯到手了，但防毒面具的滤罐也被腐蚀穿了，{self} 出门时呛得直咳嗽。面具只能扔了。',
            effects: [
              { item: 'water_filter', add: 1 },
              { item: 'gas_mask', add: -1 },
              { stat: 'health', of: 'self', add: -6 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'seedling_room',
    title: '育苗室',
    text: '{self} 循着嗡嗡声找到了育苗室——门口挂着一个篮球那么大的马蜂窝。透过玻璃，能看见架子上整整齐齐的种子包。',
    weight: 0,
    choices: [
      {
        id: 'spray',
        text: '对着蜂窝狂喷杀虫喷雾',
        outcomes: [
          {
            text: '一罐喷雾喷得干干净净，马蜂下雨一样掉了一地。{self} 踮着脚进去，抱走了一包种子。',
            effects: [
              { item: 'seed_pack', add: 1 },
              { item: 'bug_spray', add: -1 },
            ],
          },
        ],
      },
    ],
  },
] satisfies EventDef[];
