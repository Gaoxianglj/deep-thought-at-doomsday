/**
 * 对局分析：逐步观察 applyAction 的前后状态，记录死因、每日曲线、外出结果、事件选项。
 * Recorder 每局一个，产出 RunAnalytics；aggregateAnalytics 把多局汇总成 AnalyticsSummary。
 * 零 DOM、零 Node 专属 API；不含任何内容 id（死因全由数据里的属性 / 状态 / 事件 id 推出）。
 */
import { aliveIds, getEventView, type Action, type Content, type RunState } from '../engine';
import { stat, type Stat } from './stats';
import { pct, table } from './table';

/** 一步动作的前后快照（动作被拒绝时 after === before 且带 error） */
export interface StepInfo {
  index: number;
  before: RunState;
  action: Action;
  after: RunState;
  error?: string;
}

export type DeathTrigger = 'night' | 'event' | 'expedition' | 'other';

export interface DeathRecord {
  charId: string;
  day: number;
  /** dead = 死亡，gone = 离队/失踪 */
  how: 'dead' | 'gone';
  /** night = 入夜到清晨的结算；event = 事件选择；expedition = 外出失踪；other = 其他动作 */
  trigger: DeathTrigger;
  eventId?: string;
  choiceId?: string;
  locationId?: string;
  /** 死亡时人在外面 */
  whileAway: boolean;
  /** 触发死亡的属性（deathAtZero 且已归零） */
  fatal: string[];
  /** 其他已归零的属性 */
  empty: string[];
  /** 当时身上的状态 */
  statuses: string[];
}

export type ExpeditionOutcome = 'returned' | 'lost' | 'died' | 'other';

export interface ChoiceCount {
  offered: number;
  enabled: number;
  picked: number;
}

export interface RunAnalytics {
  deaths: DeathRecord[];
  /** 下标 d-1 = 第 d 天开始时的存活人数 */
  aliveByDay: number[];
  /** 配给标签 → 下标 d-1 = 第 d 天开始时该标签物品的库存总数 */
  supplyByDay: Record<string, number[]>;
  /** 每次出发的地点 */
  departures: string[];
  expeditions: { locationId: string; outcome: ExpeditionOutcome }[];
  /** 键 = `<eventId>/<choiceId>` */
  choices: Record<string, ChoiceCount>;
  /** 本局依次出现的事件 id（含事件链与队列事件） */
  eventSeq: string[];
}

interface ActiveExp {
  charId: string;
  locationId: string;
  /** 这一步里才出发 */
  departedNow: boolean;
}

/**
 * 这一步里"在外面"的外出：之前已在外，或这一步入夜出发。
 * 注意：往返 1 天的外出会在同一个 endDay 里出发并结算，此时 before.expedition 为空。
 */
function activeExpedition(before: RunState, after: RunState): ActiveExp | undefined {
  if (before.expedition) {
    return {
      charId: before.expedition.charId,
      locationId: before.expedition.locationId,
      departedNow: false,
    };
  }
  const departed = (after.counters.expeditions ?? 0) > (before.counters.expeditions ?? 0);
  const planned = before.plan.expedition;
  if (departed && planned)
    return { charId: planned.charId, locationId: planned.locationId, departedNow: true };
  return undefined;
}

const isAlive = (where: string | undefined) => where === 'shelter' || where === 'away';

export class Recorder {
  readonly analytics: RunAnalytics = {
    deaths: [],
    aliveByDay: [],
    supplyByDay: {},
    departures: [],
    expeditions: [],
    choices: {},
    eventSeq: [],
  };
  private readonly tagItems: Record<string, string[]> = {};

  private readonly content: Content;

  constructor(content: Content) {
    this.content = content;
    for (const tag of content.config.rationTags) {
      this.tagItems[tag] = content.db.items.filter((i) => i.tags.includes(tag)).map((i) => i.id);
      this.analytics.supplyByDay[tag] = [];
    }
  }

  start(run: RunState): void {
    this.sampleDay(run);
    if (run.pendingEvent) this.analytics.eventSeq.push(run.pendingEvent.eventId);
  }

