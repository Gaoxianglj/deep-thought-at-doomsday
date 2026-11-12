import { describe, expect, it } from 'vitest';
import {
  artCandidates,
  artPath,
  hashHue,
  placeholderColors,
  placeholderLabel,
} from '../../src/ui/art';

describe('art', () => {
  it('artPath 拼接 base / 类别 / id / 状态', () => {
    expect(artPath('characters', 'alpha', 'sick', '/deep-thought-at-doomsday/')).toBe(
      '/deep-thought-at-doomsday/art/characters/alpha/sick.png',
    );
  });

  it('候选顺序为 状态 → normal，并去重', () => {
    expect(artCandidates('items', 'can', 'broken', '/b/', new Set())).toEqual([
      '/b/art/items/can/broken.png',
      '/b/art/items/can/normal.png',
    ]);
    expect(artCandidates('items', 'can', 'normal', '/b/', new Set())).toEqual([
      '/b/art/items/can/normal.png',
    ]);
  });

  it('已知失败的 URL 被跳过', () => {
    const failed = new Set(['/b/art/characters/a/sick.png']);
    expect(artCandidates('characters', 'a', 'sick', '/b/', failed)).toEqual([
      '/b/art/characters/a/normal.png',
    ]);
    failed.add('/b/art/characters/a/normal.png');
    expect(artCandidates('characters', 'a', 'sick', '/b/', failed)).toEqual([]);
  });

  it('色相稳定且在 0–359 之间', () => {
    for (const id of ['alpha', 'beta', 'canned_food', '']) {
      const h = hashHue(id);
      expect(h).toBe(hashHue(id));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
    expect(hashHue('alpha')).not.toBe(hashHue('beta'));
    expect(placeholderColors('alpha').bg).toContain(`hsl(${hashHue('alpha')} `);
  });

  it('占位文字取名称前两个字符', () => {
    expect(placeholderLabel('阿尔法')).toBe('阿尔');
    expect(placeholderLabel(' x ')).toBe('x');
    expect(placeholderLabel('')).toBe('?');
  });
});
