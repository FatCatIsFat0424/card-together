import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
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
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProvidedEmoji } from '@shared/types';
import { parseProvidedEmojiCatalog } from '@shared/constants';

const IMPORT_SCRIPT = resolve(import.meta.dirname, '../../../scripts/emoji/import-provided-emoji.mjs');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Buffer.from('GIF89a');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
const LIMIT = 2 * 1024 * 1024;
const temporaryRoots: string[] = [];

function createRoot(withSources = true): string {
  const root = mkdtempSync(join(tmpdir(), 'card-together-provided-emoji-'));
  temporaryRoots.push(root);
  if (withSources) mkdirSync(join(root, 'local-emoji'));
  return root;
}

function sourcePath(root: string, file: string): string {
  return join(root, 'local-emoji', file);
}

function outputPath(root: string, file: string): string {
  return join(root, 'client/public/provided-emoji', file);
}

function catalogPath(root: string): string {
  return join(root, 'shared/src/provided-emoji.generated.json');
}

function writeSource(root: string, file: string, bytes: Buffer): void {
  const path = sourcePath(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * Small fixtures carry only magic bytes plus a marker: sources within the limit are copied
 * without being decoded.
 */
function addSource(root: string, file: string, header: Buffer = PNG, marker = file): void {
  writeSource(root, file, Buffer.concat([header, Buffer.from(marker)]));
}

function runImport(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [IMPORT_SCRIPT, root], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readCatalog(root: string): ProvidedEmoji[] {
  return parseProvidedEmojiCatalog(JSON.parse(readFileSync(catalogPath(root), 'utf8')));
}

function importEmoji(root: string): ProvidedEmoji[] {
  const result = runImport(root);
  if (result.status !== 0) throw new Error(`Emoji import failed: ${result.stderr}`);
  return readCatalog(root);
}

function importError(root: string): string {
  const result = runImport(root);
  if (result.status === 0) throw new Error('Expected the emoji import to fail.');
  return result.stderr;
}

function byName(emoji: readonly ProvidedEmoji[], name: string): ProvidedEmoji {
  const entry = emoji.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Missing emoji ${name}`);
  return entry;
}

/** Incompressible pixels so encoded size tracks pixel count. */
function noisePng(width: number, height: number): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 }).toBuffer();
}

/**
 * A small animated GIF padded past the limit with a comment extension, which decoders skip;
 * this keeps fixture generation fast while still exercising animated compression.
 */
async function paddedAnimatedGif(width: number, height: number, frames: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * frames * 3);
  for (let frame = 0; frame < frames; frame += 1) {
    pixels.fill(frame * 60, frame * width * height * 3, (frame + 1) * width * height * 3);
  }
  const gif = await sharp(pixels, { raw: { width, height: height * frames, channels: 3, pageHeight: height } })
    .gif({ delay: Array.from({ length: frames }, (_, index) => 40 + index * 10), loop: 0 }).toBuffer();
  const blocks = Array.from({ length: Math.ceil((LIMIT + 1024) / 255) }, () =>
    Buffer.concat([Buffer.from([255]), Buffer.alloc(255, 0x61)]));
  const comment = Buffer.concat([Buffer.from([0x21, 0xfe]), ...blocks, Buffer.from([0])]);
  expect(gif.at(-1)).toBe(0x3b);
  return Buffer.concat([gif.subarray(0, -1), comment, gif.subarray(-1)]);
}

function snapshotOutputs(root: string): Record<string, string> {
  const snapshot: Record<string, string> = { catalog: readFileSync(catalogPath(root), 'utf8') };
  for (const file of readdirSync(outputPath(root, ''))) {
    snapshot[file] = readFileSync(outputPath(root, file)).toString('base64');
  }
  return snapshot;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('provided emoji import CLI', () => {
  it('should import nested images by name with detected types and preserved bytes', () => {
    const root = createRoot();
    addSource(root, 'faces/wave.PNG', PNG);
    addSource(root, 'faces/happy_2.jpeg', JPEG);
    addSource(root, 'party.gif', GIF);
    addSource(root, 'animals/cat.webp', WEBP);
    addSource(root, 'notes.txt', PNG);
    addSource(root, 'logo.svg', PNG);

    const emoji = importEmoji(root);

    expect(emoji.map((entry) => entry.name)).toEqual(['cat', 'happy_2', 'party', 'wave']);
    expect(emoji.map((entry) => entry.file.split('.').at(-1))).toEqual(['webp', 'jpg', 'gif', 'png']);
    for (const entry of emoji) {
      expect(entry.file).toMatch(new RegExp(`^${entry.name}-[a-f0-9]{24}\\.(png|jpg|gif|webp)$`));
    }
    const wave = emoji.find((entry) => entry.name === 'wave')!;
    expect(readFileSync(outputPath(root, wave.file)))
      .toEqual(Buffer.concat([PNG, Buffer.from('faces/wave.PNG')]));
    expect(readdirSync(outputPath(root, ''))).toHaveLength(4);
  });

  it('should produce deterministic output and new file names only for changed bytes', () => {
    const root = createRoot();
    addSource(root, 'wave.png', PNG, 'first');
    addSource(root, 'cat.png', PNG, 'cat');
    const first = importEmoji(root);
    const snapshot = snapshotOutputs(root);
    expect(importEmoji(root)).toEqual(first);
    expect(snapshotOutputs(root)).toEqual(snapshot);

    addSource(root, 'wave.png', PNG, 'second');
    const second = importEmoji(root);
    const [oldWave, newWave] = [first, second].map((emoji) => emoji.find((entry) => entry.name === 'wave')!);
    expect(newWave.file).not.toBe(oldWave.file);
    expect(existsSync(outputPath(root, oldWave.file))).toBe(false);
    expect(second.find((entry) => entry.name === 'cat')).toEqual(first.find((entry) => entry.name === 'cat'));
  });

  it('should remove stale imported files while preserving unrelated output files', () => {
    const root = createRoot();
    addSource(root, 'keep.png');
    addSource(root, 'remove.gif', GIF);
    const removed = importEmoji(root).find((entry) => entry.name === 'remove')!;
    writeFileSync(outputPath(root, 'README.md'), 'project documentation');
    writeFileSync(outputPath(root, 'unrelated.png'), 'unrelated image');
    rmSync(sourcePath(root, 'remove.gif'));

    expect(importEmoji(root).map((entry) => entry.name)).toEqual(['keep']);
    expect(existsSync(outputPath(root, removed.file))).toBe(false);
    expect(readFileSync(outputPath(root, 'README.md'), 'utf8')).toBe('project documentation');
    expect(readFileSync(outputPath(root, 'unrelated.png'), 'utf8')).toBe('unrelated image');
  });

  it('should publish an empty catalog when the source folder is missing or empty', () => {
    const missing = createRoot(false);
    expect(importEmoji(missing)).toEqual([]);
    expect(existsSync(join(missing, 'local-emoji'))).toBe(true);

    const emptied = createRoot();
    addSource(emptied, 'wave.png');
    const [wave] = importEmoji(emptied);
    rmSync(sourcePath(emptied, 'wave.png'));
    expect(importEmoji(emptied)).toEqual([]);
    expect(existsSync(outputPath(emptied, wave.file))).toBe(false);
  });

  it('should normalize invalid names, keep valid relaxed names and report every rename', () => {
    const root = createRoot();
    const sources = {
      'Wave Hello.png': 'Wave_Hello',
      'phoebe1 .png': 'phoebe1',
      '-5641e774f3c32f20.gif': '5641e774f3c32f20',
      '__a  b!!c__.png': 'a_b_c',
      [`${'a'.repeat(70)}.png`]: 'a'.repeat(64),
      'x.png': `emoji_${createHash('sha256').update('x.png').digest('hex').slice(0, 6)}`,
      'faces/貓.png': `emoji_${createHash('sha256').update('faces/貓.png').digest('hex').slice(0, 6)}`,
      'FB_IMG_1737436595895.jpg': 'FB_IMG_1737436595895',
      'image0-1-3.png': 'image0-1-3',
      'dont_bark-ezgif.com-optimize.gif': 'dont_bark-ezgif.com-optimize',
      'ok_2.png': 'ok_2',
    };
    for (const file of Object.keys(sources)) addSource(root, file, file.endsWith('.gif') ? GIF : PNG);

    const result = runImport(root);

    expect(result.status).toBe(0);
    const emoji = readCatalog(root);
    expect(emoji.map((entry) => entry.name).sort()).toEqual(Object.values(sources).sort());
    for (const entry of emoji) expect(existsSync(outputPath(root, entry.file))).toBe(true);
    expect(result.stderr).toContain('Warning: renamed (7):');
    expect(result.stderr).toContain('Wave Hello.png -> :Wave_Hello:');
    expect(result.stderr).toContain('phoebe1 .png -> :phoebe1:');
    expect(result.stderr).not.toContain('image0-1-3.png ->');
    expect(result.stderr).not.toContain('ok_2.png ->');
  });

  it('should suffix duplicate names deterministically, letting valid file names keep theirs', () => {
    const root = createRoot();
    addSource(root, 'a/wave.png');
    addSource(root, 'b/wave.gif', GIF);
    addSource(root, 'wave.webp', WEBP);
    addSource(root, 'wave_2.png');
    addSource(root, 'Wave.png');
    addSource(root, 'wave .jpg', JPEG);

    const first = importEmoji(root);
    const names = Object.fromEntries(first.map((entry) => [entry.name, entry.file.split('.').at(-1)]));

    expect(names).toEqual({ Wave: 'png', wave: 'png', wave_2: 'png', wave_3: 'gif', wave_4: 'jpg', wave_5: 'webp' });
    expect(importEmoji(root)).toEqual(first);
  });

  it('should skip unusable files with reasons and still publish the rest', () => {
    const root = createRoot();
    addSource(root, 'wave.png', PNG, 'original');
    importEmoji(root);
    addSource(root, 'fake.png', Buffer.from('text'));
    writeSource(root, 'broken.gif', Buffer.concat([GIF, Buffer.alloc(LIMIT)]));
    const unreadable = process.getuid?.() !== 0;
    if (unreadable) {
      addSource(root, 'locked.png');
      chmodSync(sourcePath(root, 'locked.png'), 0);
    }
    addSource(root, 'cat.png');

    const result = runImport(root);

    expect(result.status).toBe(0);
    expect(readCatalog(root).map((entry) => entry.name)).toEqual(['cat', 'wave']);
    expect(result.stderr).toContain(`Warning: skipped (${unreadable ? 3 : 2}):`);
    expect(result.stderr).toContain('fake.png: not a PNG, JPEG, GIF or WebP image');
    expect(result.stderr).toContain('broken.gif: could not be decoded for compression');
    if (unreadable) expect(result.stderr).toContain('locked.png: unreadable (EACCES)');
  });

  it('should copy sources up to 2 MiB unchanged and compress larger images to WebP', async () => {
    const root = createRoot();
    const exact = Buffer.alloc(LIMIT);
    PNG.copy(exact);
    writeSource(root, 'exact.png', exact);
    writeSource(root, 'photo.png', await noisePng(1200, 600));
    const gif = await paddedAnimatedGif(320, 200, 4);
    expect(gif.length).toBeGreaterThan(LIMIT);
    writeSource(root, 'dance.gif', gif);

    const result = runImport(root);

    expect(result.status).toBe(0);
    const emoji = readCatalog(root);
    expect(readFileSync(outputPath(root, byName(emoji, 'exact').file))).toEqual(exact);
    expect(result.stdout).toContain('Compressed to WebP (2):');
    expect(result.stdout).toMatch(/dance\.gif: 2\.\d MiB -> \d+\.\d KiB/);

    const photo = byName(emoji, 'photo');
    expect(photo.file).toMatch(/^photo-[a-f0-9]{24}\.webp$/);
    const photoBytes = readFileSync(outputPath(root, photo.file));
    expect(photoBytes.length).toBeLessThanOrEqual(LIMIT);
    expect(await sharp(photoBytes).metadata()).toMatchObject({ format: 'webp', width: 256, height: 128 });

    const dance = byName(emoji, 'dance');
    expect(dance.file).toMatch(/^dance-[a-f0-9]{24}\.webp$/);
    const danceBytes = readFileSync(outputPath(root, dance.file));
    expect(danceBytes.length).toBeLessThanOrEqual(LIMIT);
    expect(await sharp(danceBytes, { animated: true }).metadata()).toMatchObject({
      format: 'webp', pages: 4, width: 256, pageHeight: 160, delay: [40, 50, 60, 70], loop: 0,
    });
    expect(readdirSync(outputPath(root, '')).filter((file) => file.startsWith('.'))).toEqual([]);
  }, 60_000);

  it('should skip an image that cannot fit at the smallest size', async () => {
    const root = createRoot();
    const frames = 640;
    // Incompressible 96-pixel frames stay over the limit even at the last step.
    const animation = await sharp(randomBytes(96 * 96 * frames * 3), {
      raw: { width: 96, height: 96 * frames, channels: 3, pageHeight: 96 },
    }).webp({ quality: 100, effort: 0 }).toBuffer();
    writeSource(root, 'noise.webp', animation);
    addSource(root, 'wave.png');

    const result = runImport(root);

    expect(result.status).toBe(0);
    expect(readCatalog(root).map((entry) => entry.name)).toEqual(['wave']);
    expect(result.stderr).toMatch(/noise\.webp: \d+\.\d MiB does not fit 2\.0 MiB even at the smallest size/);
  }, 120_000);

  it.each(['file', 'directory'] as const)(
    'should reject a source %s symlink without changing previous outputs',
    (kind) => {
      const root = createRoot();
      addSource(root, 'wave.png', PNG, 'original');
      importEmoji(root);
      const previous = snapshotOutputs(root);
      addSource(root, 'wave.png', PNG, 'changed');
      if (kind === 'file') {
        symlinkSync(sourcePath(root, 'wave.png'), sourcePath(root, 'link.png'));
      } else {
        mkdirSync(join(root, 'external'));
        writeFileSync(join(root, 'external/cat.png'), PNG);
        symlinkSync(join(root, 'external'), sourcePath(root, 'linked'));
      }

      expect(importError(root)).toContain('Symlinks are not allowed');
      expect(snapshotOutputs(root)).toEqual(previous);
    },
  );
});
