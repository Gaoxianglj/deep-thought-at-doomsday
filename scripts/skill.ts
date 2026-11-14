/** 技能梯度：npm run skill -- --runs 200 --search 16 */
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { runSkillLadder } from '../src/sim/skill';
import { pct, table } from '../src/sim/table';
import { resolveJobs, simulateManyParallel } from './parallel';

const HELP = `用法: npm run skill -- [选项]
用 random / turtle / sensible / explorer 与"随机搜索出的最优参数"各跑一批局，估计游戏对不同水平玩家的难度。
  --runs <n>          每个策略的局数（默认 200）
  --search <n>        随机搜索的候选参数组数（默认 16，0 = 不搜索）
  --search-runs <n>   搜索阶段每组候选的局数（默认 60）
  --map <id>          地图 id（默认第一个地图）
  --difficulty <id>   难度 id（默认每个难度各跑一轮）
  --seed <前缀>       种子前缀（默认 skill）
  --max-days <n>      每局最多天数（默认 200）
  --jobs <n|auto>     固定预设与最终复测的并行进程数（默认 auto）
  --unlock-all        所有角色视为已解锁
  --json              输出 JSON
  --help              显示本帮助
best 一行给出的描述串可直接用于 npm run sim -- --bot "<描述串>" 复现。`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const args = process.argv.slice(2);
const flags = new Set(['--unlock-all', '--json', '--help']);
const options = [
  '--runs',
  '--search',
  '--search-runs',
  '--map',
  '--difficulty',
  '--seed',
  '--max-days',
];
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (flags.has(a)) values[a] = 'true';
  else if (options.includes(a)) {
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) fail(`参数 ${a} 需要一个值`);
    values[a] = v;
  } else fail(`未知参数: ${a}\n\n${HELP}`);
}
if (values['--help']) {
  console.log(HELP);
  process.exit(0);
}
const int = (key: string, def: number, min = 1) => {
  if (values[key] === undefined) return def;
  const n = Number(values[key]);
  if (!Number.isInteger(n) || n < min) fail(`${key} 需要不小于 ${min} 的整数`);
  return n;
};

const content = buildContent(contentDB);
if (!content.db.maps.length || !content.db.characters.length) fail('内容为空，无法模拟。');
const mapId = values['--map'] ?? content.db.maps[0].id;
if (!content.maps.has(mapId)) fail(`未知地图: ${mapId}`);
const diffIds = values['--difficulty']
  ? [values['--difficulty']]
  : content.db.difficulties.map((d) => d.id);
for (const id of diffIds) if (!content.difficulties.has(id)) fail(`未知难度: ${id}`);

const unlocked = values['--unlock-all'] ? content.db.characters.map((c) => c.id) : undefined;
const maxDays = int('--max-days', 200);
const result = [];
for (const difficultyId of diffIds) {
  result.push({
    difficultyId,
    rows: await runSkillLadder(content, {
      mapId,
      difficultyId,
      runs: int('--runs', 200),
      search: int('--search', 16, 0),
      searchRuns: int('--search-runs', 60),
      seed: values['--seed'] ?? 'skill',
      unlocked,
      maxDays,
      run: (spec, runs, seedPrefix, purpose) =>
        simulateManyParallel(
          content,
          { mapId, difficultyId, botSpec: spec, runs, seedPrefix, unlocked, maxDays, check: false },
          purpose === 'search' ? 1 : resolveJobs(values['--jobs'], runs),
        ),
    }),
  });
}

if (values['--json']) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const { difficultyId, rows } of result) {
    console.log(
      `\n== ${content.maps.get(mapId)!.name} / ${content.difficulties.get(difficultyId)!.name} ==`,
    );
    console.log(
      table(
        ['策略', '通关率', '平均天数', '平均幸存', '局数'],
        rows.map((r) => [
          r.label,
          pct(r.winRate),
          r.daysMean.toFixed(1),
          r.survivorsMean.toFixed(2),
          String(r.runs),
        ]),
      ).join('\n'),
    );
    const best = rows.find((r) => r.label.startsWith('best'));
    if (best) console.log(`  best 参数: --bot "${best.spec}"`);
  }
}
