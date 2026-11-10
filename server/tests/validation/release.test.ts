import { access, mkdtemp, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleRelease, assertSelfContainedLinks } from '../../../scripts/release/assemble';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function temporary(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'card-release-'));
  directories.push(directory);
  return directory;
}

async function put(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

async function checkout(): Promise<string> {
  const root = await temporary();
  await put(root, {
    'package.json': '{}', 'tsconfig.json': '{}',
    'shared/package.json': '{}', 'shared/tsconfig.json': '{}', 'shared/src/index.ts': '', 'shared/src/provided-emoji.generated.json': '[]',
    'server/package.json': '{}', 'server/tsconfig.json': '{}', 'server/start.mjs': '', 'server/src/index.ts': '', 'server/tests/a.test.ts': '',
    'client/package.json': '{}', 'client/tsconfig.json': '{}', 'client/dist/index.html': '', 'client/src/main.tsx': '',
    'node_modules/tsx/package.json': '{}', 'node_modules/.tmp/cache.tsbuildinfo': '', 'node_modules/.vite/deps.json': '{}',
  });
  await mkdir(join(root, 'node_modules/@card-together'), { recursive: true });
  for (const workspace of ['shared', 'server', 'client']) await symlink(`../../${workspace}`, join(root, 'node_modules/@card-together', workspace));
  return root;
}

describe('release assembly', () => {
  it('copies runtime inputs, keeps workspace links relative and leaves out tests, client sources and tool caches', async () => {
    const root = await checkout();
    const output = join(root, '.release');
    const { links } = await assembleRelease(root, output);
    expect(links).toBe(3);
    expect(await readlink(join(output, 'node_modules/@card-together/shared'))).toBe('../../shared');
    const present = (path: string): Promise<boolean> => access(join(output, path)).then(() => true, () => false);
    for (const path of ['server/start.mjs', 'server/src/index.ts', 'shared/src/provided-emoji.generated.json', 'client/dist/index.html',
      'client/package.json', 'node_modules/tsx/package.json', 'tsconfig.json']) expect(await present(path), path).toBe(true);
    for (const path of ['server/tests', 'client/src', 'node_modules/.tmp', 'node_modules/.vite']) expect(await present(path), path).toBe(false);
  });

  it('replaces a previous release instead of merging into it', async () => {
    const root = await checkout();
    const output = join(root, '.release');
    await put(output, { 'stale.txt': '' });
    await assembleRelease(root, output);
    await expect(access(join(output, 'stale.txt'))).rejects.toThrow();
  });

  it('rejects absolute, dangling and escaping links', async () => {
    for (const [name, target] of [['absolute', tmpdir()], ['dangling', 'missing'], ['escaping', '../sibling']] as const) {
      const root = await temporary();
      const output = join(root, 'release');
      await mkdir(output);
      await mkdir(join(root, 'sibling'));
      await symlink(target, join(output, 'link'));
      await expect(assertSelfContainedLinks(output), name).rejects.toThrow(/Release link/);
    }
  });
});
