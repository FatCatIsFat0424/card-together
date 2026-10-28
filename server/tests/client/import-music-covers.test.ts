import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

interface ImportedTrack {
  id: string;
  title: string;
  file: string;
  group?: string;
  cover?: string;
}

const IMPORT_SCRIPT = resolve(import.meta.dirname, '../../../scripts/audio/import-provided-music.mjs');
const temporaryRoots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'card-together-music-covers-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'local-music'));
  return root;
}

function addSource(root: string, file: string, contents: Buffer | string): void {
  const path = join(root, 'local-music', file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function runImport(root: string): { tracks: ImportedTrack[]; stderr: string } {
  const result = spawnSync(process.execPath, [IMPORT_SCRIPT, root], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  const catalog = join(root, 'client/src/audio/provided-music.generated.json');
  return { tracks: JSON.parse(readFileSync(catalog, 'utf8')) as ImportedTrack[], stderr: result.stderr };
}

function coverFiles(root: string): string[] {
  return readdirSync(join(root, 'client/public/provided-music')).filter((name) => name.startsWith('imported-cover-')).sort();
}

async function image(color: string, format: 'jpeg' | 'png' = 'jpeg'): Promise<Buffer> {
  const base = sharp({ create: { width: 320, height: 180, channels: 3, background: color } });
  return format === 'jpeg' ? base.jpeg().toBuffer() : base.png().toBuffer();
}

function u32(value: number, endian: 'be' | 'le' = 'be'): Buffer {
  const bytes = Buffer.alloc(4);
  if (endian === 'be') bytes.writeUInt32BE(value);
  else bytes.writeUInt32LE(value);
  return bytes;
}

function syncsafe(value: number): Buffer {
  return Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f]);
}

function flacPicture(type: number, data: Buffer, mime = 'image/jpeg'): Buffer {
  return Buffer.concat([
    u32(type), u32(mime.length), Buffer.from(mime), u32(0), Buffer.alloc(16), u32(data.length), data,
  ]);
}

/** Splits packets into Ogg pages with at most 40 lacing values each, so large packets span several pages. */
function oggPages(packets: readonly Buffer[]): Buffer {
  const pages: Buffer[] = [];
  let sequence = 0;
  let lacing: number[] = [];
  let body: Buffer[] = [];
  let continued = false;
  const flush = (): void => {
    const header = Buffer.alloc(27);
    header.write('OggS', 0, 'latin1');
    header[5] = (continued ? 1 : 0) | (sequence === 0 ? 2 : 0);
    header.writeUInt32LE(sequence, 18);
    header[26] = lacing.length;
    pages.push(Buffer.concat([header, Buffer.from(lacing), ...body]));
    sequence += 1;
    lacing = [];
    body = [];
  };
  for (const packet of packets) {
    let offset = 0;
    for (;;) {
      const length = Math.min(255, packet.length - offset);
      lacing.push(length);
      body.push(packet.subarray(offset, offset + length));
      offset += length;
      const finished = length < 255;
      if (lacing.length === 40) {
        flush();
        continued = !finished;
      }
      if (finished) break;
    }
  }
  if (lacing.length) flush();
  return Buffer.concat(pages);
}

function opusFile(pictures: readonly Buffer[], extraComments: readonly string[] = []): Buffer {
  const comments = [...extraComments, ...pictures.map((picture) => `METADATA_BLOCK_PICTURE=${picture.toString('base64')}`)];
  const vendor = Buffer.from('test');
  const tags = Buffer.concat([
    Buffer.from('OpusTags'), u32(vendor.length, 'le'), vendor, u32(comments.length, 'le'),
    ...comments.flatMap((comment) => [u32(Buffer.byteLength(comment), 'le'), Buffer.from(comment)]),
  ]);
  const head = Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11)]);
  return Buffer.concat([oggPages([head, tags]), Buffer.from('OggS audio payload')]);
}

