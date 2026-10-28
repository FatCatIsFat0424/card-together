import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDED_MUSIC_TRACKS, albumCoverUrl, groupProvidedMusicTracks, providedMusicCoverUrl, providedMusicUrl,
  validateProvidedMusicCatalog,
} from '../../../client/src/audio/provided-music-catalog';

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
    expect(() => validateProvidedMusicCatalog([{ ...track, group: ' ' }])).toThrow();
    expect(() => validateProvidedMusicCatalog([{ ...track, group: 'Album' }])).not.toThrow();
  });
  it('groups consecutive tracks by folder in playback order', () => {
    const tracks = [
      { id: 'a', title: 'A', file: 'a.mp3' },
      { id: 'b', title: 'B', file: 'b.mp3', group: 'Album' },
      { id: 'c', title: 'C', file: 'c.mp3', group: 'Album' },
      { id: 'd', title: 'D', file: 'd.mp3', group: 'Composer' },
    ];
    expect(groupProvidedMusicTracks(tracks)).toEqual([
      { name: undefined, tracks: [tracks[0]] },
      { name: 'Album', tracks: [tracks[1], tracks[2]] },
      { name: 'Composer', tracks: [tracks[3]] },
    ]);
  });
  it('accepts only generated cover thumbnails and resolves them against the base', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    const cover = `imported-cover-${'a'.repeat(24)}.webp`;
    const track = { id: 'owner', title: 'Song', file: 'song.mp3', cover };
    expect(() => validateProvidedMusicCatalog([track])).not.toThrow();
    for (const bad of ['../x.webp', 'cover.webp', `imported-cover-${'a'.repeat(24)}.png`, `imported-cover-${'A'.repeat(24)}.webp`]) {
      expect(() => validateProvidedMusicCatalog([{ ...track, cover: bad }])).toThrow();
    }
    expect(providedMusicCoverUrl(track)).toBe(`/card-together/provided-music/${cover}`);
    expect(providedMusicCoverUrl({ id: 'plain', title: 'Plain', file: 'plain.mp3' })).toBeNull();
  });
  it('shows an album with its first track that has artwork', () => {
    vi.stubEnv('BASE_URL', '/');
    const cover = `imported-cover-${'b'.repeat(24)}.webp`;
    const tracks = [
      { id: 'a', title: 'A', file: 'a.mp3' },
      { id: 'b', title: 'B', file: 'b.mp3', cover },
    ];
    expect(albumCoverUrl(tracks)).toBe(`/provided-music/${cover}`);
    expect(albumCoverUrl([tracks[0]])).toBeNull();
  });
  it('encodes file names relative to the deployment base', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    expect(providedMusicUrl({ id: 'owner', title: 'Song', file: '夏日 夜晚.mp3' }))
      .toBe('/card-together/provided-music/%E5%A4%8F%E6%97%A5%20%E5%A4%9C%E6%99%9A.mp3');
  });
});
