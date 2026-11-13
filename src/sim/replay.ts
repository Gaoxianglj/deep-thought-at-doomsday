/**
 * 回放：按种子重跑一局，把过程记录成逐日轨迹（供人或 AI 阅读，找 bug / 看平衡）。
 * 同 seed + 同地图 / 难度 / bot / 解锁 / 天数上限 → 与批量模拟里的那一局完全一致。
 * 零 DOM、零 Node 专属 API；不含任何内容 id。
 */
import { getEventView, type Action, type Content, type LogEntry, type RunState } from '../engine';
import { simulateRun, type RunOptions, type RunResult } from './simulate';

export interface CharSnapshot {
  id: string;
  where: string;
  stats: Record<string, number>;
  statuses: { id: string; daysLeft?: number }[];
}

export interface DaySnapshot {
  day: number;
  weather?: string;
  inventory: Record<string, number>;
  characters: CharSnapshot[];
}

export interface ReplayEvent {
  id: string;
  title: string;
  text: string;
  choices: { id: string; text: string; enabled: boolean; hint?: string }[];
  picked: string;
  result?: string;
}

export interface ReplayStep {
  index: number;
  /** 动作执行前的天数 */
  day: number;
  action: Action;
  error?: string;
  event?: ReplayEvent;
  /** 这一步新增的日志 */
  logs: LogEntry[];
  /** 这一步让天数前进时，新一天开始的状态 */
  newDay?: DaySnapshot;
}

export interface Replay {
  result: RunResult;
  start: DaySnapshot;
  steps: ReplayStep[];
}

export type ReplayOptions = Omit<RunOptions, 'observer'>;

function snapshot(run: RunState): DaySnapshot {
  return {
    day: run.day,
    weather: run.weather?.id,
    inventory: { ...run.inventory },
    characters: run.party.map((id) => {
      const c = run.characters[id];
      return {
        id,
        where: c.where,
        stats: { ...c.stats },
        statuses: c.statuses.map((s) => ({ id: s.id, daysLeft: s.daysLeft })),
      };
    }),
  };
}

/** after.log 相对 before.log 新增的条目（trimLog 可能从头部丢掉旧条目） */
export function newLogEntries(before: LogEntry[], after: LogEntry[]): LogEntry[] {
  const same = (a: LogEntry, b: LogEntry) =>
    a.day === b.day && a.kind === b.kind && a.text === b.text;
  for (let trimmed = 0; trimmed <= before.length; trimmed++) {
    const kept = before.length - trimmed;
    if (kept > after.length) continue;
    let ok = true;
    for (let i = 0; i < kept && ok; i++) ok = same(before[trimmed + i], after[i]);
    if (ok) return after.slice(kept);
  }
  return after;
}

export function replayRun(content: Content, opts: ReplayOptions): Replay {
  const steps: ReplayStep[] = [];
  let start: DaySnapshot = { day: 1, inventory: {}, characters: [] };
  const result = simulateRun(content, {
    ...opts,
    observer: {
      start(run) {
        start = snapshot(run);
      },
      step({ index, before, action, after, error }) {
        const step: ReplayStep = {
          index,
          day: before.day,
          action,
          logs: error ? [] : newLogEntries(before.log, after.log),
        };
        if (error) step.error = error;
        if (!error && action.type === 'chooseEventOption' && before.pendingEvent) {
          const view = getEventView({ run: structuredClone(before), content });
          if (view) {
            step.event = {
              id: view.eventId,
              title: view.title,
              text: view.text,
              choices: view.choices,
              picked: action.choiceId,
              result: after.pendingEvent?.result?.text,
            };
          }
        }
        if (!error && after.day !== before.day) step.newDay = snapshot(after);
        steps.push(step);
      },
    },
  });
  return { result, start, steps };
}

// ---------- 文本输出 ----------

export interface FormatReplayOptions {
  fromDay?: number;
  toDay?: number;
  /** 只保留事件、外出与日志，不打印每日角色表与配给 / 用药操作 */
  brief?: boolean;
}

