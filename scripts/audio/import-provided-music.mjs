/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManagedFiles, assertSafePath, cleanupInterrupted, ensureTypeScriptSupport, importOptions, importProfile, inputFingerprint, publishImport,
  readSafeFile, reusableImport, safeDirectory, scanSources, sha256, withImportLock,
} from '../assets/import-state.mjs';
import { extractEmbeddedCover } from './cover-art.mjs';

const EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus']);
const OWN_FILE = /^imported-(?:[a-f0-9]{24}-[a-f0-9]{24}\.(?:mp3|ogg|wav|m4a|aac|flac|opus)|cover-[a-f0-9]{24}\.webp)$/;
const COVER_NAMES = ['cover', 'folder'];
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const COVER_SIZE = 160;
const COVER_QUALITY = 72;
const script = fileURLToPath(import.meta.url);
const coverArt = join(dirname(script), 'cover-art.mjs');
ensureTypeScriptSupport(script, process.argv.slice(2));
const { validateProvidedMusicCatalog } = await import('../../client/src/audio/validate-provided-music-catalog.ts');
const policy = {
  extensions: [...EXTENSIONS], ownFile: OWN_FILE.source, order: 'root-then-folder-en-numeric', schema: 3,
  cover: { names: COVER_NAMES, extensions: COVER_EXTENSIONS, size: COVER_SIZE, quality: COVER_QUALITY },
};

function compareText(left, right) {
  return left.localeCompare(right, 'en', { numeric: true }) || (left < right ? -1 : left > right ? 1 : 0);
}

function isCoverFile(name) {
  return COVER_NAMES.includes(basename(name, extname(name)).toLowerCase());
}

/** `cover.*` before `folder.*`, each in the listed extension order, from the track's own folder. */
function folderCover(folderCovers, directory) {
  const candidates = folderCovers.get(directory) ?? [];
  for (const name of COVER_NAMES) {
    for (const extension of COVER_EXTENSIONS) {
      const found = candidates.find((candidate) => candidate.name === `${name}${extension}`);
      if (found) return found.path;
    }
  }
  return null;
}

let sharpModule = null;
async function renderCover(bytes) {
  if (!sharpModule) {
    sharpModule = (await import('sharp')).default;
    sharpModule.cache(false);
  }
  return sharpModule(bytes).rotate().resize(COVER_SIZE, COVER_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: COVER_QUALITY }).toBuffer();
}

/** One thumbnail file per distinct artwork; art that cannot be read or decoded is skipped with a warning. */
function createCoverBuilder(folderCovers) {
  const bySource = new Map();
  const files = new Map();
  const render = async (bytes, label) => {
    const key = sha256(bytes);
    if (!bySource.has(key)) {
      try {
        const output = await renderCover(bytes);
        const file = `imported-cover-${sha256(output).slice(0, 24)}.webp`;
        files.set(file, output);
        bySource.set(key, file);
      } catch (error) {
        process.stderr.write(`Warning: ignoring unreadable cover art (${label}): ${error.message}\n`);
        bySource.set(key, null);
      }
    }
    return bySource.get(key);
  };
  return {
    files,
    async forTrack(source) {
      let embedded = null;
      try { embedded = await extractEmbeddedCover(source.path); }
      catch (error) { process.stderr.write(`Warning: ignoring unreadable cover art (${source.relativePath}): ${error.message}\n`); }
      const fromTrack = embedded ? await render(embedded, source.relativePath) : null;
      if (fromTrack) return fromTrack;
      const fallback = folderCover(folderCovers, dirname(source.path));
      if (!fallback) return null;
      try { return await render(await readSafeFile(fallback), fallback); }
      catch (error) {
        process.stderr.write(`Warning: ignoring unreadable cover art (${fallback}): ${error.message}\n`);
        return null;
      }
    },
  };
}

async function scanFolderCovers(input, profile) {
  const found = await scanSources(input, new Set(COVER_EXTENSIONS), profile, isCoverFile);
  const byDirectory = new Map();
  for (const entry of found) {
    if (entry.error) continue;
    const directory = dirname(entry.path);
    byDirectory.set(directory, [...byDirectory.get(directory) ?? [], { name: basename(entry.path).toLowerCase(), path: entry.path }]);
  }
  return { covers: byDirectory, sources: found };
}

