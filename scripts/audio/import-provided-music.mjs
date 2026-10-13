/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node CLI uses JavaScript. */
import process from 'node:process';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManagedFiles, assertSafePath, cleanupInterrupted, ensureTypeScriptSupport, importOptions, importProfile, inputFingerprint, publishImport, reusableImport,
  safeDirectory, scanSources, sha256, withImportLock,
} from '../assets/import-state.mjs';

const EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus']);
const OWN_FILE = /^imported-[a-f0-9]{24}-[a-f0-9]{24}\.(mp3|ogg|wav|m4a|aac|flac|opus)$/;
const script = fileURLToPath(import.meta.url);
ensureTypeScriptSupport(script, process.argv.slice(2));
const { validateProvidedMusicCatalog } = await import('../../client/src/audio/validate-provided-music-catalog.ts');
const policy = { extensions: [...EXTENSIONS], ownFile: OWN_FILE.source, order: 'root-then-folder-en-numeric', schema: 2 };

function compareText(left, right) {
  return left.localeCompare(right, 'en', { numeric: true }) || (left < right ? -1 : left > right ? 1 : 0);
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
    const fingerprint = await inputFingerprint('music', sources, policy, script);
    const reuse = options.noCache ? null : await profile.measure('validateOutputs', () => reusableImport({
      state, output, catalog, fingerprint, ownFile: OWN_FILE, validateCatalog: validateProvidedMusicCatalog,
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
    const records = grouped.map(({ source, group }) => {
      if (source.error || source.size === 0) throw new Error(`Audio file is empty or not readable: ${source.path}`);
      if (group === '') throw new Error(`Music folder has an empty name: ${source.path}`);
      const id = `provided-${sha256(source.relativePath).slice(0, 24)}`;
      const title = basename(source.path, extname(source.path)).trim();
      if (!title) throw new Error(`Audio file has an empty title: ${source.path}`);
      const file = `imported-${id.slice(9)}-${source.sha256.slice(0, 24)}${extname(source.path).toLowerCase()}`;
      const catalog = group === undefined ? { id, title, file } : { id, title, file, group };
      return { source: source.path, sha256: source.sha256, file, catalog };
    });
    validateProvidedMusicCatalog(records.map((record) => record.catalog));
    await profile.measure('publish', () => publishImport({
      output, catalog, state, fingerprint, records, ownFile: OWN_FILE,
      report: { skipped: [], renamed: [], compressed: [] },
      verifyInputs: async () => {
        const current = await scanSources(input, EXTENSIONS, profile);
        if (await inputFingerprint('music', current, policy, script) !== fingerprint) {
          throw new Error('Audio changed during import; retry after copying finishes.');
        }
      },
    }));
    process.stdout.write(`Imported ${records.length} owner music file(s) from ${input}\n`);
    profile.report('music', false);
  });
}

main().catch((error) => {
  process.stderr.write(`Music import failed: ${error.message}\n`);
  process.exitCode = 1;
});
