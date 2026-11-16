/** 文本试玩（给 LLM / 人当玩家）：npm run play -- <命令> */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { aliveIds, applyAction, buildContent, newRun } from '../src/engine';
import { contentDB } from '../src/data/index';
import { uiText } from '../src/data/ui-text';
import { sensibleBot } from '../src/sim/bots';
import {
  checkSetup,
  describeInfo,
  describeState,
  describeStep,
  runCommand,
  staleSessionMessage,
  tryLoadRun,
  setupCost,
  type PlaySession,
  type PlaySetup,
} from '../src/sim/play';
import { createReplayRecorder, formatReplay } from '../src/sim/replay';
import { makeRng } from '../src/sim/simulate';

const HELP = `用法: npm run play -- <命令> [选项]
文本试玩：一局游戏 = 一个会话文件，每次调用都读取、推进、保存。
命令:
  info                  列出可选的伙伴、物资、点数（开局前先看这个）
  new                   开新局：--party <伙伴,伙伴> --items <物品=数量,...>，或 --auto 自动配置
  show                  显示当前局面与可用操作（含"备忘"：任务进度与线索，等同界面日记本的备忘页）
  act <命令>            执行操作，可用 ; 连续执行多条（遇错即停）:
                        act choose 1 / act "ration 阿尔法 食物 罐头; ration 阿尔法 饮水 瓶装水; end"
  note <文字>           记下一条试玩感想（会附在 report 里）
  report                导出完整过程（含笔记），供复盘
选项:
  --session <文件>      会话文件（默认 .playtest/session.json）
  --map <id>  --difficulty <id>  --seed <种子>  --unlock-all   （info / new 用）
  --brief               report 用：精简输出
  --help                显示本帮助`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = new Set(['--auto', '--unlock-all', '--brief', '--help']);
const options = ['--session', '--map', '--difficulty', '--seed', '--party', '--items'];
const values: Record<string, string> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (flags.has(a)) values[a] = 'true';
  else if (options.includes(a)) {
    const v = argv[++i];
    if (v === undefined) fail(`参数 ${a} 需要一个值`);
    values[a] = v;
  } else if (a.startsWith('--')) fail(`未知参数: ${a}\n\n${HELP}`);
  else positional.push(a);
}
const [command, ...restWords] = positional;
if (values['--help'] || !command) {
  console.log(HELP);
  process.exit(command || values['--help'] ? 0 : 1);
}

const content = buildContent(contentDB);
const sessionPath = values['--session'] ?? '.playtest/session.json';
const errorText = (code: string) =>
  uiText.errors[code] ?? uiText.errors.unknown.replace('{code}', code);

const mapId = values['--map'] ?? content.db.maps[0]?.id;
const difficultyId = values['--difficulty'] ?? content.db.difficulties[0]?.id;
const unlocked = values['--unlock-all']
  ? content.db.characters.map((c) => c.id)
  : content.db.characters.filter((c) => c.unlockedByDefault).map((c) => c.id);

function loadSession(): PlaySession {
  if (!existsSync(sessionPath))
    fail(`没有进行中的局（${sessionPath}）。先运行: npm run play -- new ...`);
  return JSON.parse(readFileSync(sessionPath, 'utf8')) as PlaySession;
}
function saveSession(s: PlaySession): void {
  mkdirSync(dirname(sessionPath), { recursive: true });
  writeFileSync(sessionPath, JSON.stringify(s, null, 2));
}

/** 名字或 id → id */
function resolveIds<T extends { id: string; name: string }>(
  list: T[],
  token: string,
  what: string,
): string {
  const t = token.trim().toLowerCase();
  const hit =
    list.find((x) => x.id.toLowerCase() === t) ?? list.find((x) => x.name.toLowerCase() === t);
  if (!hit) fail(`不认识的${what}: ${token}`);
  return hit.id;
}

