/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, parse, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCHEMA = 1;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Re-runs with type stripping when it was disabled, so the shared TypeScript contracts load. */
export function ensureTypeScriptSupport(script, args) {
  const stripFlag = process.execArgv.findLast((arg) =>
    arg === '--experimental-strip-types' || arg === '--no-experimental-strip-types');
  if (process.features.typescript || stripFlag === '--experimental-strip-types') return;
  const child = spawnSync(process.execPath,
    [...process.execArgv, '--experimental-strip-types', script, ...args], { stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.signal) process.kill(process.pid, child.signal);
  process.exit(child.status ?? 1);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function importOptions(args, defaultRoot) {
  const roots = args.filter((arg) => !arg.startsWith('--'));
  if (roots.length > 1 || args.some((arg) => arg.startsWith('--') && !['--no-cache', '--profile'].includes(arg))) {
    throw new Error('Usage: import-provided-assets.mjs [root] [--no-cache] [--profile]');
  }
  return { root: resolve(roots[0] ?? defaultRoot), noCache: args.includes('--no-cache'), profile: args.includes('--profile') };
}

export function importProfile(enabled) {
  const phases = {};
  return {
    async measure(name, operation) {
      const start = performance.now();
      try { return await operation(); }
      finally { phases[name] = (phases[name] ?? 0) + performance.now() - start; }
    },
    report(kind, reused) {
      if (enabled) process.stderr.write(JSON.stringify({ assetImport: kind, reused, phasesMs: phases }) + '\n');
    },
  };
}

/** Check every ancestor before creating, opening or removing managed paths. */
export async function assertSafePath(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${current}`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

export async function safeDirectory(path) {
  await assertSafePath(path);
  await mkdir(path, { recursive: true });
  await assertSafePath(path);
  if (!(await lstat(path)).isDirectory()) throw new Error(`Expected a directory: ${path}`);
}

export async function readSafeFile(path) {
  await assertSafePath(path);
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Expected a regular file: ${path}`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function digestFile(path) {
  await assertSafePath(path);
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Expected a regular file: ${path}`);
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return { sha256: hash.digest('hex'), size: info.size };
  } finally { await handle.close(); }
}

/** Unsupported files are not imported, but symlinks anywhere in the source tree are refused. `accept` narrows files by name. */
export async function scanSources(input, extensions, profile, accept = () => true) {
  const paths = [];
  await profile.measure('scan', async () => {
    async function collect(directory) {
      await assertSafePath(directory);
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${path}`);
        if (entry.isDirectory()) await collect(path);
        else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase()) && accept(entry.name)) paths.push(path);
      }
    }
    await collect(input);
    paths.sort();
  });
  return profile.measure('hashSources', async () => {
    const sources = [];
    for (const path of paths) {
      const relativePath = relative(input, path).split(sep).join('/');
      const info = await lstat(path);
      try { sources.push({ path, relativePath, mode: info.mode, ...await digestFile(path) }); }
      catch (error) {
        if (['EACCES', 'EPERM'].includes(error.code)) sources.push({ path, relativePath, mode: info.mode, error: error.code });
        else throw error;
      }
    }
    return sources;
  });
}

