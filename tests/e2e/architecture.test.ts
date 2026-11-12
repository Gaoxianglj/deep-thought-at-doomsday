import { describe, expect, it } from 'vitest';
import { contentDB } from '../../src/data';

/**
 * 用 vite 的 import.meta.glob 以原始文本读取源码（项目没有 @types/node，tsc 下不能用 node:fs）。
 * 键为相对本文件的路径，如 '../../src/engine/day.ts'。
 */
const engineFiles = import.meta.glob('../../src/engine/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const uiFiles = import.meta.glob('../../src/ui/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * 已确认的误报：expedition.ts 里的 'injured' 是引擎自己的外出结果枚举（safe/injured/lost），
 * 恰好与正式内容里的状态 id 同名，并非内容引用。
 */
const KNOWN_FALSE_POSITIVES = new Set(["src/engine/expedition.ts: 'injured'"]);

const shortName = (f: string) => f.replace('../../', '');

/** 正式内容里所有长度 ≥ 5 的 id（角色、道具、状态、地点、事件、结局、地图） */
function contentIds(): string[] {
  const lists = [
    contentDB.characters,
    contentDB.items,
    contentDB.statuses,
    contentDB.locations,
    contentDB.events,
    contentDB.endings,
    contentDB.maps,
  ];
  return [...new Set(lists.flatMap((l) => l.map((d) => d.id)).filter((id) => id.length >= 5))];
}

/** 去掉注释，避免注释里举例的 id 误报 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function quotedIdHits(files: Record<string, string>): string[] {
  const ids = contentIds();
  const hits: string[] = [];
  for (const [f, raw] of Object.entries(files)) {
    const src = stripComments(raw);
    for (const id of ids) {
      if (new RegExp(`(['"\`])${id}\\1`).test(src)) hits.push(`${shortName(f)}: '${id}'`);
    }
  }
  return hits.filter((h) => !KNOWN_FALSE_POSITIVES.has(h));
}

describe('架构约束', () => {
  it('确实读到了内容 id 与源文件', () => {
    expect(contentIds().length).toBeGreaterThan(10);
    expect(Object.keys(engineFiles).length).toBeGreaterThan(5);
    expect(Object.keys(uiFiles).length).toBeGreaterThan(3);
  });

  it('src/engine 不含内容 id 字符串', () => {
    expect(quotedIdHits(engineFiles)).toEqual([]);
  });

  it('src/ui 不含内容 id 字符串', () => {
    expect(quotedIdHits(uiFiles)).toEqual([]);
  });

  it('src/engine 不 import ui / save / data / sim', () => {
    const bad: string[] = [];
    for (const [f, raw] of Object.entries(engineFiles)) {
      const src = stripComments(raw);
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
        if (/(^|\/)(ui|save|data|sim)(\/|$)/.test(m[1])) bad.push(`${shortName(f)} -> ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
