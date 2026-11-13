/**
 * 不变量检查：每个动作之后对 RunState 做一遍体检，发现引擎 / 内容的隐性 bug。
 * 纯函数，零 DOM、零 Node 专属 API；不含任何内容 id。
 *
 * 两类检查：
 * - checkInvariants(content, run)：任何时刻都必须成立的状态约束
 * - checkTransition(before, after)：一步动作前后必须成立的约束（只增不减、不复活……）
 */
import { aliveIds, type Content, type RunState } from '../engine';

export interface Violation {
  /** 稳定的违规代码，用于按类别汇总，如 'stat.range' */
  code: string;
  message: string;
  day: number;
  /**
   * error = 一定是 bug，会让 sim / replay 以退出码 1 结束；
   * warning = 疑似问题（多半是流程设计缺口），只在报告里列出。
   */
  severity: 'error' | 'warning';
}

const WHERE = new Set(['shelter', 'away', 'dead', 'gone']);
const isDead = (where: string | undefined) => where === 'dead' || where === 'gone';

export function checkInvariants(content: Content, run: RunState): Violation[] {
  const out: Violation[] = [];
  const bad = (code: string, message: string, severity: Violation['severity'] = 'error') =>
    out.push({ code, message, day: run.day, severity });

  // ---- 流程 ----
  if (!Number.isInteger(run.day) || run.day < 1) bad('day.range', `day=${run.day}`);
  if (run.phase === 'ended' && !run.ending) bad('phase.ended-no-ending', 'phase=ended 但没有结局');
  if (run.ending && !content.endings.has(run.ending.id))
    bad('ending.unknown', `结局 id 不存在: ${run.ending.id}`);
  if (run.phase === 'event' && !run.pendingEvent)
    bad('phase.event-no-pending', 'phase=event 但没有待处理事件');
  if (run.phase === 'plan' && run.pendingEvent)
    bad('phase.plan-has-pending', `phase=plan 但仍有待处理事件 ${run.pendingEvent.eventId}`);
  if (!Number.isInteger(run.rng) || run.rng < 0 || run.rng > 0xffffffff)
    bad('rng.invalid', `rng=${run.rng}`);
  if (run.phase !== 'ended' && aliveIds(run).length === 0) {
    // 事件已选完、正在展示结果时全员死亡是合法的（玩家看完结果就进结局）；
    // 但事件还在等玩家做选择，说明全员消失后仍在弹新事件。
    if (run.phase === 'event') {
      if (!run.pendingEvent?.result)
        bad('phase.event-no-alive', '没有活人，但仍有新事件在等玩家做选择', 'warning');
    } else bad('phase.plan-no-alive', '没有活人但进入了计划阶段，对局未结束');
  }

  // ---- 队伍与角色 ----
  const partySet = new Set(run.party);
  if (partySet.size !== run.party.length) bad('party.duplicate', '队伍里有重复角色');
  for (const id of run.party) {
    if (!run.characters[id]) bad('party.missing-state', `队伍成员 ${id} 没有角色状态`);
  }
  for (const [key, ch] of Object.entries(run.characters)) {
    if (!partySet.has(key)) bad('party.orphan-state', `角色状态 ${key} 不在队伍里`);
    if (ch.id !== key) bad('char.id-mismatch', `角色状态键 ${key} 与 id ${ch.id} 不一致`);
    if (!WHERE.has(ch.where)) bad('char.where', `${key}.where=${ch.where}`);
    if (!content.characters.has(key)) bad('char.unknown', `角色 id 不存在: ${key}`);
    for (const s of content.db.stats) {
      const v = ch.stats[s.id];
      if (v === undefined) bad('stat.missing', `${key} 缺少属性 ${s.id}`);
      else if (!Number.isFinite(v)) bad('stat.nan', `${key}.${s.id}=${v}`);
      else if (v < s.min || v > s.max)
        bad('stat.range', `${key}.${s.id}=${v} 超出 [${s.min}, ${s.max}]`);
    }
    for (const id of Object.keys(ch.stats)) {
      if (!content.stats.has(id)) bad('stat.unknown', `${key} 有未知属性 ${id}`);
    }
    const seen = new Set<string>();
    for (const st of ch.statuses) {
      if (!content.statuses.has(st.id)) bad('status.unknown', `${key} 有未知状态 ${st.id}`);
      if (seen.has(st.id)) bad('status.duplicate', `${key} 重复拥有状态 ${st.id}`);
      seen.add(st.id);
      if (st.daysLeft !== undefined && !(Number.isFinite(st.daysLeft) && st.daysLeft >= 0))
        bad('status.days', `${key} 的状态 ${st.id} daysLeft=${st.daysLeft}`);
    }
  }

  // ---- 库存 / 标记 / 计数 ----
  for (const [id, n] of Object.entries(run.inventory)) {
    if (!content.items.has(id)) bad('inventory.unknown', `库存里有未知物品 ${id}`);
    if (!Number.isInteger(n) || n < 0) bad('inventory.count', `库存 ${id}=${n}`);
  }
  for (const [k, v] of Object.entries(run.flags)) {
    if (typeof v === 'number' && !Number.isFinite(v)) bad('flag.nan', `flag ${k}=${v}`);
  }
  for (const [k, v] of Object.entries(run.counters)) {
    if (!Number.isFinite(v) || v < 0) bad('counter.invalid', `counter ${k}=${v}`);
  }
  for (const [k, h] of Object.entries(run.history)) {
    if (!Number.isInteger(h.count) || h.count < 1)
      bad('history.count', `history ${k}.count=${h.count}`);
  }

  // ---- 外出 ----
  const away = Object.values(run.characters).filter((c) => c.where === 'away');
  const exp = run.expedition;
  if (exp) {
    if (away.length !== 1 || away[0].id !== exp.charId)
      bad(
        'expedition.away-mismatch',
        `外出者 ${exp.charId}，但 away 的角色是 [${away.map((c) => c.id)}]`,
      );
    if (!content.locations.has(exp.locationId))
      bad('expedition.unknown-location', `外出地点不存在: ${exp.locationId}`);
    if (exp.returnDay < run.day)
      bad(
        'expedition.overdue',
        `returnDay=${exp.returnDay} 早于当前第 ${run.day} 天，外出者回不来了`,
      );
  } else if (away.length) {
    bad('expedition.orphan-away', `没有外出但 [${away.map((c) => c.id)}] 的状态是 away`);
  }
  const planned = run.plan.expedition;
  if (planned && run.characters[planned.charId]?.where !== 'shelter')
    bad('plan.expedition-char', `外出计划的角色 ${planned.charId} 不在庇护所`);

  // ---- 队列与待处理事件 ----
  for (const q of run.eventQueue) {
    if (!content.events.has(q.eventId))
      bad('queue.unknown-event', `事件队列里有未知事件 ${q.eventId}`);
    for (const id of Object.values(q.roles)) {
      if (!run.characters[id])
        bad('queue.unknown-role', `队列事件 ${q.eventId} 绑定了不存在的角色 ${id}`);
    }
  }
  const pending = run.pendingEvent;
  if (pending) {
    if (!content.events.has(pending.eventId))
      bad('pending.unknown-event', `待处理事件不存在: ${pending.eventId}`);
    for (const id of Object.values(pending.roles)) {
      if (!run.characters[id]) bad('pending.unknown-role', `待处理事件绑定了不存在的角色 ${id}`);
    }
  }
  if (run.weather && !content.weathers.has(run.weather.id))
    bad('weather.unknown', `天气不存在: ${run.weather.id}`);
  for (const id of run.unlocked) {
    if (!content.characters.has(id)) bad('unlocked.unknown', `解锁了不存在的角色 ${id}`);
  }
  return out;
}