function flacFile(pictures: readonly Buffer[]): Buffer {
  const blocks = [{ type: 0, body: Buffer.alloc(34) }, ...pictures.map((picture) => ({ type: 6, body: picture }))];
  return Buffer.concat([
    Buffer.from('fLaC'),
    ...blocks.map((block, index) => Buffer.concat([
      Buffer.from([(index === blocks.length - 1 ? 0x80 : 0) | block.type]),
      Buffer.from([(block.body.length >> 16) & 0xff, (block.body.length >> 8) & 0xff, block.body.length & 0xff]),
      block.body,
    ])),
    Buffer.from('audio frames'),
  ]);
}

function id3File(version: 2 | 3 | 4, type: number, data: Buffer): Buffer {
  let frame: Buffer;
  if (version === 2) {
    const body = Buffer.concat([Buffer.from([0]), Buffer.from('JPG'), Buffer.from([type]), Buffer.from([0]), data]);
    frame = Buffer.concat([Buffer.from('PIC'), Buffer.from([(body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff]), body]);
  } else {
    // UTF-16 description checks the double-zero terminator handling.
    const description = Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x00, 0x00]);
    const body = Buffer.concat([Buffer.from([1]), Buffer.from('image/jpeg\0'), Buffer.from([type]), description, data]);
    frame = Buffer.concat([
      Buffer.from('APIC'), version === 3 ? u32(body.length) : syncsafe(body.length), Buffer.from([0, 0]), body,
    ]);
  }
  const padding = Buffer.alloc(16);
  const tag = Buffer.concat([frame, padding]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([version, 0, 0]), syncsafe(tag.length), tag, Buffer.from([0xff, 0xfb, 0x90, 0x00])]);
}

