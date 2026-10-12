import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

export interface CheckOptions {
  mode: 'focused' | 'full' | 'release';
  base?: string;
  files?: readonly string[];
  dryRun: boolean;
  noCache: boolean;
}

export interface Selection {
  scope: 'focused' | 'full' | 'release' | 'documentation';
  paths: string[];
  reasons: string[];
  tests: string[];
  lint: string[];
  types: Array<'shared' | 'server' | 'tests' | 'client' | 'client-node'>;
  python: string[];
  shell: string[];
  build: boolean;
  benchmark: Array<'database' | 'socket' | 'arrange'>;
  browser: boolean;
}

const SOURCE_ROOTS = ['shared/src', 'server/src', 'server/tests', 'server/benchmarks', 'client/src', 'scripts'];
const CODE = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js']);
const PYTHON_INPUTS: Readonly<Record<string, readonly string[]>> = {
  'deploy/configure-nginx.py': ['test_configure_nginx'],
  'deploy/nginx/card-together.conf': ['test_configure_nginx'],
  'deploy/nginx/card-together-http.conf': ['test_configure_nginx'],
  'deploy/prepare-runtime.py': ['test_prepare_runtime'],
  'deploy/systemd/server.env.example': ['test_prepare_runtime'],
  'deploy/migrate-state.py': ['test_migrate_state'],
  'deploy/backup-data.sh': ['test_backup_scripts'],
  'deploy/prune-assets.sh': ['test_backup_scripts'],
  'deploy/start-service.sh': ['test_start_service'],
  'deploy/wait-for-health.py': ['test_wait_for_health'],
};

export function parseOptions(args: readonly string[]): CheckOptions {
  const [mode, ...rest] = args;
  if (mode !== 'focused' && mode !== 'full' && mode !== 'release') {
    throw new Error('Use check full, check release, or check focused --base <ref> / --files <paths...>.');
  }
  const options: CheckOptions = { mode, dryRun: false, noCache: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-cache') options.noCache = true;
    else if (arg === '--base') {
      const value = rest[++index];
      if (!value || value.startsWith('-') || options.base) throw new Error('Provide one --base reference.');
      options.base = value;
    } else if (arg === '--files') {
      if (options.files) throw new Error('Provide --files only once.');
      const files: string[] = [];
      while (rest[index + 1] && !rest[index + 1].startsWith('--')) files.push(rest[++index]);
      if (!files.length) throw new Error('--files requires at least one repository-relative path.');
      options.files = files;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (mode === 'focused' ? Boolean(options.base) === Boolean(options.files) : options.base || options.files) {
    throw new Error('Focused requires exactly one of --base or --files; full/release accept neither.');
  }
  return options;
}

export function normalizePath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.startsWith('-') || path.includes('\0')) {
    throw new Error('Paths must be repository-relative filenames.');
  }
  const normalized = relative(root, resolve(root, path)).split(sep).join('/');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('.git/')) {
    throw new Error('Path is outside the repository or names Git internals.');
  }
  return normalized;
}

export function changedPaths(root: string, options: CheckOptions): string[] {
  if (options.files) return [...new Set(options.files.map((path) => normalizePath(root, path)))].sort();
  if (!options.base) return [];
  const git = (args: readonly string[]): string => execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const base = git(['rev-parse', '--verify', `${options.base}^{commit}`]).trim();
  const ancestor = git(['merge-base', base, 'HEAD']).trim();
  const outputs = [
    git(['diff', '--name-only', '--no-renames', '-z', ancestor, 'HEAD', '--']),
    git(['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return [...new Set(outputs.flatMap((output) => output.split('\0').filter(Boolean))
    .map((path) => normalizePath(root, path)))].sort();
}

export function collectFiles(root: string, roots: readonly string[]): string[] {
  const files: string[] = [];
  function visit(path: string): void {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return;
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) { files.push(path); return; }
    if (info.isFile()) { files.push(path); return; }
    if (!info.isDirectory()) return;
    for (const entry of readdirSync(absolute)) {
      if (['node_modules', 'dist', '.git', '.plan', '__pycache__'].includes(entry) ||
        entry.startsWith('.import-') || entry.endsWith('.tsbuildinfo')) continue;
      visit(join(path, entry).split(sep).join('/'));
    }
  }
  for (const path of roots) visit(path);
  return [...new Set(files)].sort();
}

function relatedFiles(root: string, changed: readonly string[]): { files: Set<string>; incomplete: boolean } {
  const files = collectFiles(root, SOURCE_ROOTS);
  const available = new Set(files);
  const dependents = new Map<string, Set<string>>();
  let incomplete = false;
  for (const file of files.filter((path) => CODE.has(extname(path)))) {
    const absolute = join(root, file);
    if (lstatSync(absolute).isSymbolicLink()) { incomplete = true; continue; }
    const source = ts.createSourceFile(file, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
        else incomplete = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const imported of imports) {
      if (!imported.startsWith('.') && !imported.startsWith('@shared/')) continue;
      const base = imported.startsWith('@shared/') ? `shared/src/${imported.slice(8)}` :
        relative(root, resolve(root, dirname(file), imported)).split(sep).join('/');
      const candidates = [base, ...['.ts', '.tsx', '.mts', '.mjs', '.js', '.json'].map((ext) => base + ext),
        ...['.ts', '.tsx', '.mjs', '.js'].map((ext) => `${base}/index${ext}`)];
      const dependency = candidates.find((path) => available.has(path));
      if (!dependency) {
        // Assets outside the source graph still force a conservative client/build selection.
        if (!existsSync(join(root, base))) incomplete = true;
        continue;
      }
      const users = dependents.get(dependency) ?? new Set<string>();
      users.add(file);
      dependents.set(dependency, users);
    }
  }
  const closure = new Set(changed);
  const pending = [...changed];
  while (pending.length) {
    for (const user of dependents.get(pending.pop()!) ?? []) {
      if (!closure.has(user)) { closure.add(user); pending.push(user); }
    }
  }
  return { files: closure, incomplete };
}

