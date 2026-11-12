import type { EventDef } from '../../engine/schema';

export const selfRescueEvents = [
  {
    id: 'install_generator',
    title: '发电机零件',
    text: '仓库角落里的旧发电机一直是个摆设。现在你们手里有了缺失的核心零件，要不要试着把它修好？',
    tags: ['build'],
    when: { all: [{ hasItem: 'generator_part' }, { not: { flag: 'gen_installed' } }] },
    weight: 2,
    cooldown: 3,
    choices: [
      {
        id: 'install',
        text: '动手安装',
        outcomes: [
          {
            text: '拧螺丝、接电线、祈祷……发电机咳嗽了两声，终于稳定地嗡嗡响了起来。',
            effects: [
              { item: 'generator_part', add: -1 },
              { setFlag: 'gen_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
      {
        id: 'later',
        text: '先放着，以后再说',
        outcomes: [{ text: '零件被小心地收了起来。' }],
      },
    ],
  },
  {
    id: 'install_filter',
    title: '滤水芯',
    text: '庇护所里有一台破旧的净水桶，只差一根滤水芯。要把它装上去吗？',
    tags: ['build'],
    when: { all: [{ hasItem: 'water_filter' }, { not: { flag: 'filter_installed' } }] },
    weight: 2,
    cooldown: 3,
    choices: [
      {
        id: 'install',
        text: '装上滤水芯',
        outcomes: [
          {
            text: '浑浊的水流过滤芯，从另一头流出来的竟然是清亮的。大家围着净水桶欢呼。',
            effects: [
              { item: 'water_filter', add: -1 },
              { setFlag: 'filter_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
      {
        id: 'later',
        text: '先留着',
        outcomes: [{ text: '滤水芯被放回了架子上。' }],
      },
    ],
  },
  {
    id: 'install_seeds',
    title: '种子包',
    text: '角落里有个空的种植箱，旁边的种子包在向你们招手：“种我，种我。”',
    tags: ['build'],
    when: { all: [{ hasItem: 'seed_pack' }, { not: { flag: 'seeds_installed' } }] },
    weight: 2,
    cooldown: 3,
    choices: [
      {
        id: 'plant',
        text: '把种子种下去',
        outcomes: [
          {
            text: '你们浇了点水，认真地盖上土。几天后，也许会有惊喜。',
            effects: [
              { item: 'seed_pack', add: -1 },
              { setFlag: 'seeds_installed', value: true },
              { stat: 'sanity', of: 'all', add: 8 },
            ],
          },
        ],
      },
      {
        id: 'later',
        text: '再等等',
        outcomes: [{ text: '种子包被放回了抽屉。' }],
      },
    ],
  },
] satisfies EventDef[];
