import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateMediaSession } from '../../../client/src/audio/media-session';

class FakeMediaMetadata {
  constructor(readonly init: Record<string, unknown>) {}
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('media session metadata', () => {
  it('publishes the title, album and an absolute artwork URL', () => {
    vi.stubEnv('BASE_URL', '/card-together/');
    const session: { metadata: unknown } = { metadata: null };
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.stubGlobal('location', { href: 'https://example.com/card-together/rooms' });
    const cover = `imported-cover-${'c'.repeat(24)}.webp`;

    updateMediaSession({ id: 'owner', title: 'Song', file: 'song.opus', group: 'Album', cover });

    expect((session.metadata as FakeMediaMetadata).init).toEqual({
      title: 'Song',
      artist: 'Album',
      album: 'Album',
      artwork: [{ src: `https://example.com/card-together/provided-music/${cover}`, sizes: '160x160', type: 'image/webp' }],
    });
  });

  it('omits artwork when the track has none and ignores browsers without the API', () => {
    const session: { metadata: unknown } = { metadata: null };
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
    vi.stubGlobal('location', { href: 'https://example.com/' });
    updateMediaSession({ id: 'owner', title: 'Song', file: 'song.opus' });
    expect((session.metadata as FakeMediaMetadata).init.artwork).toEqual([]);

    vi.stubGlobal('navigator', {});
    expect(() => updateMediaSession({ id: 'owner', title: 'Song', file: 'song.opus' })).not.toThrow();
  });
});
