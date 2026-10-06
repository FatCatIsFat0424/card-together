import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
