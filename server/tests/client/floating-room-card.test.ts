import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { GamePhase, PlayerInfo, RoomInfo } from '@shared/types';

const state = vi.hoisted(() => ({
  accountId: 'alice' as string | null, connection: 'ready',
  currentRoomCode: 'ABC123' as string | null, roomInfo: null as RoomInfo | null,
  phase: null as GamePhase | null,
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: { account: { id: string } | null; connection: string }) => unknown) =>
    select({ account: state.accountId ? { id: state.accountId } : null, connection: state.connection }),
}));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { currentRoomCode: string | null; roomInfo: RoomInfo | null }) => unknown) => select(state),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: GamePhase | null }) => unknown) => select(state),
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
import { FloatingRoomCard } from '../../../client/src/components/FloatingRoomCard';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, avatar: 'cat', avatarImage: null, color: '#123456' };
}
function room(): RoomInfo {
  return { code: 'ABC123', gameType: 'bridge', status: 'waiting', hostId: 'alice', createdAt: 0,
    abortVote: null, abortVoteCooldownUntil: null, seats: {
      N: { player: player('alice'), isReady: true }, E: { player: player('bob'), isReady: false },
      S: { player: null, isReady: false }, W: { player: null, isReady: false },
    } };
}
function render(path = '/account'): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(FloatingRoomCard)));
}

describe('floating room card', () => {
  beforeEach(() => {
    state.accountId = 'alice'; state.connection = 'ready'; state.currentRoomCode = 'ABC123';
    state.roomInfo = room(); state.phase = null;
    useI18nStore.getState().setLocale('en');
  });

  it.each(['/', '/account', '/friends', '/messages', '/messages/bob', '/shop', '/achievements', '/players/bob'])(
    'shows the current room on %s with a single return link', (path) => {
      const html = render(path);
      expect(html).toContain('href="/room/ABC123"');
      expect(html).toContain('Return to Bridge, room ABC123');
      expect(html).toContain('Waiting for players');
      expect(html).toContain('1/2 ready');
      expect(html).toContain('2/4');
      expect(html.match(/<li /g)).toHaveLength(2);
      expect(html.match(/<a /g)).toHaveLength(1);
    },
  );
  it.each(['/room/ABC123', '/game/ABC123', '/room/OTHER1', '/login', '/register'])(
    'hides on %s', (path) => expect(render(path)).toBe(''),
  );
  it('hides after leaving, signing out, and while room identity is incomplete', () => {
    state.currentRoomCode = null;
    expect(render()).toBe('');
    state.currentRoomCode = 'ABC123'; state.roomInfo = null;
    expect(render()).toBe('');
    state.roomInfo = { ...room(), code: 'OTHER1' };
    expect(render()).toBe('');
    state.roomInfo = room(); state.accountId = null;
    expect(render()).toBe('');
  });
  it('reflects a new snapshot, all eight seated players, spectators and host-start readiness', () => {
    const initial = room();
    state.roomInfo = { ...initial, gameType: 'holdem', seats: {
      N: initial.seats.N, E: { ...initial.seats.E, isReady: true },
      S: { player: player('carol'), isReady: true }, W: { player: player('dave'), isReady: true },
    }, additionalSeats: ['eve', 'frank', 'grace', 'henry'].map((id) => ({ player: player(id), isReady: true })),
    spectators: [player('spectator')] };
    const html = render();
    expect(html.match(/<li /g)).toHaveLength(8);
    expect(html).toContain('henry');
    expect(html).toContain('8/8 ready');
    expect(html).toContain('Waiting for the host to start');
    expect(html).toContain('1 watching');
    expect(html).not.toContain('>spectator<');
    state.roomInfo = room();
    expect(render()).not.toContain('henry');
  });
  it('returns to the game during play and results, with reconnect status overriding stale activity', () => {
    state.roomInfo = { ...room(), status: 'playing' };
    expect(render()).toContain('href="/game/ABC123"');
    expect(render()).toContain('Game in progress');
    state.phase = 'scoring'; state.roomInfo = room();
    expect(render()).toContain('href="/game/ABC123"');
    expect(render()).toContain('Game finished');
    state.connection = 'connecting';
    expect(render()).toContain('Reconnecting');
    expect(render()).not.toContain('Game finished');
    state.connection = 'ready'; state.phase = null;
    expect(render()).toContain('href="/room/ABC123"');
  });
  it.each(['en', 'zh-TW'] as const)('localizes every game variant in %s', (locale) => {
    useI18nStore.getState().setLocale(locale);
    for (const gameType of GAME_TYPES) {
      state.roomInfo = { ...room(), gameType };
      expect(render()).not.toMatch(/roomCard\.|gameType\./);
    }
  });
});