export function formatReplay(
  content: Content,
  replay: Replay,
  header: string,
  opts: FormatReplayOptions = {},
): string {
  const { result, start, steps } = replay;
  const from = opts.fromDay ?? 1;
  const to = opts.toDay ?? Infinity;
  const inRange = (d: number) => d >= from && d <= to;
  const out: string[] = [header];

  const charName = (id: string) => content.characters.get(id)?.name ?? id;
  const itemName = (id: string) => content.items.get(id)?.name ?? id;
  const statName = (id: string) => content.stats.get(id)?.name ?? id;
  const statusName = (id: string) => content.statuses.get(id)?.name ?? id;
  const locName = (id: string) => content.locations.get(id)?.name ?? id;
  const tagName = (tag: string) => content.config.tagNames?.[tag] ?? tag;

  const whereLabel = (c: CharSnapshot) =>
    c.where === 'shelter'
      ? '庇护所'
      : c.where === 'away'
        ? '外出中'
        : c.where === 'dead'
          ? '已死亡'
          : '已离队';

  const dayHeader = (s: DaySnapshot) => {
    const alive = s.characters.filter((c) => c.where === 'shelter' || c.where === 'away').length;
    const weather = s.weather
      ? `  天气: ${content.weathers.get(s.weather)?.name ?? s.weather}`
      : '';
    out.push('', `── 第 ${s.day} 天 ──  存活 ${alive} 人${weather}`);
    if (opts.brief) return;
    for (const c of s.characters) {
      if (c.where === 'dead' || c.where === 'gone') {
        out.push(`  ${charName(c.id)}（${whereLabel(c)}）`);
        continue;
      }
      const stats = content.db.stats.map((d) => `${statName(d.id)} ${c.stats[d.id]}`).join('  ');
      const sts = c.statuses.length
        ? `  状态: ${c.statuses.map((x) => statusName(x.id) + (x.daysLeft !== undefined ? `(${x.daysLeft}天)` : '')).join('、')}`
        : '';
      out.push(`  ${charName(c.id)}（${whereLabel(c)}）  ${stats}${sts}`);
    }
    const inv = Object.entries(s.inventory)
      .map(([id, n]) => `${itemName(id)}×${n}`)
      .join('、');
    out.push(`  库存: ${inv || '空'}`);
  };

  const logLines = (logs: LogEntry[]) => {
    for (const l of logs) out.push(`  · [${l.kind}] ${l.text}`);
  };

  const actionLines = (step: ReplayStep) => {
    const a = step.action;
    if (step.error) {
      out.push(`  ✗ 动作被拒绝（${step.error}）: ${JSON.stringify(a)}`);
      return;
    }
    switch (a.type) {
      case 'chooseEventOption': {
        const ev = step.event;
        if (!ev) {
          out.push(`  选择了选项 ${a.choiceId}`);
          break;
        }
        out.push(`  ◆ 事件《${ev.title}》${ev.text}`);
        out.push(
          `      选项: ${ev.choices
            .map(
              (c) =>
                `${c.id === ev.picked ? '▶' : ' '}${c.text}${c.enabled ? '' : `（不可选${c.hint ? ': ' + c.hint : ''}）`}`,
            )
            .join(' | ')}`,
        );
        if (ev.result) out.push(`      结果: ${ev.result}`);
        break;
      }
      case 'continueEvent':
        break;
      case 'setRation':
        if (!opts.brief)
          out.push(
            `  配给 ${charName(a.charId)}: ${tagName(a.tag)} ← ${a.itemId ? itemName(a.itemId) : '（清空）'}`,
          );
        break;
      case 'useItem':
        out.push(`  使用 ${itemName(a.itemId)} → ${charName(a.charId)}`);
        break;
      case 'planExpedition':
        out.push(
          `  外出计划: ${charName(a.charId)} → ${locName(a.locationId)}` +
            (a.carry.length ? `（携带 ${a.carry.map(itemName).join('、')}）` : ''),
        );
        break;
      case 'cancelExpedition':
        out.push('  取消外出计划');
        break;
      case 'endDay':
        out.push('  结束这一天');
        break;
    }
  };

  // 开局
  if (inRange(1)) {
    const party = start.characters.map((c) => charName(c.id)).join('、') || '（空）';
    out.push('', `开局队伍: ${party}`);
    dayHeader(start);
  }

  for (const step of steps) {
    const show = inRange(step.day);
    const newDay = step.newDay?.day;
    const morning = newDay === undefined ? [] : step.logs.filter((l) => l.day === newDay);
    const night = newDay === undefined ? step.logs : step.logs.filter((l) => l.day !== newDay);
    if (show) {
      actionLines(step);
      logLines(night);
    }
    if (step.newDay && inRange(step.newDay.day)) {
      dayHeader(step.newDay);
      logLines(morning);
    }
  }

  // 结局
  out.push('');
  if (result.crash) {
    out.push(`✗ 崩溃（${result.crash.stage}）: ${result.crash.message}`);
    if (result.crash.action) out.push(`  动作: ${result.crash.action}`);
    if (result.crash.stack) out.push(...result.crash.stack.split('\n').map((l) => `  ${l}`));
  } else if (result.ending === 'timeout') {
    out.push(`═ 超时（到第 ${result.days} 天仍未结束），幸存 ${result.survivors} 人`);
  } else if (result.ending === 'stuck') {
    out.push(`═ 卡死: ${result.lastError ?? '未知原因'}`);
  } else {
    const e = content.endings.get(result.ending);
    out.push(
      `═ 结局「${e?.name ?? result.ending}」第 ${result.days} 天，幸存 ${result.survivors} 人`,
    );
    if (e?.text) out.push(`  ${e.text}`);
  }
  if (result.violations.length) {
    out.push('', '不变量违规:');
    for (const v of result.violations) out.push(`  [${v.code}] 第 ${v.day} 天: ${v.message}`);
  }
  return out.join('\n');
}
