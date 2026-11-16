/**
 * 文本试玩：把一局游戏渲染成纯文本，并把简短的文字命令解析成 Action，
 * 让 LLM（或人）通过命令行当玩家。会话 = 开局设置 + 动作列表 + 笔记；
 * 每次调用都由"开局 + 全部动作"重建当前状态（引擎是确定性的），所以不需要存 RunState。
 * 零 DOM、零 Node 专属 API（读写文件由 scripts/play.ts 负责）；不含任何内容 id。
 *
 * 信息量与真实界面对齐：地点只给描述、天数、危险等级（1–5 档），不给战利品表与精确概率。
 */
import {
  applyAction,
  getEventView,
  getNotes,
  newRun,
  pointsCost,
  shelterIds,
  validateExpeditionPlan,
  validateSetup,
  type Action,
  type Content,
  type Env,
  type ExpeditionPlan,
  type RunState,
} from '../engine';
import { newLogEntries } from './replay';

export interface PlaySetup {
  seed: string;
  mapId: string;
  difficultyId: string;
  party: string[];
  items: Record<string, number>;
  unlocked: string[];
}

export interface PlaySession {
  version: 1;
  setup: PlaySetup;
  actions: Action[];
  notes: { day: number; text: string }[];
}

export type ErrorText = (code: string) => string;
const defaultErrorText: ErrorText = (code) => `操作无效（${code}）`;

// ---------- 会话 ----------

/** 由开局 + 动作重建当前状态；某个动作重放失败说明会话文件损坏或内容已变 */
export function loadRun(content: Content, session: PlaySession): RunState {
  let run = newRun(content, session.setup);
  session.actions.forEach((action, i) => {
    const res = applyAction(run, action, content);
    if (res.error)
      throw new Error(`会话第 ${i + 1} 个动作重放失败（${res.error}）：内容可能已变化`);
    run = res.state;
  });
  return run;
}

/** 容错版重放：遇到重放失败的动作就停下，返回停在失败前的状态与失败的步序号（从 1 数起） */
export function tryLoadRun(
  content: Content,
  session: PlaySession,
): { run: RunState; failedAt?: number; error?: string } {
  let run: RunState;
  try {
    run = newRun(content, session.setup);
  } catch (e) {
    return { run: undefined as unknown as RunState, failedAt: 0, error: String(e) };
  }
  for (let i = 0; i < session.actions.length; i++) {
    const res = applyAction(run, session.actions[i], content);
    if (res.error) return { run, failedAt: i + 1, error: res.error };
    run = res.state;
  }
  return { run };
}

/** 会话无法完整重放时给玩家看的说明 */
export function staleSessionMessage(failedAt: number): string {
  return failedAt === 0
    ? '内容已变化，这个会话的开局设置已无法使用。note / report 仍可用；要继续玩请重新开局（new）。'
    : `内容已变化，这个会话在第 ${failedAt} 步之后无法重放，所以无法显示或继续。note / report 仍可用（report 会标明失败位置）；要继续玩请重新开局（new）。`;
}

/** 校验开局设置；返回人话错误列表（空 = 合法） */
export function checkSetup(
  content: Content,
  setup: PlaySetup,
  errorText: ErrorText = defaultErrorText,
) {
  return validateSetup(content, setup).map(errorText);
}

// ---------- 渲染 ----------

const dangerLevel = (danger: number) => Math.max(1, Math.min(5, Math.ceil(danger / 0.1 - 1e-9)));
const DANGER_WORDS = [
  '比较安全',
  '有些风险',
  '有风险，可能受伤',
  '很危险，可能受伤甚至一去不回',
  '极度危险，很可能一去不回',
];

