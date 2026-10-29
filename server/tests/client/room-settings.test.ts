import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameType, RoomInfo } from '@shared/types';

// Per-game option panels are not under test and pull in the whole client runtime.
vi.mock('../../../client/src/games/ui-registry', () => ({ gameUi: () => ({}) }));

// Calling the picker as a plain function lets the test walk its element tree and fire handlers.
vi.mock('../../../client/src/stores/i18n-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/stores/i18n-store')>();
  return { ...actual, useI18nStore: Object.assign(() => actual.useI18nStore.getState(), actual.useI18nStore) };
});

import { RoomGamePicker } from '../../../client/src/components/RoomGamePicker';
import { RoomSettings } from '../../../client/src/components/RoomSettings';
import { Tabs } from '../../../client/src/components/Tabs';
import { gamesInCategory, lobbyCategories } from '../../../client/src/games/registry';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function findAll(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => findAll(child, match));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(match(node) ? [node] : []), ...findAll(node.props.children as ReactNode, match)];
}

const chips = (tree: ReactNode) => findAll(tree, (element) => element.type === 'button');

function pickerProps(overrides: Partial<Parameters<typeof RoomGamePicker>[0]> = {}): Parameters<typeof RoomGamePicker>[0] {
  return {
    gameType: 'bigtwo', category: 'cards', onCategoryChange: vi.fn(), onSelect: vi.fn(), disabled: false, ...overrides,
  };
}

function room(gameType: GameType): RoomInfo {
  return { code: 'ABC123', gameType, status: 'waiting', hostId: 'host' } as RoomInfo;
}

const noop = (): void => undefined;
const settingsProps = { setGameType: noop, setTimeControl: noop, setShuffleSeats: noop, setGameOptions: noop, pending: false };

describe('room game picker', () => {
  beforeEach(() => useI18nStore.setState({ locale: 'en' }));

  it('should list the category games with lobby seat counts and mark the current game', () => {
    const tree = RoomGamePicker(pickerProps());
    const list = chips(tree);
    expect(list).toHaveLength(gamesInCategory('cards').length);
    const pressed = list.filter((chip) => chip.props['aria-pressed'] === true);
    expect(pressed).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(RoomGamePicker, pickerProps()));
    expect(html).toContain('Big Two');
    expect(html).toContain('4 players');
    expect(html).toContain('2–8 players');
  });

  it('should offer one tab per lobby category and switch category through the tabs', () => {
    const onCategoryChange = vi.fn();
    const [tabs] = findAll(RoomGamePicker(pickerProps({ onCategoryChange })), (element) => element.type === Tabs);
    expect((tabs.props.tabs as readonly unknown[])).toHaveLength(lobbyCategories().length);
    (tabs.props.onChange as (id: string) => void)('board');
    expect(onCategoryChange).toHaveBeenCalledWith('board');
  });

  it('should send the chosen game when a chip is clicked', () => {
    const onSelect = vi.fn();
    const list = chips(RoomGamePicker(pickerProps({ category: 'board', onSelect })));
    expect(list).toHaveLength(gamesInCategory('board').length);
    (list[0].props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith(gamesInCategory('board')[0]);
  });

  it('should disable every chip for a read-only viewer', () => {
    const list = chips(RoomGamePicker(pickerProps({ disabled: true, title: 'Only the host can change the game.' })));
    expect(list.every((chip) => chip.props.disabled === true)).toBe(true);
  });

  it('should keep chips focusable but inert while a request is pending', () => {
    const onSelect = vi.fn();
    const list = chips(RoomGamePicker(pickerProps({ disabled: true, pending: true, onSelect })));
    expect(list.every((chip) => chip.props.disabled === false && chip.props['aria-disabled'] === true)).toBe(true);
    (list[0].props.onClick as () => void)();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('room settings game picker', () => {
  beforeEach(() => useI18nStore.setState({ locale: 'en' }));

  it('should start on the category of the current game', () => {
    const board = renderToStaticMarkup(createElement(RoomSettings, { ...settingsProps, room: room('gomoku'), editable: true, isHost: true }));
    expect(board).toContain('Gomoku');
    expect(board).not.toContain('Big Two');
    expect(board).toMatch(/aria-selected="true"[^>]*>Board games/);
    expect(board).not.toMatch(/aria-pressed="[a-z]+"[^>]*disabled=""/);
  });

  it('should lock the chips and explain why for a non-host', () => {
    const html = renderToStaticMarkup(createElement(RoomSettings, { ...settingsProps, room: room('bigtwo'), editable: false, isHost: false }));
    expect(html).toContain('title="Only the host can change the game."');
    expect(html).toMatch(/aria-pressed="true"[^>]*disabled=""/);
  });
});
