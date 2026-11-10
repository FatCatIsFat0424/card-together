import { cp, lstat, mkdir, readdir, readlink, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export const RELEASE_DIRECTORY = '.release';

const FILES = [
  'package.json', 'tsconfig.json',
  'shared/package.json', 'shared/tsconfig.json',
  'server/package.json', 'server/tsconfig.json', 'server/start.mjs',
  'client/package.json', 'client/tsconfig.json',
];
const DIRECTORIES = ['shared/src', 'server/src', 'client/dist', 'node_modules'];
// Dependencies of every workspace are installed per workspace only when versions conflict.
const WORKSPACES = ['shared', 'server', 'client'];
const TOOL_CACHES = new Set(['.tmp', '.vite', '.cache']);

function isCache(root: string, path: string): boolean {
  const parts = relative(root, path).split(sep);
  const index = parts.indexOf('node_modules');
  return index !== -1 && TOOL_CACHES.has(parts[index + 1] ?? '');
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Every link must be relative and resolve to an existing entry inside the release, so the tree can be moved. */
export async function assertSelfContainedLinks(output: string): Promise<number> {
  const root = await realpath(output);
  let links = 0;
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links += 1;
        const target = await readlink(path);
        if (isAbsolute(target)) throw new Error(`Release link is absolute: ${relative(output, path)} -> ${target}`);
        let resolved: string;
        try { resolved = await realpath(path); } catch {
          throw new Error(`Release link is dangling: ${relative(output, path)} -> ${target}`);
        }
        if (resolved !== root && !resolved.startsWith(root + sep)) {
          throw new Error(`Release link leaves the release: ${relative(output, path)} -> ${target}`);
        }
      } else if (entry.isDirectory()) await visit(path);
    }
  }
  await visit(output);
  return links;
}

/**
 * Copies what `node server/start.mjs` needs into `output`: sources run through tsx, the built client, and every
 * dependency including development ones (tsx is a devDependency). Workspace links stay relative.
 */
export async function assembleRelease(root: string, output: string): Promise<{ links: number }> {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const copy = async (path: string): Promise<void> => {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await cp(join(root, path), join(output, path), {
      recursive: true, verbatimSymlinks: true, filter: (source) => !isCache(root, source),
    });
  };
  for (const path of FILES) await copy(path);
  for (const path of DIRECTORIES) await copy(path);
  for (const workspace of WORKSPACES) {
    if (await exists(join(root, workspace, 'node_modules'))) await copy(`${workspace}/node_modules`);
  }
  return { links: await assertSelfContainedLinks(output) };
}