/** 配给与外出携带共需超过库存的物品（文字提醒用） */
export function rationOverages(content: Content, run: RunState): string[] {
  const used = new Map<string, number>();
  for (const id of run.plan.expedition?.carry ?? []) used.set(id, (used.get(id) ?? 0) + 1);
  for (const cid of shelterIds(run))
    for (const itemId of Object.values(run.plan.rations[cid] ?? {}))
      used.set(itemId, (used.get(itemId) ?? 0) + 1);
  return [...used]
    .filter(([id, n]) => n > (run.inventory[id] ?? 0))
    .map(
      ([id, n]) =>
        `${content.items.get(id)?.name ?? id}：已分配 ${n} 份，库存只有 ${run.inventory[id] ?? 0}（入夜时先到先得，后面的人会吃不到）`,
    );
}

const tagLabel = (content: Content, tag: string) => content.config.tagNames?.[tag] ?? tag;

/** 开局可选项一览（给玩家选队伍与物资用） */
export function describeInfo(
  content: Content,
  mapId: string,
  difficultyId: string,
  unlocked: string[],
): string {
  const map = content.maps.get(mapId);
  const diff = content.difficulties.get(difficultyId);
  if (!map || !diff) return '未知的地图或难度。';
  const out: string[] = [];
  out.push(
    `可选地图: ${content.db.maps.map((m) => `${m.name}[${m.id}]`).join('、')}（当前 ${map.name}）`,
    `可选难度: ${content.db.difficulties.map((d) => `${d.name}[${d.id}]（${d.points} 点）`).join('、')}（当前 ${diff.name}）`,
  );
  if (map.desc) out.push(`地图简介: ${map.desc}`);
  out.push(
    '',
    `队伍人数 ${map.partySize.min}–${map.partySize.max} 人；总点数 ${diff.points}（伙伴与物资共用）`,
  );
  out.push('', '伙伴:');
  for (const c of content.db.characters.filter((c) => unlocked.includes(c.id))) {
    const traits = c.traits?.map((t) => `${t.name}：${t.desc ?? ''}`).join('；');
    out.push(
      `  ${c.name}[${c.id}]  花费 ${c.cost ?? 0}  ${c.desc ?? ''}${traits ? `  特性: ${traits}` : ''}`,
    );
  }
  out.push('', '可购买的物资（每件花费点数）:');
  for (const id of map.startingPool) {
    const it = content.items.get(id);
    if (!it || it.cost === undefined) continue;
    out.push(
      `  ${it.name}[${it.id}]  花费 ${it.cost}` +
        (it.maxAtStart !== undefined ? `  最多 ${it.maxAtStart}` : '') +
        `  ${it.desc ?? ''}`,
    );
  }
  const free = Object.entries(map.startingItems ?? {})
    .map(([id, n]) => `${content.items.get(id)?.name ?? id}×${n}`)
    .join('、');
  if (free) out.push(`  （开局自带: ${free}）`);
  out.push(
    '',
    '开局命令: new --party <伙伴,伙伴> --items <物品=数量,物品=数量>   （名字或 id 都可以；--auto 自动配置）',
  );
  return out.join('\n');
}

function charLine(content: Content, run: RunState, id: string): string {
  const ch = run.characters[id];
  const name = content.characters.get(id)?.name ?? id;
  if (ch.where === 'dead') return `  ${name}（已死亡）`;
  if (ch.where === 'gone') return `  ${name}（已离开）`;
  const stats = content.db.stats
    .map((s) => `${s.name} ${Math.round(ch.stats[s.id] ?? s.initial)}`)
    .join('  ');
  const status = ch.statuses.length
    ? `  状态: ${ch.statuses
        .map(
          (x) =>
            (content.statuses.get(x.id)?.name ?? x.id) +
            (x.daysLeft !== undefined ? `(剩${x.daysLeft}天)` : ''),
        )
        .join('、')}`
    : '';
  return `  ${name}（${ch.where === 'away' ? '外出中' : '庇护所'}）  ${stats}${status}`;
}

function itemList(content: Content, ids: [string, number][]): string {
  return (
    ids.map(([id, n]) => `${content.items.get(id)?.name ?? id}×${n}[${id}]`).join('、') || '无'
  );
}