export async function inputFingerprint(kind, sources, policy, script, extraTools = []) {
  const tools = {};
  for (const path of [script, ...extraTools, fileURLToPath(import.meta.url), join(repository, 'package-lock.json'),
    join(repository, 'package.json'), join(repository, '.node-version'),
    join(repository, 'client/src/audio/validate-provided-music-catalog.ts'), join(repository, 'shared/src/constants/emoji.ts'),
    join(repository, 'node_modules/sharp/package.json'),
    join(repository, `node_modules/@img/sharp-${process.platform}-${process.arch}/package.json`),
    join(repository, `node_modules/@img/sharp-libvips-${process.platform}-${process.arch}/package.json`)]) {
    try { tools[relative(repository, path)] = sha256(await readFile(path)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      tools[relative(repository, path)] = null;
    }
  }
  return sha256(JSON.stringify({ schema: SCHEMA, kind, policy, tools, node: process.versions,
    platform: process.platform, arch: process.arch,
    sources: sources.map(({ path: _path, ...source }) => source) }));
}

/** The parent keeps the inherited open-file-description locked until publication ends. */
export async function withImportLock(output, operation) {
  await safeDirectory(output);
  const state = join(output, '.import-state');
  await safeDirectory(state);
  const path = join(state, 'lock');
  await assertSafePath(path);
  const handle = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Expected a regular lock file: ${path}`);
    await new Promise((resolveLock, rejectLock) => {
      const child = spawn('flock', ['-x', '-w', '60', '3'], { stdio: ['ignore', 'ignore', 'pipe', handle.fd] });
      let diagnostic = '';
      child.stderr.on('data', (bytes) => { diagnostic += bytes; });
      child.once('error', rejectLock);
      child.once('exit', (code) => {
        if (code === 0) resolveLock();
        else rejectLock(new Error(`Cannot acquire asset import lock (${output}): ${diagnostic.trim() || `flock exited ${code}`}`));
      });
    });
    return await operation(state);
  } finally { await handle.close(); }
}

export async function assertManagedFiles(output, ownFile) {
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      await assertSafePath(path);
      if (directory === output && ownFile.test(entry.name) && !entry.isFile()) {
        throw new Error(`Expected a regular managed file: ${path}`);
      }
      if (entry.isDirectory()) await inspect(path);
    }
  }
  await inspect(output);
}

export async function cleanupInterrupted(output, catalog, state) {
  const token = /^\d+-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (entry.name.startsWith('.import-stage-') && token.test(entry.name.slice('.import-stage-'.length))) {
      const path = join(output, entry.name);
      await assertSafePath(path);
      await rm(path, { recursive: true, force: true });
    }
  }
  for (const directory of [dirname(catalog), state]) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const prefix = directory === state ? 'manifest.json.' : `${basename(catalog)}.`;
      if (entry.name.startsWith(prefix) && entry.name.endsWith('.tmp') && token.test(entry.name.slice(prefix.length, -4))) {
        const path = join(directory, entry.name);
        await assertSafePath(path);
        await rm(path, { force: true });
      }
    }
  }
}

/** `catalogFiles` lists every output a catalog needs; importers with extra assets such as cover art override it. */
export async function reusableImport({
  state, output, catalog, fingerprint, ownFile, validateCatalog, catalogFiles = (records) => records.map((record) => record.file),
}) {
  const manifestPath = join(state, 'manifest.json');
  await assertSafePath(manifestPath);
  await assertSafePath(catalog);
  const entries = await readdir(output, { withFileTypes: true });
  for (const entry of entries) if (ownFile.test(entry.name)) await assertSafePath(join(output, entry.name));
  try {
    const manifest = JSON.parse(await readSafeFile(manifestPath));
    const { integrity, ...content } = manifest;
    if (integrity !== sha256(JSON.stringify(content)) || manifest.schema !== SCHEMA
      || manifest.fingerprint !== fingerprint || !Array.isArray(manifest.outputs)) return null;
    const bytes = await readSafeFile(catalog);
    if (sha256(bytes) !== manifest.catalogHash) return null;
    const records = JSON.parse(bytes);
    validateCatalog(records);
    const files = catalogFiles(records);
    if (new Set(files).size !== files.length || JSON.stringify([...files].sort()) !== JSON.stringify(manifest.outputs.map((entry) => entry.file).sort())) return null;
    const managed = entries.filter((entry) => ownFile.test(entry.name));
    if (managed.length !== files.length || managed.some((entry) => !entry.isFile() || !files.includes(entry.name))) return null;
    for (const entry of manifest.outputs) {
      if (!ownFile.test(entry.file)) return null;
      const actual = await digestFile(join(output, entry.file));
      if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) return null;
    }
    if (!manifest.report || !Array.isArray(manifest.report.skipped) || !Array.isArray(manifest.report.renamed)
      || !Array.isArray(manifest.report.compressed)) return null;
    return { records, report: manifest.report };
  } catch (error) {
    if (error.message?.startsWith('Symlinks are not allowed:') || error.message?.startsWith('Expected a regular file:')) throw error;
    if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code) && error.code) throw error;
    return null;
  }
}

/** Content-addressed files publish first, then the catalog, then successful reuse metadata. Records without `catalog` are extra files. */
export async function publishImport({ output, catalog, state, fingerprint, records, ownFile, report, verifyInputs }) {
  const token = `${process.pid}-${randomUUID()}`;
  const stage = join(output, `.import-stage-${token}`);
  const catalogTemp = `${catalog}.${token}.tmp`;
  const manifestPath = join(state, 'manifest.json');
  const manifestTemp = `${manifestPath}.${token}.tmp`;
  await assertSafePath(catalog);
  await assertSafePath(manifestPath);
  for (const path of [catalog, manifestPath]) {
    const info = await lstat(path).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && !info.isFile()) throw new Error(`Expected a regular file: ${path}`);
  }
  await mkdir(stage);
  try {
    const outputs = [];
    for (const record of records) {
      if (!ownFile.test(record.file)) throw new Error(`Invalid managed asset file: ${record.file}`);
      const staged = join(stage, record.file);
      if (record.source) {
        const source = await open(record.source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          if (!(await source.stat()).isFile()) throw new Error(`Expected a regular file: ${record.source}`);
          const target = await open(staged, 'wx');
          try {
            for await (const chunk of source.createReadStream({ autoClose: false })) await target.writeFile(chunk);
          } finally { await target.close(); }
        } finally { await source.close(); }
      } else await writeFile(staged, record.bytes, { flag: 'wx' });
      const actual = await digestFile(staged);
      if (record.sha256 && actual.sha256 !== record.sha256) throw new Error(`Source changed during import: ${record.source}`);
      outputs.push({ file: record.file, ...actual, ...(record.metadata ? { metadata: record.metadata } : {}) });
    }
    await verifyInputs();
    const catalogBytes = JSON.stringify(records.filter((record) => record.catalog).map((record) => record.catalog), null, 2) + '\n';
    await writeFile(catalogTemp, catalogBytes, { flag: 'wx' });
    const content = { schema: SCHEMA, fingerprint, catalogHash: sha256(catalogBytes), outputs, report };
    await writeFile(manifestTemp, JSON.stringify({ ...content, integrity: sha256(JSON.stringify(content)) }, null, 2) + '\n', { flag: 'wx' });
    for (const { file } of records) {
      await assertSafePath(join(output, file));
      await rename(join(stage, file), join(output, file));
    }
    await assertSafePath(catalog);
    await rename(catalogTemp, catalog);
    const retained = new Set(records.map((record) => record.file));
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (ownFile.test(entry.name) && !retained.has(entry.name)) {
        const path = join(output, entry.name);
        await assertSafePath(path);
        if (!entry.isFile()) throw new Error(`Expected a regular managed file: ${path}`);
        await rm(path);
      }
    }
    await assertSafePath(manifestPath);
    await rename(manifestTemp, manifestPath);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(catalogTemp, { force: true });
    await rm(manifestTemp, { force: true });
  }
}
