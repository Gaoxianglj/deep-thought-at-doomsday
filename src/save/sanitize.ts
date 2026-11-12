/**
 * 失效引用修复（docs/DESIGN.md 第 7 节）：内容被删除/改名后，旧存档仍能读。
 * 纯函数：不修改传入的 run，返回修复后的副本和给玩家看的中文提示。
 */
import type { Content } from '../engine/content';
import type { RunState } from '../engine/schema';

export interface SanitizeResult {
  run: RunState | null;
  notices: string[];
}

export function sanitizeRun(input: RunState, content: Content): SanitizeResult {
  const notices: string[] = [];
  const run: RunState = structuredClone(input);
  const ended = run.ending !== null || run.phase === 'ended';

  if (!content.maps.has(run.mapId)) {
    return {
      run: null,
      notices: ['这局所在的地图已从游戏中移除，对局无法继续（档案和解锁已保留）。'],
    };
  }
  if (!content.difficulties.has(run.difficultyId)) {
    return {
      run: null,
      notices: ['这局使用的难度已从游戏中移除，对局无法继续（档案和解锁已保留）。'],
    };
  }

  const knownItem = (id: string) => content.items.has(id);
  const returnItems = (ids: string[]) => {
    for (const id of ids) if (knownItem(id)) run.inventory[id] = (run.inventory[id] ?? 0) + 1;
  };

  // ---- 角色 ----
  const removedChars: string[] = [];
  for (const id of Object.keys(run.characters)) {
    if (!content.characters.has(id)) {
      delete run.characters[id];
      removedChars.push(id);
    }
  }
  for (const id of run.party) {
    if (!content.characters.has(id) && !removedChars.includes(id)) removedChars.push(id);
  }
  // party 里有但 characters 里没有状态的也视为失效
  run.party = run.party.filter((id) => content.characters.has(id) && run.characters[id]);
  if (removedChars.length) {
    notices.push(`有 ${removedChars.length} 名角色已从游戏中移除，已离开队伍。`);
  }
  const knownChar = (id: string) => !!run.characters[id];

  for (const ch of Object.values(run.characters)) {
    const def = content.characters.get(ch.id);
    const stats: Record<string, number> = {};
    for (const [sid, sdef] of content.stats) {
      const v = ch.stats[sid];
      stats[sid] = typeof v === 'number' ? v : (def?.stats?.[sid] ?? sdef.initial);
    }
    ch.stats = stats;
    ch.statuses = ch.statuses.filter((s) => content.statuses.has(s.id));
  }

  // ---- 库存 ----
  for (const id of Object.keys(run.inventory)) if (!knownItem(id)) delete run.inventory[id];

  // ---- 进行中的外出 ----
  if (run.expedition) {
    const exp = run.expedition;
    const loc = content.locations.get(exp.locationId);
    if (!knownChar(exp.charId)) {
      returnItems(exp.carry);
      run.expedition = null;
    } else if (!loc || loc.map !== run.mapId) {
      const ch = run.characters[exp.charId];
      if (ch.where === 'away') ch.where = 'shelter';
      returnItems(exp.carry);
      run.expedition = null;
      notices.push(
        `${content.characters.get(exp.charId)?.name ?? '外出的人'}要去的地点已不存在，已提前回到庇护所，携带的物品已归还。`,
      );
    } else {
      exp.carry = exp.carry.filter(knownItem);
      if (exp.vehicleId !== undefined && !knownItem(exp.vehicleId)) delete exp.vehicleId;
    }
  }
  // 状态为外出、却没有对应外出记录的人，直接回到庇护所
  for (const ch of Object.values(run.characters)) {
    if (ch.where === 'away' && run.expedition?.charId !== ch.id) ch.where = 'shelter';
  }

  // ---- 计划 ----
  const rations: RunState['plan']['rations'] = {};
  for (const [cid, slots] of Object.entries(run.plan.rations)) {
    if (!knownChar(cid)) continue;
    const kept: Record<string, string> = {};
    for (const [tag, item] of Object.entries(slots)) if (knownItem(item)) kept[tag] = item;
    rations[cid] = kept;
  }
  run.plan.rations = rations;
  const planExp = run.plan.expedition;
  if (planExp) {
    const loc = content.locations.get(planExp.locationId);
    if (!knownChar(planExp.charId) || !loc || loc.map !== run.mapId) {
      delete run.plan.expedition;
    } else {
      planExp.carry = planExp.carry.filter(knownItem);
      if (planExp.vehicleId !== undefined && !knownItem(planExp.vehicleId)) {
        delete planExp.vehicleId;
      }
    }
  }

  // ---- 事件 ----
  const rolesOk = (roles: Record<string, string>) => Object.values(roles).every(knownChar);
  if (run.pendingEvent) {
    const pe = run.pendingEvent;
    const ev = content.events.get(pe.eventId);
    const valid =
      !!ev &&
      rolesOk(pe.roles) &&
      (!pe.result || ev.choices.some((c) => c.id === pe.result!.choiceId)) &&
      (!pe.result?.next || content.events.has(pe.result.next));
    if (!valid) {
      run.pendingEvent = null;
      run.phase = ended ? 'ended' : 'plan';
      notices.push('当前事件已从游戏中移除，已跳过。');
    }
  }
  const queueBefore = run.eventQueue.length;
  run.eventQueue = run.eventQueue.filter((q) => content.events.has(q.eventId) && rolesOk(q.roles));
  if (run.eventQueue.length < queueBefore) notices.push('部分即将发生的事件已失效，已移除。');

  if (run.weather && !content.weathers.has(run.weather.id)) run.weather = null;

  // ---- 队伍是否还有人 ----
  const anyAlive = run.party.some((id) => {
    const w = run.characters[id]?.where;
    return w === 'shelter' || w === 'away';
  });
  if (!anyAlive && !ended) {
    return {
      run: null,
      notices: [...notices, '这局的队伍成员已全部从游戏中移除，对局无法继续（档案和解锁已保留）。'],
    };
  }

  return { run, notices };
}
