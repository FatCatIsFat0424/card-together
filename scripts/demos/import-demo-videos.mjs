/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManagedFiles, assertSafePath, cleanupInterrupted, ensureTypeScriptSupport, importOptions, importProfile, inputFingerprint, publishImport, readSafeFile,
  reusableImport, safeDirectory, scanSources, withImportLock,
} from '../assets/import-state.mjs';

const EXTENSIONS = new Set(['.mp4']);
const script = fileURLToPath(import.meta.url);
ensureTypeScriptSupport(script, process.argv.slice(2));
const contract = join(dirname(script), '../../client/src/game-demo-videos.ts');
const recordingsPath = join(dirname(script), '../../client/src/game-demo-recordings.json');
const { DEMO_DURATION_TOLERANCE, DEMO_VIDEO_FILE, parseDemoVideoCatalog } = await import('../../client/src/game-demo-videos.ts');
const recordings = JSON.parse(await readFile(recordingsPath, 'utf8'));
const GAMES = Object.keys(recordings);
const policy = { extensions: [...EXTENSIONS], ownFile: DEMO_VIDEO_FILE.source, tolerance: DEMO_DURATION_TOLERANCE, schema: 1 };

function* boxes(bytes, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return;
    yield { type: bytes.toString('latin1', offset + 4, offset + 8), body: offset + header, end: offset + size };
    offset += size;
  }
}

/** Seconds from `moov/mvhd`; null for non-MP4 data or fragmented files that do not record a total. */
function mp4Duration(bytes) {
  const top = [...boxes(bytes, 0, bytes.length)];
  const moov = top[0]?.type === 'ftyp' ? top.find((box) => box.type === 'moov') : undefined;
  const mvhd = moov && [...boxes(bytes, moov.body, moov.end)].find((box) => box.type === 'mvhd');
  if (!mvhd || mvhd.end - mvhd.body < 32) return null;
  const [timescale, duration] = bytes[mvhd.body] === 1
    ? [bytes.readUInt32BE(mvhd.body + 20), Number(bytes.readBigUInt64BE(mvhd.body + 24))]
    : [bytes.readUInt32BE(mvhd.body + 12), bytes.readUInt32BE(mvhd.body + 16)];
  return timescale && duration ? duration / timescale : null;
}

/** Chapters and subtitles are timed against one specific take, so any other length is an error. */
async function checkDuration(game, source) {
  const seconds = mp4Duration(await readSafeFile(source.path));
  if (seconds === null) {
    throw new Error(`${source.relativePath} has no MP4 duration; remux it with \`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4\`.`);
  }
  const expected = recordings[game].duration;
  if (Math.abs(seconds - expected) > DEMO_DURATION_TOLERANCE) {
    throw new Error(`${source.relativePath} lasts ${seconds.toFixed(3)} s but client/src/game-demo-recordings.json expects ${expected} s; `
      + 'update the recording timings with the video (docs/game-demos.md).');
  }
}

function report(stream, title, lines) {
  if (lines.length > 0) stream.write(`${title} (${lines.length}):\n  ${lines.join('\n  ')}\n`);
}

function printReport(input, records, details, reused) {
  process.stdout.write(`${reused ? 'Reused' : 'Imported'} ${records.length} of ${GAMES.length} walkthrough videos from ${input}\n`);
  if (records.length > 0) report(process.stderr, 'Warning: missing videos', details.missing ?? []);
  report(process.stderr, 'Warning: skipped', details.skipped);
}

async function main() {
  const options = importOptions(process.argv.slice(2), join(dirname(script), '../..'));
  const profile = importProfile(options.profile);
  const input = join(options.root, 'local-demos');
  const output = join(options.root, 'client/public/game-demos');
  const catalog = join(options.root, 'client/src/game-demo-videos.generated.json');
  const validateCatalog = (records) => parseDemoVideoCatalog(records, GAMES);
  await safeDirectory(input);
  await assertSafePath(output);
  await assertSafePath(catalog);
  await safeDirectory(dirname(catalog));
  await withImportLock(output, async (state) => {
    await cleanupInterrupted(output, catalog, state);
    await assertManagedFiles(output, DEMO_VIDEO_FILE);
    const sources = await scanSources(input, EXTENSIONS, profile);
    const fingerprint = await inputFingerprint('demos', sources, policy, script, [contract, recordingsPath]);
    const reuse = options.noCache ? null : await profile.measure('validateOutputs', () => reusableImport({
      state, output, catalog, fingerprint, ownFile: DEMO_VIDEO_FILE, validateCatalog,
    }));
    if (reuse) {
      printReport(input, reuse.records, reuse.report, true);
      profile.report('demos', true);
      return;
    }
    const records = [];
    const skipped = [];
    for (const source of sources) {
      const game = basename(source.relativePath, extname(source.relativePath));
      if (source.relativePath.includes('/') || !GAMES.includes(game)) {
        skipped.push(`${source.relativePath}: expected local-demos/<game>.mp4 for a mode in DEMO_GAME_TYPES`);
        continue;
      }
      if (source.error) throw new Error(`${source.relativePath} is unreadable (${source.error}).`);
      await profile.measure('prepare', () => checkDuration(game, source));
      const file = `${game}-${source.sha256.slice(0, 24)}.mp4`;
      records.push({ file, source: source.path, sha256: source.sha256, catalog: { game, file } });
    }
    records.sort((a, b) => (a.catalog.game < b.catalog.game ? -1 : 1));
    validateCatalog(records.map((record) => record.catalog));
    const imported = new Set(records.map((record) => record.catalog.game));
    const details = { skipped, renamed: [], compressed: [], missing: GAMES.filter((game) => !imported.has(game)) };
    await profile.measure('publish', () => publishImport({
      output, catalog, state, fingerprint, records, ownFile: DEMO_VIDEO_FILE, report: details,
      verifyInputs: async () => {
        const current = await scanSources(input, EXTENSIONS, profile);
        if (await inputFingerprint('demos', current, policy, script, [contract, recordingsPath]) !== fingerprint) {
          throw new Error('Walkthrough videos changed during import; retry after copying finishes.');
        }
      },
    }));
    printReport(input, records, details, false);
    profile.report('demos', false);
  });
}

main().catch((error) => {
  process.stderr.write(`Walkthrough video import failed: ${error.message}\n`);
  process.exitCode = 1;
});
