/**
 * 前后对比：比较两份 `npm run sim -- --out` 保存的汇总，只列出"超出噪声"的变化。
 * 比例类指标用两样本比例 z 检验（|z| > 2 记为显著）；天数 / 人数用均值差，标准差由 p10–p90 估计。
 * 同一批种子在改动前后会走向不同的局，这里按独立样本处理（偏保守）。
 * 零 DOM、零 Node 专属 API；不含任何内容 id。
 */
import type { Content } from '../engine';
import type { Summary } from './simulate';
import { pct, table } from './table';

const Z_SIGNIFICANT = 2;
/** p10–p90 约等于 ±1.28σ → σ ≈ (p90 − p10) / 2.56 */
const sdOf = (s: Summary) => Math.max((s.days.p90 - s.days.p10) / 2.56, 1e-9);

export interface ProportionDiff {
  before: number;
  after: number;
  delta: number;
  z: number;
  significant: boolean;
}

/** 两样本比例差（p 为 0–1）及 z 值 */
export function diffProportion(p1: number, n1: number, p2: number, n2: number): ProportionDiff {
  const pool = n1 + n2 ? (p1 * n1 + p2 * n2) / (n1 + n2) : 0;
  const se = Math.sqrt(pool * (1 - pool) * (1 / Math.max(n1, 1) + 1 / Math.max(n2, 1)));
  const z = se > 0 ? (p2 - p1) / se : 0;
  return { before: p1, after: p2, delta: p2 - p1, z, significant: Math.abs(z) > Z_SIGNIFICANT };
}

const sign = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '±');
const mark = (d: ProportionDiff) => (d.significant ? (d.delta > 0 ? '▲' : '▼') : '·');
const ppt = (x: number) => `${sign(x)}${Math.abs(x * 100).toFixed(1)}pp`;

export function compareSummaries(before: Summary[], after: Summary[], content: Content): string {
  const out: string[] = [];
  const unmatched = before.filter((b) => !after.some((a) => a.difficultyId === b.difficultyId));
  if (unmatched.length)
    out.push(
      `（以下难度只在改动前出现，已跳过: ${unmatched.map((u) => u.difficultyId).join('、')}）`,
    );
  for (const a of after) {
    const b = before.find((x) => x.difficultyId === a.difficultyId);
    if (!b) {
      out.push(`（难度 ${a.difficultyId} 只在改动后出现，已跳过）`);
      continue;
    }
    out.push(...compareOne(b, a, content), '');
  }
  return out.join('\n').trimEnd();
}

