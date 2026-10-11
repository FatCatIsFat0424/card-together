import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { MatchSummary, PlayerInfo, RoomInfo, Seat } from '@shared/types';

const state = vi.hoisted(() => ({
  room: null as RoomInfo | null,
  playerId: 'alice',
  mySeat: 'N' as Seat | null,
  connection: 'ready' as 'connecting' | 'ready' | 'error',
}));

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../client/src/components/InviteFriends', () => ({ InviteFriends: () => null }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: RoomInfo | null; mySeat: Seat | null }) => unknown) =>
    select({ roomInfo: state.room, mySeat: state.mySeat }),
}));
vi.mock('../../../client/src/stores/player-store', () => ({
  usePlayerStore: (select: (value: { playerId: string }) => unknown) => select({ playerId: state.playerId }),
}));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (value: {
    account: { id: string; tableBackground: null }; connection: typeof state.connection;
  }) => unknown) => select({ account: { id: state.playerId, tableBackground: null }, connection: state.connection }),
  selectConnectionReady: (value: { connection: string }): boolean => value.connection === 'ready',
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: { phase: null }) => unknown) => select({ phase: null }),
}));

import { PlayerLink } from '../../../client/src/components/PlayerLink';
import { MatchHistoryList } from '../../../client/src/components/MatchHistoryList';
import { RoomPage } from '../../../client/src/pages/RoomPage';
import { AbortVoteBanner } from '../../../client/src/games/AbortVote';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const human: PlayerInfo = {
  id: 'alice', username: 'alice', nickname: 'Alice', color: '#4a9eff', avatar: 'cat', avatarImage: null,
};
const bot: PlayerInfo = { ...human, id: 'bot:synthetic', username: '', nickname: 'Bot East', isBot: true };

function room(): RoomInfo {
  return {
    code: 'ABC123', gameType: 'bigtwo', status: 'waiting', createdAt: 123, hostId: human.id,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: human, isReady: false }, E: { player: bot, isReady: true },
      S: { player: null, isReady: false }, W: { player: null, isReady: false },
    },
  };
}

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/room/ABC123'] },
    createElement(Routes, null, createElement(Route, { path: '/room/:roomCode', element }))));
}

