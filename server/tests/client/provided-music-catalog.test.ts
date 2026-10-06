import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDED_MUSIC_TRACKS, providedMusicUrl, validateProvidedMusicCatalog } from '../../../client/src/audio/provided-music-catalog';

afterEach(() => { vi.unstubAllEnvs(); });
describe('owner-provided music catalog', () => {
  it('contains supplied files available in the public music directory', () => {
    validateProvidedMusicCatalog(PROVIDED_MUSIC_TRACKS);
    for (const track of PROVIDED_MUSIC_TRACKS) {
      expect(existsSync(resolve(import.meta.dirname, '../../../client/public/provided-music', track.file))).toBe(true);
    }
  });
  it('rejects URLs, directory traversal and duplicate IDs/files', () => {
    const track = { id: 'owner', title: 'Owner song', file: 'song.mp3' };
    for (const file of ['../song.mp3', '/song.mp3', 'https://example.com/song.mp3', 'song.mp3?x', '%2e%2e.mp3']) {
      expect(() => validateProvidedMusicCatalog([{ ...track, file }])).toThrow();
    }
    expect(() => validateProvidedMusicCatalog([track, track])).toThrow();
    expect(() => validateProvidedMusicCatalog([track, { ...track, id: 'second' }])).toThrow();
  });
  it('encodes file names relative to the deployment base', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    expect(providedMusicUrl({ id: 'owner', title: 'Song', file: '夏日 夜晚.mp3' }))
      .toBe('/card-together/provided-music/%E5%A4%8F%E6%97%A5%20%E5%A4%9C%E6%99%9A.mp3');
  });
});
