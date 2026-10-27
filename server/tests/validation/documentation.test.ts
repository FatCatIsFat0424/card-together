import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planGates } from '../../../scripts/validation/check';
import { documentationErrors, documentationPaths, githubSlug, headingAnchors } from '../../../scripts/validation/documentation';
import { parseOptions, selectChecks } from '../../../scripts/validation/selection';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'card-validation-documentation-'));
  directories.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe('documentation link validation', () => {
  it.each([
    ['Bot bidding agreements', 'bot-bidding-agreements'],
    ["Texas Hold'em", 'texas-holdem'],
    ['21 點', '21-點'],
    ['Bot 叫牌約定', 'bot-叫牌約定'],
    ['旁觀者與上帝視角（觀戰）', '旁觀者與上帝視角觀戰'],
    ['`npm run check` 模式', 'npm-run-check-模式'],
    ['[Socket](api.md) 事件', 'socket-事件'],
    ['snake_case & Dashes-ok', 'snake_case--dashes-ok'],
  ])('slugs %s like GitHub', (heading, slug) => {
    expect(githubSlug(heading)).toBe(slug);
  });

  it('numbers duplicate headings and ignores fenced code', () => {
    const anchors = headingAnchors('# 設定\n\n## 設定\n\n```sh\n# not a heading\n```\n\n### 設定 ###\n');
    expect([...anchors]).toEqual(['設定', '設定-1', '設定-2']);
  });

  it('reports missing files, anchors, and whitespace while accepting valid links', async () => {
    const root = await fixture({
      'docs/games/cards.md': '# 撲克牌遊戲\n\n## 大老二\n\n[本頁](#大老二)\n',
      'docs/guide.md': [
        '# 指南', '',
        '[valid](games/cards.md#大老二) [encoded](games/cards.md#%E5%A4%A7%E8%80%81%E4%BA%8C)',
        '[file](games/cards.md) [external](https://example.com/a.md#x) [mail](mailto:a@example.com)',
        '[stale](games/cards.md#big-two) [gone](games.md#big-two) [self](#missing) [bad](#%E5)',
        'trailing ',
      ].join('\n'),
    });
    expect(documentationErrors(root, ['docs/games/cards.md'])).toEqual([]);
    expect(documentationErrors(root, ['docs/guide.md'])).toEqual([
      'Whitespace or conflict markers in docs/guide.md',
      'docs/guide.md: missing heading anchor games/cards.md#big-two',
      'docs/guide.md: missing link target games.md#big-two',
      'docs/guide.md: missing heading anchor #missing',
      'docs/guide.md: malformed anchor #%E5',
    ]);
  });

  it('collects repository Markdown and runs in full and documentation scopes', async () => {
    const root = await fixture({ 'README.md': '# Card Together\n', 'docs/games/cards.md': '# 撲克牌遊戲\n', 'docs/a.txt': '' });
    expect(documentationPaths(root)).toEqual(['README.md', 'docs/games/cards.md']);
    const full = parseOptions(['full']);
    expect(planGates(root, selectChecks(root, full), full).map((gate) => gate.id)).toContain('documentation');
    const focused = parseOptions(['focused', '--files', 'docs/games/cards.md']);
    expect(planGates(root, selectChecks(root, focused), focused)).toEqual([{ id: 'documentation', internal: 'documentation' }]);
  });
});
