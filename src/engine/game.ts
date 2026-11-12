/**
 * 引擎对外 API。UI / 存档 / 模拟器只从这里（或 ./index）导入。
 * 引擎是纯逻辑：applyAction 不修改传入的 state，返回新 state。
 */
import type { Content } from './content';
import { itemCount, type Env } from './context';
import { consumeItemOn, endDay } from './day';
import { chooseEventOption, continueEvent } from './events';
import { validateExpeditionPlan } from './expedition';
import type { ExpeditionPlan, RunState } from './schema';

export type Action =
  | { type: 'chooseEventOption'; choiceId: string }
  | { type: 'continueEvent' }
  /** itemId 为 null = 清空该配给槽 */
  | { type: 'setRation'; charId: string; tag: string; itemId: string | null }
  | { type: 'useItem'; itemId: string; charId: string }
  | ({ type: 'planExpedition' } & ExpeditionPlan)
  | { type: 'cancelExpedition' }
  | { type: 'endDay' };

export interface ActionResult {
  state: RunState;
  /** 动作不合法时的错误码；此时 state 是原对象，未发生任何变化 */
  error?: string;
}

export function applyAction(state: RunState, action: Action, content: Content): ActionResult {
  if (state.phase === 'ended') return { state, error: 'runEnded' };
  const env: Env = { run: structuredClone(state), content };
  const error = dispatch(env, action);
  return error ? { state, error } : { state: env.run };
}

function dispatch(env: Env, a: Action): string | null {
  const { run, content } = env;
  switch (a.type) {
    case 'chooseEventOption':
      return chooseEventOption(env, a.choiceId);
    case 'continueEvent':
      return continueEvent(env);
    case 'endDay':
      return endDay(env);
    case 'setRation': {
      if (run.phase !== 'plan') return 'notPlanPhase';
      if (run.characters[a.charId]?.where !== 'shelter') return 'charUnavailable';
      if (!content.config.rationTags.includes(a.tag)) return 'unknownRationTag';
      const slots = (run.plan.rations[a.charId] ??= {});
      if (a.itemId === null) {
        delete slots[a.tag];
        return null;
      }
      if (!content.items.get(a.itemId)?.tags.includes(a.tag)) return 'itemWrongTag';
      if (itemCount(run, a.itemId) < 1) return 'itemMissing';
      slots[a.tag] = a.itemId;
      return null;
    }
    case 'useItem': {
      if (run.phase !== 'plan') return 'notPlanPhase';
      if (run.characters[a.charId]?.where !== 'shelter') return 'charUnavailable';
      if (!content.items.get(a.itemId)?.manualUse) return 'itemNotUsable';
      return consumeItemOn(env, a.itemId, a.charId) ? null : 'itemMissing';
    }
    case 'planExpedition': {
      if (run.phase !== 'plan') return 'notPlanPhase';
      const plan: ExpeditionPlan = {
        charId: a.charId,
        locationId: a.locationId,
        carry: [...a.carry],
      };
      if (a.vehicleId) plan.vehicleId = a.vehicleId;
      const error = validateExpeditionPlan(env, plan);
      if (error) return error;
      run.plan.expedition = plan;
      return null;
    }
    case 'cancelExpedition':
      if (run.phase !== 'plan') return 'notPlanPhase';
      delete run.plan.expedition;
      return null;
    default: {
      const exhaustive: never = a;
      return exhaustive;
    }
  }
}

/** 角色当前的美术状态名（public/art/characters/<id>/<状态>.png），无特殊状态为 'normal'。 */
export function getArtState(run: RunState, content: Content, charId: string): string {
  let best: { artState: string; priority: number } | undefined;
  for (const s of run.characters[charId]?.statuses ?? []) {
    const def = content.statuses.get(s.id);
    if (def?.artState && (!best || (def.priority ?? 0) > best.priority)) {
      best = { artState: def.artState, priority: def.priority ?? 0 };
    }
  }
  return best?.artState ?? 'normal';
}
