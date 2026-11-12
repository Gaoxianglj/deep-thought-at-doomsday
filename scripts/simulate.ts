/** 批量模拟 CLI：npm run sim -- --runs 200 --difficulty normal --bot sensible */
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { BOTS } from '../src/sim/bots';
import { formatSummary, simulateMany } from '../src/sim/simulate';

const HELP = `用法: npm run sim -- [选项]
  --runs <n>          每个难度模拟的局数（默认 100）
  --map <id>          地图 id（默认第一个地图）
  --difficulty <id>   难度 id（默认每个难度各跑一轮）
  --bot <name>        策略: sensible | random（默认 sensible）
  --seed <前缀>       种子前缀（默认 sim）
  --max-days <n>      每局最多天数（默认 200）
  --unlock-all        所有角色视为已解锁（默认只用 unlockedByDefault 的角色）
  --json              输出 JSON
  --help              显示本帮助`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(['--unlock-all', '--json', '--help']);
const values: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (flags.has(a)) values[a] = 'true';
  else if (
    a.startsWith('--') &&
    ['--runs', '--map', '--difficulty', '--bot', '--seed', '--max-days'].includes(a)
  ) {
    const v = args[++i];
    if (v === undefined || v.startsWith('--')) fail(`参数 ${a} 需要一个值`);
    values[a] = v;
  } else fail(`未知参数: ${a}\n\n${HELP}`);
}
if (values['--help']) {
  console.log(HELP);
  process.exit(0);
}

const int = (key: string, def: number) => {
  if (values[key] === undefined) return def;
  const n = Number(values[key]);
  if (!Number.isInteger(n) || n < 1) fail(`${key} 需要正整数`);
  return n;
};

const content = buildContent(contentDB);
if (!content.db.maps.length || !content.db.characters.length) {
  fail('内容为空（还没有地图或角色），无法模拟。请先填充 src/data。');
}
const botName = values['--bot'] ?? 'sensible';
const bot = BOTS[botName];
if (!bot) fail(`未知策略: ${botName}（可选: ${Object.keys(BOTS).join('、')}）`);
const mapId = values['--map'] ?? content.db.maps[0].id;
if (!content.maps.has(mapId))
  fail(`未知地图: ${mapId}（可选: ${[...content.maps.keys()].join('、')}）`);
const diffIds = values['--difficulty']
  ? [values['--difficulty']]
  : content.db.difficulties.map((d) => d.id);
for (const id of diffIds) if (!content.difficulties.has(id)) fail(`未知难度: ${id}`);
if (!diffIds.length) fail('内容里没有难度。');

const unlocked = values['--unlock-all'] ? content.db.characters.map((c) => c.id) : undefined;
const summaries = diffIds.map((difficultyId) =>
  simulateMany(content, {
    runs: int('--runs', 100),
    seedPrefix: values['--seed'] ?? 'sim',
    mapId,
    difficultyId,
    bot,
    unlocked,
    maxDays: int('--max-days', 200),
  }),
);

if (values['--json']) console.log(JSON.stringify(summaries, null, 2));
else console.log(summaries.map((s) => formatSummary(s, content)).join('\n\n'));