async function dimensions(path: string): Promise<{ width: number; height: number; format: string }> {
  const { width, height, format } = await sharp(path).metadata();
  return { width, height, format };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('music cover art import', () => {
  it('extracts art embedded in Ogg Opus across pages, preferring the front cover', async () => {
    const root = createRoot();
    const back = await image('#aa2222');
    const front = await image('#2222aa');
    addSource(root, 'Album/one.opus', opusFile([flacPicture(0, back), flacPicture(3, front)], ['TITLE=one']));

    const { tracks } = runImport(root);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].cover).toMatch(/^imported-cover-[a-f0-9]{24}\.webp$/);
    const path = join(root, 'client/public/provided-music', tracks[0].cover ?? '');
    expect(await dimensions(path)).toEqual({ width: 160, height: 160, format: 'webp' });
    const { data } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeGreaterThan(data[0]);
    expect(readFileSync(path).length).toBeLessThan(20_000);
  });

  it('extracts art from FLAC pictures and ID3v2.2, 2.3 and 2.4 tags', async () => {
    const root = createRoot();
    addSource(root, 'a.flac', flacFile([flacPicture(3, await image('#112233'))]));
    addSource(root, 'b.mp3', id3File(2, 3, await image('#223344')));
    addSource(root, 'c.mp3', id3File(3, 3, await image('#334455')));
    addSource(root, 'd.mp3', id3File(4, 3, await image('#445566', 'png')));

    const { tracks, stderr } = runImport(root);

    expect(stderr).toBe('');
    expect(tracks.map((track) => track.cover)).toHaveLength(4);
    expect(tracks.every((track) => track.cover !== undefined)).toBe(true);
    expect(coverFiles(root)).toHaveLength(4);
  });

  it('writes identical artwork once and keeps distinct artwork apart', async () => {
    const root = createRoot();
    const shared = await image('#118833');
    addSource(root, 'Album/one.opus', opusFile([flacPicture(3, shared)]));
    addSource(root, 'Album/two.opus', opusFile([flacPicture(3, shared)]));
    addSource(root, 'Album/three.opus', opusFile([flacPicture(3, await image('#883311'))]));

    const { tracks } = runImport(root);

    expect(new Set(tracks.map((track) => track.cover)).size).toBe(2);
    expect(coverFiles(root)).toHaveLength(2);
  });

  it('falls back to cover or folder images in the track folder only', async () => {
    const root = createRoot();
    addSource(root, 'Album/plain.mp3', 'no tags');
    addSource(root, 'Album/folder.png', await image('#cc0000', 'png'));
    addSource(root, 'Album/Cover.JPG', await image('#00cc00'));
    addSource(root, 'Other/plain.mp3', 'no tags');
    addSource(root, 'Tagged/plain.opus', opusFile([flacPicture(3, await image('#0000cc'))]));
    addSource(root, 'Tagged/cover.jpg', await image('#cccc00'));

    const { tracks } = runImport(root);
    const byGroup = Object.fromEntries(tracks.map((track) => [track.group, track.cover]));

    expect(byGroup.Other).toBeUndefined();
    expect(byGroup.Album).toBeDefined();
    const { data } = await sharp(join(root, 'client/public/provided-music', byGroup.Album ?? '')).raw().toBuffer({ resolveWithObject: true });
    expect(data[1]).toBeGreaterThan(data[0]);
    const embedded = await sharp(join(root, 'client/public/provided-music', byGroup.Tagged ?? '')).raw().toBuffer({ resolveWithObject: true });
    expect(embedded.data[2]).toBeGreaterThan(embedded.data[0]);
  });

  it('warns and continues when art is corrupt, truncated or missing', async () => {
    const root = createRoot();
    addSource(root, 'Album/bad-image.opus', opusFile([flacPicture(3, Buffer.from('not an image'))]));
    const truncated = opusFile([flacPicture(3, await image('#101010'))]);
    addSource(root, 'Album/truncated.opus', truncated.subarray(0, 140));
    addSource(root, 'Album/none.mp3', 'no tags');

    const { tracks, stderr } = runImport(root);

    expect(tracks).toHaveLength(3);
    expect(tracks.some((track) => track.cover !== undefined)).toBe(false);
    expect(stderr).toContain('bad-image.opus');
    expect(stderr).toContain('truncated.opus');
    expect(coverFiles(root)).toEqual([]);
  });

  it('reuses unchanged output, refreshes changed fallback art and removes stale covers', async () => {
    const root = createRoot();
    addSource(root, 'Album/plain.mp3', 'no tags');
    addSource(root, 'Album/cover.jpg', await image('#aa0000'));
    addSource(root, 'Tagged/one.opus', opusFile([flacPicture(3, await image('#0000aa'))]));
    const first = runImport(root);
    const unrelated = join(root, 'client/public/provided-music/notes.txt');
    writeFileSync(unrelated, 'keep');
    const before = readFileSync(join(root, 'client/src/audio/provided-music.generated.json'), 'utf8');

    expect(runImport(root).tracks).toEqual(first.tracks);
    expect(readFileSync(join(root, 'client/src/audio/provided-music.generated.json'), 'utf8')).toBe(before);

    writeFileSync(join(root, 'local-music/Album/cover.jpg'), await image('#00aa00'));
    const changed = runImport(root);
    const album = changed.tracks.find((track) => track.group === 'Album');
    expect(album?.cover).not.toBe(first.tracks.find((track) => track.group === 'Album')?.cover);
    expect(coverFiles(root)).toHaveLength(2);

    rmSync(join(root, 'local-music/Tagged'), { recursive: true });
    const reduced = runImport(root);
    expect(reduced.tracks).toHaveLength(1);
    expect(coverFiles(root)).toEqual([`${reduced.tracks[0].cover}`]);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('leaves tracks without any art unchanged in the catalog', () => {
    const root = createRoot();
    addSource(root, 'plain.mp3', 'no tags');

    const { tracks } = runImport(root);

    expect(Object.keys(tracks[0])).toEqual(['id', 'title', 'file']);
  });
});
