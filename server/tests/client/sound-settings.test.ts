import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server rendering reads a zustand store's initial state, so each switch reads a mutable stand-in.
const stores = vi.hoisted(() => ({
  music: { enabled: true, setEnabled: (): void => undefined },
  effects: { enabled: true, setEnabled: (): void => undefined },
  turn: { enabled: true, setEnabled: (): void => undefined },
}));
vi.mock('../../../client/src/stores/music-store', () => ({
  useMusicStore: (select: (value: typeof stores.music) => unknown) => select(stores.music),
}));
vi.mock('../../../client/src/stores/sound-effects-store', () => ({
  useSoundEffectsStore: (select: (value: typeof stores.effects) => unknown) => select(stores.effects),
}));
vi.mock('../../../client/src/stores/turn-sound-store', () => ({
  useTurnSoundStore: (select: (value: typeof stores.turn) => unknown) => select(stores.turn),
}));

import { SoundSettings } from '../../../client/src/components/SoundSettings';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const checked = (html: string, id: string): boolean => {
  const tag = html.match(new RegExp(`<span[^>]*data-sound-setting="${id}"[^>]*>`))?.[0] ?? '';
  return tag.includes('Mui-checked');
};

describe('sound settings', () => {
  beforeEach(() => {
    useI18nStore.getState().setLocale('zh-TW');
    for (const store of Object.values(stores)) store.enabled = true;
  });

  it('lists the effects, music, and turn reminder switches with their current state', () => {
    let html = renderToStaticMarkup(createElement(SoundSettings));
    for (const label of ['遊戲音效', '遊戲音樂', '回合提醒音', '這些設定只儲存在這台裝置。']) expect(html).toContain(label);
    expect(['effects', 'music', 'turn'].map((id) => checked(html, id))).toEqual([true, true, true]);
    stores.effects.enabled = false;
    stores.music.enabled = false;
    html = renderToStaticMarkup(createElement(SoundSettings));
    expect(['effects', 'music', 'turn'].map((id) => checked(html, id))).toEqual([false, false, true]);
  });
});
