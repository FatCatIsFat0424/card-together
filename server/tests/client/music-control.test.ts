import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicControl } from '../../../client/src/components/MusicControl';
import { PROVIDED_MUSIC_TRACKS } from '../../../client/src/audio/provided-music-catalog';

describe('game music menu', () => {
  it('shows the owner playlist without original tabs, library links or seek controls', () => {
    const html = renderToStaticMarkup(createElement(MusicControl));
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('audio-library/');
    expect(html).not.toContain('原創音樂');
    expect(html).not.toContain('快進 10 秒');
    expect(html).not.toContain('倒退 10 秒');
    expect(html).toContain('播放音樂');
    expect(html).toContain('上一首');
    expect(html).toContain('下一首');
    const current = html.match(/aria-current="true"/g) ?? [];
    expect(current).toHaveLength(PROVIDED_MUSIC_TRACKS.length ? 1 : 0);
    if (!PROVIDED_MUSIC_TRACKS.length) expect(html).toContain('尚未加入音樂檔案');
  });
});

describe('grouped music menu', () => {
  afterEach(() => {
    vi.doUnmock('../../../client/src/audio/provided-music-catalog');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('shows artwork in the now-playing row, album row and track thumbnails, lazily where listed', async () => {
    vi.resetModules();
    const cover = `imported-cover-${'d'.repeat(24)}.webp`;
    vi.doMock('../../../client/src/audio/provided-music-catalog', async (importOriginal) => ({
      ...await importOriginal<typeof import('../../../client/src/audio/provided-music-catalog')>(),
      PROVIDED_MUSIC_TRACKS: [
        { id: 'a-one', title: 'Morning', file: 'a1.mp3', group: 'Composer A', cover },
        { id: 'a-two', title: 'Noon', file: 'a2.mp3', group: 'Composer A' },
      ],
    }));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { MusicControl: CoverControl } = await import('../../../client/src/components/MusicControl');
    const html = renderToStaticMarkup(createElement(CoverControl));
    const images = html.match(/<img[^>]*>/g) ?? [];
    // Now playing, album row and the playing track's thumbnail; the track without art shows its number instead.
    expect(images).toHaveLength(3);
    expect(images.every((image) => image.includes(`provided-music/${cover}`))).toBe(true);
    expect(images.filter((image) => image.includes('loading="lazy"'))).toHaveLength(2);
    expect(html).toContain('>2</span>');
  });

  it('labels the current track with its group and opens only that group', async () => {
    vi.resetModules();
    vi.doMock('../../../client/src/audio/provided-music-catalog', async (importOriginal) => ({
      ...await importOriginal<typeof import('../../../client/src/audio/provided-music-catalog')>(),
      PROVIDED_MUSIC_TRACKS: [
        { id: 'a-one', title: 'Morning', file: 'a1.mp3', group: 'Composer A' },
        { id: 'b-one', title: 'Evening', file: 'b1.mp3', group: 'Composer B' },
      ],
    }));
    // Server rendering reads the store's initial state, so steer the random first track.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { MusicControl: GroupedControl } = await import('../../../client/src/components/MusicControl');
    const html = renderToStaticMarkup(createElement(GroupedControl));
    expect(html).toContain('>Composer B</span>');
    expect(html).toContain('Evening</span>');
    expect(html).toContain('第 1/1 首');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html).not.toContain('Morning');
    expect(html).toContain('播放「Composer A」的曲目');
  });
});
