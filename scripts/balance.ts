/** 平衡护栏：npm run balance（规则在 balance/targets.ts） */
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { resolveBot } from '../src/sim/bots';
import { evaluateGuardrails } from '../src/sim/guardrails';
import type { Summary } from '../src/sim/simulate';
import { resolveJobs, simulateManyParallel } from './parallel';
import { pct, table } from '../src/sim/table';
import { targets } from '../balance/targets';

const HELP = `用法: npm run balance -- [选项]
按 balance/targets.ts 对每个 (难度, bot) 跑一批局，做平衡健全性检查与数值范围断言。
  --runs <n>   覆盖每组的局数（默认取配置）
  --seed <前缀> 覆盖种子前缀
  --json       输出 JSON
  --help       显示本帮助
有"错误"级检查失败时退出码为 1；"警告"只提示。`;

const args = process.argv.slice(2);
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json' || a === '--help') values[a] = 'true';
  else if (a === '--runs' || a === '--seed') values[a] = args[++i] ?? '';
  else {
    console.error(`未知参数: ${a}\n\n${HELP}`);
    process.exit(1);
  }
}
if (values['--help']) {
  console.log(HELP);
  process.exit(0);
}
const runs = values['--runs'] ? Number(values['--runs']) : targets.runs;
if (!Number.isInteger(runs) || runs < 1) {
  console.error('--runs 需要正整数');
  process.exit(1);
}
const cfg = { ...targets, runs, seed: values['--seed'] || targets.seed };

const content = buildContent(contentDB);
const mapId = content.db.maps[0].id;
const summaries = new Map<string, Summary>();
for (const d of content.db.difficulties) {
  for (const spec of cfg.bots) {
    const resolved = resolveBot(spec);
    if (typeof resolved === 'string') {
      console.error(resolved);
      process.exit(1);
    }
    summaries.set(
      `${d.id}|${spec}`,
      await simulateManyParallel(
        content,
        { runs: cfg.runs, seedPrefix: cfg.seed, mapId, difficultyId: d.id, botSpec: spec },
        resolveJobs(undefined, cfg.runs),
      ),
    );
  }
}
const checks = evaluateGuardrails(content, cfg, summaries);
const failed = checks.filter((c) => !c.ok && c.severity === 'error');

if (values['--json']) {
  console.log(JSON.stringify({ checks, summaries: Object.fromEntries(summaries) }, null, 2));
} else {
  console.log(`== 平衡护栏（每组 ${cfg.runs} 局，种子 ${cfg.seed}）==\n`);
  console.log(
    table(
      ['难度', '策略', '通关率', '平均天数', '平均幸存', '超时'],
      [...summaries.entries()].map(([k, s]) => [
        content.difficulties.get(k.split('|')[0])?.name ?? k,
        s.botName,
        pct(s.winRate),
        s.days.mean.toFixed(1),
        s.survivors.mean.toFixed(2),
        pct(s.runs ? s.timeout / s.runs : 0, 0),
      ]),
    ).join('\n'),
  );
  console.log('');
  for (const c of checks) {
    const icon = c.ok ? '✓' : c.severity === 'error' ? '✗' : '⚠';
    console.log(`${icon} ${c.name}: ${c.detail}`);
  }
  console.log(
    `\n${failed.length ? `失败: ${failed.length} 项错误` : '通过'}（警告 ${checks.filter((c) => !c.ok && c.severity === 'warning').length} 项）`,
  );
}
if (failed.length) process.exitCode = 1;