async function main() {
  const options = importOptions(process.argv.slice(2), join(dirname(script), '../..'));
  const profile = importProfile(options.profile);
  const input = join(options.root, 'local-music');
  const output = join(options.root, 'client/public/provided-music');
  const catalog = join(options.root, 'client/src/audio/provided-music.generated.json');
  await safeDirectory(input);
  await assertSafePath(output);
  await assertSafePath(catalog);
  await safeDirectory(dirname(catalog));
  await withImportLock(output, async (state) => {
    await cleanupInterrupted(output, catalog, state);
    await assertManagedFiles(output, OWN_FILE);
    const sources = await scanSources(input, EXTENSIONS, profile);
    const folder = await scanFolderCovers(input, profile);
    const fingerprint = await inputFingerprint('music', [...sources, ...folder.sources], policy, script, [coverArt]);
    const reuse = options.noCache ? null : await profile.measure('validateOutputs', () => reusableImport({
      state, output, catalog, fingerprint, ownFile: OWN_FILE, validateCatalog: validateProvidedMusicCatalog,
      catalogFiles: (records) => [...new Set(records.flatMap((record) => record.cover ? [record.file, record.cover] : [record.file]))],
    }));
    if (reuse) {
      process.stdout.write(`Reused ${reuse.records.length} owner music file(s) from ${input}\n`);
      profile.report('music', true);
      return;
    }
    // Root files come first, then each first-level folder, so every group stays contiguous.
    const grouped = sources.map((source) => {
      const segments = source.relativePath.split('/');
      return { source, group: segments.length > 1 ? segments[0].trim() : undefined };
    });
    grouped.sort((left, right) => (left.group === undefined ? 0 : 1) - (right.group === undefined ? 0 : 1)
      || compareText(left.group ?? '', right.group ?? '')
      || compareText(left.source.relativePath, right.source.relativePath));
    const covers = createCoverBuilder(folder.covers);
    const records = [];
    for (const { source, group } of grouped) {
      if (source.error || source.size === 0) throw new Error(`Audio file is empty or not readable: ${source.path}`);
      if (group === '') throw new Error(`Music folder has an empty name: ${source.path}`);
      const id = `provided-${sha256(source.relativePath).slice(0, 24)}`;
      const title = basename(source.path, extname(source.path)).trim();
      if (!title) throw new Error(`Audio file has an empty title: ${source.path}`);
      const file = `imported-${id.slice(9)}-${source.sha256.slice(0, 24)}${extname(source.path).toLowerCase()}`;
      const cover = await profile.measure('covers', () => covers.forTrack(source));
      const entry = { id, title, file, ...group === undefined ? {} : { group }, ...cover ? { cover } : {} };
      records.push({ source: source.path, sha256: source.sha256, file, catalog: entry });
    }
    const coverRecords = [...covers.files].map(([file, bytes]) => ({ file, bytes }));
    validateProvidedMusicCatalog(records.map((record) => record.catalog));
    await profile.measure('publish', () => publishImport({
      output, catalog, state, fingerprint, records: [...records, ...coverRecords], ownFile: OWN_FILE,
      report: { skipped: [], renamed: [], compressed: [] },
      verifyInputs: async () => {
        const current = await scanSources(input, EXTENSIONS, profile);
        const currentCovers = await scanFolderCovers(input, profile);
        if (await inputFingerprint('music', [...current, ...currentCovers.sources], policy, script, [coverArt]) !== fingerprint) {
          throw new Error('Audio changed during import; retry after copying finishes.');
        }
      },
    }));
    const coverBytes = coverRecords.reduce((sum, record) => sum + record.bytes.length, 0);
    process.stdout.write(`Imported ${records.length} owner music file(s) from ${input}`
      + ` with ${records.filter((record) => record.catalog.cover).length} cover(s) (${coverRecords.length} distinct, ${coverBytes} bytes)\n`);
    profile.report('music', false);
  });
}

main().catch((error) => {
  process.stderr.write(`Music import failed: ${error.message}\n`);
  process.exitCode = 1;
});
