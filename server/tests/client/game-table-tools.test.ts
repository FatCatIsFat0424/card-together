import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  visible: null as Record<string, unknown> | null,
  sort: { gameType: null as string | null, order: null as string | null, sort: (): void => undefined },
}));

vi.mock('../../../client/src/socket', () => ({ socket: { timeout: () => ({ emit: (): void => undefined }) } }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { visible: unknown }) => unknown) => select({ visible: state.visible }),
}));
vi.mock('../../../client/src/stores/hand-sort-store', () => ({ useHandSortStore: () => state.sort }));

import { AutoPlayBanner, GameActionBar } from '../../../client/src/games/GameActionBar';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const render = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(element);

describe('table menu tools', () => {
  beforeEach(() => {
    state.visible = { gameType: 'bigtwo', phase: 'playing', observer: false, autoPlay: false };
    state.sort.gameType = null;
    state.sort.order = null;
    useI18nStore.getState().setLocale('en');
  });

  it('offers auto-play and both sort orders to a player', () => {
    const html = render(createElement(GameActionBar));
    expect(html).toContain('>Computer auto-play<');
    expect(html).toContain('>Sort by suit<');
    expect(html).toContain('>Sort by rank<');
    expect(html).toMatch(/aria-pressed="false"[^>]*>Computer auto-play</);
  });

  it('marks the active sort order and the running auto-play', () => {
    state.visible = { ...state.visible, autoPlay: true };
    state.sort.gameType = 'bigtwo';
    state.sort.order = 'rank';
    const html = render(createElement(GameActionBar));
    expect(html).toContain('>Stop auto-play<');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Sort by rank</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Sort by suit</);
  });

  it('disables suit sorting for games whose cards have no suit', () => {
    state.visible = { ...state.visible, gameType: 'liarsdeck' };
    expect(render(createElement(GameActionBar))).toMatch(/disabled=""[^>]*>Sort by suit</);
  });

  it('hides the tools from spectators and on the settled table', () => {
    state.visible = { ...state.visible, observer: true };
    expect(render(createElement(GameActionBar))).toBe('');
    state.visible = { gameType: 'bigtwo', phase: 'scoring', observer: false, autoPlay: true };
    expect(render(createElement(GameActionBar))).toBe('');
    expect(render(createElement(AutoPlayBanner))).toBe('');
  });

  it('shows the auto-play banner with a way to turn it off only while it runs', () => {
    expect(render(createElement(AutoPlayBanner))).toBe('');
    state.visible = { ...state.visible, autoPlay: true };
    const html = render(createElement(AutoPlayBanner));
    expect(html).toContain('Auto-play is on');
    expect(html).toContain('>Stop</button>');
    useI18nStore.getState().setLocale('zh-TW');
    expect(render(createElement(AutoPlayBanner))).toContain('自動代打中');
  });
});
