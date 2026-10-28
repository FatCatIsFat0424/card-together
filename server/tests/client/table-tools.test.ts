import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  visible: null as Record<string, unknown> | null,
  sort: { gameType: null as string | null, order: null as string | null, manual: false },
}));

vi.mock('../../../client/src/socket', () => ({ socket: { timeout: () => ({ emit: (): void => undefined }) } }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { visible: unknown }) => unknown) => select({ visible: state.visible }),
}));
// Server rendering reads a store's initial state, so the sort choice comes from this mutable stand-in.
vi.mock('../../../client/src/stores/hand-sort-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../client/src/stores/hand-sort-store')>(),
  useHandSortStore: (select: (value: unknown) => unknown) => select({ ...state.sort, sort: () => undefined }),
}));

import { AutoPlayBanner, TableTools, TableToolsDrawer } from '../../../client/src/games/TableTools';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const render = (element: ReturnType<typeof createElement>): string => renderToStaticMarkup(element);
const pressed = (html: string, label: string): string | undefined =>
  new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*aria-label="${label}"`).exec(html)?.[1];

describe('table tools', () => {
  beforeEach(() => {
    state.visible = { gameType: 'bigtwo', phase: 'playing', observer: false, autoPlay: false };
    state.sort = { gameType: null, order: null, manual: false };
    useI18nStore.getState().setLocale('en');
  });

  it('offers an auto-play switch and both sort orders, with the game default selected', () => {
    const html = render(createElement(TableTools));
    expect(html).toContain('data-table-tools="cluster"');
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*>[\s\S]*Computer auto-play/);
    expect(pressed(html, 'Sort by rank')).toBe('true');
    expect(pressed(html, 'Sort by suit')).toBe('false');
    expect(html).toContain('>Suit</button>');
    expect(html).toContain('>Rank</button>');
  });

  it('follows the chosen order and highlights neither after a manual arrangement', () => {
    state.sort = { gameType: 'bigtwo', order: 'suit', manual: false };
    expect(pressed(render(createElement(TableTools)), 'Sort by suit')).toBe('true');
    state.sort = { gameType: 'bigtwo', order: 'suit', manual: true };
    const html = render(createElement(TableTools));
    expect(pressed(html, 'Sort by suit')).toBe('false');
    expect(pressed(html, 'Sort by rank')).toBe('false');
  });

  it('turns the switch gold and waits the sort orders while the computer plays', () => {
    state.visible = { ...state.visible, autoPlay: true };
    const html = render(createElement(TableTools));
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*>[\s\S]*Auto-playing/);
    expect(html.match(/aria-pressed="(?:true|false)" aria-label="Sort by (?:suit|rank)"[^>]*disabled=""/g)).toHaveLength(2);
  });

  it('disables suit sorting for games whose cards have no suit', () => {
    state.visible = { ...state.visible, gameType: 'liarsdeck' };
    expect(render(createElement(TableTools))).toMatch(/aria-label="Sort by suit" title="These cards have no suits\."[^>]*disabled=""/);
  });

  it('starts the phone drawer closed, with a dot on the handle while auto-play runs', () => {
    expect(render(createElement(TableToolsDrawer))).toMatch(/aria-expanded="false" aria-label="Table tools"/);
    expect(render(createElement(TableToolsDrawer))).not.toContain('role="switch"');
    state.visible = { ...state.visible, autoPlay: true };
    expect(render(createElement(TableToolsDrawer))).toContain('aria-label="Table tools · Auto-play is on"');
  });

  it('hides the tools from spectators and on the settled table', () => {
    state.visible = { ...state.visible, observer: true };
    expect(render(createElement(TableTools))).toBe('');
    expect(render(createElement(TableToolsDrawer))).toBe('');
    state.visible = { gameType: 'bigtwo', phase: 'scoring', observer: false, autoPlay: true };
    expect(render(createElement(TableTools))).toBe('');
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
