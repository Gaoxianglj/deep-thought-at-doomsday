/** 文本表格工具（按中日韩字符宽度对齐）。零 DOM、零 Node 专属 API。 */

export function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

export const padR = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));
export const padL = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s;

/** 第一列左对齐，其余右对齐 */
export function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]))));
  const line = (r: string[]) =>
    '  ' + r.map((c, i) => (i === 0 ? padR(c, widths[i]) : padL(c, widths[i]))).join('  ');
  return [line(head), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
