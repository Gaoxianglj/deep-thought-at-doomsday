/** 批量模拟：不经过 UI 自动跑多局并汇总统计。零 DOM、零 Node 专属 API。 */
import {
  aliveIds,
  applyAction,
  newRun,
  validateSetup,
  type Action,
  type Content,
  type Env,
  type RunState,
} from '../engine';
import {
  aggregateAnalytics,
  formatAnalytics,
  Recorder,
  type AnalyticsSummary,
  type RunAnalytics,
  type StepInfo,
} from './analytics';
import type { Bot, BotMemory } from './bots';
import { checkInvariants, checkTransition, type Violation } from './invariants';
import { stat, type Stat } from './stats';
import { pct, table } from './table';

export type { Stat } from './stats';

/** 观察者：simulateRun 在开局与每一步之后回调（回放、调试用） */
export interface RunObserver {
  start?(run: RunState): void;
  step?(info: StepInfo): void;
}

export interface RunOptions {
  seed: string;
  mapId: string;
  difficultyId: string;
  bot: Bot;
  /** 开局已解锁的角色；默认 = 所有 unlockedByDefault 的角色 */
  unlocked?: string[];
  maxDays?: number;
  maxActions?: number;
  /** 每步之后做不变量检查（默认开） */
  check?: boolean;
  observer?: RunObserver;
}

export interface CrashInfo {
  /** setup = 开局（bot.setup / newRun）；bot = bot.act 抛异常；engine = applyAction 抛异常 */
  stage: 'setup' | 'bot' | 'engine';
  message: string;
  stack?: string;
  /** 抛异常时正在执行的动作（JSON） */
  action?: string;
  day?: number;
}

export interface RunResult {
  seed: string;
  /** 结局 id，或 'timeout' / 'stuck' / 'crashed' */
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
  /** 不变量违规（同一 code 每局只记第一次） */
  violations: Violation[];
  crash?: CrashInfo;
  analytics: RunAnalytics;
}

const STUCK_LIMIT = 50;
/** 每局最多记录多少种不同的违规 */
const MAX_VIOLATIONS_PER_RUN = 20;

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

function toCrash(
  stage: CrashInfo['stage'],
  err: unknown,
  extra: { action?: Action; day?: number } = {},
): CrashInfo {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    stage,
    message: e.message,
    stack: e.stack?.split('\n').slice(0, 6).join('\n'),
    action: extra.action ? JSON.stringify(extra.action) : undefined,
    day: extra.day,
  };
}

