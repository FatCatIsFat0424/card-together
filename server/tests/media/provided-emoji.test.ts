import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProvidedEmojiCatalog } from '../../src/media/provided-emoji';

const WAVE = { name: 'wave', file: 'wave-0123456789abcdef01234567.png' };

describe('provided emoji catalog loading', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-together-emoji-catalog-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('should treat a missing catalog as no provided emoji', async () => {
    expect((await loadProvidedEmojiCatalog(join(directory, 'missing.json'))).size).toBe(0);
  });

  it('should key valid entries by name', async () => {
    const path = join(directory, 'catalog.json');
    await writeFile(path, JSON.stringify([WAVE]));
    expect([...await loadProvidedEmojiCatalog(path)]).toEqual([['wave', WAVE]]);
  });

  it.each([
    ['malformed JSON', '[{'],
    ['an invalid entry', JSON.stringify([{ name: 'wave', file: 'https://example.com/wave.png' }])],
    ['a duplicate name', JSON.stringify([WAVE, WAVE])],
  ])('should fail fast on %s', async (_label, contents) => {
    const path = join(directory, 'catalog.json');
    await writeFile(path, contents);
    await expect(loadProvidedEmojiCatalog(path)).rejects.toThrow();
  });
});
