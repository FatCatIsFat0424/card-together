import { createElement } from 'react';
import type { ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Server rendering reads each zustand store's initial state, so saved preferences stand in for store updates.
interface Components {
  AudioSettings: ComponentType<{ showTitle?: boolean }>;
  AudioSettingsButton: ComponentType<{ label?: string }>;
  MusicControl: ComponentType;
}

async function load(saved: Record<string, string>): Promise<Components> {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => saved[key.replace('card-together.', '')] ?? null,
    setItem: (): void => undefined,
    removeItem: (): void => undefined,
  });
  vi.stubGlobal('sessionStorage', undefined);
  const { useI18nStore } = await import('../../../client/src/stores/i18n-store');
  useI18nStore.getState().setLocale('zh-TW');
  const settings = await import('../../../client/src/components/AudioSettings');
  const music = await import('../../../client/src/components/MusicControl');
  return {
    AudioSettings: settings.AudioSettings,
    AudioSettingsButton: settings.AudioSettingsButton,
    MusicControl: music.MusicControl,
  };
}

describe('audio settings panel', () => {
  let components: Components;

  beforeEach(async () => {
    components = await load({
      'audio.master.volume': '0.9', 'audio.voice.enabled': 'false', 'sound.effects.volume': '0.7',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should list every channel with its switch and a 0-100 slider, plus the nested turn reminder switch', () => {
    const html = renderToStaticMarkup(createElement(components.AudioSettings));
    for (const label of ['音訊設定', '主音量', '背景音樂', '音效', '回合提醒音', '語音聊天']) expect(html).toContain(label);
    expect(html.match(/role="switch"/g)).toHaveLength(5);
    expect(html.match(/type="range"/g)).toHaveLength(4);
    expect(html.match(/min="0"/g)).toHaveLength(4);
    expect(html.match(/max="100"/g)).toHaveLength(4);
    expect(html).toContain('value="90"');
    expect(html).toContain('value="70"');
    expect(html).toContain('aria-label="語音聊天"');
    expect(html).toContain('這些設定只儲存在這台裝置。');
    expect(html).toContain('提及提醒');
    expect(html).toContain('提示與音效');
    expect(html).toContain('僅視覺提示');
    expect(html).toContain('關閉提醒');
  });

  it('should reflect each switch state', () => {
    const html = renderToStaticMarkup(createElement(components.AudioSettings));
    const switches = html.match(/<input[^>]*role="switch"[^>]*>/g) ?? [];
    // Master, music, effects, turn reminder, voice (saved as off).
    expect(switches.map((tag) => tag.includes('checked'))).toEqual([true, true, true, true, false]);
  });

  it('should omit its title when hosted in a page that already has one', () => {
    const html = renderToStaticMarkup(createElement(components.AudioSettings, { showTitle: false }));
    expect(html).not.toContain('<h2');
    expect(html).toContain('aria-label="音訊設定"');
  });

  it('should offer a button that opens the same dialog from other panels', () => {
    expect(renderToStaticMarkup(createElement(components.AudioSettingsButton))).toContain('音訊設定');
    expect(renderToStaticMarkup(createElement(components.AudioSettingsButton, { label: '音量設定' })))
      .toContain('音量設定');
  });

  it('should keep playback controls in the music menu but move volume to the audio settings', () => {
    const html = renderToStaticMarkup(createElement(components.MusicControl));
    expect(html).toContain('播放音樂');
    expect(html).toContain('音訊設定');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('回合提醒音');
  });
});
