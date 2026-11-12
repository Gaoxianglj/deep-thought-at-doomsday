/** 结局判定：按 priority 从高到低，第一个 when 成立的结局生效。 */
import { evalCondition } from './conditions';
import { aliveIds, type Env } from './context';

/** 返回对局是否已结束；结束时会把 phase 置为 'ended'（若没有待处理事件）。 */
export function checkEndings(env: Env): boolean {
  const { run, content } = env;
  if (!run.ending) {
    const sorted = [...content.db.endings].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const hit = sorted.find((e) => e.when && evalCondition(env, {}, e.when));
    if (hit) run.ending = { id: hit.id, day: run.day };
    else if (aliveIds(run).length === 0) {
      run.ending = { id: content.config.fallbackEnding, day: run.day };
    }
  }
  if (run.ending && !run.pendingEvent) run.phase = 'ended';
  return !!run.ending;
}
