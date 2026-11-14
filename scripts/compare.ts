/** 前后对比：npm run compare -- before.json after.json */
import { readFileSync } from 'node:fs';
import { buildContent } from '../src/engine';
import { contentDB } from '../src/data/index';
import { compareSummaries } from '../src/sim/compare';
import type { Summary } from '../src/sim/simulate';

const HELP = `用法: npm run compare -- <改动前.json> <改动后.json>
两个文件都由 npm run sim -- --out <文件> 生成（参数应相同，包括 --runs / --bot / --difficulty）。
典型流程:
  npm run sim -- --runs 500 --seed base --out /tmp/before.json
  （改数值 / 内容）
  npm run sim -- --runs 500 --seed base --out /tmp/after.json
  npm run compare -- /tmp/before.json /tmp/after.json`;

const [beforePath, afterPath, ...rest] = process.argv.slice(2);
if (!beforePath || !afterPath || rest.length || beforePath === '--help') {
  console.log(HELP);
  process.exit(beforePath === '--help' ? 0 : 1);
}
const load = (path: string): Summary[] => {
  const data = JSON.parse(readFileSync(path, 'utf8')) as Summary[] | Summary;
  return Array.isArray(data) ? data : [data];
};
console.log(compareSummaries(load(beforePath), load(afterPath), buildContent(contentDB)));