/** 当前局面 + 可用操作 */
export function describeState(content: Content, run: RunState): string {
  const out: string[] = [];
  const weather = run.weather
    ? `  天气: ${content.weathers.get(run.weather.id)?.name ?? run.weather.id}`
    : '';
  out.push(`══ 第 ${run.day} 天 ══${weather}`);
  for (const id of run.party) out.push(charLine(content, run, id));
  const inv = Object.entries(run.inventory).filter(([, n]) => n > 0);
  out.push(`  库存: ${itemList(content, inv)}`);
  for (const [id] of inv) {
    const desc = content.items.get(id)?.desc;
    if (desc) out.push(`    · ${content.items.get(id)?.name}: ${desc}`);
  }
  const notes = getNotes({ run: structuredClone(run), content });
  if (notes.length) {
    out.push('  备忘（日记本里记下的任务进度与线索）:');
    for (const n of notes) out.push(`    ✎ ${n.text}`);
  }

  if (run.phase === 'ended') {
    const ending = run.ending ? content.endings.get(run.ending.id) : undefined;
    out.push(
      '',
      `★ 结局「${ending?.name ?? run.ending?.id}」（第 ${run.ending?.day ?? run.day} 天）`,
    );
    if (ending?.text) out.push(`  ${ending.text}`);
    if (run.newUnlocks.length)
      out.push(
        `  新解锁: ${run.newUnlocks.map((id) => content.characters.get(id)?.name ?? id).join('、')}`,
      );
    out.push('', '这一局已结束。可以用 note 记下感想，用 report 导出完整过程。');
    return out.join('\n');
  }

  if (run.phase === 'event') {
    const view = getEventView({ run: structuredClone(run), content });
    if (view) {
      out.push('', `◆ 事件《${view.title}》`, `  ${view.text}`);
      if (view.result) {
        out.push(
          '',
          `  结果: ${view.result.text || '（无）'}`,
          '',
          '操作:',
          '  continue            继续',
        );
      } else {
        out.push('', '选项:');
        view.choices.forEach((c, i) =>
          out.push(
            `  ${i + 1}) ${c.text}${c.enabled ? '' : `   （不可选${c.hint ? `：${c.hint}` : ''}）`}`,
          ),
        );
        out.push('', '操作:', '  choose <序号>       选择一个选项');
      }
    }
    return out.join('\n');
  }

  // 计划阶段
  const env: Env = { run: structuredClone(run), content };
  const home = shelterIds(run);
  if (run.expedition) {
    const e = run.expedition;
    out.push(
      `  外出中: ${content.characters.get(e.charId)?.name} → ${content.locations.get(e.locationId)?.name}（第 ${e.returnDay} 天回来）`,
    );
  }
  const planned = run.plan.expedition;
  if (planned)
    out.push(
      `  已安排外出: ${content.characters.get(planned.charId)?.name} → ${content.locations.get(planned.locationId)?.name}` +
        (planned.carry.length
          ? `（携带 ${planned.carry.map((i) => content.items.get(i)?.name ?? i).join('、')}）`
          : '') +
        '（今晚出发）',
    );
  out.push('  今日配给计划（不设置 = 今晚不吃不喝；每天都要重新设置）:');
  for (const id of home) {
    const slots = run.plan.rations[id] ?? {};
    const parts = content.config.rationTags.map(
      (tag) =>
        `${tagLabel(content, tag)}←${slots[tag] ? (content.items.get(slots[tag])?.name ?? slots[tag]) : '（未设置）'}`,
    );
    out.push(`    ${content.characters.get(id)?.name}: ${parts.join('  ')}`);
  }
  for (const w of rationOverages(content, run)) out.push(`  ⚠ 配给超额 ${w}`);

  out.push('', '操作（名字或 id 都可以）:');
  for (const tag of content.config.rationTags) {
    const stock = content.db.items
      .filter((i) => i.tags.includes(tag) && (run.inventory[i.id] ?? 0) > 0)
      .map((i) => [i.id, run.inventory[i.id]] as [string, number]);
    out.push(
      `  ration <角色> ${tagLabel(content, tag)} <物品|none>    可用: ${itemList(content, stock)}`,
    );
  }
  const usable = content.db.items
    .filter((i) => i.manualUse && (run.inventory[i.id] ?? 0) > 0)
    .map((i) => [i.id, run.inventory[i.id]] as [string, number]);
  if (usable.length)
    out.push(`  use <物品> <角色>                  可用: ${itemList(content, usable)}`);
  if (!run.expedition && !planned && home.length) {
    const slots = content.maps.get(run.mapId)?.expedition.carrySlots ?? 0;
    out.push(
      `  go <角色> <地点> [携带物,携带物]   可携带 ${slots} 件；同一时间只能有一个人外出；危险包括一去不回；地点:`,
    );
    for (const loc of content.db.locations.filter((l) => l.map === run.mapId)) {
      const plan: ExpeditionPlan = { charId: home[0], locationId: loc.id, carry: [] };
      const vehicle = loc.vehicle ?? content.maps.get(run.mapId)?.expedition.vehicle;
      if (vehicle) plan.vehicleId = vehicle;
      const err = validateExpeditionPlan(env, plan);
      const blocked = err === 'locationLocked' || err === 'vehicleMissing';
      out.push(
        `    ${loc.name}[${loc.id}]  往返 ${loc.distance} 天  危险 ${dangerLevel(loc.danger)}/5（${DANGER_WORDS[dangerLevel(loc.danger) - 1]}）  ${loc.desc ?? ''}` +
          (blocked ? `  （暂不可去${loc.requiresHint ? `：${loc.requiresHint}` : ''}）` : ''),
      );
    }
  }
  if (planned) out.push('  cancel                             取消外出计划');
  out.push('  end                                结束这一天（先吃后衰减；外出计划此时出发）');
  return out.join('\n');
}