describe('bot player interface', () => {
  beforeEach(() => {
    state.room = room();
    state.playerId = human.id;
    state.mySeat = 'N';
    state.connection = 'ready';
    useI18nStore.getState().setLocale('en');
  });

  it('identifies bots without creating profile links or account usernames', () => {
    const html = render(createElement(PlayerLink, { player: bot, showUsername: true }));
    expect(html).toContain('Bot East');
    expect(html).toContain('Bot</span>');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('/players/');
    expect(html).not.toContain('@');
    expect(render(createElement(PlayerLink, { player: human }))).toContain('href="/players/alice"');
  });

  it('offers only the host add, remove, and fill controls while preserving seat selection', () => {
    const hostHtml = render(createElement(RoomPage));
    expect(hostHtml.match(/>Add bot</g)).toHaveLength(2);
    expect(hostHtml).toContain('Remove bot');
    expect(hostHtml).toContain('Fill empty seats with bots');
    expect(hostHtml.match(/>Empty</g)).toHaveLength(2);
    expect(hostHtml).toContain('Bot is automatically ready');
    expect(hostHtml).not.toContain('/players/bot');

    state.playerId = 'visitor';
    const visitorHtml = render(createElement(RoomPage));
    expect(visitorHtml).not.toContain('Add bot');
    expect(visitorHtml).not.toContain('Remove bot');
    expect(visitorHtml).not.toContain('Fill empty seats with bots');
    expect(visitorHtml.match(/>Empty</g)).toHaveLength(2);
  });

  it('keeps rules access available to hosts, guests, and disconnected spectators', () => {
    for (const gameType of GAME_TYPES) {
      state.room = { ...room(), gameType };
      for (const playerId of ['alice', 'visitor']) {
        state.playerId = playerId;
        state.mySeat = null;
        state.connection = 'connecting';
        const trigger = render(createElement(RoomPage)).match(/<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?Game rules<\/button>/)?.[0];
        expect(trigger).toBeDefined();
        expect(trigger).not.toContain('disabled');
      }
    }
  });

  it('disables room actions until the connection is ready', () => {
    state.room = { ...room(), seats: { ...room().seats,
      S: { player: { ...bot, id: 'bot:south' }, isReady: true },
      W: { player: { ...bot, id: 'bot:west' }, isReady: true },
    } };
    expect(render(createElement(RoomPage))).not.toMatch(/disabled="">Ready<\/button>/);
    state.connection = 'connecting';
    const html = render(createElement(RoomPage));
    expect(html).toMatch(/disabled="">Ready<\/button>/);
    expect(html).toMatch(/disabled="">Fill empty seats with bots<\/button>/);
    expect(html).toMatch(/disabled="">Leave Room<\/button>/);
  });

  it('exposes placement handles only for humans managed by a connected waiting-room host', () => {
    state.room = { ...room(), spectators: [{ ...human, id: 'spectator', nickname: 'Visitor' }] };
    const html = render(createElement(RoomPage));
    expect(html).toContain('aria-label="Move Alice"');
    expect(html).toContain('aria-label="Move Visitor"');
    expect(html).not.toContain('aria-label="Move Bot East"');
    expect(html).toContain('data-room-drop="spectator"');
    state.playerId = 'visitor';
    expect(render(createElement(RoomPage))).not.toContain('data-seat-drag-handle');
    state.playerId = human.id;
    state.connection = 'connecting';
    expect(render(createElement(RoomPage))).not.toContain('data-seat-drag-handle');
    state.connection = 'ready';
    state.room = { ...state.room!, status: 'playing' };
    expect(render(createElement(RoomPage))).not.toContain('data-seat-drag-handle');
  });

  it('keeps Ready clickable without permanent player-count notices', () => {
    expect(render(createElement(RoomPage))).not.toMatch(/disabled="">Ready<\/button>/);
    state.room = { ...room(), gameType: 'holdem', additionalSeats: [{ player: null, isReady: false }] };
    const html = render(createElement(RoomPage));
    expect(html).toContain('Seat 5');
    expect(html).not.toMatch(/disabled="">Ready<\/button>/);
    expect(html).not.toContain('Only four-player matches are currently supported');
    expect(html).not.toMatch(/\d\/\d seated/);
    expect(html).not.toMatch(/\d\/\d ready/);
    state.mySeat = null;
    expect(render(createElement(RoomPage))).not.toMatch(/disabled="">Ready<\/button>/);
  });

  it('shows the seat expansion control only to hosts of Ninety-Nine, Blackjack, and Hold\'em', () => {
    for (const gameType of GAME_TYPES) {
      state.room = { ...room(), gameType };
      const expandable = gameType === 'ninetynine' || gameType === 'blackjack' || gameType === 'holdem';
      const html = render(createElement(RoomPage));
      expect(html.includes('aria-label="Add seat"')).toBe(expandable);
      expect(html.includes('expandedSeats')).toBe(expandable);
    }
    state.room = { ...room(), gameType: 'holdem', hostId: 'another-player' };
    expect(render(createElement(RoomPage))).not.toContain('aria-label="Add seat"');
  });

  it('disables filling when every seat is occupied', () => {
    state.room = {
      ...room(), seats: { ...room().seats, S: { player: bot, isReady: true }, W: { player: bot, isReady: true } },
    };
    expect(render(createElement(RoomPage))).toMatch(/disabled="">Fill empty seats with bots<\/button>/);
  });

  it('offers the eighth seat and hides the add control at eight seats', () => {
    state.room = { ...room(), gameType: 'holdem',
      additionalSeats: Array.from({ length: 3 }, () => ({ player: null, isReady: false })),
    };
    const addButton = (): string | undefined => render(createElement(RoomPage))
      .match(/<button[^>]*aria-label="Add seat"[^>]*>/)?.[0];
    expect(addButton()).toBeDefined();
    expect(addButton()).not.toContain('disabled');
    state.room = { ...state.room, additionalSeats: [
      ...state.room.additionalSeats!, { player: null, isReady: false },
    ] };
    expect(addButton()).toBeUndefined();
  });

  it('keeps bot participants and bot winners visible in match history without profile links', () => {
    const match: MatchSummary = {
      id: 'match', roomCode: 'ABC123', accountIds: [human.id, bot.id, 'bot:south', 'bot:west'], finishedAt: 123,
      result: {
        gameType: 'bigtwo', winnerSeat: 'E', dragon: false,
        cardsLeft: { N: 1, E: 0, S: 1, W: 1 }, twosLeft: { N: 0, E: 0, S: 0, W: 0 },
        scores: { N: 1, E: 0, S: 1, W: 1 },
      },
    };
    const html = render(createElement(MatchHistoryList, { matches: [match], players: { [human.id]: human } }));
    expect(html.match(/Bot \(East\)/g)).toHaveLength(2);
    expect(html).toContain('Bot (South)');
    expect(html).toContain('Bot (West)');
    expect(html).toContain('href="/players/alice"');
    expect(html).not.toContain('/players/bot');
  });

  it('displays the abort threshold using seated humans rather than bots', () => {
    state.room = {
      ...room(), status: 'playing',
      seats: { ...room().seats, S: { player: { ...human, id: 'bob' }, isReady: true } },
      abortVote: { startedBy: human.id, startedAt: Date.now(), expiresAt: Date.now() + 60000, yes: [human.id], no: [] },
    };
    const html = render(createElement(AbortVoteBanner));
    expect(html).toContain('Ends when 2 players agree; bots do not vote');
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-live');
  });

  it('renders the bot controls and labels in Traditional Chinese', () => {
    useI18nStore.getState().setLocale('zh-TW');
    const html = render(createElement(RoomPage));
    expect(html).toContain('加入 bot');
    expect(html).toContain('移除 bot');
    expect(html).toContain('用 bot 補滿空位');
    expect(html).toContain('bot 已自動準備');
  });
});
