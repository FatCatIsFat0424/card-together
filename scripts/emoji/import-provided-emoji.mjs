/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManagedFiles, assertSafePath, cleanupInterrupted, ensureTypeScriptSupport, importOptions, importProfile, inputFingerprint, publishImport, readSafeFile,
  reusableImport, safeDirectory, scanSources, sha256, withImportLock,
} from '../assets/import-state.mjs';

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
const script = fileURLToPath(import.meta.url);
ensureTypeScriptSupport(script, process.argv.slice(2));
const { parseProvidedEmojiCatalog } = await import('../../shared/src/constants/emoji.ts');
const policy = { extensions: [...EXTENSIONS], name: NAME.source, ownFile: OWN_FILE.source, maxBytes: MAX_BYTES,
  steps: COMPRESSION_STEPS, schema: 1 };

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
async function compress(bytes, profile) {
  const sharp = await loadSharp();
  for (const { size, quality } of COMPRESSION_STEPS) {
    const result = await profile.measure('codec', () => sharp(bytes, { animated: true })
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer());
    if (result.length <= MAX_BYTES) return result;
  }
  return null;
}

/** Reads and, when needed, compresses one source; returns a skip reason instead of throwing. */
async function prepare(path, relativePath, profile) {
  let source;
  try {
    source = await readSafeFile(path);
  } catch (error) {
    return { skip: `unreadable (${error.code ?? error.message})` };
  }
  const kind = sniffImage(source);
  if (!kind) return { skip: 'not a PNG, JPEG, GIF or WebP image' };
  if (source.length <= MAX_BYTES) return { bytes: source, kind };
  let bytes;
  try {
    bytes = await compress(source, profile);
  } catch (error) {
    return { skip: `could not be decoded for compression (${error.message})` };
  }
  if (!bytes) {
    return { skip: `${formatBytes(source.length)} does not fit ${formatBytes(MAX_BYTES)} even at the smallest size` };
  }
  const sharp = await loadSharp();
  const metadata = await sharp(bytes, { animated: true }).metadata();
  return { bytes, kind: 'webp', metadata: { format: metadata.format, width: metadata.width, height: metadata.height,
    pages: metadata.pages ?? 1, pageHeight: metadata.pageHeight, delay: metadata.delay, loop: metadata.loop },
    compressed: { relativePath, before: source.length, after: bytes.length } };
}

function report(stream, title, lines) {
  if (lines.length > 0) stream.write(`${title} (${lines.length}):\n  ${lines.join('\n  ')}\n`);
}

function printReport(input, records, details, reused) {
  process.stdout.write(`${reused ? 'Reused' : 'Imported'} ${records.length} site emoji from ${input}\n`);
  report(process.stdout, 'Compressed to WebP', details.compressed);
  report(process.stderr, 'Warning: renamed', details.renamed);
  report(process.stderr, 'Warning: skipped', details.skipped);
}

async function main() {
  const options = importOptions(process.argv.slice(2), join(dirname(script), '../..'));
  const profile = importProfile(options.profile);
  const input = join(options.root, 'local-emoji');
  const output = join(options.root, 'client/public/provided-emoji');
  const catalog = join(options.root, 'shared/src/provided-emoji.generated.json');
  await safeDirectory(input);
  await assertSafePath(output);
  await assertSafePath(catalog);
  await safeDirectory(dirname(catalog));
  await withImportLock(output, async (state) => {
    await cleanupInterrupted(output, catalog, state);
    await assertManagedFiles(output, OWN_FILE);
    const sources = await scanSources(input, EXTENSIONS, profile);
    const fingerprint = await inputFingerprint('emoji', sources, policy, script);
    const reuse = options.noCache ? null : await profile.measure('validateOutputs', () => reusableImport({
      state, output, catalog, fingerprint, ownFile: OWN_FILE, validateCatalog: parseProvidedEmojiCatalog,
    }));
    if (reuse) {
      printReport(input, reuse.records, reuse.report, true);
      profile.report('emoji', true);
      return;
    }
    const records = [];
    const skipped = [];
    const compressed = [];
    for (const { path, relativePath } of sources) {
      const prepared = await profile.measure('prepare', () => prepare(path, relativePath, profile));
      if (prepared.skip) { skipped.push(`${relativePath}: ${prepared.skip}`); continue; }
      if (prepared.compressed) compressed.push(prepared.compressed);
      records.push({ relativePath, rawName: basename(path, extname(path)), ...prepared });
    }
    assignNames(records);
    for (const record of records) {
      record.emoji = { name: record.name, file: `${record.name}-${sha256(record.bytes).slice(0, 24)}.${record.kind}` };
    }
    records.sort((a, b) => (a.emoji.name < b.emoji.name ? -1 : 1));
    parseProvidedEmojiCatalog(records.map((record) => record.emoji));
    const details = {
      skipped,
      renamed: records.filter((record) => record.name !== record.rawName)
        .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
        .map((record) => `${record.relativePath} -> :${record.name}:`),
      compressed: compressed.map(({ relativePath, before, after }) =>
        `${relativePath}: ${formatBytes(before)} -> ${formatBytes(after)}`),
    };
    await profile.measure('publish', () => publishImport({
      output, catalog, state, fingerprint,
      records: records.map((record) => ({ file: record.emoji.file, bytes: record.bytes,
        catalog: record.emoji, metadata: record.metadata })),
      ownFile: OWN_FILE, report: details,
      verifyInputs: async () => {
        const current = await scanSources(input, EXTENSIONS, profile);
        if (await inputFingerprint('emoji', current, policy, script) !== fingerprint) {
          throw new Error('Emoji changed during import; retry after copying finishes.');
        }
      },
    }));
    printReport(input, records, details, false);
    profile.report('emoji', false);
  });
}

main().catch((error) => {
  process.stderr.write(`Emoji import failed: ${error.message}\n`);
  process.exitCode = 1;
});