switch (command) {
  case 'info': {
    if (!mapId || !difficultyId) fail('内容里没有地图或难度。');
    console.log(describeInfo(content, mapId, difficultyId, unlocked));
    break;
  }
  case 'new': {
    if (!mapId || !difficultyId) fail('内容里没有地图或难度。');
    const seed = values['--seed'] ?? `play-${Date.now()}`;
    let party: string[];
    let items: Record<string, number>;
    if (values['--auto']) {
      const setup = sensibleBot.setup(content, mapId, difficultyId, unlocked, makeRng(seed));
      party = setup.party;
      items = setup.items;
    } else {
      if (!values['--party']) fail('缺少 --party（或使用 --auto）。先运行 info 查看可选项。');
      party = values['--party']
        .split(/[,，、]/)
        .filter(Boolean)
        .map((t) => resolveIds(content.db.characters, t, '伙伴'));
      items = {};
      for (const pair of (values['--items'] ?? '').split(/[,，、]/).filter(Boolean)) {
        const [name, n] = pair.split('=');
        items[resolveIds(content.db.items, name, '物品')] = Number(n ?? 1);
      }
    }
    const setup: PlaySetup = { seed, mapId, difficultyId, party, items, unlocked };
    const errors = checkSetup(content, setup, errorText);
    if (errors.length) fail(`开局设置不合法: ${errors.join('；')}`);
    const session: PlaySession = { version: 1, setup, actions: [], notes: [] };
    saveSession(session);
    const diff = content.difficulties.get(difficultyId)!;
    console.log(
      `新局已开始（种子 ${seed}，花费 ${setupCost(content, setup)}/${diff.points} 点）。会话文件: ${sessionPath}\n`,
    );
    console.log(describeState(content, newRun(content, setup)));
    break;
  }
  case 'show': {
    const loaded = tryLoadRun(content, loadSession());
    if (loaded.failedAt !== undefined) fail(staleSessionMessage(loaded.failedAt));
    console.log(describeState(content, loaded.run));
    break;
  }
  case 'act': {
    const session = loadSession();
    const loaded = tryLoadRun(content, session);
    if (loaded.failedAt !== undefined) fail(staleSessionMessage(loaded.failedAt));
    const start = loaded.run;
    if (start.phase === 'ended') fail('这一局已经结束了。可以用 report 导出过程，或 new 开新局。');
    // 允许用 ; 一次执行多条命令（遇到错误就停），最后只打印一次局面，省得每步都刷屏
    const commands = restWords
      .join(' ')
      .split(/[;；]/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (!commands.length) fail('用法: act <命令>[; <命令>...]');
    let run = start;
    let failed: string | undefined;
    let done = 0;
    for (const cmd of commands) {
      if (run.phase === 'ended') break;
      const result = runCommand(content, run, cmd, errorText);
      if ('error' in result) {
        failed = `✗ 第 ${done + 1} 条命令「${cmd}」: ${result.error}`;
        break;
      }
      session.actions.push(result.action);
      run = result.run;
      done++;
    }
    if (done) saveSession(session);
    if (done) console.log(describeStep(content, start, run));
    if (failed) {
      console.log(
        `${done ? '\n' : ''}${failed}\n（${done ? `前 ${done} 条已执行，后面的没有执行` : '局面没有变化'}；show 查看当前局面）`,
      );
      process.exitCode = 2;
    }
    break;
  }
  case 'note': {
    const session = loadSession();
    const loaded = tryLoadRun(content, session);
    const day = loaded.run?.day ?? session.notes[session.notes.length - 1]?.day ?? 1;
    const text = restWords.join(' ').trim();
    if (!text) fail('用法: note <文字>');
    session.notes.push({ day, text });
    saveSession(session);
    console.log(`已记录（第 ${day} 天）: ${text}`);
    break;
  }
  case 'report': {
    const session = loadSession();
    const rec = createReplayRecorder(content);
    const probe = tryLoadRun(content, session);
    if (probe.failedAt === 0) {
      console.log(`== 试玩报告 / 种子 ${session.setup.seed} ==\n${staleSessionMessage(0)}`);
      if (session.notes.length) {
        console.log('\n试玩笔记:');
        for (const n of session.notes) console.log(`  [第 ${n.day} 天] ${n.text}`);
      }
      break;
    }
    let run = newRun(content, session.setup);
    rec.start(run);
    for (let index = 0; index < session.actions.length; index++) {
      const res = applyAction(run, session.actions[index], content);
      rec.step({
        index,
        before: run,
        action: session.actions[index],
        after: res.state,
        error: res.error,
      });
      if (res.error) break;
      run = res.state;
    }
    if (probe.failedAt !== undefined)
      console.log(`!! 内容已变化，第 ${probe.failedAt} 步之后无法重放（以下为失败前的过程）\n`);
    const header = `== 试玩报告 / 种子 ${session.setup.seed} / ${content.maps.get(session.setup.mapId)?.name} / ${content.difficulties.get(session.setup.difficultyId)?.name} ==`;
    console.log(
      formatReplay(
        content,
        {
          result: {
            ending: run.ending?.id ?? 'ongoing',
            days: run.ending?.day ?? run.day,
            survivors: aliveIds(run).length,
            violations: [],
          },
          start: rec.getStart(),
          steps: rec.steps,
        },
        header,
        { brief: !!values['--brief'] },
      ),
    );
    if (session.notes.length) {
      console.log('\n试玩笔记:');
      for (const n of session.notes) console.log(`  [第 ${n.day} 天] ${n.text}`);
    }
    break;
  }
  default:
    fail(`未知命令: ${command}\n\n${HELP}`);
}
