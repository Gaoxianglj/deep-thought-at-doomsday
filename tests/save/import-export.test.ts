import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_VERSION } from '../../src/engine';
import {
  createSaveService,
  decodeSaveCode,
  encodeSaveCode,
  SaveEnvelopeSchema,
  type SaveService,
} from '../../src/save';
import { makeContent, makeEnv } from '../fixtures/content';

function newService(): SaveService {
  return createSaveService(makeContent(), { indexedDB: new IDBFactory() });
}

async function seeded() {
  const svc = newService();
  const p = await svc.createProfile('导出者');
  const run = makeEnv({ items: { can: 3 } }).run;
  await svc.saveRun(p.id, run);
  return { svc, p, run };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectFail(r: Awaited<ReturnType<SaveService['importText']>>): string {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('unreachable');
  expect(r.error).toMatch(/[一-鿿]/);
  return r.error;
}

describe('JSON 导出导入', () => {
  it('往返：作为新档案写入，名字冲突加后缀', async () => {
    const { svc, p, run } = await seeded();
    const json = await svc.exportJson(p.id);
    const env = SaveEnvelopeSchema.parse(JSON.parse(json));
    expect(env.version).toBe(SAVE_VERSION);
    expect(env.run).toEqual(run);

    const r = await svc.importText(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hasRun).toBe(true);
    expect(r.profile.id).not.toBe(p.id);
    expect(r.profile.name).toBe('导出者 (2)');
    expect((await svc.loadRun(r.profile.id)).run).toEqual(run);

    // 导入到另一个空库：保留原 id 与名字
    const other = newService();
    const r2 = await other.importText(`\n  ${json}  \n`);
    expect(r2.ok && r2.profile.id).toBe(p.id);
    expect(r2.ok && r2.profile.name).toBe('导出者');
  });

  it('没有进行中对局时 run 为 null', async () => {
    const svc = newService();
    const p = await svc.createProfile('空');
    const env = JSON.parse(await svc.exportJson(p.id));
    expect(env.run).toBeNull();
    const r = await newService().importText(JSON.stringify(env));
    expect(r.ok && r.hasRun).toBe(false);
  });

  it('非本游戏 JSON / 乱码 / 坏 JSON', async () => {
    const svc = newService();
    expect(expectFail(await svc.importText('{"hello":"world"}'))).toContain('不是本游戏');
    expect(expectFail(await svc.importText('随便写点什么 asdf'))).toContain('不是本游戏');
    expect(expectFail(await svc.importText(''))).toContain('不是本游戏');
    expect(expectFail(await svc.importText('{"format":"dtad-save",'))).toContain('损坏');
  });

  it('版本过新被拒绝', async () => {
    const { svc, p } = await seeded();
    const env = JSON.parse(await svc.exportJson(p.id));
    env.version = SAVE_VERSION + 1;
    expect(expectFail(await svc.importText(JSON.stringify(env)))).toContain('更新');
  });

  it('结构损坏时给出中文位置说明', async () => {
    const { svc, p } = await seeded();
    const env = JSON.parse(await svc.exportJson(p.id));
    env.run.characters.alpha.stats.food = 'lots';
    const err = expectFail(await svc.importText(JSON.stringify(env)));
    expect(err).toContain('对局数据');
    expect(err).toContain('角色');
    expect(err).toContain('数字');
    expect(err).not.toMatch(/Invalid|expected/);

    const env2 = JSON.parse(await svc.exportJson(p.id));
    delete env2.profile.name;
    const err2 = expectFail(await svc.importText(JSON.stringify(env2)));
    expect(err2).toContain('档案信息');
    expect(err2).toContain('缺少');
  });

  it('导入时执行失效引用修复', async () => {
    const { svc, p } = await seeded();
    const env = JSON.parse(await svc.exportJson(p.id));
    env.run.eventQueue = [{ eventId: 'no_such', day: 2, roles: {} }];
    const r = await svc.importText(JSON.stringify(env));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notices.length).toBe(1);
    expect((await svc.loadRun(r.profile.id)).run!.eventQueue).toEqual([]);
  });
});

describe('存档码', () => {
  it('DTAD1 往返，容忍空白与换行', async () => {
    const { svc, p, run } = await seeded();
    const code = await svc.exportCode(p.id);
    expect(code.startsWith('DTAD1.')).toBe(true);
    const messy = `  \n${code.slice(0, 20)}\n ${code.slice(20, 50)}\r\n\t${code.slice(50)}  \n`;
    const other = newService();
    const r = await other.importText(messy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await other.loadRun(r.profile.id)).run).toEqual(run);
  });

  it('CompressionStream 不可用时退回 DTAD0，且两种都能解码', async () => {
    const { svc, p, run } = await seeded();
    vi.stubGlobal('CompressionStream', undefined);
    const code0 = await svc.exportCode(p.id);
    expect(code0.startsWith('DTAD0.')).toBe(true);
    vi.unstubAllGlobals();
    const other = newService();
    const r = await other.importText(code0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await other.loadRun(r.profile.id)).run).toEqual(run);
  });

  it('中文与长文本往返', async () => {
    const json = JSON.stringify({ text: '末日时在深度思考中'.repeat(500) });
    expect(await decodeSaveCode(await encodeSaveCode(json))).toBe(json);
  });

  it('被截断或篡改的码报"不完整"', async () => {
    const { svc, p } = await seeded();
    const code = await svc.exportCode(p.id);
    const truncated = code.slice(0, Math.floor(code.length * 0.6));
    expect(expectFail(await svc.importText(truncated))).toContain('不完整');
    expect(expectFail(await svc.importText(code.slice(0, -3)))).toContain('不完整');

    const i = 10;
    const flipped = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    expect(expectFail(await svc.importText(flipped))).toContain('不完整');
    expect(expectFail(await svc.importText('DTAD1.'))).toContain('不完整');
  });

  it('码前缀正确但内容乱码', async () => {
    const svc = newService();
    expect(expectFail(await svc.importText('DTAD1.@@@###.12345678'))).toContain('不完整');
    // 校验和正确但内容不是存档
    const junk = await encodeSaveCode('{"foo":1}');
    expect(expectFail(await svc.importText(junk))).toContain('不是本游戏');
    const notJson = await encodeSaveCode('not json at all');
    expect(expectFail(await svc.importText(notJson))).toBeTruthy();
  });

  it('更新版本的存档码格式被拒绝', async () => {
    const svc = newService();
    expect(expectFail(await svc.importText('DTAD7.abc.00000000'))).toContain('更新');
  });
});
