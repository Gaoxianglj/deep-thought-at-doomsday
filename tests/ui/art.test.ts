import { describe, expect, it } from 'vitest';
import {
  artCandidates,
  artPath,
  cssUrl,
  hashHue,
  placeholderColors,
  placeholderLabel,
} from '../../src/ui/art';

describe('art', () => {
  it('artPath 拼接 base / 类别 / id / 状态，扩展名为 webp', () => {
    expect(artPath('characters', 'alpha', 'sick', '/deep-thought-at-doomsday/')).toBe(
      '/deep-thought-at-doomsday/art/characters/alpha/sick.webp',
    );
    expect(artPath('backgrounds', 'bunker', 'normal', '/b/')).toBe(
      '/b/art/backgrounds/bunker/normal.webp',
    );
  });

  it('候选顺序为 状态 → normal，并去重', () => {
    expect(artCandidates('items', 'can', 'broken', '/b/', new Set())).toEqual([
      '/b/art/items/can/broken.webp',
      '/b/art/items/can/normal.webp',
    ]);
    expect(artCandidates('items', 'can', 'normal', '/b/', new Set())).toEqual([
      '/b/art/items/can/normal.webp',
    ]);
  });

  it('已知失败的 URL 被跳过', () => {
    const failed = new Set(['/b/art/characters/a/sick.webp']);
    expect(artCandidates('characters', 'a', 'sick', '/b/', failed)).toEqual([
      '/b/art/characters/a/normal.webp',
    ]);
    failed.add('/b/art/characters/a/normal.webp');
    expect(artCandidates('characters', 'a', 'sick', '/b/', failed)).toEqual([]);
  });

  it('色相稳定且在 0–359 之间，占位图为奶油底 + 色相点缀', () => {
    for (const id of ['alpha', 'beta', 'canned_food', '']) {
      const h = hashHue(id);
      expect(h).toBe(hashHue(id));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
    expect(hashHue('alpha')).not.toBe(hashHue('beta'));
    expect(placeholderColors('alpha').accent).toContain(`hsl(${hashHue('alpha')} `);
    expect(placeholderColors('alpha').bg).toBe(placeholderColors('beta').bg);
  });

  it('占位文字取名称首字', () => {
    expect(placeholderLabel('阿尔法')).toBe('阿');
    expect(placeholderLabel(' x ')).toBe('x');
    expect(placeholderLabel('')).toBe('?');
  });

  it('cssUrl 生成安全的 url() 字面量', () => {
    expect(cssUrl('/b/art/backgrounds/x/normal.webp')).toBe(
      'url("/b/art/backgrounds/x/normal.webp")',
    );
    expect(cssUrl('/a"b')).toBe('url("/ab")');
  });
});
