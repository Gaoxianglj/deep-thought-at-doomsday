/** 批量模拟：不经过 UI 自动跑多局并汇总统计。零 DOM、零 Node 专属 API。 */
import {
  aliveIds,
  applyAction,
  newRun,
  validateSetup,
  type Content,
  type Env,
  type RunState,
} from '../engine';
import type { Bot } from './bots';

export interface RunOptions {
  seed: string;
  mapId: string;
  difficultyId: string;
  bot: Bot;
  /** 开局已解锁的角色；默认 = 所有 unlockedByDefault 的角色 */
  unlocked?: string[];
  maxDays?: number;
  maxActions?: number;
}

export interface RunResult {
  seed: string;
  /** 结局 id，或 'timeout' / 'stuck' */
  ending: string;
  /** 存活天数（结局发生的那天；timeout 时为 maxDays） */
  days: number;
  survivors: number;
  /** 最终队伍（含中途加入者与已死亡者） */
  party: string[];
  /** 最终仍活着的队员 */
  alive: string[];
  counters: Record<string, number>;
  /** 事件 id → 触发次数 */
  events: Record<string, number>;
  newUnlocks: string[];
  /** 被引擎拒绝的动作总数 */
  rejected: number;
  /** 错误码 → 次数 */
  rejectedCodes: Record<string, number>;
  /** 判定 stuck 时记录的最后错误码 */
  lastError?: string;
}

const STUCK_LIMIT = 50;

/** 独立于引擎的 mulberry32，用于 bot 自己的随机性 */
export function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultUnlocked(content: Content): string[] {
  return content.db.characters.filter((c) => c.unlockedByDefault).map((c) => c.id);
}

function eventCounts(run: RunState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, h] of Object.entries(run.history)) {
    if (key.startsWith('event:')) out[key.slice(6)] = h.count;
  }
  return out;
}

export function simulateRun(content: Content, opts: RunOptions): RunResult {
  const maxDays = opts.maxDays ?? 200;
  const maxActions = opts.maxActions ?? 20000;
  const unlocked = opts.unlocked ?? defaultUnlocked(content);
  const botRng = makeRng(`${opts.seed}|bot|${opts.bot.name}`);
  const rejectedCodes: Record<string, number> = {};
  let rejected = 0;

  const setup = opts.bot.setup(content, opts.mapId, opts.difficultyId, unlocked, botRng);
  const runOpts = {
    seed: opts.seed,
    mapId: opts.mapId,
    difficultyId: opts.difficultyId,
    party: setup.party,
    items: setup.items,
    unlocked,
  };
  const setupErrors = validateSetup(content, runOpts);
  if (setupErrors.length) {
    return {
      seed: opts.seed,
      ending: 'stuck',
      days: 0,
      survivors: 0,
      party: setup.party,
      alive: [],
      counters: {},
      events: {},
      newUnlocks: [],
      rejected: 0,
      rejectedCodes: {},
      lastError: `setup:${setupErrors.join(',')}`,
    };
  }

  let run = newRun(content, runOpts);
  let ending: string | null = null;
  let lastError: string | undefined;
  let consecutive = 0;
  let actions = 0;

  while (!ending) {
    if (run.phase === 'ended') {
      ending = run.ending?.id ?? 'stuck';
    } else if (run.day > maxDays) {
      ending = 'timeout';
    } else if (actions++ >= maxActions) {
      ending = 'timeout';
    } else {
      const env: Env = { run, content };
      const action = opts.bot.act(env, botRng);
      const res = applyAction(run, action, content);
      if (res.error) {
        rejected++;
        rejectedCodes[res.error] = (rejectedCodes[res.error] ?? 0) + 1;
        lastError = res.error;
        if (++consecutive >= STUCK_LIMIT) ending = 'stuck';
      } else {
        consecutive = 0;
        run = res.state;
      }
    }
  }

  const alive = aliveIds(run);
  const result: RunResult = {
    seed: opts.seed,
    ending,
    days: ending === 'timeout' ? maxDays : (run.ending?.day ?? run.day),
    survivors: alive.length,
    party: [...run.party],
    alive,
    counters: { ...run.counters },
    events: eventCounts(run),
    newUnlocks: run.unlocked.filter((id) => !unlocked.includes(id)),
    rejected,
    rejectedCodes,
  };
  if (ending === 'stuck') result.lastError = lastError;
  return result;
}

