import { describe, expect, it } from 'vitest';
import {
  RAIL_ITEMS, activeLobbyCategory, currentRailItem, isTableRoute, railItemPath, tableRailPath,
} from '../../../client/src/components/desktop-nav';
import { friendAction, friendActivity } from '../../../client/src/components/lobby-friend-activity';

describe('desktop navigation', () => {
  it('lists the destinations in rail order with the account entry last', () => {
    expect(RAIL_ITEMS.map((item) => item.id)).toEqual(['lobby', 'friends', 'messages', 'shop', 'achievements', 'history', 'me']);
    expect(RAIL_ITEMS.filter((item) => item.bottom).map((item) => item.id)).toEqual(['me']);
  });

  it.each([
    ['/', 'lobby'],
    ['/friends', 'friends'],
    ['/messages', 'messages'],
    ['/messages/bob', 'messages'],
    ['/shop', 'shop'],
    ['/achievements', 'achievements'],
    ['/players/alice', 'history'],
    ['/account', 'me'],
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
      ['/', '/friends', '/messages', '/shop', '/achievements', '/players/a%20b', '/account']);
    expect(currentRailItem('/players/a%20b', 'a b')).toBe('history');
  });

  it('drops the top bar on table routes only', () => {
    expect(isTableRoute('/game/ABC123')).toBe(true);
    expect(isTableRoute('/room/ABC123/replay')).toBe(true);
    expect(isTableRoute('/room/ABC123')).toBe(false);
    expect(isTableRoute('/games')).toBe(false);
    expect(isTableRoute('/')).toBe(false);
  });

  it('leads the table item back to the running game, otherwise to the waiting room', () => {
    expect(tableRailPath('ABC123', true)).toBe('/game/ABC123');
    expect(tableRailPath('ABC123', false)).toBe('/room/ABC123');
    expect(currentRailItem('/gamesroom', 'alice')).toBeNull();
  });

  it('falls back to the default game category when the stored one has no games', () => {
    expect(activeLobbyCategory(null)).toBe('cards');
    expect(activeLobbyCategory('cards')).toBe('cards');
    expect(activeLobbyCategory('dice')).toBe('cards');
    expect(activeLobbyCategory('board')).toBe('cards');
  });
});

describe('lobby friend activity', () => {
  const presence = (online: boolean, inRoom: boolean, hostedRoomCode: string | null) => ({ online, inRoom, hostedRoomCode });

  it('reports hosting, room and lobby activity of online friends only', () => {
    expect(friendActivity(presence(true, true, 'ABC123'))).toEqual({ kind: 'hosting', code: 'ABC123' });
    expect(friendActivity(presence(true, true, null))).toEqual({ kind: 'room' });
    expect(friendActivity(presence(true, false, null))).toEqual({ kind: 'lobby' });
    expect(friendActivity(presence(false, false, null))).toBeNull();
  });

  it('offers joining a hosted room and inviting friends who are free, never both', () => {
    expect(friendAction(presence(true, true, 'ABC123'), false)).toBe('join');
    expect(friendAction(presence(true, true, 'ABC123'), true)).toBe('join');
    expect(friendAction(presence(true, false, null), true)).toBe('invite');
    expect(friendAction(presence(true, false, null), false)).toBeNull();
    expect(friendAction(presence(true, true, null), true)).toBeNull();
    expect(friendAction(presence(false, false, null), true)).toBeNull();
  });
});
