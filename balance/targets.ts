/**
 * 平衡护栏配置：`npm run balance` 读取它。
 * 默认只启用"设计无关"的检查（健康、难度 / 技能单调、事件覆盖、超时率）。
 * 想把设计意图固化成数值，就往 ranges 里加规则；改了数值后跑 npm run balance，越界就会失败。
 * 例（取消注释并按设计调整）：
 *   { difficulty: 'normal', bot: 'sensible', metric: 'winRate', min: 0.1, max: 0.4, note: '普通难度，稳健玩家 10–40% 通关' },
 *   { bot: 'random', metric: 'winRate', max: 0.05, note: '乱玩不应通关' },
 * 可用的 metric: winRate | daysMean | daysMedian | survivorsMean | timeoutRate（比例用 0–1）。
 * bot 可以带参数覆盖，如 'sensible:toolReserve=0.3'。
 */
import type { GuardrailConfig } from '../src/sim/guardrails';

export const targets: GuardrailConfig = {
  runs: 300,
  seed: 'balance',
  bots: ['random', 'sensible'],
  referenceBot: 'sensible',
  maxTimeoutRate: 0.15,
  requireAllEventsTrigger: true,
  // 数值平衡后的回归护栏（docs/DESIGN.md 12.9）：范围比实测略宽，越界说明平衡被改动了
  ranges: [
    { bot: 'random', metric: 'winRate', max: 0.03, note: '乱玩不应通关' },
    {
      difficulty: 'easy',
      bot: 'sensible',
      metric: 'winRate',
      min: 0.38,
      max: 0.58,
      note: '简单：稳健玩家约一半通关',
    },
    {
      difficulty: 'normal',
      bot: 'sensible',
      metric: 'winRate',
      min: 0.22,
      max: 0.4,
      note: '普通：稳健玩家 25–40% 通关',
    },
    {
      difficulty: 'hard',
      bot: 'sensible',
      metric: 'winRate',
      min: 0.1,
      max: 0.27,
      note: '困难：稳健玩家 12–25% 通关',
    },
    {
      difficulty: 'normal',
      bot: 'sensible',
      metric: 'daysMedian',
      min: 18,
      max: 34,
      note: '普通：一局大约三四周',
    },
    { bot: 'sensible', metric: 'timeoutRate', max: 0.02, note: '不应出现能无限苟活的局' },
  ],
};
