/** 多进程并行模拟：按 i % n 分片，结果按原序号合并，与单进程完全一致。 */
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import type { Content } from '../src/engine';
import { resolveBot } from '../src/sim/bots';
import {
  mergeShards,
  simulateMany,
  summarizeMany,
  type RunResult,
  type Summary,
} from '../src/sim/simulate';

export interface ParallelOptions {
  mapId: string;
  difficultyId: string;
  /** bot 描述串（resolveBot 可识别） */
  botSpec: string;
  runs: number;
  seedPrefix: string;
  unlocked?: string[];
  maxDays?: number;
  check?: boolean;
}

/** "auto" 或正整数；auto = 局数够多时用 min(核数, 8)，否则 1（起进程本身要约 1 秒） */
export function resolveJobs(raw: string | undefined, runs: number): number {
  if (raw === undefined || raw === 'auto') {
    return runs >= 300 ? Math.min(availableParallelism(), 8) : 1;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error('--jobs 需要正整数或 auto');
  return Math.min(n, runs);
}

function runWorker(spec: object): Promise<RunResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        new URL('./sim-worker.ts', import.meta.url).pathname,
        JSON.stringify(spec),
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`并行工作进程异常退出（代码 ${code}）`));
      else resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunResult[]);
    });
  });
}

export async function simulateManyParallel(
  content: Content,
  opts: ParallelOptions,
  jobs: number,
): Promise<Summary> {
  const bot = resolveBot(opts.botSpec);
  if (typeof bot === 'string') throw new Error(bot);
  const base = {
    mapId: opts.mapId,
    difficultyId: opts.difficultyId,
    bot,
    runs: opts.runs,
    seedPrefix: opts.seedPrefix,
    unlocked: opts.unlocked,
    maxDays: opts.maxDays,
    check: opts.check,
  };
  if (jobs <= 1) return simulateMany(content, base);
  const shards = await Promise.all(
    Array.from({ length: jobs }, (_, shard) =>
      runWorker({
        mapId: opts.mapId,
        difficultyId: opts.difficultyId,
        botSpec: opts.botSpec,
        unlocked: opts.unlocked,
        maxDays: opts.maxDays,
        check: opts.check,
        seedPrefix: opts.seedPrefix,
        runs: opts.runs,
        shard,
        shards: jobs,
      }),
    ),
  );
  const results = mergeShards(shards, opts.runs);
  return summarizeMany(content, base, results);
}