  step(info: StepInfo): void {
    if (info.error) return;
    const { before, after, action } = info;
    const exp = activeExpedition(before, after);
    this.recordDeaths(before, after, action, exp);
    this.recordExpeditions(before, after, exp);
    if (action.type === 'chooseEventOption') this.recordChoices(before, action.choiceId);
    if ((after.counters.events ?? 0) > (before.counters.events ?? 0) && after.pendingEvent) {
      this.analytics.eventSeq.push(after.pendingEvent.eventId);
    }
    this.sampleDay(after);
  }

  private sampleDay(run: RunState): void {
    const a = this.analytics;
    if (a.aliveByDay[run.day - 1] !== undefined) return;
    a.aliveByDay[run.day - 1] = aliveIds(run).length;
    for (const [tag, ids] of Object.entries(this.tagItems)) {
      a.supplyByDay[tag][run.day - 1] = ids.reduce((n, id) => n + (run.inventory[id] ?? 0), 0);
    }
  }

  private recordDeaths(
    before: RunState,
    after: RunState,
    action: Action,
    exp: ActiveExp | undefined,
  ): void {
    const { content } = this;
    for (const id of before.party) {
      const b = before.characters[id];
      const a = after.characters[id];
      if (!b || !a || !isAlive(b.where) || isAlive(a.where)) continue;
      const rec: DeathRecord = {
        charId: id,
        day: after.day,
        how: a.where === 'dead' ? 'dead' : 'gone',
        trigger: 'other',
        whileAway: b.where === 'away' || exp?.charId === id,
        fatal: [],
        empty: [],
        statuses: [...new Set([...b.statuses, ...a.statuses].map((s) => s.id))],
      };
      for (const s of content.db.stats) {
        if ((a.stats[s.id] ?? s.initial) > s.min) continue;
        (s.deathAtZero ? rec.fatal : rec.empty).push(s.id);
      }
      const lostNow =
        (after.counters.expeditionsLost ?? 0) > (before.counters.expeditionsLost ?? 0);
      if (a.where === 'gone' && lostNow && exp?.charId === id) {
        rec.trigger = 'expedition';
        rec.locationId = exp.locationId;
      } else if (action.type === 'endDay') {
        rec.trigger = 'night';
      } else if (action.type === 'chooseEventOption' || action.type === 'continueEvent') {
        rec.trigger = 'event';
        rec.eventId = before.pendingEvent?.eventId;
        rec.choiceId =
          action.type === 'chooseEventOption'
            ? action.choiceId
            : before.pendingEvent?.result?.choiceId;
      }
      this.analytics.deaths.push(rec);
    }
  }

  private recordExpeditions(before: RunState, after: RunState, exp: ActiveExp | undefined): void {
    const a = this.analytics;
    const delta = (key: string) => (after.counters[key] ?? 0) - (before.counters[key] ?? 0);
    if (exp?.departedNow) a.departures.push(exp.locationId);
    if (!exp || after.expedition) return;
    // 外出已经结束（含"当晚出发、次日清晨就结算"的一天往返）
    let outcome: ExpeditionOutcome = 'other';
    if (delta('expeditionsReturned') > 0) outcome = 'returned';
    else if (delta('expeditionsLost') > 0) outcome = 'lost';
    else if (after.characters[exp.charId]?.where === 'dead') outcome = 'died';
    a.expeditions.push({ locationId: exp.locationId, outcome });
  }

  private recordChoices(before: RunState, pickedId: string): void {
    const pending = before.pendingEvent;
    if (!pending || pending.result) return;
    // 在副本上求值：选项的 requires 万一用了 chance 也不会污染对局的随机数
    const view = getEventView({ run: structuredClone(before), content: this.content });
    if (!view) return;
    for (const c of view.choices) {
      const key = `${view.eventId}/${c.id}`;
      const row = (this.analytics.choices[key] ??= { offered: 0, enabled: 0, picked: 0 });
      row.offered++;
      if (c.enabled) row.enabled++;
      if (c.id === pickedId) row.picked++;
    }
  }
}