export function selectChecks(root: string, options: CheckOptions): Selection {
  const paths = changedPaths(root, options);
  const selection: Selection = {
    scope: options.mode, paths, reasons: [], tests: [], lint: [], types: [], python: [], shell: [],
    build: options.mode !== 'focused', benchmark: [], browser: false,
  };
  const full = (reason: string): Selection => ({ ...selection, scope: options.mode === 'release' ? 'release' : 'full',
    reasons: [reason], types: ['shared', 'server', 'tests', 'client', 'client-node'], build: true });
  if (options.mode !== 'focused') return full('All correctness and deployment gates are required.');
  if (!paths.length) throw new Error('No changed paths selected; no verification was performed.');
  if (paths.every((path) => /^(?:docs\/.*\.md|README\.md|CHANGELOG\.md|CONTRIBUTING\.md)$/.test(path))) {
    return { ...selection, scope: 'documentation', reasons: ['Documentation content checks only; no runtime verification.'] };
  }
  if (paths.some((path) => /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts)$/.test(path) ||
    path === '.node-version' || path === 'AGENTS.md' || path === 'eslint.config.cjs' || path.startsWith('.github/') ||
    path.startsWith('shared/') || path.startsWith('scripts/validation/'))) return full('Shared/tool/dependency/check configuration changed.');
  if (paths.some((path) => !existsSync(join(root, path)))) return full('Deleted or missing input requires the complete dependency boundary.');
  if (paths.some((path) => !/^(?:server\/(?:src|tests|benchmarks)\/|client\/(?:src|public)\/|scripts\/|local-(?:music|emoji)\/|deploy\/)/.test(path))) {
    return full('Unmapped input requires full validation.');
  }
  const codePaths = paths.filter((path) => !path.startsWith('deploy/'));
  if (codePaths.length) {
    const related = relatedFiles(root, codePaths);
    if (related.incomplete) return full('Dependency graph contains unresolved or dynamic local inputs.');
    const files = [...related.files];
    const tests = new Set(files.filter((path) => /^server\/tests\/.*\.test\.ts$/.test(path)));
    const allTests = collectFiles(root, ['server/tests']).filter((path) => path.endsWith('.test.ts'));
    const addCategory = (categories: readonly string[]): void => {
      for (const test of allTests) if (categories.some((category) => test.startsWith(`server/tests/${category}/`))) tests.add(test);
    };
    if (codePaths.some((path) => /^server\/src\/(?:(?:runtime|socket|managers|auth|database|media|social|http)\/|(?:app|index|config)\.ts$)/.test(path))) {
      addCategory(['runtime', 'auth', 'database', 'media', 'social', 'performance', 'voice']);
      selection.reasons.push('Runtime/security/persistence manifest adds real boundary suites.');
    }
    if (codePaths.some((path) => path.startsWith('client/') && !CODE.has(extname(path)))) addCategory(['client']);
    if (codePaths.some((path) => /^(?:scripts\/(?:audio|emoji|assets)\/|local-(?:music|emoji)\/|client\/public\/)/.test(path))) {
      addCategory(['client', 'media']); selection.build = true;
    }
    if (!tests.size) { addCategory(['engine', 'client', 'runtime', 'auth', 'database', 'media', 'social', 'performance', 'voice']);
      selection.reasons.push('No test dependency found; run all Vitest correctness tests.'); }
    selection.tests = [...tests].sort();
    selection.lint = files.filter((path) => /\.(?:ts|tsx|mjs)$/.test(path)).sort();
    if (codePaths.some((path) => path.startsWith('server/'))) selection.types.push('server', 'tests');
    if (codePaths.some((path) => path.startsWith('client/'))) selection.types.push('client', 'tests');
    if (selection.build) selection.types.push('shared', 'server', 'tests', 'client', 'client-node');
    selection.types = [...new Set(selection.types)];
    selection.browser = codePaths.some((path) => /^(?:client\/src\/(?:components|pages|styles)\/|client\/public\/|client\/src\/(?:App\.tsx|main\.tsx|image-resize\.ts|stores\/emoji-store\.ts))/.test(path));
    if (codePaths.some((path) => /(?:server\/(?:src\/database\/|tests\/database\/repository-benchmark\.ts))/.test(path))) selection.benchmark.push('database');
    if (codePaths.some((path) => /(?:server\/(?:src\/socket\/|benchmarks\/socket-benchmark\.ts|tests\/performance\/))/.test(path))) selection.benchmark.push('socket');
    if (codePaths.some((path) => path.includes('chinesepoker-arrange') || path.includes('arrange-benchmark'))) selection.benchmark.push('arrange');
  }
  for (const path of paths.filter((item) => item.startsWith('deploy/'))) {
    if (path.endsWith('.sh')) selection.shell.push(path);
    const modules = PYTHON_INPUTS[path] ?? (/^deploy\/tests\/test_[^/]+\.py$/.test(path) ? [path.split('/').at(-1)!.slice(0, -3)] : undefined);
    if (!modules) { selection.python = ['*']; selection.reasons.push('Unmapped deployment/helper/template requires all deployment tests.'); }
    else if (!selection.python.includes('*')) selection.python.push(...modules);
  }
  selection.python = [...new Set(selection.python)].sort();
  selection.reasons.push('Focused dependency and risk selection; full completion checks remain required.');
  return selection;
}
