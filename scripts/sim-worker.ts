/** 并行模拟的工作进程：由 scripts/parallel.ts 启动，把自己负责的那一片结果以 JSON 打到 stdout。 */
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { resolveBot } from '../src/sim/bots';
import { simulateRuns } from '../src/sim/simulate';

interface WorkerSpec {
  mapId: string;
  difficultyId: string;
  botSpec: string;
  unlocked?: string[];
  maxDays?: number;
  check?: boolean;
  seedPrefix: string;
  runs: number;
  shard: number;
  shards: number;
}

const spec = JSON.parse(process.argv[2]) as WorkerSpec;
const bot = resolveBot(spec.botSpec);
if (typeof bot === 'string') {
  console.error(bot);
  process.exit(1);
}
const indices: number[] = [];
for (let i = spec.shard; i < spec.runs; i += spec.shards) indices.push(i);
const results = simulateRuns(
  buildContent(contentDB),
  {
    runs: spec.runs,
    seedPrefix: spec.seedPrefix,
    mapId: spec.mapId,
    difficultyId: spec.difficultyId,
    bot,
    unlocked: spec.unlocked,
    maxDays: spec.maxDays,
    check: spec.check,
  },
  indices,
);
process.stdout.write(JSON.stringify(results));
