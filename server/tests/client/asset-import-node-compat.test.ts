import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const repository = resolve(import.meta.dirname, '../../..');
const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'card-node-strip-'));
  roots.push(root);
  return root;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each([false, true])('preserves streams, arguments, flags and exit status (stripping disabled=%s)', (disabled) => {
  const root = temporaryRoot();
  const script = join(root, 'bootstrap.mjs');
  const helper = pathToFileURL(join(repository, 'scripts/assets/import-state.mjs')).href;
  writeFileSync(script, `import { ensureTypeScriptSupport } from ${JSON.stringify(helper)}; import { fileURLToPath } from 'node:url'; ensureTypeScriptSupport(fileURLToPath(import.meta.url), process.argv.slice(2)); process.stdout.write(JSON.stringify({ pid: process.pid, typescript: process.features.typescript, args: process.argv.slice(2), flags: process.execArgv })); process.stderr.write('preserved diagnostic'); process.exitCode = 7;`);
  const result = spawnSync(process.execPath, [...(disabled ? ['--no-experimental-strip-types'] : []), '--trace-warnings', script, 'root with spaces', '--no-cache'], { encoding: 'utf8', timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(7);
  expect(result.stderr).toBe('preserved diagnostic');
  const output = JSON.parse(result.stdout) as { pid: number; typescript: string; args: string[]; flags: string[] };
  expect(output.typescript).toBe('strip');
  expect(output.args).toEqual(['root with spaces', '--no-cache']);
  expect(output.flags).toContain('--trace-warnings');
  if (disabled) {
    expect(output.pid).not.toBe(result.pid);
    expect(output.flags.at(-1)).toBe('--experimental-strip-types');
  } else {
    expect(output.pid).toBe(result.pid);
    expect(output.flags).not.toContain('--experimental-strip-types');
  }
});

it.each([
  ['scripts/audio/import-provided-music.mjs', 'local-music', 'sample.mp3', 'client/src/audio/provided-music.generated.json', 'music', Buffer.from('audio fixture')],
  ['scripts/emoji/import-provided-emoji.mjs', 'local-emoji', 'sample.png', 'shared/src/provided-emoji.generated.json', 'emoji', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
] as const)('imports and reuses shared TypeScript catalogs without default stripping: %s', (script, input, file, catalog, kind, bytes) => {
  const root = temporaryRoot();
  mkdirSync(join(root, input));
  writeFileSync(join(root, input, file), bytes);
  for (const [expected, force] of [['Imported', false], ['Reused', false], ['Imported', true]] as const) {
    const result = spawnSync(process.execPath, ['--no-experimental-strip-types', join(repository, script), root, '--profile', ...(force ? ['--no-cache'] : [])], { encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(expected);
    const profile = JSON.parse(result.stderr.trim().split('\n').at(-1) ?? '') as { assetImport: string; reused: boolean };
    expect(profile).toMatchObject({ assetImport: kind, reused: expected === 'Reused' });
    const records = JSON.parse(readFileSync(join(root, catalog), 'utf8')) as { file: string }[];
    expect(records).toHaveLength(1);
    expect(readFileSync(join(root, 'client/public', `provided-${kind}`, records[0].file))).toEqual(bytes);
    expect(readFileSync(join(root, input, file))).toEqual(bytes);
  }
});
