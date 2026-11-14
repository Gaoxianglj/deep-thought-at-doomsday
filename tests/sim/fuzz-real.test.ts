import { describe, expect, it } from 'vitest';
import { buildContent } from '../../src/engine';
import { contentDB } from '../../src/data';
import { uiText } from '../../src/data/ui-text';
import { fuzzBot } from '../../src/sim/bots';
import { simulateMany } from '../../src/sim/simulate';

describe('正式内容 + fuzz', () => {
  const real = buildContent(contentDB);
  const ready = real.db.maps.length > 0 && real.db.characters.length > 0;

  it.skipIf(!ready)('引擎不抛异常、被拒绝时状态不变；所有错误码都有界面文案', () => {
    const s = simulateMany(real, {
      mapId: real.db.maps[0].id,
      difficultyId: real.db.difficulties[0].id,
      bot: fuzzBot,
      unlocked: real.db.characters.map((c) => c.id),
      runs: 120,
      maxDays: 60,
    });
    expect(s.failures).toEqual([]);
    const missing = Object.keys(s.rejectedCodes).filter((code) => !(code in uiText.errors));
    // 新增引擎错误码时必须在 src/data/ui-text.ts 的 errors 里补一行，否则界面会显示"操作无效（code）"
    expect(missing).toEqual([]);
  });
});
