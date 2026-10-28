import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedPaths, normalizePath, parseOptions, selectChecks } from '../../../scripts/validation/selection';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'card-validation-selection-'));
  directories.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe('validation selection input', () => {
  it.each([
    [], ['focused'], ['focused', '--files'], ['focused', '--base', '--dry-run'],
    ['focused', '--base', 'main', '--files', 'a.ts'], ['full', '--files', 'a.ts'],
    ['release', '--base', 'main'], ['focused', '--unknown'], ['full', '--wat'],
  ].map((args) => ({ args })))('rejects invalid arguments $args before verification', ({ args }) => {
    expect(() => parseOptions(args)).toThrow();
  });

  it('keeps explicit filenames and options independent', () => {
    expect(parseOptions(['focused', '--files', 'client/src/a file.ts', 'client/src/b.ts', '--no-cache', '--dry-run']))
      .toEqual({ mode: 'focused', files: ['client/src/a file.ts', 'client/src/b.ts'], dryRun: true, noCache: true });
  });

  it.each(['/etc/passwd', '../outside', '.git/config', '', '-file'])('rejects unsafe path %s', (path) => {
    expect(() => normalizePath('/repository', path)).toThrow();
  });

  it('includes committed, staged, dirty, untracked and both rename paths relative to the explicit base', async () => {
    const root = await fixture({ '.gitignore': '.ignored\n', 'old name.ts': 'original', 'dirty.ts': 'old', 'staged.ts': 'old' });
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'test: create synthetic fixture');
    const base = git('rev-parse', 'HEAD').trim();
    await writeFile(join(root, 'committed.ts'), 'committed'); git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'test: change synthetic fixture');
    git('mv', 'old name.ts', 'new name.ts');
    await writeFile(join(root, 'staged.ts'), 'staged'); git('add', 'staged.ts');
    await writeFile(join(root, 'dirty.ts'), 'dirty'); await writeFile(join(root, 'untracked.ts'), 'new');
    await writeFile(join(root, '.ignored'), 'ignored');
    expect(changedPaths(root, parseOptions(['focused', '--base', base]))).toEqual([
      'committed.ts', 'dirty.ts', 'new name.ts', 'old name.ts', 'staged.ts', 'untracked.ts',
    ]);
    expect(() => changedPaths(root, parseOptions(['focused', '--base', 'missing-ref']))).toThrow();
  });
});

describe('dependency and risk selection', () => {
  it('finds transitive rule consumers and retains a focused scope', async () => {
    const root = await fixture({
      'server/src/engine/rule.ts': 'export const rule = 1;',
      'server/src/engine/wrapper.ts': "export { rule } from './rule';",
      'server/tests/engine/rule.test.ts': "import { rule } from '../../src/engine/wrapper';",
      'server/tests/engine/unrelated.test.ts': 'export {};',
    });
    const selection = selectChecks(root, parseOptions(['focused', '--files', 'server/src/engine/rule.ts']));
    expect(selection.scope).toBe('focused');
    expect(selection.tests).toEqual(['server/tests/engine/rule.test.ts']);
    expect(selection.types).toEqual(['server', 'tests']);
    expect(selection.lint).toContain('server/src/engine/wrapper.ts');
  });

  it.each(['server/src/runtime/queue.ts', 'server/src/app.ts', 'server/src/index.ts', 'server/src/config.ts'])('adds runtime, privacy and persistence suites for %s even without an import edge', async (path) => {
    const root = await fixture({ [path]: 'export {};',
      'server/tests/voice/privacy.test.ts': 'export {};', 'server/tests/database/rollback.test.ts': 'export {};' });
    const selection = selectChecks(root, parseOptions(['focused', '--files', path]));
    expect(selection.tests).toEqual(['server/tests/database/rollback.test.ts', 'server/tests/voice/privacy.test.ts']);
  });

  it.each(['package-lock.json', 'shared/src/types/new.ts', 'server/vitest.config.ts', 'scripts/validation/new.ts', 'unknown.txt'])(
    'broadens protected or unmapped input %s', async (path) => {
      const root = await fixture({ [path]: '' });
      expect(selectChecks(root, parseOptions(['focused', '--files', path])).scope).toBe('full');
    });

  it('resolves Vite asset queries and files outside the source roots without broadening', async () => {
    const root = await fixture({
      'client/src/stickers.ts': "import hello from './assets/hello.svg?no-inline'; export { hello };",
      'client/src/assets/hello.svg': '<svg/>',
      'client/vite.config.ts': 'export default {};',
      'server/tests/client/proxy.test.ts': "import config from '../../../client/vite.config'; void config;",
    });
    expect(selectChecks(root, parseOptions(['focused', '--files', 'client/src/stickers.ts'])).scope).toBe('focused');
    expect(selectChecks(root, parseOptions(['focused', '--files', 'server/tests/client/proxy.test.ts'])).scope).toBe('focused');
  });

  it('broadens deleted inputs and nonliteral dependency resolution', async () => {
    const root = await fixture({ 'server/src/engine/dynamic.ts': 'const name = "./other"; import(name);' });
    expect(selectChecks(root, parseOptions(['focused', '--files', 'server/src/engine/missing.ts'])).scope).toBe('full');
    expect(selectChecks(root, parseOptions(['focused', '--files', 'server/src/engine/dynamic.ts'])).scope).toBe('full');
  });

  it('maps deployment sources and conservatively expands unknown helpers', async () => {
    const root = await fixture({ 'deploy/start-service.sh': '', 'deploy/new-helper.py': '' });
    expect(selectChecks(root, parseOptions(['focused', '--files', 'deploy/start-service.sh'])).python).toEqual(['test_start_service']);
    const unknown = selectChecks(root, parseOptions(['focused', '--files', 'deploy/new-helper.py']));
    expect(unknown.python).toEqual(['*']);
    expect(unknown.tests).toEqual([]);
  });

  it('labels documentation separately from full runtime success', async () => {
    const root = await fixture({ 'docs/development.md': '# Development\n' });
    expect(selectChecks(root, parseOptions(['focused', '--files', 'docs/development.md'])).scope).toBe('documentation');
  });
});
