/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac']);
const OWN_FILE = /^imported-[a-f0-9]{24}-[a-f0-9]{24}\.(mp3|ogg|wav|m4a|aac|flac)$/;
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../..'));
const input = join(root, 'local-music');
const output = join(root, 'client/public/provided-music');
const catalog = join(root, 'client/src/audio/provided-music.generated.json');

async function safeDirectory(path) {
  await mkdir(path, { recursive: true });
  if ((await lstat(path)).isSymbolicLink()) throw new Error(`Directory must not be a symlink: ${path}`);
}

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${path}`);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

async function digestFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex').slice(0, 24);
}

async function main() {
  await safeDirectory(input);
  const paths = (await collect(input)).sort((a, b) => {
    const left = relative(input, a).split(sep).join('/');
    const right = relative(input, b).split(sep).join('/');
    return left.localeCompare(right, 'en', { numeric: true }) || (left < right ? -1 : left > right ? 1 : 0);
  });
  // Complete input validation before changing the published snapshot.
  const records = [];
  for (const path of paths) {
    const info = await lstat(path);
    if (!info.isFile() || info.size === 0) throw new Error(`Audio file is empty or not regular: ${path}`);
    const relativePath = relative(input, path).split(sep).join('/');
    const id = `provided-${createHash('sha256').update(relativePath).digest('hex').slice(0, 24)}`;
    const title = basename(path, extname(path)).trim();
    if (!title) throw new Error(`Audio file has an empty title: ${path}`);
    const digest = await digestFile(path);
    const file = `imported-${id.slice(9)}-${digest}${extname(path).toLowerCase()}`;
    records.push({ path, track: { id, title, file } });
  }
  await safeDirectory(output);
  await safeDirectory(dirname(catalog));
  const stage = join(output, `.import-${process.pid}`);
  const catalogTemp = `${catalog}.${process.pid}.tmp`;
  await mkdir(stage);
  try {
    for (const { path, track } of records) {
      const staged = join(stage, track.file);
      await copyFile(path, staged);
      if (await digestFile(staged) !== track.file.split('-')[2].split('.')[0]) {
        throw new Error(`Audio changed during import; retry after copying finishes: ${path}`);
      }
    }
    for (const { track } of records) await rename(join(stage, track.file), join(output, track.file));
    await writeFile(catalogTemp, JSON.stringify(records.map(({ track }) => track), null, 2) + '\n');
    await rename(catalogTemp, catalog);
    const retained = new Set(records.map(({ track }) => track.file));
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (entry.isFile() && OWN_FILE.test(entry.name) && !retained.has(entry.name)) {
        await rm(join(output, entry.name));
      }
    }
    process.stdout.write(`Imported ${records.length} owner music file(s) from ${input}\n`);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(catalogTemp, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`Music import failed: ${error.message}\n`);
  process.exitCode = 1;
});