// ---------- 汇总 ----------

export interface DeathCause {
  key: string;
  label: string;
  count: number;
  pct: number;
}

export interface TimelinePoint {
  day: number;
  /** 到达这一天的局数占比（仍在继续的比例） */
  running: number;
  /** 到达这一天的局里，平均存活人数 */
  meanAlive: number;
  /** 配给标签 → 平均库存、断供（库存为 0）的比例 */
  supply: Record<string, { mean: number; emptyRate: number }>;
}

export interface ExpeditionRow {
  locationId: string;
  departed: number;
  returned: number;
  lost: number;
  died: number;
  other: number;
  /** 场均出发次数 */
  perRun: number;
}

export interface ChoiceRow {
  eventId: string;
  choiceId: string;
  offered: number;
  enabled: number;
  picked: number;
}

export interface AnalyticsSummary {
  deaths: {
    total: number;
    perRun: number;
    /** 至少死过一人的局里，第一个死亡发生在第几天 */
    firstDeathDay: Stat | null;
    causes: DeathCause[];
  };
  timeline: TimelinePoint[];
  expeditions: ExpeditionRow[];
  choices: ChoiceRow[];
  diversity: Diversity;
}

/** 跨局多样性：玩家重复玩时会不会觉得"每局都一样" */
export interface Diversity {
  /** 事件分布的归一化香农熵（0–1；1 = 各事件出现次数完全均匀） */
  eventEntropy: number;
  /** 局间两两"出现过的事件集合"的平均 Jaccard 相似度（0–1；越高越雷同；抽样前 100 局） */
  meanJaccard: number;
  /** 开场（前 OPENING_LEN 个事件）的多样性 */
  openings: { length: number; distinct: number; runs: number; topShare: number };
  /** 单局里出现次数最多的那个事件的平均次数；以及场均出现最多的事件 */
  repeat: { meanMax: number; worstEventId?: string; worstPerRun: number };
  /** 结局、天数、事件序列都完全相同的局所占比例 */
  duplicateRunRate: number;
}

function deathKey(d: DeathRecord): string {
  const list = (xs: string[]) => [...xs].sort().join(',');
  if (d.trigger === 'event') return `event:${d.eventId ?? ''}/${d.choiceId ?? ''}/${d.how}`;
  if (d.trigger === 'expedition') return `expedition:${d.locationId ?? ''}`;
  return [
    d.trigger,
    d.how,
    d.whileAway ? 'away' : 'home',
    `fatal=${list(d.fatal)}`,
    `empty=${list(d.empty)}`,
    `status=${list(d.statuses)}`,
  ].join('|');
}

function deathLabel(content: Content, d: DeathRecord): string {
  const statName = (id: string) => content.stats.get(id)?.name ?? id;
  const statusName = (id: string) => content.statuses.get(id)?.name ?? id;
  const verb = d.how === 'dead' ? '死亡' : '离队';
  if (d.trigger === 'expedition') {
    return `外出失踪 · ${content.locations.get(d.locationId ?? '')?.name ?? d.locationId}`;
  }
  if (d.trigger === 'event') {
    const ev = content.events.get(d.eventId ?? '');
    const choice = ev?.choices.find((c) => c.id === d.choiceId);
    return `${verb} · 事件「${ev?.title ?? d.eventId}」${choice ? `· 选项「${choice.text}」` : ''}`;
  }
  const where = d.trigger === 'night' ? (d.whileAway ? '外出途中的夜间结算' : '夜间结算') : '其他';
  const parts = [`${verb} · ${where}`];
  if (d.fatal.length) parts.push(`${d.fatal.map(statName).join('、')}归零`);
  if (d.empty.length) parts.push(`同时 ${d.empty.map(statName).join('、')} 为 0`);
  if (d.statuses.length) parts.push(`状态: ${d.statuses.map(statusName).join('、')}`);
  return parts.join(' · ');
}

const OPENING_LEN = 3;
const JACCARD_SAMPLE = 100;

