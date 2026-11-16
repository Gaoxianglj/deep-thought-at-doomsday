import { describe, expect, it } from 'vitest';
import { newRun, type ContentDB } from '../../src/engine';
import { currentNotes, defaultJournalTab, notesSignature } from '../../src/ui/panels/journal';
import { makeContent } from '../fixtures/content';

const setup = {
  seed: 'notes',
  mapId: 'bunker',
  difficultyId: 'normal',
  party: ['alpha', 'beta'],
  items: {},
  unlocked: ['alpha', 'beta'],
};

function withNotes(db: ContentDB): void {
  db.notes = [
    { id: 'lead', text: '线索在 {flag:spot}', when: { flag: 'spot' } },
    { id: 'lucky', text: '碰运气', when: { chance: 0.5 } },
  ];
}

describe('日记本备忘', () => {
  it('没有备忘时默认翻到往日记录；有备忘时翻到备忘', () => {
    const content = makeContent(withNotes);
    const run = newRun(content, setup);
    const plain = makeContent();
    expect(defaultJournalTab(plain, newRun(plain, setup))).toBe('history');
    run.flags.spot = '屋顶';
    expect(defaultJournalTab(content, run)).toBe('notes');
    expect(currentNotes(content, run).map((n) => n.text)).toContain('线索在 屋顶');
  });

  it('求值不推进真实对局的随机数', () => {
    const content = makeContent(withNotes);
    const run = newRun(content, setup);
    const rng = run.rng;
    currentNotes(content, run);
    defaultJournalTab(content, run);
    expect(run.rng).toBe(rng);
  });

  it('签名随内容变化', () => {
    const a = notesSignature([{ id: 'x', text: '还需要 4 份水' }]);
    const b = notesSignature([{ id: 'x', text: '还需要 2 份水' }]);
    expect(a).not.toBe(b);
    expect(notesSignature([])).toBe('');
  });
});
