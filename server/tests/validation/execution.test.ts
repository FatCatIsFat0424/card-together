import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inputFingerprint, planGates, preparationFingerprint, runGates } from '../../../scripts/validation/check';
import type { FingerprintEntry } from '../../../scripts/validation/check';
import { parseOptions, selectChecks } from '../../../scripts/validation/selection';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('validation gate execution', () => {
  it('prepares catalogs before five type environments and has only one client app check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'card-validation-gates-')); directories.push(root);
    const options = parseOptions(['full', '--no-cache']);
    const gates = planGates(root, selectChecks(root, options), options);
    const ids = gates.map((gate) => gate.id);
    expect(ids.slice(0, 3)).toEqual(['import-music', 'import-emoji', 'import-demos']);
    expect(ids.filter((id) => id.startsWith('type-'))).toEqual(['type-shared', 'type-server', 'type-tests', 'type-client', 'type-client-node']);
    expect(ids.filter((id) => id === 'type-client')).toHaveLength(1);
    expect(ids.indexOf('type-client')).toBeLessThan(ids.indexOf('bundle'));
    expect(gates[0].args).toContain('--no-cache');
    expect(ids).toContain('clear-type-cache');
    expect(ids).toContain('lint'); expect(ids).toContain('vitest'); expect(ids).toContain('python');
  });

  it('propagates importer failure and marks every downstream gate not-run', async () => {
    const execute = vi.fn(async () => 1);
    const fingerprint = vi.fn(() => 'inputs');
    const result = await runGates([{ id: 'import', preparation: true }, { id: 'type' }, { id: 'bundle' }], execute, fingerprint);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fingerprint).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
    expect(result.results.map((gate) => gate.status)).toEqual(['fail', 'not-run', 'not-run']);
  });

  it('rejects a changed input even when every selected command passed', async () => {
    let input = 'before';
    const result = await runGates([{ id: 'type' }, { id: 'bundle' }], async () => { input = 'after'; return 0; }, () => input);
    expect(result.exitCode).toBe(2);
    expect(result.results.map((gate) => gate.status)).toEqual(['pass', 'not-run']);
  });

  it('captures generated input only after preparation and preserves cancellation', async () => {
    let input = 'old';
    const result = await runGates([{ id: 'import', preparation: true }, { id: 'type' }, { id: 'lint' }], async (gate) => {
      if (gate.preparation) { input = 'generated'; return 0; }
      return 130;
    }, () => input);
    expect(result.exitCode).toBe(130);
    expect(result.results.map((gate) => gate.status)).toEqual(['pass', 'fail', 'not-run']);
  });

  it('does not certify an empty gate list', async () => {
    expect((await runGates([], async () => 0, () => 'same')).exitCode).toBe(2);
  });

  it('rejects source changes during asset preparation before checking generated data', async () => {
    let source = 'original';
    const result = await runGates([{ id: 'import', preparation: true }, { id: 'type' }], async () => {
      source = 'changed'; return 0;
    }, () => 'generated', () => source);
    expect(result.exitCode).toBe(2);
    expect(result.results.map((gate) => gate.status)).toEqual(['pass', 'not-run']);
  });

  it('invalidates dependency/config additions, deletes and unchanged-size edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'card-validation-fingerprint-')); directories.push(root);
    await mkdir(join(root, 'client/src'), { recursive: true });
    await writeFile(join(root, 'client/src/a.ts'), 'first');
    const selection = selectChecks(root, parseOptions(['full']));
    const cache = new Map<string, FingerprintEntry>();
    const initial = inputFingerprint(root, selection, cache);
    expect(inputFingerprint(root, selection, cache)).toBe(initial);
    await writeFile(join(root, 'client/src/a.ts'), 'other');
    const changed = inputFingerprint(root, selection, cache);
    expect(changed).not.toBe(initial);
    await writeFile(join(root, 'package-lock.json'), '{}');
    const lock = inputFingerprint(root, selection, cache); expect(lock).not.toBe(changed);
    await rename(join(root, 'client/src/a.ts'), join(root, 'client/src/b.ts'));
    const renamed = inputFingerprint(root, selection, cache); expect(renamed).not.toBe(lock);
    await rm(join(root, 'client/src/b.ts')); expect(inputFingerprint(root, selection, cache)).not.toBe(renamed);
  });
});


it('tracks immutable source, HTML and environment during preparation while allowing generated catalogs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'card-validation-preparation-')); directories.push(root);
  for (const path of ['server/src', 'client/src/audio', 'shared/src', 'client/public/provided-music', 'client/public/game-demos']) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, 'server/src/a.ts'), 'first');
  const cache = new Map<string, FingerprintEntry>();
  const before = preparationFingerprint(root, cache);
  await writeFile(join(root, 'client/src/audio/provided-music.generated.json'), '[]');
  await writeFile(join(root, 'shared/src/provided-emoji.generated.json'), '[]');
  await writeFile(join(root, 'client/src/game-demo-videos.generated.json'), '[]');
  await writeFile(join(root, 'client/public/provided-music/imported-fixture.mp3'), 'generated');
  await writeFile(join(root, `client/public/game-demos/bridge-${'a'.repeat(24)}.mp4`), 'generated');
  expect(preparationFingerprint(root, cache)).toBe(before);
  const gates = [{ id: 'import', preparation: true }, { id: 'type' }];
  const result = await runGates(gates, async () => {
    await writeFile(join(root, 'server/src/a.ts'), 'other'); return 0;
  }, () => 'generated', () => preparationFingerprint(root, cache), before);
  expect(result.exitCode).toBe(2);
  expect(result.results.map((gate) => gate.status)).toEqual(['pass', 'not-run']);
  const source = preparationFingerprint(root, cache);
  await writeFile(join(root, 'client/index.html'), '<html>changed</html>');
  const html = preparationFingerprint(root, cache); expect(html).not.toBe(source);
  await writeFile(join(root, 'client/.env.local'), 'VITE_BASE_PATH=/different/');
  expect(preparationFingerprint(root, cache)).not.toBe(html);
  const full = selectChecks(root, parseOptions(['full']));
  const bundled = inputFingerprint(root, full, cache);
  await writeFile(join(root, 'client/index.html'), '<html>mutated</html>');
  expect(inputFingerprint(root, full, cache)).not.toBe(bundled);
});