// ---------- 汇总 ----------

export interface Stat {
  mean: number;
  median: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
}

export interface Summary {
  runs: number;
  botName: string;
  mapId: string;
  difficultyId: string;
  endings: { id: string; count: number; pct: number }[];
  days: Stat;
  survivors: { mean: number };
  characters: { id: string; appearRate: number; survivalRate: number }[];
  events: { id: string; triggerRate: number; avgCount: number }[];
  neverTriggered: string[];
  unlocks: { id: string; rate: number }[];
  rejectedCodes: Record<string, number>;
  stuck: number;
  timeout: number;
  lastErrors: Record<string, number>;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stat(values: number[]): Stat {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  return {
    mean,
    median: quantile(s, 0.5),
    min: s[0] ?? 0,
    max: s[s.length - 1] ?? 0,
    p10: quantile(s, 0.1),
    p90: quantile(s, 0.9),
  };
}

export function summarize(content: Content, opts: RunOptions, results: RunResult[]): Summary {
  const n = results.length;
  const rate = (x: number) => (n ? x / n : 0);
  const endingCount: Record<string, number> = {};
  const appear: Record<string, number> = {};
  const survive: Record<string, number> = {};
  const eventRuns: Record<string, number> = {};
  const eventTotal: Record<string, number> = {};
  const unlockCount: Record<string, number> = {};
  const rejectedCodes: Record<string, number> = {};
  const lastErrors: Record<string, number> = {};
  for (const r of results) {
    endingCount[r.ending] = (endingCount[r.ending] ?? 0) + 1;
    for (const id of r.party) appear[id] = (appear[id] ?? 0) + 1;
    for (const id of r.alive) survive[id] = (survive[id] ?? 0) + 1;
    for (const [id, c] of Object.entries(r.events)) {
      eventRuns[id] = (eventRuns[id] ?? 0) + 1;
      eventTotal[id] = (eventTotal[id] ?? 0) + c;
    }
    for (const id of r.newUnlocks) unlockCount[id] = (unlockCount[id] ?? 0) + 1;
    for (const [code, c] of Object.entries(r.rejectedCodes)) {
      rejectedCodes[code] = (rejectedCodes[code] ?? 0) + c;
    }
    if (r.ending === 'stuck' && r.lastError) {
      lastErrors[r.lastError] = (lastErrors[r.lastError] ?? 0) + 1;
    }
  }
  const endingIds = [
    ...content.db.endings.map((e) => e.id),
    ...Object.keys(endingCount).filter((id) => !content.endings.has(id)),
  ].filter((id) => endingCount[id]);
  const charIds = Object.keys(appear).sort(
    (a, b) =>
      content.db.characters.findIndex((c) => c.id === a) -
      content.db.characters.findIndex((c) => c.id === b),
  );
  const knownEvents = content.db.events.map((e) => e.id);
  const eventIds = [
    ...knownEvents,
    ...Object.keys(eventRuns).filter((id) => !content.events.has(id)),
  ];
  return {
    runs: n,
    botName: opts.bot.name,
    mapId: opts.mapId,
    difficultyId: opts.difficultyId,
    endings: endingIds.map((id) => ({
      id,
      count: endingCount[id],
      pct: n ? (endingCount[id] / n) * 100 : 0,
    })),
    days: stat(results.map((r) => r.days)),
    survivors: { mean: stat(results.map((r) => r.survivors)).mean },
    characters: charIds.map((id) => ({
      id,
      appearRate: rate(appear[id]),
      survivalRate: appear[id] ? (survive[id] ?? 0) / appear[id] : 0,
    })),
    events: eventIds
      .filter((id) => eventRuns[id])
      .map((id) => ({
        id,
        triggerRate: rate(eventRuns[id]),
        avgCount: rate(eventTotal[id]),
      })),
    neverTriggered: knownEvents.filter((id) => !eventRuns[id]),
    unlocks: Object.keys(unlockCount).map((id) => ({ id, rate: rate(unlockCount[id]) })),
    rejectedCodes,
    stuck: endingCount.stuck ?? 0,
    timeout: endingCount.timeout ?? 0,
    lastErrors,
  };
}

export function simulateMany(
  content: Content,
  opts: Omit<RunOptions, 'seed'> & { seed?: string; runs: number; seedPrefix?: string },
): Summary {
  const prefix = opts.seedPrefix ?? opts.seed ?? 'sim';
  const results: RunResult[] = [];
  for (let i = 0; i < opts.runs; i++) {
    results.push(simulateRun(content, { ...opts, seed: `${prefix}-${i}` }));
  }
  return summarize(content, { ...opts, seed: prefix }, results);
}

// ---------- 文本输出 ----------

function width(s: string): number {
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
const padR = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));
const padL = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s;

