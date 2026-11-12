/**
 * 存档码编解码：
 *   DTAD1.<base64url(deflate-raw(JSON 的 UTF-8))>.<CRC32 十六进制>
 *   DTAD0.<base64url(JSON 的 UTF-8)>.<CRC32 十六进制>   （CompressionStream 不可用时）
 * 校验和针对 payload 字符串本身，解码前先校验，被截断/篡改即可识别。
 */

/** 给玩家看的错误（message 为中文） */
export class SaveError extends Error {}

export const MSG = {
  notOurs: '这不是本游戏的存档。请确认复制的是完整的存档码或导出的存档文件。',
  truncated: '存档码不完整或已被改动（校验不通过）。请重新完整复制一次。',
  brokenJson: '存档文件已损坏，无法读取（JSON 格式错误）。',
  noDecompress: '当前浏览器不支持解压这种存档码，请换用较新的浏览器，或改用 JSON 文件导入。',
  codeTooNew: '这个存档码来自更新版本的游戏，请先更新游戏再导入。',
} as const;

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checksum(payload: string): string {
  return crc32(new TextEncoder().encode(payload)).toString(16).padStart(8, '0');
}

// ---------- base64url ----------
export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new SaveError(MSG.truncated);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- 压缩 ----------
export function canCompress(): boolean {
  return typeof CompressionStream === 'function';
}
function canDecompress(): boolean {
  return typeof DecompressionStream === 'function';
}

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as TransformStream);
  return new Uint8Array(await new Response(src).arrayBuffer());
}

// ---------- 存档码 ----------
export async function encodeSaveCode(json: string): Promise<string> {
  const raw = new TextEncoder().encode(json);
  let prefix = 'DTAD0';
  let body: Uint8Array = raw;
  if (canCompress()) {
    try {
      body = await pipe(raw, new CompressionStream('deflate-raw'));
      prefix = 'DTAD1';
    } catch {
      body = raw;
    }
  }
  const payload = toBase64Url(body);
  return `${prefix}.${payload}.${checksum(payload)}`;
}

/** 看起来像存档码（容忍首尾空白） */
export function looksLikeCode(text: string): boolean {
  return /^DTAD\d+\./i.test(text.replace(/\s+/g, ''));
}

/** 解码存档码，返回 JSON 字符串。失败抛 SaveError。 */
export async function decodeSaveCode(text: string): Promise<string> {
  const s = text.replace(/\s+/g, '');
  const m = /^DTAD(\d+)\.(.*)$/i.exec(s);
  if (!m) throw new SaveError(MSG.notOurs);
  const codecVersion = Number(m[1]);
  if (codecVersion > 1) throw new SaveError(MSG.codeTooNew);
  const rest = m[2];
  const dot = rest.lastIndexOf('.');
  if (dot < 0) throw new SaveError(MSG.truncated);
  const payload = rest.slice(0, dot);
  const sum = rest.slice(dot + 1).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(sum) || checksum(payload) !== sum) {
    throw new SaveError(MSG.truncated);
  }
  let bytes = fromBase64Url(payload);
  if (codecVersion === 1) {
    if (!canDecompress()) throw new SaveError(MSG.noDecompress);
    try {
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } catch {
      throw new SaveError(MSG.truncated);
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SaveError(MSG.truncated);
  }
}

/** 把玩家粘贴/上传的文本解析成原始对象（JSON 或存档码）。失败抛 SaveError。 */
export async function parseSaveText(text: string): Promise<unknown> {
  const trimmed = text.trim();
  let json: string;
  if (trimmed.startsWith('{')) json = trimmed;
  else if (looksLikeCode(trimmed)) json = await decodeSaveCode(trimmed);
  else throw new SaveError(MSG.notOurs);
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new SaveError(trimmed.startsWith('{') ? MSG.brokenJson : MSG.truncated);
  }
}
