import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface BaselineCheckout {
  /** Directory holding the ref's `server/src` and `shared/src`. */
  readonly root: string;
  readonly commit: string;
}

/**
 * Exports `ref`'s server and shared sources into a new temporary directory. `git archive` reads the object
 * store only, so concurrent arena runs never contend for worktree registrations or the index.
 */
export async function checkoutBaseline(repoRoot: string, ref: string): Promise<BaselineCheckout> {
  const { stdout } = await run('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot })
    .catch(() => ({ stdout: '' }));
  const commit = stdout.trim();
  if (!commit) throw new Error(`Unknown baseline ref: ${ref}`);
  const root = await mkdtemp(join(tmpdir(), 'card-together-arena-'));
  try {
    const archive = join(root, 'baseline.tar');
    await run('git', ['archive', '--format=tar', `--output=${archive}`, commit,
      // The package files keep each tree's module type, so the baseline loads as ES modules like the candidate.
      'server/package.json', 'server/src', 'shared/package.json', 'shared/src'], { cwd: repoRoot });
    await run('tar', ['-xf', archive, '-C', root]);
    await rm(archive);
  } catch (error) {
    await removeBaseline(root);
    throw error;
  }
  return { root, commit };
}

export async function removeBaseline(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

/**
 * Makes `@shared/*` imports from baseline files load the baseline's own `shared/src`, so its bots run with
 * the shared helpers they were written against; the candidate and the game managers keep the tsconfig alias.
 * Call once, before importing any baseline module.
 */
export function useBaselineShared(root: string): void {
  const prefix = pathToFileURL(root + sep).href;
  registerHooks({
    resolve: (specifier, context, nextResolve) => {
      if (!specifier.startsWith('@shared/') || !context.parentURL?.startsWith(prefix)) return nextResolve(specifier, context);
      // A relative specifier keeps the TypeScript loader's extension and index resolution.
      const target = join(root, 'shared/src', specifier.slice('@shared/'.length));
      const path = relative(dirname(fileURLToPath(context.parentURL)), target).split(sep).join('/');
      return nextResolve(path.startsWith('.') ? path : `./${path}`, context);
    },
  });
}