function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]))));
  const line = (r: string[]) =>
    '  ' + r.map((c, i) => (i === 0 ? padR(c, widths[i]) : padL(c, widths[i]))).join('  ');
  return [line(head), '  ' + widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function formatSummary(s: Summary, content: Content): string {
  const name = (m: Map<string, { name: string }>, id: string) => m.get(id)?.name ?? id;
  const out: string[] = [];
  const mapName = name(content.maps, s.mapId);
  const diffName = name(content.difficulties, s.difficultyId);
  out.push(`== ${mapName} / ${diffName} / 策略 ${s.botName} / ${s.runs} 局 ==`);

  out.push('', '结局分布');
  const endingName = (id: string) =>
    id === 'timeout' ? '超时' : id === 'stuck' ? '卡死' : (content.endings.get(id)?.name ?? id);
  out.push(
    ...table(
      ['结局', '局数', '占比'],
      s.endings.map((e) => [endingName(e.id), String(e.count), `${e.pct.toFixed(1)}%`]),
    ),
  );
  if (s.stuck || s.timeout) {
    out.push(`  卡死 ${s.stuck} 局，超时 ${s.timeout} 局`);
    for (const [code, c] of Object.entries(s.lastErrors))
      out.push(`  卡死时最后的错误码: ${code} x${c}`);
  }

  const d = s.days;
  out.push('', '存活天数');
  out.push(
    ...table(
      ['均值', '中位', '最小', 'p10', 'p90', '最大', '平均幸存人数'],
      [
        [
          d.mean.toFixed(1),
          d.median.toFixed(1),
          String(d.min),
          d.p10.toFixed(1),
          d.p90.toFixed(1),
          String(d.max),
          s.survivors.mean.toFixed(2),
        ],
      ],
    ),
  );

  if (s.characters.length) {
    out.push('', '角色');
    out.push(
      ...table(
        ['角色', '出场率', '存活率'],
        s.characters.map((c) => [
          name(content.characters, c.id),
          pct(c.appearRate),
          pct(c.survivalRate),
        ]),
      ),
    );
  }

  if (s.events.length) {
    out.push('', '事件');
    const title = (id: string) => content.events.get(id)?.title ?? id;
    out.push(
      ...table(
        ['事件', '触发率', '场均次数'],
        s.events.map((e) => [title(e.id), pct(e.triggerRate), e.avgCount.toFixed(2)]),
      ),
    );
  }
  out.push(
    '',
    s.neverTriggered.length
      ? `从未触发的事件 (${s.neverTriggered.length}): ${s.neverTriggered
          .map((id) => content.events.get(id)?.title ?? id)
          .join('、')}`
      : '从未触发的事件: 无',
  );

  if (s.unlocks.length) {
    out.push('', '解锁率');
    out.push(
      ...table(
        ['角色', '解锁率'],
        s.unlocks.map((u) => [name(content.characters, u.id), pct(u.rate)]),
      ),
    );
  }

  const codes = Object.entries(s.rejectedCodes);
  out.push('', codes.length ? '被拒绝的动作' : '被拒绝的动作: 无');
  if (codes.length)
    out.push(
      ...table(
        ['错误码', '次数'],
        codes.map(([k, v]) => [k, String(v)]),
      ),
    );
  return out.join('\n');
}
