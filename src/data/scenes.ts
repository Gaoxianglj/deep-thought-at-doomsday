import type { SceneDef } from '../engine/schema';

/**
 * 庇护所场景：横屏舞台上各元素的摆放。坐标都是相对 16:9 场景画面的百分比（左上角为原点）。
 * 这些数字是对着背景图 public/art/backgrounds/<background>/normal.webp 标出来的，换背景图要重新标。
 */
export const scenes = [
  {
    id: 'city_ruins_shelter',
    map: 'city_ruins',
    background: 'city_ruins',
    // 脚底中心位置；前后错开一点更有层次。前两位站在桌前的空地上，不挡货架与舱门；
    // 第三位站在右侧地毯上（靠后、略小），避开左下角的日志条和右下角的按钮；第四位站在货架前
    spots: [
      { x: 47, y: 94, h: 44 },
      { x: 64, y: 90, h: 44 },
      { x: 85, y: 81, h: 41 },
      { x: 30, y: 96, h: 44 },
    ],
    // 左侧木架：自上而下第 1–4 层的搁板
    stockAreas: [
      { tag: 'medicine', x: 8, y: 19, w: 29, h: 9.5, max: 6 },
      { tag: 'food', x: 8, y: 30, w: 29, h: 10, max: 12 },
      { tag: 'water', x: 8, y: 41, w: 29, h: 10, max: 12 },
    ],
    props: {
      // 木架顶上
      generator_part: { x: 12, y: 17.5, w: 7 },
      water_filter: { x: 21, y: 17.5, w: 5 },
      seed_pack: { x: 29, y: 17.5, w: 5 },
      // 木架最下层
      map_book: { x: 12, y: 61.5, w: 6 },
      gas_mask: { x: 19.5, y: 61.5, w: 6 },
      flashlight: { x: 26.5, y: 61.5, w: 5 },
      crowbar: { x: 33.5, y: 61.5, w: 6.5 },
      // 桌面
      playing_cards: { x: 59, y: 45.5, w: 3.5 },
      radio: { x: 64.5, y: 45.5, w: 6.5 },
      // 舱门上
      door_lock: { x: 75.5, y: 45, w: 4 },
    },
    hotspots: {
      expedition: { x: 70.5, y: 17, w: 19, h: 47 },
      journal: { x: 46, y: 37, w: 10, h: 9, art: 'journal' },
    },
  },
] satisfies SceneDef[];
