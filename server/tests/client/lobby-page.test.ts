import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountProfile, FriendEntry } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';

const state = vi.hoisted(() => ({
  currentRoomCode: null as string | null,
  phase: null as string | null,
  connection: 'ready',
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: Partial<AccountProfile>; connection: string }) => unknown) => select({
    account: { id: 'alice', username: 'alice', nickname: 'Alice', avatar: 'cat', avatarImage: null, color: '#4a9eff' },
    connection: state.connection,
  }),
  selectConnectionReady: (value: { connection: string }) => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null }) => unknown) =>
    select({ currentRoomCode: state.currentRoomCode }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: string | null }) => unknown) => select({ phase: state.phase }),
}));

import { LobbyPage } from '../../../client/src/pages/LobbyPage';
import { DesktopLobby } from '../../../client/src/pages/DesktopLobby';
import type { DesktopLobbyProps } from '../../../client/src/pages/DesktopLobby';
import { onlineLobbyFriends } from '../../../client/src/components/LobbyFriends';
import { GAME_CARD_ART } from '../../../client/src/game-backgrounds';
import { gamesInCategory, lobbyCategories } from '../../../client/src/games/registry';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function render(): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] },
    createElement(Routes, null, createElement(Route, { path: '/', element: createElement(LobbyPage) }))));
}

describe('lobby page', () => {
  beforeEach(() => {
    state.currentRoomCode = null;
    state.phase = null;
    state.connection = 'ready';
    useI18nStore.getState().setLocale('en');
  });

  it('lists the games of the selected category with one create and join area', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(1);
    expect(html).toContain('>Cards</button>');
    expect(html).not.toContain('>Dice<');
    expect(html).not.toContain('>Board games<');
    expect(html).toContain('id="lobby-games" role="tabpanel"');
    const choices = html.match(/<button[^>]*aria-controls="lobby-selected-game"[^>]*>/g) ?? [];
    expect(choices).toHaveLength(GAME_TYPES.length);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('4 players · Tricks');
    expect(html).toContain('2–8 players · Betting');
    expect(html).toContain('id="lobby-selected-game-title">Bridge</h2>');
    expect(html).toContain('Rules</button>');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('placeholder="Enter room code"');
    expect(html.match(/>Create Room</g)).toHaveLength(1);
    expect(html).not.toMatch(/disabled=""[^>]*>Create Room/);
    expect(html).toContain('Friends online');
    expect(html).toContain('Daily tasks');
    expect(html).toContain('Daily check-in');
  });

  it('shows a tab only for categories that have games', () => {
    expect(lobbyCategories()).toEqual(['cards']);
    expect(gamesInCategory('dice')).toEqual([]);
    for (const gameType of GAME_TYPES) expect(GAME_CARD_ART[gameType]).toBeTruthy();
  });

  it('keeps room actions disabled without duplicating the floating room card with a banner', () => {
    state.currentRoomCode = 'ABC123';
    const waiting = render();
    expect(waiting).not.toContain('href="/room/ABC123"');
    expect(waiting).toContain('Choose a game');
    expect(waiting).toMatch(/disabled=""[^>]*>Create Room/);
    expect(waiting).toMatch(/<input[^>]*disabled=""/);
    expect(waiting).not.toContain('lobby-current-room');
    state.phase = 'playing';
    expect(render()).not.toContain('href="/game/ABC123"');
  });

  it('disables room creation while disconnected but still allows game browsing', () => {
    state.connection = 'connecting';
    const html = render();
    expect(html).toMatch(/disabled=""[^>]*>Create Room/);
    const choices = html.match(/<button[^>]*aria-controls="lobby-selected-game"[^>]*>/g) ?? [];
    expect(choices).toHaveLength(GAME_TYPES.length);
    expect(choices.every((choice) => !choice.includes('disabled'))).toBe(true);
  });

  it('shows online hosts first without mutating the supplied friend list', () => {
    const friend = (id: string, online: boolean, hostedRoomCode: string | null): FriendEntry => ({
      id, username: id, nickname: id, avatar: 'cat', avatarImage: null, color: '#4a9eff',
      online, hostedRoomCode, inRoom: Boolean(hostedRoomCode), lastSeenAt: null,
    });
    const friends = Object.freeze([
      friend('available', true, null), friend('offline', false, 'OLD123'),
      friend('host', true, 'ABC123'), friend('other', true, null),
    ]);
    expect(onlineLobbyFriends(friends).map(({ id }) => id)).toEqual(['host', 'available', 'other']);
    expect(friends.map(({ id }) => id)).toEqual(['available', 'offline', 'host', 'other']);
  });

  describe('desktop layout', () => {
    const noop = (): void => undefined;
    const desktop = (overrides: Partial<DesktopLobbyProps> = {}): string => renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(DesktopLobby, {
        accountId: 'alice', category: 'cards', selectedGame: 'holdem', onSelectGame: noop, onShowRules: noop, error: '',
        inRoom: false, blocked: false, roomLocked: false, pending: null, roomCode: '', onRoomCodeChange: noop,
        onCreate: noop, onJoin: noop,
        friends: { refreshToken: 0, onJoin: noop, activity: { viewerInRoom: false, invited: new Set<string>(), onInvite: noop } },
        ...overrides,
      })));

    it('puts the selected game in a hero with one create, join and rules control, above one card per game', () => {
      const html = desktop();
      expect(html).toContain('id="lobby-selected-game-title">Texas Hold&#x27;em</h2>');
      expect(html).toContain('2–8 players · Betting');
      expect(html.match(/>Create Room</g)).toHaveLength(1);
      expect(html).toContain('placeholder="Enter room code"');
      expect(html).toContain('Rules</button>');
      const cards = html.match(/<button[^>]*aria-controls="lobby-selected-game"[^>]*>/g) ?? [];
      expect(cards).toHaveLength(GAME_TYPES.length);
      expect(cards.filter((card) => card.includes('aria-pressed="true"'))).toHaveLength(1);
      expect(html.indexOf('Create Room')).toBeLessThan(html.indexOf('aria-controls="lobby-selected-game"'));
    });

    it('keeps friends and daily rewards in a social column', () => {
      const html = desktop();
      const social = html.slice(html.indexOf('<aside'));
      expect(social).toContain('Friends online');
      expect(social).toContain('Daily tasks');
      expect(social).toContain('Daily check-in');
    });

    it('locks creating and joining while in a room and shows request errors', () => {
      const html = desktop({ roomLocked: true, inRoom: true, error: 'Room is full.' });
      expect(html).toMatch(/disabled=""[^>]*>Create Room/);
      expect(html).toMatch(/<input[^>]*disabled=""/);
      expect(html).toContain('role="alert">Room is full.');
    });
  });
});
