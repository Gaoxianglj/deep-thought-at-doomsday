/** npm run validate [-- --strict]：校验 src/data 的内容，有 error 时退出码为 1。 */
import process from 'node:process';
import { contentDB } from '../src/data/index';
import { validateContent, type Issue } from '../src/validation/validate';

const strict = process.argv.includes('--strict');
const issues = validateContent(contentDB);
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warning');

function print(title: string, list: Issue[]): void {
  if (list.length === 0) return;
  console.log(`\n== ${title}（${list.length}）==`);
  for (const i of list) console.log(`  ${i.path}\n    ${i.message}`);
}

print('错误', errors);
print('警告', warnings);
console.log(
  `\n共 ${errors.length} 个错误，${warnings.length} 个警告${strict ? '（严格模式）' : ''}。`,
);

if (errors.length > 0 || (strict && warnings.length > 0)) process.exit(1);
