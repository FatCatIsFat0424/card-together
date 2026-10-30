import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import recordings from '../../../client/src/game-demo-recordings.json';
import { DEMO_GAME_TYPES } from '../../../client/src/game-demos';
import { parseDemoVideoCatalog } from '../../../client/src/game-demo-videos';

const IMPORT_SCRIPT = resolve(import.meta.dirname, '../../../scripts/demos/import-demo-videos.mjs');
const roots: string[] = [];

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** Smallest MP4 the importer can time: `ftyp`, then `moov/mvhd` with a millisecond timescale. */
function mp4(seconds: number, padding = 'x'): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(Math.round(seconds * 1000), 16);
  return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom')), box('moov', box('mvhd', mvhd)), box('free', Buffer.from(padding))]);
}

function createRoot(files: Record<string, Buffer> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'card-together-demo-videos-'));
  roots.push(root);
  mkdirSync(join(root, 'local-demos'));
  for (const [file, bytes] of Object.entries(files)) {
    mkdirSync(join(root, 'local-demos', file, '..'), { recursive: true });
    writeFileSync(join(root, 'local-demos', file), bytes);
  }
  return root;
}

function run(root: string, flags: readonly string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [...flags, IMPORT_SCRIPT, root], { encoding: 'utf8', timeout: 20_000 });
  if (result.error) throw result.error;
  return result;
}

function catalogPath(root: string): string {
  return join(root, 'client/src/game-demo-videos.generated.json');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('walkthrough video catalog', () => {
  it('keeps recorded timings for exactly the lesson modes', () => {
    expect(Object.keys(recordings).sort()).toEqual([...DEMO_GAME_TYPES].sort());
  });

  it('accepts one content-hashed file per known mode and rejects anything else', () => {
    const file = `bridge-${'a'.repeat(24)}.mp4`;
    expect(parseDemoVideoCatalog([{ game: 'bridge', file }], DEMO_GAME_TYPES)).toEqual([{ game: 'bridge', file }]);
    for (const value of [
      {}, [null], [{ game: 'chess', file: `chess-${'a'.repeat(24)}.mp4` }], [{ game: 'bridge', file: `napoleon-${'a'.repeat(24)}.mp4` }],
      [{ game: 'bridge', file: '../bridge.mp4' }], [{ game: 'bridge', file }, { game: 'bridge', file }],
    ]) expect(() => parseDemoVideoCatalog(value, DEMO_GAME_TYPES)).toThrow();
  });
});

describe('walkthrough video import', () => {
  it('publishes matching videos under content hashes, reuses them and reports skipped files', () => {
    const bytes = mp4(recordings.bridge.duration);
    const root = createRoot({ 'bridge.mp4': bytes, 'notes.mp4': bytes, 'extra/napoleon.mp4': bytes });
    const first = run(root);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain(`Imported 1 of ${DEMO_GAME_TYPES.length} walkthrough videos`);
    expect(first.stderr).toContain('notes.mp4');
    expect(first.stderr).toContain('extra/napoleon.mp4');
    expect(first.stderr).toContain('missing videos');
    const file = `bridge-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}.mp4`;
    expect(JSON.parse(readFileSync(catalogPath(root), 'utf8'))).toEqual([{ game: 'bridge', file }]);
    expect(readFileSync(join(root, 'client/public/game-demos', file))).toEqual(bytes);
    const second = run(root);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Reused 1');
  });

  it('writes an empty catalog without warnings when no videos are provided', () => {
    const root = createRoot();
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(readFileSync(catalogPath(root), 'utf8'))).toEqual([]);
  });

  it('refuses videos whose length no longer matches the recorded chapters', () => {
    const root = createRoot({ 'bridge.mp4': mp4(recordings.bridge.duration + 1) });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('game-demo-recordings.json');
    expect(existsSync(catalogPath(root))).toBe(false);
  });

  it('refuses files without an MP4 duration and explains how to remux them', () => {
    const root = createRoot({ 'bridge.mp4': Buffer.from('not a video') });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('-movflags +faststart');
  });

  it('loads the shared TypeScript contract when type stripping is disabled', () => {
    const root = createRoot({ 'bridge.mp4': mp4(recordings.bridge.duration) });
    const result = run(root, ['--no-experimental-strip-types']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Imported 1');
  });
});