export function computeDiversity(runs: RunAnalytics[], outcomes: string[] = []): Diversity {
  const n = runs.length;
  // 事件分布熵
  const total = new Map<string, number>();
  for (const r of runs) for (const id of r.eventSeq) total.set(id, (total.get(id) ?? 0) + 1);
  const sum = [...total.values()].reduce((a, b) => a + b, 0);
  let entropy = 0;
  if (total.size > 1 && sum > 0) {
    for (const c of total.values()) entropy -= (c / sum) * Math.log(c / sum);
    entropy /= Math.log(total.size);
  }
  // 局间相似度
  const sets = runs.slice(0, JACCARD_SAMPLE).map((r) => new Set(r.eventSeq));
  let jac = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (!a.size && !b.size) continue;
      let inter = 0;
      for (const x of a) if (b.has(x)) inter++;
      jac += inter / (a.size + b.size - inter);
      pairs++;
    }
  }
  // 开场
  const openingCount = new Map<string, number>();
  for (const r of runs) {
    const key = r.eventSeq.slice(0, OPENING_LEN).join('>');
    openingCount.set(key, (openingCount.get(key) ?? 0) + 1);
  }
  // 重复
  let maxSum = 0;
  for (const r of runs) {
    const c = new Map<string, number>();
    for (const id of r.eventSeq) c.set(id, (c.get(id) ?? 0) + 1);
    maxSum += Math.max(0, ...c.values());
  }
  let worstId: string | undefined;
  let worst = 0;
  for (const [id, c] of total) {
    if (c / Math.max(n, 1) > worst) {
      worst = c / Math.max(n, 1);
      worstId = id;
    }
  }
  // 完全相同的局
  const seen = new Map<string, number>();
  runs.forEach((r, i) => {
    const key = `${outcomes[i] ?? ''}|${r.eventSeq.join('>')}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  const dup = [...seen.values()].filter((c) => c > 1).reduce((a, b) => a + b, 0);
  return {
    eventEntropy: entropy,
    meanJaccard: pairs ? jac / pairs : 0,
    openings: {
      length: OPENING_LEN,
      distinct: openingCount.size,
      runs: n,
      topShare: n ? Math.max(0, ...openingCount.values()) / n : 0,
    },
    repeat: { meanMax: n ? maxSum / n : 0, worstEventId: worstId, worstPerRun: worst },
    duplicateRunRate: n ? dup / n : 0,
  };
}

export function aggregateAnalytics(
  content: Content,
  runs: RunAnalytics[],
  maxDays = Infinity,
  /** 与 runs 一一对应的"结局@天数"，用于判断两局是否完全相同 */
  outcomes: string[] = [],
): AnalyticsSummary {
  const n = runs.length;

  // 死因
  const causeCount = new Map<string, { count: number; sample: DeathRecord }>();
  const firstDeath: number[] = [];
  let total = 0;
  for (const r of runs) {
    if (r.deaths.length) firstDeath.push(Math.min(...r.deaths.map((d) => d.day)));
    for (const d of r.deaths) {
      total++;
      const key = deathKey(d);
      const cur = causeCount.get(key);
      if (cur) cur.count++;
      else causeCount.set(key, { count: 1, sample: d });
    }
  }
  const causes = [...causeCount.entries()]
    .map(([key, v]) => ({
      key,
      label: deathLabel(content, v.sample),
      count: v.count,
      pct: total ? v.count / total : 0,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  // 每日曲线
  const maxDay = Math.min(maxDays, Math.max(0, ...runs.map((r) => r.aliveByDay.length)));
  const tags = content.config.rationTags;
  const timeline: TimelinePoint[] = [];
  for (let day = 1; day <= maxDay; day++) {
    const reached = runs.filter((r) => r.aliveByDay[day - 1] !== undefined);
    if (!reached.length) continue;
    const supply: TimelinePoint['supply'] = {};
    for (const tag of tags) {
      const vals = reached.map((r) => r.supplyByDay[tag]?.[day - 1] ?? 0);
      supply[tag] = {
        mean: vals.reduce((a, b) => a + b, 0) / vals.length,
        emptyRate: vals.filter((v) => v === 0).length / vals.length,
      };
    }
    timeline.push({
      day,
      running: n ? reached.length / n : 0,
      meanAlive: reached.reduce((a, r) => a + r.aliveByDay[day - 1], 0) / reached.length,
      supply,
    });
  }

  // 外出
  const rows = new Map<string, ExpeditionRow>();
  const rowOf = (id: string) => {
    let row = rows.get(id);
    if (!row) {
      row = { locationId: id, departed: 0, returned: 0, lost: 0, died: 0, other: 0, perRun: 0 };
      rows.set(id, row);
    }
    return row;
  };
  for (const r of runs) {
    for (const id of r.departures) rowOf(id).departed++;
    for (const e of r.expeditions) rowOf(e.locationId)[e.outcome]++;
  }
  const locOrder = content.db.locations.map((l) => l.id);
  const expeditions = [...rows.values()]
    .map((row) => ({ ...row, perRun: n ? row.departed / n : 0 }))
    .sort((a, b) => locOrder.indexOf(a.locationId) - locOrder.indexOf(b.locationId));

  // 事件选项
  const choiceTotals = new Map<string, ChoiceCount>();
  for (const r of runs) {
    for (const [key, c] of Object.entries(r.choices)) {
      const cur = choiceTotals.get(key) ?? { offered: 0, enabled: 0, picked: 0 };
      cur.offered += c.offered;
      cur.enabled += c.enabled;
      cur.picked += c.picked;
      choiceTotals.set(key, cur);
    }
  }
  const choices: ChoiceRow[] = [];
  for (const ev of content.db.events) {
    for (const c of ev.choices) {
      const t = choiceTotals.get(`${ev.id}/${c.id}`);
      if (t) choices.push({ eventId: ev.id, choiceId: c.id, ...t });
    }
  }

  return {
    deaths: {
      total,
      perRun: n ? total / n : 0,
      firstDeathDay: firstDeath.length ? stat(firstDeath) : null,
      causes,
    },
    timeline,
    expeditions,
    choices,
    diversity: computeDiversity(runs, outcomes),
  };
}

// ---------- 文本输出 ----------

const CHECKPOINTS = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200];
const DOMINANT_RATE = 0.95;
const MIN_SAMPLES = 30;

export interface FormatAnalyticsOptions {
  botName: string;
  /** 打印全部选项而不只是异常项 */
  detail?: boolean;
  /** 死因表最多显示几行 */
  topCauses?: number;
}

export function formatAnalytics(
  a: AnalyticsSummary,
  content: Content,
  opts: FormatAnalyticsOptions,
): string[] {
  const out: string[] = [];
  const tagName = (tag: string) => content.config.tagNames?.[tag] ?? tag;

  // 死因
  out.push('', '死亡 / 离队原因');
  if (!a.deaths.total) {
    out.push('  无人死亡或离队');
  } else {
    const f = a.deaths.firstDeathDay;
    out.push(
      `  共 ${a.deaths.total} 人次，场均 ${a.deaths.perRun.toFixed(2)}` +
        (f
          ? `；首个死亡日 中位 ${f.median.toFixed(0)}（p10 ${f.p10.toFixed(0)} / p90 ${f.p90.toFixed(0)}）`
          : ''),
    );
    const top = a.deaths.causes.slice(0, opts.topCauses ?? 10);
    out.push(
      ...table(
        ['原因', '人次', '占比'],
        top.map((c) => [c.label, String(c.count), pct(c.pct)]),
      ),
    );
    if (a.deaths.causes.length > top.length)
      out.push(`  … 另有 ${a.deaths.causes.length - top.length} 种原因（--json 查看全部）`);
  }

  // 曲线
  const days = a.timeline.map((p) => p.day);
  const lastDay = days[days.length - 1] ?? 0;
  const points = a.timeline.filter((p) => CHECKPOINTS.includes(p.day) || p.day === lastDay);
  if (points.length) {
    const tags = content.config.rationTags;
    out.push('', '每日曲线（到达该天的局）');
    out.push(
      ...table(
        [
          '第几天',
          '仍在继续',
          '平均活人',
          ...tags.flatMap((t) => [`${tagName(t)}库存`, `${tagName(t)}断供`]),
        ],
        points.map((p) => [
          String(p.day),
          pct(p.running, 0),
          p.meanAlive.toFixed(2),
          ...tags.flatMap((t) => [p.supply[t].mean.toFixed(1), pct(p.supply[t].emptyRate, 0)]),
        ]),
      ),
    );
  }

  // 外出
  if (a.expeditions.length) {
    out.push('', '外出');
    out.push(
      ...table(
        ['地点', '场均出发', '平安返回', '失踪', '途中死亡', '失踪率'],
        a.expeditions.map((e) => {
          const done = e.returned + e.lost + e.died;
          return [
            content.locations.get(e.locationId)?.name ?? e.locationId,
            e.perRun.toFixed(2),
            String(e.returned),
            String(e.lost),
            String(e.died),
            done ? pct(e.lost / done) : '-',
          ];
        }),
      ),
    );
  }

  // 多样性
  const dv = a.diversity;
  out.push('', '多样性（跨局）');
  out.push(
    `  事件分布熵 ${dv.eventEntropy.toFixed(2)}（1 = 各事件均匀出现）；局间事件集合平均相似度 ${dv.meanJaccard.toFixed(2)}（越低越多样）`,
    `  开场前 ${dv.openings.length} 个事件：${dv.openings.distinct} 种不同序列 / ${dv.openings.runs} 局，最常见的占 ${pct(dv.openings.topShare, 0)}`,
    `  单局内最频繁事件平均出现 ${dv.repeat.meanMax.toFixed(1)} 次` +
      (dv.repeat.worstEventId
        ? `；场均最多的是「${content.events.get(dv.repeat.worstEventId)?.title ?? dv.repeat.worstEventId}」${dv.repeat.worstPerRun.toFixed(1)} 次`
        : ''),
    `  结局、天数、事件序列都相同的局: ${pct(dv.duplicateRunRate)}`,
  );

  // 事件选项
  const evTitle = (id: string) => content.events.get(id)?.title ?? id;
  const choiceText = (e: string, c: string) =>
    content.events.get(e)?.choices.find((x) => x.id === c)?.text ?? c;
  const flagged: string[] = [];
  for (const c of a.choices) {
    const name = `「${evTitle(c.eventId)}」· ${choiceText(c.eventId, c.choiceId)}`;
    if (c.enabled === 0)
      flagged.push(`  从未可选: ${name}（出现 ${c.offered} 次，条件始终不满足）`);
    else if (c.picked === 0 && c.enabled >= MIN_SAMPLES / 3)
      flagged.push(`  从未被选: ${name}（可选 ${c.enabled} 次）`);
    else if (c.enabled >= MIN_SAMPLES && c.picked / c.enabled >= DOMINANT_RATE) {
      // 只有一个可选项的选项不算"压倒性"
      const siblings = a.choices.filter((x) => x.eventId === c.eventId && x.enabled > 0);
      if (siblings.length > 1)
        flagged.push(`  几乎总被选 (${pct(c.picked / c.enabled, 0)}): ${name}`);
    }
  }
  out.push('', `事件选项（策略 ${opts.botName}；想看选项覆盖请用 --bot random）`);
  if (opts.detail) {
    out.push(
      ...table(
        ['事件 / 选项', '出现', '可选率', '选择率'],
        a.choices.map((c) => [
          `${evTitle(c.eventId)} / ${choiceText(c.eventId, c.choiceId)}`,
          String(c.offered),
          c.offered ? pct(c.enabled / c.offered, 0) : '-',
          c.enabled ? pct(c.picked / c.enabled, 0) : '-',
        ]),
      ),
    );
  } else {
    out.push(...(flagged.length ? flagged : ['  没有异常选项（--detail 查看全部）']));
  }
  return out;
}
