import { describe, expect, it } from 'vitest';
import {
  RAIL_ITEMS, activeLobbyCategory, currentRailItem, railItemPath, tableRailPath,
} from '../../../client/src/components/desktop-nav';

describe('desktop navigation', () => {
  it('lists the destinations in rail order; the account menu is not a destination', () => {
    expect(RAIL_ITEMS.map((item) => item.id)).toEqual(['lobby', 'friends', 'messages', 'shop', 'achievements', 'history']);
  });

  it.each([
    ['/', 'lobby'],
    ['/friends', 'friends'],
    ['/messages', 'messages'],
    ['/messages/bob', 'messages'],
    ['/shop', 'shop'],
    ['/achievements', 'achievements'],
    ['/players/alice', 'history'],
    ['/account', 'account'],
    ['/players/bob', null],
    ['/players/alice-2', null],
    ['/room/ABC123', 'table'],
    ['/room/ABC123/replay', 'table'],
    ['/game/ABC123', 'table'],
  ] as const)('highlights %s as %s', (pathname, expected) => {
    expect(currentRailItem(pathname, 'alice')).toBe(expected);
  });

  it('links every item to its page and encodes the account id', () => {
    expect(RAIL_ITEMS.map((item) => railItemPath(item.id, 'a b'))).toEqual(
      ['/', '/friends', '/messages', '/shop', '/achievements', '/players/a%20b']);
    expect(currentRailItem('/players/a%20b', 'a b')).toBe('history');
  });

  it('leads the table item back to the running game, otherwise to the waiting room', () => {
    expect(tableRailPath('ABC123', true)).toBe('/game/ABC123');
    expect(tableRailPath('ABC123', false)).toBe('/room/ABC123');
    expect(currentRailItem('/gamesroom', 'alice')).toBeNull();
  });

  it('keeps a stored category that has games and falls back to the default when it has none', () => {
    expect(activeLobbyCategory(null)).toBe('cards');
    expect(activeLobbyCategory('cards')).toBe('cards');
    expect(activeLobbyCategory('dice')).toBe('dice');
    expect(activeLobbyCategory('board')).toBe('cards');
  });
});

