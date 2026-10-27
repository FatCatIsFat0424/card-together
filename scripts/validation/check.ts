import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { buildEnvironment, validateArtifacts } from './artifacts';
import { DOCUMENTATION_ROOTS, documentationErrors, documentationPaths } from './documentation';
import { fontSizeErrors } from './font-size';
import { collectFiles, parseOptions, selectChecks } from './selection';
import type { CheckOptions, Selection } from './selection';

export interface Gate {
  id: string;
  command?: string;
  args?: string[];
  cwd?: string;
  internal?: 'artifacts' | 'documentation' | 'font-size' | 'clear-types';
  preparation?: boolean;
}

export interface GateResult {
  id: string;
  status: 'pass' | 'fail' | 'not-run';
  seconds: number;
  exitCode?: number;
}

export interface FingerprintEntry {
  stamp: string;
  digest: string;
}

const TYPES: Readonly<Record<string, string[]>> = {
  shared: ['--noEmit'], server: ['--noEmit'], tests: ['-p', 'tsconfig.test.json', '--noEmit'],
  client: ['-p', 'tsconfig.app.json', '--noEmit'], 'client-node': ['-p', 'tsconfig.node.json', '--noEmit'],
};

const TYPE_CACHE: Readonly<Record<Selection['types'][number], string>> = {
  shared: 'shared/tsconfig.tsbuildinfo', server: 'node_modules/.tmp/server-production.tsbuildinfo',
  tests: 'node_modules/.tmp/server-tests.tsbuildinfo', client: 'client/node_modules/.tmp/tsconfig.app.tsbuildinfo',
  'client-node': 'client/node_modules/.tmp/tsconfig.node.tsbuildinfo',
};

export function planGates(root: string, selection: Selection, options: CheckOptions): Gate[] {
  if (selection.scope === 'documentation') return [{ id: 'documentation', internal: 'documentation' }];
  const full = selection.scope === 'full' || selection.scope === 'release';
  const gates: Gate[] = [];
  if (full || selection.build) {
    for (const kind of ['music', 'emoji']) gates.push({ id: `import-${kind}`, command: process.execPath,
      args: [`scripts/${kind === 'music' ? 'audio' : 'emoji'}/import-provided-${kind}.mjs`, ...(options.noCache ? ['--no-cache'] : [])], preparation: true });
  }
  if (options.noCache && selection.types.length) gates.push({ id: 'clear-type-cache', internal: 'clear-types', preparation: true });
  for (const type of selection.types) gates.push({ id: `type-${type}`, command: 'npx',
    args: ['tsc', ...TYPES[type]], cwd: type === 'shared' ? 'shared' : type.startsWith('client') ? 'client' : 'server' });
  if (full || selection.types.includes('client')) gates.push({ id: 'font-size', internal: 'font-size' });
  if (full) gates.push({ id: 'lint', command: 'npm', args: ['run', 'lint'] });
  else if (selection.lint.length) gates.push({ id: 'lint', command: 'npx', args: ['eslint', ...selection.lint] });
  if (full || selection.tests.length) gates.push({ id: 'vitest', command: 'npx', cwd: 'server',
    args: ['vitest', 'run', ...(full ? [] : selection.tests.map((path) => path.slice('server/'.length)))] });
  if (full || selection.build) {
    gates.push({ id: 'bundle', command: 'npx', args: ['vite', 'build'], cwd: 'client' });
    gates.push({ id: 'artifacts', internal: 'artifacts' });
  }
  const scripts = full ? collectFiles(root, ['deploy']).filter((path) => path.endsWith('.sh')) : selection.shell;
  for (const script of scripts) gates.push({ id: `syntax:${script}`, command: 'bash', args: ['-n', script] });
  if (full || selection.python.length) {
    gates.push({ id: 'python', command: 'python3', args: ['-B', '-m', 'unittest',
      ...(full || selection.python.includes('*') ? ['discover', '-s', 'deploy/tests'] : selection.python)],
    cwd: full || selection.python.includes('*') ? '.' : 'deploy/tests' });
  }
  if (full) gates.push({ id: 'documentation', internal: 'documentation' });
  return gates;
}

