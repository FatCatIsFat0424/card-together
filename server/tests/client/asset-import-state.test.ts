import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Source {
  path: string;
  relativePath: string;
  mode: number;
  sha256: string;
  size: number;
}
interface Profile {
  measure<T>(name: string, operation: () => Promise<T>): Promise<T>;
  report(kind: string, reused: boolean): void;
}
interface CatalogEntry { file: string }
interface Report { skipped: string[]; renamed: string[]; compressed: string[] }
interface Publication {
  output: string;
  catalog: string;
  state: string;
  fingerprint: string;
  ownFile: RegExp;
  records: { file: string; catalog: CatalogEntry; bytes?: Buffer; source?: string; sha256?: string }[];
  report: Report;
  verifyInputs: () => Promise<void>;
}
interface Reuse extends Omit<Publication, 'records' | 'report' | 'verifyInputs'> {
  validateCatalog: (records: unknown) => void;
}
interface ImportState {
  importOptions(args: readonly string[], defaultRoot: string): { root: string; noCache: boolean; profile: boolean };
  importProfile(enabled: boolean): Profile;
  assertSafePath(path: string): Promise<void>;
  safeDirectory(path: string): Promise<void>;
  readSafeFile(path: string): Promise<Buffer>;
  digestFile(path: string): Promise<{ sha256: string; size: number }>;
  scanSources(input: string, extensions: ReadonlySet<string>, profile: Profile): Promise<Source[]>;
  inputFingerprint(kind: string, sources: readonly Source[], policy: unknown, script: string): Promise<string>;
  withImportLock<T>(output: string, operation: (state: string) => Promise<T>): Promise<T>;
  assertManagedFiles(output: string, ownFile: RegExp): Promise<void>;
  cleanupInterrupted(output: string, catalog: string, state: string): Promise<void>;
  reusableImport(options: Reuse): Promise<{ records: CatalogEntry[]; report: Report } | null>;
  publishImport(options: Publication): Promise<void>;
}