/** 一步动作（无错误）前后的约束 */
export function checkTransition(before: RunState, after: RunState): Violation[] {
  const out: Violation[] = [];
  const bad = (code: string, message: string) =>
    out.push({ code, message, day: after.day, severity: 'error' });

  if (
    after.seed !== before.seed ||
    after.mapId !== before.mapId ||
    after.difficultyId !== before.difficultyId
  )
    bad('trans.identity', 'seed / 地图 / 难度在局中发生了变化');
  if (after.day < before.day) bad('trans.day-regress', `day ${before.day} → ${after.day}`);
  if (after.day - before.day > 1)
    bad('trans.day-jump', `一步动作跳了 ${after.day - before.day} 天`);

  if (
    after.party.length < before.party.length ||
    before.party.some((id, i) => after.party[i] !== id)
  )
    bad('trans.party-changed', '队伍列表不是只增不减的追加');
  for (const [id, ch] of Object.entries(before.characters)) {
    if (isDead(ch.where) && after.characters[id]?.where !== ch.where)
      bad('trans.revive', `${id} 从 ${ch.where} 变成了 ${after.characters[id]?.where}`);
  }
  for (const [k, v] of Object.entries(before.counters)) {
    if ((after.counters[k] ?? 0) < v)
      bad('trans.counter-regress', `counter ${k}: ${v} → ${after.counters[k] ?? 0}`);
  }
  for (const [k, h] of Object.entries(before.history)) {
    if ((after.history[k]?.count ?? 0) < h.count)
      bad('trans.history-regress', `history ${k} 次数减少`);
  }
  for (const id of before.unlocked) {
    if (!after.unlocked.includes(id)) bad('trans.unlock-regress', `解锁的 ${id} 消失了`);
  }
  if (before.ending && after.ending?.id !== before.ending.id)
    bad('trans.ending-changed', `结局从 ${before.ending.id} 变成 ${after.ending?.id}`);
  return out;
}