function fingerprintFiles(root: string, roots: readonly string[], cache: Map<string, FingerprintEntry>, excludeGenerated = false): string {
  const hash = createHash('sha256').update(process.version).update(process.execPath);
  for (const path of collectFiles(root, roots)) {
    if (excludeGenerated && (path === 'shared/src/provided-emoji.generated.json' ||
      path === 'client/src/audio/provided-music.generated.json' ||
      /^client\/public\/provided-(?:music|emoji)\//.test(path))) continue;
    const absolute = join(root, path);
    hash.update(path).update('\0');
    const info = lstatSync(absolute, { bigint: true });
    const stamp = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}`;
    let entry = cache.get(path);
    if (!entry || entry.stamp !== stamp) {
      entry = { stamp, digest: createHash('sha256').update(info.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute)).digest('hex') };
      cache.set(path, entry);
    }
    hash.update(entry.stamp).update(entry.digest).update('\0');
  }
  for (const [name, value] of Object.entries(process.env).sort()) hash.update(name).update('\0').update(value ?? '').update('\0');
  return hash.digest('hex');
}

export function inputFingerprint(root: string, selection: Selection, cache = new Map<string, FingerprintEntry>(), excludeGenerated = false): string {
  const roots = ['shared/src', 'server/src', 'server/tests', 'server/benchmarks', 'client/src', 'scripts', 'deploy',
    'package.json', 'package-lock.json', '.node-version', 'AGENTS.md', 'eslint.config.cjs', 'tsconfig.json',
    'shared/tsconfig.json', 'shared/package.json', 'server/tsconfig.json', 'server/tsconfig.test.json', 'server/vitest.config.ts', 'server/package.json',
    'client/index.html', 'client/tsconfig.json', 'client/tsconfig.app.json', 'client/tsconfig.node.json', 'client/vite.config.ts', 'client/package.json', '.github',
    'node_modules/.package-lock.json', 'node_modules/typescript/package.json', 'node_modules/eslint/package.json',
    'node_modules/tsx/package.json', 'node_modules/vite/package.json', 'node_modules/sharp/package.json',
    ...collectFiles(root, ['client']).filter((path) => /^client\/\.env(?:\.|$)/.test(path))];
  if (selection.build) roots.push('local-music', 'local-emoji', 'client/public');
  if (selection.scope !== 'focused') roots.push(...DOCUMENTATION_ROOTS);
  if (selection.scope === 'documentation') roots.push(...selection.paths);
  return fingerprintFiles(root, roots, cache, excludeGenerated);
}

export function preparationFingerprint(root: string, cache = new Map<string, FingerprintEntry>()): string {
  const selection = selectChecks(root, { mode: 'full', dryRun: false, noCache: false });
  return inputFingerprint(root, selection, cache, true);
}

export async function runGates(
  gates: readonly Gate[],
  execute: (gate: Gate) => Promise<number>,
  fingerprint: () => string,
  preparation?: () => string,
  preparationBaseline?: string,
): Promise<{ results: GateResult[]; exitCode: number }> {
  const results: GateResult[] = [];
  let exitCode = 0;
  let inputs: string | undefined;
  const preparationInputs = preparationBaseline ?? preparation?.();
  for (const gate of gates) {
    if (exitCode) { results.push({ id: gate.id, status: 'not-run', seconds: 0 }); continue; }
    if (preparation && preparation() !== preparationInputs) {
      exitCode = 2; results.push({ id: gate.id, status: 'not-run', seconds: 0 }); continue;
    }
    if (!gate.preparation && inputs === undefined) inputs = fingerprint();
    if (inputs !== undefined && fingerprint() !== inputs) {
      exitCode = 2; results.push({ id: gate.id, status: 'not-run', seconds: 0 }); continue;
    }
    const started = performance.now();
    let code: number;
    try { code = await execute(gate); } catch (error) {
      console.error(error instanceof Error ? error.message : 'Check execution failed.'); code = 1;
    }
    results.push({ id: gate.id, status: code ? 'fail' : 'pass', seconds: Number(((performance.now() - started) / 1000).toFixed(3)), exitCode: code });
    if (code) exitCode = code === 130 ? 130 : 1;
    if (gate.preparation && preparation && preparation() !== preparationInputs) exitCode = 2;
    if (!gate.preparation && inputs !== undefined && fingerprint() !== inputs) exitCode = 2;
  }
  if (!gates.length) return { results, exitCode: 2 };
  return { results, exitCode };
}

function documentation(root: string, selected: readonly string[]): number {
  const paths = [...new Set([...selected.filter((path) => existsSync(join(root, path))), ...documentationPaths(root)])].sort();
  const errors = documentationErrors(root, paths);
  for (const error of errors) console.error(error);
  return errors.length ? 1 : 0;
}

function fontSizes(root: string): number {
  const errors = fontSizeErrors(root);
  for (const error of errors) console.error(error);
  return errors.length ? 1 : 0;
}

async function main(): Promise<number> {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const options = parseOptions(process.argv.slice(2));
  const expected = readFileSync(join(root, '.node-version'), 'utf8').trim();
  if (process.versions.node !== expected) throw new Error(`Use Node.js ${expected}; current version is ${process.versions.node}.`);
  const cache = new Map<string, FingerprintEntry>();
  const originalInputs = preparationFingerprint(root, cache);
  const selection = selectChecks(root, options);
  const environment = selection.build ? buildEnvironment(root, selection.scope === 'release') : undefined;
  const gates = planGates(root, selection, options);
  process.stdout.write(`${JSON.stringify({ scope: selection.scope, paths: selection.paths, reasons: selection.reasons,
    browser: selection.browser, recommendedBenchmarks: selection.benchmark,
    environment, gates, dryRun: options.dryRun }, null, 2)}\n`);
  if (options.dryRun) return 0;
  const started = performance.now();
  const execute = async (gate: Gate): Promise<number> => {
    if (gate.internal === 'documentation') return documentation(root, selection.paths);
    if (gate.internal === 'font-size') return fontSizes(root);
    if (gate.internal === 'clear-types') {
      for (const type of selection.types) await rm(join(root, TYPE_CACHE[type]), { force: true });
      return 0;
    }
    if (gate.internal === 'artifacts') {
      process.stdout.write(`${JSON.stringify(await validateArtifacts(root, environment!.base))}\n`); return 0;
    }
    process.stdout.write(`Running ${gate.id}\n`);
    return new Promise<number>((resolveCode) => {
      if (!gate.command) throw new Error(`Missing command for gate ${gate.id}.`);
      const child = spawn(gate.command, gate.args ?? [], { cwd: resolve(root, gate.cwd ?? '.'), stdio: 'inherit' });
      const interrupt = (): void => { child.kill('SIGINT'); };
      process.once('SIGINT', interrupt);
      child.once('error', (error) => { console.error(error.message); });
      child.once('close', (code, signal) => {
        process.off('SIGINT', interrupt);
        resolveCode(signal === 'SIGINT' ? 130 : code ?? 1);
      });
    });
  };
  const result = await runGates(gates, execute, () => inputFingerprint(root, selection, cache),
    () => preparationFingerprint(root, cache), originalInputs);
  process.stdout.write(`${JSON.stringify({ scope: selection.scope, status: result.exitCode ? 'failed' : 'passed',
    results: result.results, seconds: Number(((performance.now() - started) / 1000).toFixed(3)),
    note: result.exitCode === 2 ? 'Inputs changed or verification was incomplete; rerun checks.' :
      selection.scope === 'focused' ? 'Focused passed does not replace full completion checks.' : undefined }, null, 2)}\n`);
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Invalid validation input.');
    process.exitCode = 2;
  });
}