function compareOne(b: Summary, a: Summary, content: Content): string[] {
  const out: string[] = [];
  const diffName = content.difficulties.get(a.difficultyId)?.name ?? a.difficultyId;
  out.push(
    `== ${diffName}：改动前 ${b.runs} 局 → 改动后 ${a.runs} 局（策略 ${b.botName} → ${a.botName}）==`,
  );
  if (b.botName !== a.botName || b.mapId !== a.mapId)
    out.push('  ⚠ 策略或地图不同，对比可能没有意义');
  out.push('  ▲▼ = 显著变化（|z|>2）；· = 噪声范围内', '');

  // 概览
  const win = diffProportion(b.winRate, b.runs, a.winRate, a.runs);
  const daysSe = Math.sqrt(sdOf(b) ** 2 / b.runs + sdOf(a) ** 2 / a.runs);
  const dDays = a.days.mean - b.days.mean;
  const daysSig = daysSe > 0 && Math.abs(dDays / daysSe) > Z_SIGNIFICANT;
  const dSurv = a.survivors.mean - b.survivors.mean;
  out.push(
    ...table(
      ['指标', '改动前', '改动后', '变化', ''],
      [
        ['通关率', pct(b.winRate), pct(a.winRate), ppt(win.delta), mark(win)],
        [
          '平均存活天数',
          b.days.mean.toFixed(1),
          a.days.mean.toFixed(1),
          `${sign(dDays)}${Math.abs(dDays).toFixed(1)}`,
          daysSig ? (dDays > 0 ? '▲' : '▼') : '·',
        ],
        [
          '存活天数中位',
          b.days.median.toFixed(1),
          a.days.median.toFixed(1),
          `${sign(a.days.median - b.days.median)}${Math.abs(a.days.median - b.days.median).toFixed(1)}`,
          '',
        ],
        [
          '平均幸存人数',
          b.survivors.mean.toFixed(2),
          a.survivors.mean.toFixed(2),
          `${sign(dSurv)}${Math.abs(dSurv).toFixed(2)}`,
          '',
        ],
      ],
    ),
  );

  // 结局
  const endingName = (id: string) =>
    id === 'timeout'
      ? '超时'
      : id === 'stuck'
        ? '卡死'
        : id === 'crashed'
          ? '崩溃'
          : (content.endings.get(id)?.name ?? id);
  const ids = [...new Set([...b.endings.map((e) => e.id), ...a.endings.map((e) => e.id)])];
  const endingRows = ids.map((id) => {
    const eb = b.endings.find((e) => e.id === id);
    const ea = a.endings.find((e) => e.id === id);
    const d = diffProportion((eb?.pct ?? 0) / 100, b.runs, (ea?.pct ?? 0) / 100, a.runs);
    return [endingName(id), pct(d.before), pct(d.after), ppt(d.delta), mark(d)];
  });
  out.push('', '结局占比', ...table(['结局', '改动前', '改动后', '变化', ''], endingRows));

  // 死因（占全部死亡 / 离队人次的比例；只列变化 ≥ 2pp 的前 6 个）
  const causeKeys = new Map<string, string>();
  for (const c of [...b.analytics.deaths.causes, ...a.analytics.deaths.causes])
    causeKeys.set(c.key, c.label);
  const causeRows = [...causeKeys.entries()]
    .map(([key, label]) => {
      const cb = b.analytics.deaths.causes.find((c) => c.key === key)?.pct ?? 0;
      const ca = a.analytics.deaths.causes.find((c) => c.key === key)?.pct ?? 0;
      return { label, cb, ca, delta: ca - cb };
    })
    .filter((r) => Math.abs(r.delta) >= 0.02)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 6);
  out.push(
    '',
    `死因占比变化（共 ${b.analytics.deaths.total} → ${a.analytics.deaths.total} 人次；只列变化 ≥ 2pp）`,
  );
  out.push(
    ...(causeRows.length
      ? table(
          ['原因', '改动前', '改动后', '变化'],
          causeRows.map((r) => [r.label, pct(r.cb), pct(r.ca), ppt(r.delta)]),
        )
      : ['  无明显变化']),
  );

  // 外出
  const locIds = [
    ...new Set([...b.analytics.expeditions, ...a.analytics.expeditions].map((e) => e.locationId)),
  ];
  const expRows = locIds.map((id) => {
    const eb = b.analytics.expeditions.find((e) => e.locationId === id);
    const ea = a.analytics.expeditions.find((e) => e.locationId === id);
    const lossOf = (e: typeof eb) => {
      const done = e ? e.returned + e.lost + e.died : 0;
      return done ? e!.lost / done : 0;
    };
    return [
      content.locations.get(id)?.name ?? id,
      (eb?.perRun ?? 0).toFixed(2),
      (ea?.perRun ?? 0).toFixed(2),
      pct(lossOf(eb)),
      pct(lossOf(ea)),
    ];
  });
  if (expRows.length) {
    out.push(
      '',
      '外出',
      ...table(['地点', '场均出发(前)', '场均出发(后)', '失踪率(前)', '失踪率(后)'], expRows),
    );
  }

  // 曲线检查点：仍在继续的比例、配给断供率
  const tags = content.config.rationTags;
  const tagName = (t: string) => content.config.tagNames?.[t] ?? t;
  const checkpoints = [10, 30, 50, 100].filter(
    (d) =>
      b.analytics.timeline.some((p) => p.day === d) ||
      a.analytics.timeline.some((p) => p.day === d),
  );
  if (checkpoints.length) {
    const rows = checkpoints.map((day) => {
      const pb = b.analytics.timeline.find((p) => p.day === day);
      const pa = a.analytics.timeline.find((p) => p.day === day);
      const f = (p: typeof pb, tag?: string) =>
        p ? pct(tag ? p.supply[tag].emptyRate : p.running, 0) : '-';
      return [`第 ${day} 天`, f(pb), f(pa), ...tags.flatMap((t) => [f(pb, t), f(pa, t)])];
    });
    out.push(
      '',
      '每日曲线检查点（仍在继续比例 / 各配给断供率）',
      ...table(
        [
          '',
          '继续(前)',
          '继续(后)',
          ...tags.flatMap((t) => [`${tagName(t)}断供(前)`, `${tagName(t)}断供(后)`]),
        ],
        rows,
      ),
    );
  }

  // 事件触发率变化 ≥ 5pp、从未触发集合变化
  const evIds = [...new Set([...b.events, ...a.events].map((e) => e.id))];
  const evRows = evIds
    .map((id) => {
      const eb = b.events.find((e) => e.id === id)?.triggerRate ?? 0;
      const ea = a.events.find((e) => e.id === id)?.triggerRate ?? 0;
      return { id, eb, ea, delta: ea - eb };
    })
    .filter((r) => Math.abs(r.delta) >= 0.05)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 8);
  if (evRows.length) {
    out.push(
      '',
      '事件触发率变化（≥ 5pp）',
      ...table(
        ['事件', '改动前', '改动后', '变化'],
        evRows.map((r) => [
          content.events.get(r.id)?.title ?? r.id,
          pct(r.eb, 0),
          pct(r.ea, 0),
          ppt(r.delta),
        ]),
      ),
    );
  }
  const newlyNever = a.neverTriggered.filter((id) => !b.neverTriggered.includes(id));
  const noLongerNever = b.neverTriggered.filter((id) => !a.neverTriggered.includes(id));
  const titles = (xs: string[]) => xs.map((id) => content.events.get(id)?.title ?? id).join('、');
  if (newlyNever.length) out.push('', `⚠ 改动后新增"从未触发"的事件: ${titles(newlyNever)}`);
  if (noLongerNever.length) out.push('', `改动后不再是"从未触发"的事件: ${titles(noLongerNever)}`);

  // 健康
  const codesB = new Set(b.violations.map((v) => v.code));
  const newCodes = a.violations.filter((v) => !codesB.has(v.code));
  out.push('', `健康检查：有问题的局 ${b.failedRuns} → ${a.failedRuns}`);
  for (const v of newCodes)
    out.push(`  ⚠ 新增违规 [${v.severity}] ${v.code}（${v.runs} 局）种子 ${v.seeds.join(', ')}`);
  return out;
}
