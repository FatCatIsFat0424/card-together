/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// Mirrors EMOJI_NAME_PATTERN in shared/src/constants/emoji.ts.
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,63}$/;
const MAX_NAME_LENGTH = 64;
// Mirrors the provided emoji file check in shared/src/constants/emoji.ts.
const OWN_FILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,63}-[a-f0-9]{24}\.(png|jpg|gif|webp)$/;
// Same limit as uploaded personal emoji; larger sources are recompressed to fit.
const MAX_BYTES = 2 * 1024 * 1024;
// Long edge (never upscaled) and WebP quality, tried in order until the output fits.
const COMPRESSION_STEPS = [
  { size: 256, quality: 80 },
  { size: 192, quality: 70 },
  { size: 128, quality: 60 },
  { size: 128, quality: 40 },
  { size: 96, quality: 40 },
];
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '../..'));
const input = join(root, 'local-emoji');
const output = join(root, 'client/public/provided-emoji');
const catalog = join(root, 'shared/src/provided-emoji.generated.json');

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

function startsWith(bytes, signature, offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Output types come from magic bytes, matching uploaded media, never from the extension. */
function sniffImage(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * A valid file name is kept as is. Otherwise disallowed characters become `_`, repeats
 * collapse, and the result is trimmed to the name rules; too little left falls back to a
 * stable name derived from the source path.
 */
function normalizeName(raw, relativePath) {
  const trimmed = raw.trim();
  if (NAME.test(trimmed)) return trimmed;
  const name = trimmed.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/_{2,}/g, '_')
    .replace(/^[_.-]+/, '').slice(0, MAX_NAME_LENGTH).replace(/_+$/, '');
  return NAME.test(name) ? name : `emoji_${sha256(relativePath).slice(0, 6)}`;
}

function withSuffix(base, suffix) {
  const tail = `_${suffix}`;
  return `${base.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`;
}

/**
 * Files whose own name is valid claim it first, in path order, so adding or renaming other
 * files never moves an existing name. Everything else gets its normalized name, made
 * unique with `_2`, `_3`, ... in path order.
 */
function assignNames(records) {
  const taken = new Set();
  const pending = [];
  for (const record of records) {
    if (NAME.test(record.rawName) && !taken.has(record.rawName)) {
      record.name = record.rawName;
      taken.add(record.name);
    } else {
      pending.push(record);
    }
  }
  for (const record of pending) {
    const base = normalizeName(record.rawName, record.relativePath);
    let name = base;
    for (let suffix = 2; taken.has(name); suffix += 1) name = withSuffix(base, suffix);
    record.name = name;
    taken.add(name);
  }
}

let sharpModule = null;

/** Loaded only when a source needs compression, so ordinary imports do not need libvips. */
async function loadSharp() {
  if (!sharpModule) {
    sharpModule = (await import('sharp')).default;
    sharpModule.cache(false);
  }
  return sharpModule;
}

/** WebP bytes from the first step that fits, or null when none does. */
async function compress(bytes) {
  const sharp = await loadSharp();
  for (const { size, quality } of COMPRESSION_STEPS) {
    const result = await sharp(bytes, { animated: true })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    if (result.length <= MAX_BYTES) return result;
  }
  return null;
}

/** Reads and, when needed, compresses one source; returns a skip reason instead of throwing. */
async function prepare(path, relativePath) {
  let source;
  try {
    source = await readFile(path);
  } catch (error) {
    return { skip: `unreadable (${error.code ?? error.message})` };
  }
  const kind = sniffImage(source);
  if (!kind) return { skip: 'not a PNG, JPEG, GIF or WebP image' };
  if (source.length <= MAX_BYTES) return { bytes: source, kind };
  let bytes;
  try {
    bytes = await compress(source);
  } catch (error) {
    return { skip: `could not be decoded for compression (${error.message})` };
  }
  if (!bytes) {
    return { skip: `${formatBytes(source.length)} does not fit ${formatBytes(MAX_BYTES)} even at the smallest size` };
  }
  return { bytes, kind: 'webp', compressed: { relativePath, before: source.length, after: bytes.length } };
}

function report(stream, title, lines) {
  if (lines.length > 0) stream.write(`${title} (${lines.length}):\n  ${lines.join('\n  ')}\n`);
}

async function main() {
  await safeDirectory(input);
  const paths = (await collect(input))
    .map((path) => ({ path, relativePath: relative(input, path).split(sep).join('/') }))
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  // Prepare every source before changing the published snapshot.
  const records = [];
  const skipped = [];
  const compressed = [];
  for (const { path, relativePath } of paths) {
    const prepared = await prepare(path, relativePath);
    if (prepared.skip) {
      skipped.push(`${relativePath}: ${prepared.skip}`);
      continue;
    }
    if (prepared.compressed) compressed.push(prepared.compressed);
    records.push({ relativePath, rawName: basename(path, extname(path)), ...prepared });
  }
  assignNames(records);
  for (const record of records) {
    record.emoji = { name: record.name, file: `${record.name}-${sha256(record.bytes).slice(0, 24)}.${record.kind}` };
  }
  records.sort((a, b) => (a.emoji.name < b.emoji.name ? -1 : 1));
  await safeDirectory(output);
  await safeDirectory(dirname(catalog));
  const stage = join(output, `.import-${process.pid}`);
  const catalogTemp = `${catalog}.${process.pid}.tmp`;
  await mkdir(stage);
  try {
    // Publish the bytes that were checked and hashed, not a later re-read of the source.
    for (const { bytes, emoji } of records) await writeFile(join(stage, emoji.file), bytes);
    for (const { emoji } of records) await rename(join(stage, emoji.file), join(output, emoji.file));
    await writeFile(catalogTemp, JSON.stringify(records.map(({ emoji }) => emoji), null, 2) + '\n');
    await rename(catalogTemp, catalog);
    const retained = new Set(records.map(({ emoji }) => emoji.file));
    for (const entry of await readdir(output, { withFileTypes: true })) {
      if (entry.isFile() && OWN_FILE.test(entry.name) && !retained.has(entry.name)) {
        await rm(join(output, entry.name));
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(catalogTemp, { force: true });
  }
  process.stdout.write(`Imported ${records.length} site emoji from ${input}\n`);
  report(process.stdout, 'Compressed to WebP', compressed.map(({ relativePath, before, after }) =>
    `${relativePath}: ${formatBytes(before)} -> ${formatBytes(after)}`));
  report(process.stderr, 'Warning: renamed', records.filter((record) => record.name !== record.rawName)
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
    .map((record) => `${record.relativePath} -> :${record.name}:`));
  report(process.stderr, 'Warning: skipped', skipped);
}

main().catch((error) => {
  process.stderr.write(`Emoji import failed: ${error.message}\n`);
  process.exitCode = 1;
});
