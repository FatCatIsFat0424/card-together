import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface ImportedTrack {
  id: string;
  title: string;
  file: string;
}

const IMPORT_SCRIPT = resolve(import.meta.dirname, '../../../scripts/audio/import-provided-music.mjs');
const temporaryRoots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bridge-provided-music-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'local-music'));
  return root;
}

function sourcePath(root: string, file: string): string {
  return join(root, 'local-music', file);
}

function outputPath(root: string, file: string): string {
  return join(root, 'client/public/provided-music', file);
}

function manifestPath(root: string): string {
  return join(root, 'client/src/audio/provided-music.generated.json');
}

function addSource(root: string, file: string, contents = 'audio fixture'): void {
  const path = sourcePath(root, file);
  mkdirSync(dirname(path), { recursive: true });
  // Fixtures test file transport; the importer does not decode audio.
  writeFileSync(path, contents);
}

function importMusic(root: string): ImportedTrack[] {
  execFileSync(process.execPath, [IMPORT_SCRIPT, root], { stdio: 'pipe' });
  return JSON.parse(readFileSync(manifestPath(root), 'utf8')) as ImportedTrack[];
}

function snapshotOutputs(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {
    manifest: readFileSync(manifestPath(root), 'utf8'),
  };
  for (const file of readdirSync(outputPath(root, ''))) {
    snapshot[file] = readFileSync(outputPath(root, file)).toString('base64');
  }
  return snapshot;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('provided music import CLI', () => {
  it('should import nested files with Unicode titles and preserve their bytes', () => {
    const root = createRoot();
    addSource(root, '夜晚/夏日 夜晚.MP3', 'first source');
    addSource(root, '另一張專輯/夏日 夜晚.ogg', 'second source');

    const tracks = importMusic(root);

    expect(tracks).toHaveLength(2);
    expect(tracks.map((track) => track.title)).toEqual(['夏日 夜晚', '夏日 夜晚']);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(2);
    expect(new Set(tracks.map((track) => track.file)).size).toBe(2);
    expect(tracks.every((track) => /^imported-[a-f0-9]+-[a-f0-9]+\.(mp3|ogg)$/.test(track.file)))
      .toBe(true);
    expect(tracks.map((track) => readFileSync(outputPath(root, track.file), 'utf8')).sort())
      .toEqual(['first source', 'second source']);
  });

  it('should order numbered filenames naturally and produce deterministic output', () => {
    const root = createRoot();
    addSource(root, 'track10.mp3');
    addSource(root, 'track2.mp3');
    addSource(root, 'track1.mp3');

    const tracks = importMusic(root);
    const firstSnapshot = snapshotOutputs(root);

    expect(tracks.map((track) => track.title)).toEqual(['track1', 'track2', 'track10']);
    expect(importMusic(root)).toEqual(tracks);
    expect(snapshotOutputs(root)).toEqual(firstSnapshot);
  });

  it('should retain track IDs and change cache filenames when source bytes change', () => {
    const root = createRoot();
    addSource(root, 'album/song.mp3', 'first version');
    const [first] = importMusic(root);

    addSource(root, 'album/song.mp3', 'second version');
    const [second] = importMusic(root);

    expect(second.id).toBe(first.id);
    expect(second.title).toBe(first.title);
    expect(second.file).not.toBe(first.file);
    expect(readFileSync(outputPath(root, second.file), 'utf8')).toBe('second version');
    expect(existsSync(outputPath(root, first.file))).toBe(false);
  });

  it('should clean removed imported tracks while preserving unrelated output files', () => {
    const root = createRoot();
    addSource(root, 'keep.mp3');
    addSource(root, 'remove.wav');
    const first = importMusic(root);
    const removed = first.find((track) => track.title === 'remove');
    expect(removed).toBeDefined();
    writeFileSync(outputPath(root, 'README.md'), 'project documentation');
    writeFileSync(outputPath(root, 'unrelated.mp3'), 'unrelated audio');
    rmSync(sourcePath(root, 'remove.wav'));

    const tracks = importMusic(root);

    expect(tracks.map((track) => track.title)).toEqual(['keep']);
    expect(existsSync(outputPath(root, removed!.file))).toBe(false);
    expect(readFileSync(outputPath(root, 'README.md'), 'utf8')).toBe('project documentation');
    expect(readFileSync(outputPath(root, 'unrelated.mp3'), 'utf8')).toBe('unrelated audio');
  });

  it('should skip unsupported files and import every supported extension', () => {
    const root = createRoot();
    for (const extension of ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac']) {
      addSource(root, `song.${extension}`);
    }
    addSource(root, 'notes.txt', '');
    addSource(root, 'album/cover.png', '');

    const tracks = importMusic(root);

    expect(tracks).toHaveLength(6);
    expect(tracks.map((track) => track.file.split('.').at(-1)).sort())
      .toEqual(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
    expect(readdirSync(outputPath(root, ''))).toHaveLength(6);
  });

  it('should reject an empty audio file without changing previous outputs', () => {
    const root = createRoot();
    addSource(root, 'a-song.mp3', 'original source');
    importMusic(root);
    const previous = snapshotOutputs(root);
    addSource(root, 'a-song.mp3', 'changed source');
    addSource(root, 'z-empty.wav', '');

    expect(() => importMusic(root)).toThrow();
    expect(snapshotOutputs(root)).toEqual(previous);
  });

  it.each(['file', 'directory'] as const)(
    'should reject a source %s symlink without changing previous outputs',
    (kind) => {
      const root = createRoot();
      addSource(root, 'a-song.mp3', 'original source');
      importMusic(root);
      const previous = snapshotOutputs(root);
      addSource(root, 'a-song.mp3', 'changed source');
      if (kind === 'file') {
        symlinkSync(sourcePath(root, 'a-song.mp3'), sourcePath(root, 'z-link.mp3'));
      } else {
        mkdirSync(join(root, 'external-album'));
        writeFileSync(join(root, 'external-album/song.mp3'), 'external source');
        symlinkSync(join(root, 'external-album'), sourcePath(root, 'z-album'));
      }

      expect(() => importMusic(root)).toThrow();
      expect(snapshotOutputs(root)).toEqual(previous);
    },
  );
});