/** 一步操作之后：本步新增的日志 + 新局面 */
export function describeStep(content: Content, before: RunState, after: RunState): string {
  const logs = newLogEntries(before.log, after.log);
  const out: string[] = [];
  if (logs.length) out.push('—— 刚刚发生的事 ——', ...logs.map((l) => `  · ${l.text}`), '');
  out.push(describeState(content, after));
  return out.join('\n');
}

// ---------- 命令解析 ----------

function findBy<T extends { id: string; name: string }>(list: T[], token: string): T | undefined {
  const t = token.toLowerCase();
  return list.find((x) => x.id.toLowerCase() === t) ?? list.find((x) => x.name.toLowerCase() === t);
}

const splitList = (raw: string) =>
  raw
    .split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** 把一条文字命令解析成 Action；解析失败返回错误说明（字符串） */
export function parseCommand(content: Content, run: RunState, input: string): Action | string {
  const [cmd, ...rest] = input.trim().split(/\s+/);
  const chars = run.party.flatMap((id) => {
    const c = content.characters.get(id);
    return c ? [{ id, name: c.name }] : [];
  });
  const char = (token: string | undefined) => (token ? findBy(chars, token) : undefined);
  const item = (token: string | undefined) => (token ? findBy(content.db.items, token) : undefined);

  switch (cmd?.toLowerCase()) {
    case 'choose':
    case 'c': {
      const token = rest[0];
      if (!token) return '用法: choose <序号>';
      const view = getEventView({ run: structuredClone(run), content });
      if (!view) return '现在没有待选择的事件。';
      const idx = Number(token);
      const choice = Number.isInteger(idx)
        ? view.choices[idx - 1]
        : view.choices.find((c) => c.id === token);
      return choice ? { type: 'chooseEventOption', choiceId: choice.id } : `没有这个选项: ${token}`;
    }
    case 'continue':
      return { type: 'continueEvent' };
    case 'end':
      return { type: 'endDay' };
    case 'cancel':
      return { type: 'cancelExpedition' };
    case 'ration': {
      const [c, tagToken, itemToken] = rest;
      const ch = char(c);
      if (!ch) return `不认识的角色: ${c ?? '(缺失)'}。用法: ration <角色> <配给类型> <物品|none>`;
      const tag = content.config.rationTags.find(
        (t) => t === tagToken || tagLabel(content, t) === tagToken,
      );
      if (!tag)
        return `不认识的配给类型: ${tagToken ?? '(缺失)'}（可选: ${content.config.rationTags.map((t) => tagLabel(content, t)).join('、')}）`;
      if (!itemToken) return '缺少物品（或写 none 清空）';
      if (itemToken.toLowerCase() === 'none')
        return { type: 'setRation', charId: ch.id, tag, itemId: null };
      const it = item(itemToken);
      return it
        ? { type: 'setRation', charId: ch.id, tag, itemId: it.id }
        : `不认识的物品: ${itemToken}`;
    }
    case 'use': {
      const [i, c] = rest;
      const it = item(i);
      const ch = char(c);
      if (!it) return `不认识的物品: ${i ?? '(缺失)'}。用法: use <物品> <角色>`;
      if (!ch) return `不认识的角色: ${c ?? '(缺失)'}`;
      return { type: 'useItem', itemId: it.id, charId: ch.id };
    }
    case 'go': {
      const [c, l, carryRaw] = rest;
      const ch = char(c);
      const loc = l ? findBy(content.db.locations, l) : undefined;
      if (!ch) return `不认识的角色: ${c ?? '(缺失)'}。用法: go <角色> <地点> [携带物,携带物]`;
      if (!loc) return `不认识的地点: ${l ?? '(缺失)'}`;
      const carry: string[] = [];
      for (const token of splitList(carryRaw ?? '')) {
        // 允许 "罐头x2" / "罐头*2" 之类写法以外的重复写法：同名写多次即可
        const it = item(token);
        if (!it) return `不认识的携带物: ${token}`;
        carry.push(it.id);
      }
      const planned = run.plan.expedition;
      if (planned && planned.charId !== ch.id) {
        const who = content.characters.get(planned.charId)?.name ?? planned.charId;
        return `今晚已经安排 ${who} 外出（同一时间只能有一个人外出）。要换人请先 cancel`;
      }
      const plan: Action = { type: 'planExpedition', charId: ch.id, locationId: loc.id, carry };
      const vehicle = loc.vehicle ?? content.maps.get(run.mapId)?.expedition.vehicle;
      if (vehicle) plan.vehicleId = vehicle;
      return plan;
    }
    default:
      return `不认识的命令: ${cmd ?? '(空)'}。可用: choose / continue / ration / use / go / cancel / end`;
  }
}

/** 解析并执行一条命令；返回新状态或错误说明（引擎拒绝时附带中文原因） */
export function runCommand(
  content: Content,
  run: RunState,
  input: string,
  errorText: ErrorText = defaultErrorText,
): { action: Action; run: RunState } | { error: string } {
  const parsed = parseCommand(content, run, input);
  if (typeof parsed === 'string') return { error: parsed };
  const res = applyAction(run, parsed, content);
  if (!res.error) return { action: parsed, run: res.state };
  // 有事件在等：提示先处理事件，而不是只说"现在不是安排计划的时候"
  const hint =
    res.error === 'notPlanPhase' && run.phase === 'event' && run.pendingEvent
      ? run.pendingEvent.result
        ? '（有事件结果还没看完：先 act continue）'
        : '（有事件在等你做选择：先 act choose <序号>）'
      : '';
  return { error: errorText(res.error) + hint };
}

/** 开局点数花费（给 --auto 之外的手动配置显示用） */
export function setupCost(content: Content, setup: PlaySetup): number {
  return pointsCost(content, setup.party, setup.items);
}