const repository = resolve(import.meta.dirname, '../../..');
const helper = pathToFileURL(join(repository, 'scripts/assets/import-state.mjs')).href;
const shared = await vi.importActual<ImportState>('../../../scripts/assets/import-state.mjs');
const roots: string[] = [];
const children: ChildProcess[] = [];
const adapters = [
  { kind: 'music', script: 'scripts/audio/import-provided-music.mjs', input: 'local-music', output: 'client/public/provided-music', catalog: 'client/src/audio/provided-music.generated.json', filename: 'sample.mp3', bytes: Buffer.from('audio fixture') },
  { kind: 'emoji', script: 'scripts/emoji/import-provided-emoji.mjs', input: 'local-emoji', output: 'client/public/provided-emoji', catalog: 'shared/src/provided-emoji.generated.json', filename: 'sample.png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) },
] as const;
type Adapter = typeof adapters[number];
const ownFile = /^asset-[a-f0-9]{24}\.bin$/;
const sampleFile = `asset-${'a'.repeat(24)}.bin`;
const sampleBytes = Buffer.from('shared asset fixture');
const report: Report = { skipped: ['unsupported source'], renamed: ['original name'], compressed: ['large image'] };

function hash(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'card-asset-state-'));
  roots.push(root);
  return root;
}
function fixture(adapter: Adapter): string {
  const root = temporaryRoot();
  mkdirSync(join(root, adapter.input));
  writeFileSync(join(root, adapter.input, adapter.filename), adapter.bytes);
  return root;
}
function run(adapter: Adapter, root: string, flags: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(repository, adapter.script), root, ...flags], { encoding: 'utf8', timeout: 20_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
function succeeded(adapter: Adapter, root: string, flags: readonly string[] = []): ReturnType<typeof run> {
  const result = run(adapter, root, flags);
  expect(result.status, result.stderr).toBe(0);
  return result;
}
function catalog(adapter: Adapter, root: string): CatalogEntry[] {
  return JSON.parse(readFileSync(join(root, adapter.catalog), 'utf8')) as CatalogEntry[];
}
function receipt(adapter: Adapter, root: string): string {
  return readFileSync(join(root, adapter.output, '.import-state/manifest.json'), 'utf8');
}
function validateCatalog(records: unknown): void {
  if (!Array.isArray(records) || records.some((record: unknown) => !record || typeof record !== 'object'
    || !('file' in record) || typeof record.file !== 'string' || !ownFile.test(record.file))) {
    throw new Error('Invalid contract catalog');
  }
}
async function contractFixture(): Promise<Publication & Reuse & { input: string }> {
  const root = temporaryRoot();
  const input = join(root, 'source');
  const output = join(root, 'output');
  const state = join(output, '.import-state');
  const catalogPath = join(root, 'catalog', 'assets.json');
  for (const path of [input, state, dirname(catalogPath)]) await shared.safeDirectory(path);
  writeFileSync(join(input, 'sample.bin'), sampleBytes);
  const options = {
    input, output, state, catalog: catalogPath, fingerprint: 'contract fingerprint', ownFile,
    records: [{ file: sampleFile, bytes: sampleBytes, catalog: { file: sampleFile } }],
    report, verifyInputs: (): Promise<void> => Promise.resolve(), validateCatalog,
  };
  await shared.publishImport(options);
  return options;
}
function exit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code));
  });
}
function line(child: ChildProcess): Promise<void> {
  return new Promise((resolveLine, rejectLine) => {
    child.once('error', rejectLine);
    child.stdout?.once('data', () => resolveLine());
    child.once('exit', (code) => rejectLine(new Error(`Lock holder exited before readiness: ${code}`)));
  });
}
async function waitForFlock(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Importer exited before waiting for flock');
    const ids = readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean);
    if (ids.some((id) => {
      try { return readFileSync(`/proc/${id}/comm`, 'utf8').trim() === 'flock'; }
      catch { return false; }
    })) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error('Importer did not wait for the publication lock');
}
function holder(output: string, catalogPath: string): ChildProcess {
  const code = `import { withImportLock, publishImport } from ${JSON.stringify(helper)}; import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; const output = process.argv[1]; const catalog = process.argv[2]; const entries = JSON.parse(await readFile(catalog, 'utf8')); const records = await Promise.all(entries.map(async entry => ({ file: entry.file, bytes: await readFile(join(output, entry.file)), catalog: entry }))); await withImportLock(output, state => publishImport({ output, catalog, state, fingerprint: 'interrupted fixture', records, ownFile: { test: file => records.some(record => record.file === file) }, report: { skipped: [], renamed: [], compressed: [] }, verifyInputs: async () => { process.stdout.write('staged\\n'); await new Promise(resolve => process.stdin.once('data', resolve)); } }));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code, output, catalogPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  return child;
}

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('shared asset import contracts', () => {
  it('parses roots and cache/profile flags and rejects unsupported CLI arguments', () => {
    const root = temporaryRoot();
    expect(shared.importOptions([], root)).toEqual({ root, noCache: false, profile: false });
    expect(shared.importOptions([root, '--profile', '--no-cache'], repository)).toEqual({ root, noCache: true, profile: true });
    expect(() => shared.importOptions(['--unknown'], root)).toThrow('Usage:');
    expect(() => shared.importOptions([root, repository], root)).toThrow('Usage:');
  });

  it('hashes bytes independently of mtime, records renames/deletions, and ignores unsupported files', async () => {
    const options = await contractFixture();
    const sourcePath = join(options.input, 'sample.bin');
    const scan = (): Promise<Source[]> => shared.scanSources(options.input, new Set(['.bin']), shared.importProfile(false));
    writeFileSync(join(options.input, 'owner.txt'), 'not imported');
    const original = await scan();
    expect(original.map(({ relativePath, sha256, size }) => ({ relativePath, sha256, size })))
      .toEqual([{ relativePath: 'sample.bin', sha256: hash(sampleBytes), size: sampleBytes.length }]);
    const before = await shared.inputFingerprint('contract', original, {}, join(repository, adapters[0].script));
    const info = statSync(sourcePath);
    const changed = Buffer.from(sampleBytes);
    changed[changed.length - 1] ^= 1;
    writeFileSync(sourcePath, changed);
    utimesSync(sourcePath, info.atime, info.mtime);
    expect(await shared.inputFingerprint('contract', await scan(), {}, join(repository, adapters[0].script))).not.toBe(before);
    expect(await shared.readSafeFile(sourcePath)).toEqual(changed);
    expect(await shared.digestFile(sourcePath)).toEqual({ sha256: hash(changed), size: changed.length });
    renameSync(sourcePath, join(options.input, 'renamed.bin'));
    expect((await scan()).map((source) => source.relativePath)).toEqual(['renamed.bin']);
    expect(await shared.inputFingerprint('contract', await scan(), {}, join(repository, adapters[0].script))).not.toBe(before);
    rmSync(join(options.input, 'renamed.bin'));
    expect(await scan()).toEqual([]);
    expect(await shared.inputFingerprint('contract', [], {}, join(repository, adapters[0].script))).not.toBe(before);
  });

  it('publishes source and byte records with independently verifiable receipt/catalog integrity', async () => {
    const options = await contractFixture();
    const other = `asset-${'b'.repeat(24)}.bin`;
    await shared.publishImport({ ...options, records: [options.records[0], { file: other, source: join(options.input, 'sample.bin'), sha256: hash(sampleBytes), catalog: { file: other } }] });
    const catalogBytes = readFileSync(options.catalog);
    const manifest = JSON.parse(readFileSync(join(options.state, 'manifest.json'), 'utf8')) as {
      schema: number; integrity: string; catalogHash: string; outputs: { file: string; sha256: string; size: number }[];
    };
    const { integrity, ...content } = manifest;
    expect(integrity).toBe(hash(JSON.stringify(content)));
    expect(manifest.schema).toBe(1);
    expect(manifest.catalogHash).toBe(hash(catalogBytes));
    expect(manifest.outputs).toEqual([sampleFile, other].map((file) => ({ file, sha256: hash(sampleBytes), size: sampleBytes.length })));
    for (const file of [sampleFile, other]) expect(readFileSync(join(options.output, file))).toEqual(sampleBytes);
    expect(await shared.reusableImport(options)).toEqual({ records: [{ file: sampleFile }, { file: other }], report });
  });

  it.each(['missing output', 'same-size corrupt output', 'corrupt catalog', 'corrupt receipt', 'extra managed output'] as const)('rejects reuse after %s and restores the published contract', async (damage) => {
    const options = await contractFixture();
    const path = join(options.output, sampleFile);
    const before = readFileSync(join(options.state, 'manifest.json'), 'utf8');
    const orphan = join(options.output, `asset-${'c'.repeat(24)}.bin`);
    if (damage === 'missing output') rmSync(path);
    if (damage === 'same-size corrupt output') {
      const info = statSync(path);
      writeFileSync(path, Buffer.alloc(sampleBytes.length));
      utimesSync(path, info.atime, info.mtime);
    }
    if (damage === 'corrupt catalog') writeFileSync(options.catalog, '[]');
    if (damage === 'corrupt receipt') writeFileSync(join(options.state, 'manifest.json'), '{}');
    if (damage === 'extra managed output') writeFileSync(orphan, 'stale');
    expect(await shared.reusableImport(options)).toBeNull();
    await shared.publishImport(options);
    expect(readFileSync(path)).toEqual(sampleBytes);
    expect(readFileSync(join(options.state, 'manifest.json'), 'utf8')).toBe(before);
    expect(await shared.reusableImport(options)).toEqual({ records: [{ file: sampleFile }], report });
    expect(existsSync(orphan)).toBe(false);
  });

  it.each(['schema', 'fingerprint', 'output hash', 'output size', 'output filename', 'report', 'duplicate catalog files', 'catalog validation'] as const)('rejects internally signed but invalid %s', async (damage) => {
    const options = await contractFixture();
    const path = join(options.state, 'manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      schema: number; fingerprint: string; catalogHash: string; integrity?: string;
      outputs: { file: string; sha256: string; size: number }[]; report: unknown;
    };
    delete manifest.integrity;
    if (damage === 'schema') manifest.schema = 99;
    if (damage === 'fingerprint') manifest.fingerprint = 'another input';
    if (damage === 'output hash') manifest.outputs[0].sha256 = 'invalid';
    if (damage === 'output size') manifest.outputs[0].size += 1;
    if (damage === 'output filename') manifest.outputs[0].file = '../owner.txt';
    if (damage === 'report') manifest.report = { skipped: [], renamed: [] };
    if (damage === 'duplicate catalog files' || damage === 'catalog validation') {
      const records = damage === 'duplicate catalog files' ? [{ file: sampleFile }, { file: sampleFile }] : [{ file: sampleFile, invalid: true }];
      const bytes = JSON.stringify(records);
      writeFileSync(options.catalog, bytes);
      manifest.catalogHash = hash(bytes);
    }
    writeFileSync(path, JSON.stringify({ ...manifest, integrity: hash(JSON.stringify(manifest)) }));
    const validate = damage === 'catalog validation' ? (): never => { throw new Error('Rejected by adapter validator'); } : validateCatalog;
    expect(await shared.reusableImport({ ...options, validateCatalog: validate })).toBeNull();
  });

  it.each(['source hash mismatch', 'input verification failure', 'invalid managed name'] as const)('preserves successful publication and cleans staging after %s', async (failure) => {
    const options = await contractFixture();
    const before = readFileSync(join(options.state, 'manifest.json'), 'utf8');
    const records = failure === 'source hash mismatch'
      ? [{ file: sampleFile, source: join(options.input, 'sample.bin'), sha256: 'wrong hash', catalog: { file: sampleFile } }]
      : failure === 'invalid managed name' ? [{ file: '../owner.txt', bytes: sampleBytes, catalog: { file: '../owner.txt' } }] : options.records;
    await expect(shared.publishImport({ ...options, records, verifyInputs: async (): Promise<void> => {
      if (failure === 'input verification failure') throw new Error('Input changed');
    } })).rejects.toThrow(failure === 'source hash mismatch' ? 'Source changed during import' : failure === 'invalid managed name' ? 'Invalid managed asset file' : 'Input changed');
    expect(readFileSync(join(options.state, 'manifest.json'), 'utf8')).toBe(before);
    expect(readFileSync(join(options.output, sampleFile))).toEqual(sampleBytes);
    expect(await shared.reusableImport(options)).toEqual({ records: [{ file: sampleFile }], report });
    expect(readdirSync(options.output).filter((name) => name.startsWith('.import-stage-'))).toEqual([]);
    expect(readdirSync(dirname(options.catalog))).toEqual(['assets.json']);
    expect(readdirSync(options.state)).toEqual(['manifest.json']);
  });

  it('removes managed orphans and interrupted PID-UUID files while preserving owner files and backup temps', async () => {
    const options = await contractFixture();
    const token = '123-12345678-1234-1234-1234-123456789abc';
    const owner = join(options.output, 'owner.txt');
    const unrelated = [`${options.catalog}.owner-backup.tmp`, join(options.state, 'manifest.json.owner-backup.tmp')];
    const interrupted = [`${options.catalog}.${token}.tmp`, join(options.state, `manifest.json.${token}.tmp`)];
    for (const path of [owner, ...unrelated, ...interrupted]) writeFileSync(path, 'keep or clean');
    mkdirSync(join(options.output, `.import-stage-${token}`));
    mkdirSync(join(options.output, '.import-stage-owner-backup'));
    await shared.cleanupInterrupted(options.output, options.catalog, options.state);
    await shared.publishImport({ ...options, records: [] });
    expect(await shared.reusableImport(options)).toEqual({ records: [], report });
    expect(existsSync(join(options.output, sampleFile))).toBe(false);
    for (const path of [owner, ...unrelated]) expect(readFileSync(path, 'utf8')).toBe('keep or clean');
    for (const path of interrupted) expect(existsSync(path)).toBe(false);
    expect(existsSync(join(options.output, `.import-stage-${token}`))).toBe(false);
    expect(existsSync(join(options.output, '.import-stage-owner-backup'))).toBe(true);
  });

  it.each(['source', 'source ancestor', 'output', 'output ancestor', 'catalog', 'catalog ancestor', 'managed file', 'owner file', 'nested output', 'lock', 'state'] as const)('rejects a symlink at %s through the responsible shared operation without modifying its target', async (location) => {
    const options = await contractFixture();
    await shared.withImportLock(options.output, (): Promise<void> => Promise.resolve());
    writeFileSync(join(options.output, 'owner.txt'), 'owner');
    mkdirSync(join(options.output, 'owner-directory'));
    const paths = {
      source: join(options.input, 'sample.bin'), 'source ancestor': options.input,
      output: options.output, 'output ancestor': dirname(options.output), catalog: options.catalog,
      'catalog ancestor': dirname(options.catalog), 'managed file': join(options.output, sampleFile),
      'owner file': join(options.output, 'owner.txt'), 'nested output': join(options.output, 'owner-directory'),
      lock: join(options.state, 'lock'), state: options.state,
    };
    const path = paths[location];
    const before = readFileSync(join(options.state, 'manifest.json'), 'utf8');
    const external = temporaryRoot();
    writeFileSync(join(external, 'sentinel'), 'external owner');
    const backup = `${path}.backup`;
    renameSync(path, backup);
    symlinkSync(statSync(backup).isDirectory() ? external : join(external, 'sentinel'), path);
    const operation = location.startsWith('source')
      ? (): Promise<Source[]> => shared.scanSources(options.input, new Set(['.bin']), shared.importProfile(false))
      : location === 'lock' || location === 'state' || location.startsWith('output')
        ? (): Promise<void> => shared.withImportLock(options.output, (): Promise<void> => Promise.resolve())
        : location.startsWith('catalog')
          ? (): Promise<void> => shared.publishImport(options)
          : (): Promise<void> => shared.assertManagedFiles(options.output, ownFile);
    await expect(operation()).rejects.toThrow('Symlinks are not allowed');
    expect(readFileSync(join(external, 'sentinel'), 'utf8')).toBe('external owner');
    expect(readdirSync(external)).toEqual(['sentinel']);
    rmSync(path);
    renameSync(backup, path);
    expect(readFileSync(join(options.state, 'manifest.json'), 'utf8')).toBe(before);
  });

  it.each(['catalog', 'manifest', 'source', 'managed output'] as const)('rejects FIFO %s paths without blocking', async (field) => {
    const options = await contractFixture();
    const path = field === 'catalog' ? options.catalog : field === 'manifest' ? join(options.state, 'manifest.json')
      : field === 'source' ? join(options.input, 'sample.bin') : join(options.output, sampleFile);
    rmSync(path);
    expect(spawnSync('mkfifo', [path]).status).toBe(0);
    await expect(shared.readSafeFile(path)).rejects.toThrow('Expected a regular file:');
    await expect(shared.digestFile(path)).rejects.toThrow('Expected a regular file:');
    if (field === 'catalog' || field === 'manifest') {
      await expect(shared.reusableImport(options)).rejects.toThrow('Expected a regular file:');
      await expect(shared.publishImport(options)).rejects.toThrow('Expected a regular file:');
    } else if (field === 'managed output') {
      await expect(shared.assertManagedFiles(options.output, ownFile)).rejects.toThrow('Expected a regular managed file:');
      expect(await shared.reusableImport(options)).toBeNull();
    }
  });

  it('fingerprints script, helper, runtime policy, dependencies and both catalog validators', async () => {
    const tools = temporaryRoot();
    const files = ['scripts/assets/import-state.mjs', 'scripts/audio/import-provided-music.mjs', 'package.json', 'package-lock.json', '.node-version', 'client/src/audio/validate-provided-music-catalog.ts', 'shared/src/constants/emoji.ts'];
    for (const file of files) {
      mkdirSync(dirname(join(tools, file)), { recursive: true });
      copyFileSync(join(repository, file), join(tools, file));
    }
    const dependencies = ['sharp', `@img/sharp-${process.platform}-${process.arch}`, `@img/sharp-libvips-${process.platform}-${process.arch}`]
      .map((name) => `node_modules/${name}/package.json`);
    for (const file of dependencies) {
      mkdirSync(dirname(join(tools, file)), { recursive: true });
      writeFileSync(join(tools, file), '{"version":"fixture"}');
    }
    const isolated = await vi.importActual<ImportState>(join(tools, files[0]));
    const script = join(tools, files[1]);
    const fingerprint = (kind = 'contract', policy: unknown = {}): Promise<string> => isolated.inputFingerprint(kind, [], policy, script);
    let before = await fingerprint();
    expect(await fingerprint()).toBe(before);
    expect(await fingerprint('emoji')).not.toBe(before);
    expect(await fingerprint('contract', { maxBytes: 1 })).not.toBe(before);
    for (const file of [...files, ...dependencies]) {
      const path = join(tools, file);
      writeFileSync(path, readFileSync(path, 'utf8') + '\n');
      const changed = await fingerprint();
      expect(changed, file).not.toBe(before);
      expect(await fingerprint(), file).toBe(changed);
      before = changed;
    }
    rmSync(join(tools, dependencies[0]));
    expect(await fingerprint()).not.toBe(before);
  });

  it('serializes concurrent publications behind flock', async () => {
    const options = await contractFixture();
    const owner = holder(options.output, options.catalog);
    await line(owner);
    expect(spawnSync('flock', ['-n', join(options.state, 'lock'), 'true']).status).toBe(1);
    const workers = [0, 1].map(() => holder(options.output, options.catalog));
    const ready = workers.map(line);
    await Promise.all(workers.map(waitForFlock));
    const ownerExit = exit(owner);
    owner.stdin?.end('release');
    expect(await ownerExit).toBe(0);
    const pending = new Set(workers.map((_, index) => index));
    while (pending.size > 0) {
      const index = await Promise.race([...pending].map((candidate) => ready[candidate].then(() => candidate)));
      const locked = workers[index];
      const lockedExit = exit(locked);
      locked.stdin?.end('release');
      expect(await lockedExit).toBe(0);
      pending.delete(index);
    }
    expect(await shared.reusableImport({ ...options, fingerprint: 'interrupted fixture' })).toEqual({ records: [{ file: sampleFile }], report: { skipped: [], renamed: [], compressed: [] } });
    expect(readdirSync(options.output).filter((name) => name.startsWith('.import-stage-'))).toEqual([]);
  });

  it('releases flock after SIGKILL, removes interrupted staging and preserves the successful receipt', async () => {
    const options = await contractFixture();
    const before = readFileSync(join(options.state, 'manifest.json'), 'utf8');
    const owner = holder(options.output, options.catalog);
    await line(owner);
    expect(readdirSync(options.output).some((name) => name.startsWith('.import-stage-'))).toBe(true);
    const ownerExit = exit(owner);
    owner.kill('SIGKILL');
    expect(await ownerExit).toBeNull();
    await shared.withImportLock(options.output, async (state) => {
      await shared.cleanupInterrupted(options.output, options.catalog, state);
      expect(await shared.reusableImport(options)).toEqual({ records: [{ file: sampleFile }], report });
    });
    expect(readFileSync(join(options.state, 'manifest.json'), 'utf8')).toBe(before);
    expect(readdirSync(options.output).filter((name) => name.startsWith('.import-stage-'))).toEqual([]);
  });
});

describe.each(adapters)('$kind CLI shared-state wiring', (adapter) => {
  it('imports, reuses and invalidates same-size source changes, renames and deletions', () => {
    const root = fixture(adapter);
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    const before = receipt(adapter, root);
    expect(succeeded(adapter, root).stdout).toContain('Reused');
    expect(receipt(adapter, root)).toBe(before);
    const source = join(root, adapter.input, adapter.filename);
    const info = statSync(source);
    const changed = Buffer.from(adapter.bytes);
    changed[changed.length - 1] ^= 1;
    writeFileSync(source, changed);
    utimesSync(source, info.atime, info.mtime);
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    expect(receipt(adapter, root)).not.toBe(before);
    const original = catalog(adapter, root)[0].file;
    expect(readFileSync(join(root, adapter.output, original))).toEqual(changed);
    writeFileSync(join(root, adapter.output, 'owner.txt'), 'owner');
    renameSync(source, join(root, adapter.input, `renamed.${adapter.filename.split('.').at(-1)}`));
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    expect(catalog(adapter, root)[0].file).not.toBe(original);
    expect(existsSync(join(root, adapter.output, original))).toBe(false);
    rmSync(join(root, adapter.input), { recursive: true });
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    expect(catalog(adapter, root)).toEqual([]);
    expect(readFileSync(join(root, adapter.output, 'owner.txt'), 'utf8')).toBe('owner');
  });

  it('validates actual catalog/output bytes and forces publication only with --no-cache', () => {
    const root = fixture(adapter);
    succeeded(adapter, root);
    const entry = catalog(adapter, root)[0];
    const before = receipt(adapter, root);
    const warm = succeeded(adapter, root, ['--profile']);
    expect(warm.stdout).toContain('Reused');
    expect(receipt(adapter, root)).toBe(before);
    const warmProfile = JSON.parse(warm.stderr.trim().split('\n').at(-1) ?? '') as { reused: boolean; phasesMs: Record<string, number> };
    expect(warmProfile.reused).toBe(true);
    expect(warmProfile.phasesMs.validateOutputs).toBeGreaterThanOrEqual(0);
    writeFileSync(join(root, adapter.output, entry.file), Buffer.alloc(adapter.bytes.length));
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    expect(readFileSync(join(root, adapter.output, entry.file))).toEqual(adapter.bytes);
    writeFileSync(join(root, adapter.catalog), '[]');
    expect(succeeded(adapter, root).stdout).toContain('Imported');
    expect(catalog(adapter, root)).toEqual([entry]);
    const cold = succeeded(adapter, root, ['--no-cache', '--profile']);
    const coldProfile = JSON.parse(cold.stderr.trim().split('\n').at(-1) ?? '') as typeof warmProfile;
    expect(cold.stdout).toContain('Imported');
    expect(coldProfile.reused).toBe(false);
    expect(coldProfile.phasesMs.publish).toBeGreaterThanOrEqual(0);
    expect(catalog(adapter, root)).toEqual([entry]);
    expect(readFileSync(join(root, adapter.output, entry.file))).toEqual(adapter.bytes);
    expect(readFileSync(join(root, adapter.input, adapter.filename))).toEqual(adapter.bytes);
    expect(receipt(adapter, root)).toBe(before);
  });

  it.each(['source', 'output ancestor', 'catalog ancestor', 'owner file', 'state'] as const)('enforces shared security for %s with default and --no-cache execution', (location) => {
    const root = fixture(adapter);
    succeeded(adapter, root);
    writeFileSync(join(root, adapter.output, 'owner.txt'), 'owner');
    const before = receipt(adapter, root);
    const paths = {
      source: join(root, adapter.input, adapter.filename), 'output ancestor': join(root, 'client/public'),
      'catalog ancestor': dirname(join(root, adapter.catalog)), 'owner file': join(root, adapter.output, 'owner.txt'),
      state: join(root, adapter.output, '.import-state'),
    };
    const path = paths[location];
    const backup = `${path}.backup`;
    const external = temporaryRoot();
    writeFileSync(join(external, 'sentinel'), 'external owner');
    renameSync(path, backup);
    symlinkSync(statSync(backup).isDirectory() ? external : join(external, 'sentinel'), path);
    for (const flags of [[], ['--no-cache']]) {
      const result = run(adapter, root, flags);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Symlinks are not allowed');
      expect(readFileSync(join(external, 'sentinel'), 'utf8')).toBe('external owner');
      expect(readdirSync(external)).toEqual(['sentinel']);
    }
    rmSync(path);
    renameSync(backup, path);
    expect(receipt(adapter, root)).toBe(before);
  });

  it.each(['catalog', 'manifest'] as const)('rejects FIFO %s with default and --no-cache execution', (field) => {
    const root = fixture(adapter);
    succeeded(adapter, root);
    const path = field === 'catalog' ? join(root, adapter.catalog) : join(root, adapter.output, '.import-state/manifest.json');
    rmSync(path);
    expect(spawnSync('mkfifo', [path]).status).toBe(0);
    for (const flags of [[], ['--no-cache']]) {
      const result = run(adapter, root, flags);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Expected a regular file:');
    }
  });

  it('waits for the shared publication lock before publishing', async () => {
    const root = fixture(adapter);
    succeeded(adapter, root);
    const output = join(root, adapter.output);
    const owner = holder(output, join(root, adapter.catalog));
    await line(owner);
    const child = spawn(process.execPath, [join(repository, adapter.script), root, '--no-cache'], { stdio: 'pipe' });
    children.push(child);
    const finished = exit(child);
    await waitForFlock(child);
    expect(readFileSync(join(output, catalog(adapter, root)[0].file))).toEqual(adapter.bytes);
    const ownerExit = exit(owner);
    owner.stdin?.end('release');
    expect(await ownerExit).toBe(0);
    expect(await finished).toBe(0);
    expect(succeeded(adapter, root).stdout).toContain('Reused');
    expect(readFileSync(join(output, catalog(adapter, root)[0].file))).toEqual(adapter.bytes);
  });
});
