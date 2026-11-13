/** 回放一局：npm run replay -- --seed sim-12 --difficulty normal --bot sensible */
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { BOTS } from '../src/sim/bots';
import { formatReplay, replayRun } from '../src/sim/replay';

const HELP = `用法: npm run replay -- --seed <种子> [选项]
  --seed <种子>       必填。批量模拟报告里的种子，如 sim-12（前缀-局序号）
  --map <id>          地图 id（默认第一个地图）
  --difficulty <id>   难度 id（默认第一个难度）
  --bot <name>        策略: sensible | random（默认 sensible）
  --unlock-all        所有角色视为已解锁（要与产生该种子的模拟一致）
  --max-days <n>      每局最多天数（默认 200，要与产生该种子的模拟一致）
  --from <天>         只打印从这一天开始的内容
  --to <天>           只打印到这一天为止的内容
  --brief             精简：不打印每日角色表与配给 / 用药操作
  --no-check          不做不变量检查
  --json              输出 JSON（含逐步动作、日志与每日快照）
  --help              显示本帮助`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(['--unlock-all', '--brief', '--no-check', '--json', '--help']);
const options = ['--seed', '--map', '--difficulty', '--bot', '--max-days', '--from', '--to'];
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
const seed = values['--seed'];
if (!seed) fail(`缺少 --seed\n\n${HELP}`);

const int = (key: string): number | undefined => {
  if (values[key] === undefined) return undefined;
  const n = Number(values[key]);
  if (!Number.isInteger(n) || n < 1) fail(`${key} 需要正整数`);
  return n;
};

const content = buildContent(contentDB);
if (!content.db.maps.length || !content.db.characters.length) fail('内容为空，无法回放。');
const botName = values['--bot'] ?? 'sensible';
const bot = BOTS[botName];
if (!bot) fail(`未知策略: ${botName}（可选: ${Object.keys(BOTS).join('、')}）`);
const mapId = values['--map'] ?? content.db.maps[0].id;
if (!content.maps.has(mapId))
  fail(`未知地图: ${mapId}（可选: ${[...content.maps.keys()].join('、')}）`);
const difficultyId = values['--difficulty'] ?? content.db.difficulties[0]?.id;
if (!difficultyId || !content.difficulties.has(difficultyId))
  fail(`未知难度: ${difficultyId}（可选: ${[...content.difficulties.keys()].join('、')}）`);

const replay = replayRun(content, {
  seed,
  mapId,
  difficultyId,
  bot,
  unlocked: values['--unlock-all'] ? content.db.characters.map((c) => c.id) : undefined,
  maxDays: int('--max-days') ?? 200,
  check: !values['--no-check'],
});

if (values['--json']) {
  const { result, start, steps } = replay;
  console.log(
    JSON.stringify({ result: { ...result, analytics: undefined }, start, steps }, null, 2),
  );
} else {
  const header = `== 回放 ${seed} / ${content.maps.get(mapId)!.name} / ${content.difficulties.get(difficultyId)!.name} / 策略 ${botName} ==`;
  console.log(
    formatReplay(content, replay, header, {
      fromDay: int('--from'),
      toDay: int('--to'),
      brief: !!values['--brief'],
    }),
  );
}
if (replay.result.crash || replay.result.violations.length || replay.result.ending === 'stuck')
  process.exitCode = 1;