export function simulateRun(content: Content, opts: RunOptions): RunResult {
  const maxDays = opts.maxDays ?? 200;
  const maxActions = opts.maxActions ?? 20000;
  const check = opts.check ?? true;
  const unlocked = opts.unlocked ?? defaultUnlocked(content);
  const botRng = makeRng(`${opts.seed}|bot|${opts.bot.name}`);
  const botMem: BotMemory = {};
  const rejectedCodes: Record<string, number> = {};
  let rejected = 0;
  const recorder = new Recorder(content);
  const violations: Violation[] = [];
  const seenCodes = new Set<string>();
  const addViolations = (list: Violation[]) => {
    for (const v of list) {
      if (seenCodes.has(v.code) || violations.length >= MAX_VIOLATIONS_PER_RUN) continue;
      seenCodes.add(v.code);
      violations.push(v);
    }
  };

  /** 开局就失败时的返回值 */
  const failedStart = (party: string[], lastError: string, crash?: CrashInfo): RunResult => ({
    seed: opts.seed,
    ending: crash ? 'crashed' : 'stuck',
    days: 0,
    survivors: 0,
    party,
    alive: [],
    counters: {},
    events: {},
    newUnlocks: [],
    rejected: 0,
    rejectedCodes: {},
    lastError,
    violations: [],
    crash,
    analytics: recorder.analytics,
  });

  let party: string[] = [];
  let run: RunState;
  try {
    const setup = opts.bot.setup(content, opts.mapId, opts.difficultyId, unlocked, botRng, botMem);
    party = setup.party;
    const runOpts = {
      seed: opts.seed,
      mapId: opts.mapId,
      difficultyId: opts.difficultyId,
      party: setup.party,
      items: setup.items,
      unlocked,
    };
    const setupErrors = validateSetup(content, runOpts);
    if (setupErrors.length) return failedStart(party, `setup:${setupErrors.join(',')}`);
    run = newRun(content, runOpts);
  } catch (err) {
    const crash = toCrash('setup', err);
    return failedStart(party, `crash:${crash.message}`, crash);
  }

  if (check) addViolations(checkInvariants(content, run));
  recorder.start(run);
  opts.observer?.start?.(run);

  let ending: string | null = null;
  let lastError: string | undefined;
  let crash: CrashInfo | undefined;
  let consecutive = 0;
  let actions = 0;

  while (!ending) {
    if (run.phase === 'ended') {
      ending = run.ending?.id ?? 'stuck';
    } else if (run.day > maxDays) {
      ending = 'timeout';
    } else if (actions >= maxActions) {
      ending = 'timeout';
    } else {
      const env: Env = { run, content };
      let action: Action;
      try {
        action = opts.bot.act(env, botRng, botMem);
      } catch (err) {
        crash = toCrash('bot', err, { day: run.day });
        ending = 'crashed';
        break;
      }
      let res: ReturnType<typeof applyAction>;
      try {
        res = applyAction(run, action, content);
      } catch (err) {
        crash = toCrash('engine', err, { action, day: run.day });
        ending = 'crashed';
        break;
      }
      const info: StepInfo = { index: actions++, before: run, action, after: res.state };
      if (res.error) {
        info.error = res.error;
        // 引擎约定：动作被拒绝时返回原来的 state 对象，未发生任何变化
        if (check && res.state !== run) {
          addViolations([
            {
              code: 'action.reject-mutated',
              message: `动作 ${action.type} 被拒绝（${res.error}），但返回了新的 state 对象`,
              day: run.day,
              severity: 'error',
            },
          ]);
        }
        rejected++;
        rejectedCodes[res.error] = (rejectedCodes[res.error] ?? 0) + 1;
        lastError = res.error;
        if (++consecutive >= STUCK_LIMIT) ending = 'stuck';
      } else {
        consecutive = 0;
        if (check) {
          addViolations(checkInvariants(content, res.state));
          addViolations(checkTransition(run, res.state));
        }
        recorder.step(info);
        run = res.state;
      }
      opts.observer?.step?.(info);
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
    violations,
    analytics: recorder.analytics,
  };
  if (ending === 'stuck') result.lastError = lastError;
  if (crash) {
    result.crash = crash;
    result.lastError = `crash:${crash.message}`;
  }
  return result;
}

// ---------- 汇总 ----------

export interface Failure {
  seed: string;
  kind: 'crash' | 'stuck' | 'violation';
  detail: string;
}

export interface ViolationSummary {
  code: string;
  severity: 'error' | 'warning';
  /** 出现过该违规的局数 */
  runs: number;
  example: string;
  seeds: string[];
}

export interface Summary {
  runs: number;
  botName: string;
  mapId: string;
  difficultyId: string;
  /** 是否做了不变量检查 */
  checked: boolean;
  endings: { id: string; count: number; pct: number; seeds: string[] }[];
  /** 通关率：以"得救 / 自给自足"（kind 为 rescue / selfRescue）的结局收场的局数占比，0–1 */
  winRate: number;
  days: Stat;
  survivors: { mean: number };
  characters: { id: string; appearRate: number; survivalRate: number }[];
  events: { id: string; triggerRate: number; avgCount: number }[];
  neverTriggered: string[];
  unlocks: { id: string; rate: number }[];
  rejectedCodes: Record<string, number>;
  stuck: number;
  timeout: number;
  crashed: number;
  lastErrors: Record<string, number>;
  violations: ViolationSummary[];
  /** 有问题（崩溃 / 卡死 / 违规）的局数 */
  failedRuns: number;
  /** 最多 MAX_FAILURES 条，可用 seed 回放 */
  failures: Failure[];
  /** 最短 / 最长的一局 */
  extremes: {
    shortest: { seed: string; days: number };
    longest: { seed: string; days: number };
  } | null;
  analytics: AnalyticsSummary;
}

const MAX_FAILURES = 20;
const SEEDS_PER_ENDING = 3;

function failureOf(r: RunResult): Failure | null {
  if (r.crash)
    return { seed: r.seed, kind: 'crash', detail: `${r.crash.stage}: ${r.crash.message}` };
  if (r.ending === 'stuck')
    return { seed: r.seed, kind: 'stuck', detail: r.lastError ?? '未知原因' };
  const errors = r.violations.filter((v) => v.severity === 'error');
  if (errors.length)
    return { seed: r.seed, kind: 'violation', detail: errors.map((v) => v.code).join(', ') };
  return null;
}

export function summarize(content: Content, opts: RunOptions, results: RunResult[]): Summary {
  const n = results.length;
  const rate = (x: number) => (n ? x / n : 0);
  const endingCount: Record<string, number> = {};
  const endingSeeds: Record<string, string[]> = {};
  const appear: Record<string, number> = {};
  const survive: Record<string, number> = {};
  const eventRuns: Record<string, number> = {};
  const eventTotal: Record<string, number> = {};
  const unlockCount: Record<string, number> = {};
  const rejectedCodes: Record<string, number> = {};
  const lastErrors: Record<string, number> = {};
  const violationMap = new Map<string, ViolationSummary>();
  const failures: Failure[] = [];
  let failedRuns = 0;
  for (const r of results) {
    endingCount[r.ending] = (endingCount[r.ending] ?? 0) + 1;
    const seeds = (endingSeeds[r.ending] ??= []);
    if (seeds.length < SEEDS_PER_ENDING) seeds.push(r.seed);
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
    if ((r.ending === 'stuck' || r.ending === 'crashed') && r.lastError) {
      lastErrors[r.lastError] = (lastErrors[r.lastError] ?? 0) + 1;
    }
    for (const v of r.violations) {
      const cur = violationMap.get(v.code) ?? {
        code: v.code,
        severity: v.severity,
        runs: 0,
        example: '',
        seeds: [],
      };
      cur.runs++;
      if (!cur.example) cur.example = `第 ${v.day} 天: ${v.message}`;
      if (cur.seeds.length < SEEDS_PER_ENDING) cur.seeds.push(r.seed);
      violationMap.set(v.code, cur);
    }
    const f = failureOf(r);
    if (f) {
      failedRuns++;
      if (failures.length < MAX_FAILURES) failures.push(f);
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
  const byDays = [...results].sort((a, b) => a.days - b.days);
  return {
    runs: n,
    botName: opts.bot.name,
    mapId: opts.mapId,
    difficultyId: opts.difficultyId,
    checked: opts.check ?? true,
    endings: endingIds.map((id) => ({
      id,
      count: endingCount[id],
      pct: n ? (endingCount[id] / n) * 100 : 0,
      seeds: endingSeeds[id] ?? [],
    })),
    winRate: rate(
      results.filter((r) => {
        const kind = content.endings.get(r.ending)?.kind;
        return kind === 'rescue' || kind === 'selfRescue';
      }).length,
    ),
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
    crashed: endingCount.crashed ?? 0,
    lastErrors,
    violations: [...violationMap.values()].sort(
      (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error') || b.runs - a.runs,
    ),
    failedRuns,
    failures,
    extremes: n
      ? {
          shortest: { seed: byDays[0].seed, days: byDays[0].days },
          longest: { seed: byDays[n - 1].seed, days: byDays[n - 1].days },
        }
      : null,
    analytics: aggregateAnalytics(
      content,
      results.map((r) => r.analytics),
      opts.maxDays ?? 200,
      results.map((r) => `${r.ending}@${r.days}`),
    ),
  };
}

export type SimulateManyOptions = Omit<RunOptions, 'seed'> & {
  seed?: string;
  runs: number;
  seedPrefix?: string;
};

const seedPrefixOf = (opts: { seedPrefix?: string; seed?: string }) =>
  opts.seedPrefix ?? opts.seed ?? 'sim';

/** 跑指定序号的局（种子 = `${前缀}-${序号}`）；多进程并行时每个进程跑其中一片 */
export function simulateRuns(
  content: Content,
  opts: SimulateManyOptions,
  indices: Iterable<number>,
): RunResult[] {
  const prefix = seedPrefixOf(opts);
  const results: RunResult[] = [];
  for (const i of indices) {
    results.push(simulateRun(content, { ...opts, seed: `${prefix}-${i}` }));
  }
  return results;
}

/** 并行分片合并：第 i 局 = 第 (i % shards.length) 片的第 floor(i / shards.length) 个 */
export function mergeShards<T>(shards: T[][], runs: number): T[] {
  return Array.from(
    { length: runs },
    (_, i) => shards[i % shards.length][Math.floor(i / shards.length)],
  );
}

/** 把已有的结果汇总（序号顺序决定"示例种子"等，所以并行合并后须按序号排好） */
export function summarizeMany(
  content: Content,
  opts: SimulateManyOptions,
  results: RunResult[],
): Summary {
  return summarize(content, { ...opts, seed: seedPrefixOf(opts) }, results);
}

export function simulateMany(content: Content, opts: SimulateManyOptions): Summary {
  const results = simulateRuns(
    content,
    opts,
    Array.from({ length: opts.runs }, (_, i) => i),
  );
  return summarizeMany(content, opts, results);
}

// ---------- 文本输出 ----------

export interface FormatOptions {
  /** 打印全部事件选项而不只是异常项 */
  detail?: boolean;
}

export function formatSummary(s: Summary, content: Content, fmt: FormatOptions = {}): string {
  const name = (m: Map<string, { name: string }>, id: string) => m.get(id)?.name ?? id;
  const out: string[] = [];
  const mapName = name(content.maps, s.mapId);
  const diffName = name(content.difficulties, s.difficultyId);
  out.push(`== ${mapName} / ${diffName} / 策略 ${s.botName} / ${s.runs} 局 ==`);

  // 健康检查放最前面：这是最需要立刻处理的东西
  out.push('', '健康检查');
  if (!s.failedRuns) {
    out.push(
      s.checked
        ? `  通过：${s.runs} 局无崩溃、无卡死、无不变量错误`
        : `  无崩溃、无卡死（未做不变量检查）`,
    );
  } else {
    out.push(`  ${s.failedRuns} / ${s.runs} 局有问题（崩溃 ${s.crashed}，卡死 ${s.stuck}）`);
    for (const [msg, c] of Object.entries(s.lastErrors)) out.push(`  卡死/崩溃原因: ${msg} x${c}`);
    out.push(
      `  问题种子（前 ${s.failures.length} 个）:`,
      ...s.failures.map((f) => `    ${f.seed}  [${f.kind}] ${f.detail}`),
    );
  }
  for (const v of s.violations) {
    out.push(
      `  [${v.severity === 'error' ? '错误' : '警告'}] ${v.code}  ${v.runs} 局 (${((v.runs / s.runs) * 100).toFixed(0)}%)  种子 ${v.seeds.join(', ')}`,
      `      例: ${v.example}`,
    );
  }

  out.push('', '结局分布');
  const endingName = (id: string) =>
    id === 'timeout'
      ? '超时'
      : id === 'stuck'
        ? '卡死'
        : id === 'crashed'
          ? '崩溃'
          : (content.endings.get(id)?.name ?? id);
  out.push(
    ...table(
      ['结局', '局数', '占比', '示例种子'],
      s.endings.map((e) => [
        endingName(e.id),
        String(e.count),
        `${e.pct.toFixed(1)}%`,
        e.seeds.join(', '),
      ]),
    ),
  );
  out.push(`  通关率（得救 / 自给自足）: ${pct(s.winRate)}`);
  if (s.stuck || s.timeout) out.push(`  卡死 ${s.stuck} 局，超时 ${s.timeout} 局`);

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
  if (s.extremes)
    out.push(
      `  最短 ${s.extremes.shortest.days} 天（${s.extremes.shortest.seed}），最长 ${s.extremes.longest.days} 天（${s.extremes.longest.seed}）`,
    );

  out.push(...formatAnalytics(s.analytics, content, { botName: s.botName, detail: fmt.detail }));

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
