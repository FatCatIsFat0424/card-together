import { createElement } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { Card, GameType, PlayerInfo, PlayerVisibleGameState, RoomInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as blackjack from '../../src/managers/games/blackjack-game';

vi.mock('../../../client/src/socket', () => ({ socket: {}, disconnectSocket: () => undefined }));
vi.mock('../../../client/src/deployment', () => ({ APP_BASE_PATH: '/', SERVER_URL: '', SOCKET_PATH: '/socket.io' }));
vi.mock('../../../client/src/components/ChatPanel', () => ({ ChatPanel: () => null }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));
vi.mock('../../../client/src/games/bridge/use-trick-presentation', () => ({ useTrickPresentation: () => null }));
vi.mock('../../../client/src/stores/game-store', async (original) => {
  const module = await original<typeof import('../../../client/src/stores/game-store')>();
  const store = module.useGameStore;
  return { ...module, useGameStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) =>
    select(store.getState()), store) };
});
vi.mock('../../../client/src/stores/room-store', async (original) => {
  const module = await original<typeof import('../../../client/src/stores/room-store')>();
  const store = module.useRoomStore;
  return { ...module, useRoomStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) =>
    select(store.getState()), store) };
});
vi.mock('../../../client/src/stores/god-view-store', async (original) => {
  const module = await original<typeof import('../../../client/src/stores/god-view-store')>();
  const store = module.useGodViewStore;
  return { ...module, useGodViewStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) =>
    select(store.getState()), store) };
});
vi.mock('../../../client/src/stores/table-perspective-store', async (original) => {
  const module = await original<typeof import('../../../client/src/stores/table-perspective-store')>();
  const store = module.useTablePerspectiveStore;
  return { ...module, useTablePerspectiveStore: Object.assign((select: (state: ReturnType<typeof store.getState>) => unknown) =>
    select(store.getState()), store) };
});

import { GamePage } from '../../../client/src/pages/GamePage';
import { isOwnTurn } from '../../../client/src/games/observer-view';
import { perspectiveSeat, spectatorGame } from '../../../client/src/games/table-perspective';
import { HIDDEN_GOD_VIEW, nextGodView, useGodViewStore } from '../../../client/src/stores/god-view-store';
import { useGameStore } from '../../../client/src/stores/game-store';
import { useRoomStore } from '../../../client/src/stores/room-store';
import { useI18nStore } from '../../../client/src/stores/i18n-store';
import { useTablePerspectiveStore } from '../../../client/src/stores/table-perspective-store';
import { blackjackActions, blackjackNeedsBet } from '../../../client/src/games/blackjack/blackjack-view';
import { holdemControls } from '../../../client/src/games/holdem/holdem-view';
import { napoleonOwnTurn } from '../../../client/src/games/napoleon/napoleon-view';

const code = 'VIEW01';
const seats: readonly Seat[] = ['N', 'E', 'S', 'W'];
const player = (seat: Seat): PlayerInfo => ({
  id: `viewer-${seat}`, username: `viewer${seat}`, nickname: `Player ${seat}`, color: '#4a9eff',
  avatar: 'cat', avatarImage: null,
});
const players = { N: player('N'), E: player('E'), S: player('S'), W: player('W') };

function snapshot(type: GameType, seat: Seat | null = null): PlayerVisibleGameState {
  expect(games.startGame(code, type, players)).toEqual({ success: true });
  const current = games.getGameState(code)!;
  delete current.presentation;
  return games.getRecipientVisibleState(code, seat)!;
}

async function render(game: PlayerVisibleGameState, locked = false): Promise<string> {
  const room: RoomInfo = {
    code, gameType: game.gameType, status: 'playing', hostId: players.N.id, createdAt: 1,
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: players.N, isReady: true }, E: { player: players.E, isReady: true },
      S: { player: players.S, isReady: true }, W: { player: players.W, isReady: true },
    },
  };
  useRoomStore.getState().setRoom(code, room);
  useGameStore.getState().restore(game);
  useGodViewStore.getState().update(game, locked);
  const stream = await renderToReadableStream(createElement(MemoryRouter, null, createElement(GamePage)));
  await stream.allReady;
  return new Response(stream).text();
}

describe('spectator table perspective', () => {
  // Module transforms belong to fixture setup, not a timed game-state assertion.
  beforeAll(async () => {
    await Promise.all([
      import('../../../client/src/games/bridge/BridgeTable'),
      import('../../../client/src/games/bigtwo/BigTwoTable'),
      import('../../../client/src/games/redpoints/RedPointsTable'),
      import('../../../client/src/games/ninetynine/NinetyNineTable'),
      import('../../../client/src/games/sevens/SevensTable'),
      import('../../../client/src/games/chinesepoker/ChinesePokerTable'),
      import('../../../client/src/games/liarsdeck/LiarsDeckTable'),
      import('../../../client/src/games/blackjack/BlackjackTable'),
      import('../../../client/src/games/holdem/HoldemTable'),
      import('../../../client/src/games/napoleon/NapoleonTable'),
    ]);
  }, 60_000);
  beforeEach(() => {
    useI18nStore.getState().setLocale('en');
    useRoomStore.getState().setMySeat(null);
    useTablePerspectiveStore.getState().reset();
  });

  afterEach(() => {
    games.removeGame(code);
    useGameStore.getState().reset();
    useGodViewStore.getState().update(null, false);
    useRoomStore.getState().leaveRoom();
    useTablePerspectiveStore.getState().reset();
  });

  it.each(GAME_TYPES)('rotates %s plates and the selected hand without granting a turn', async (type) => {
    const game = snapshot(type);
    const original = structuredClone(game);
    const view = nextGodView(HIDDEN_GOD_VIEW, game, false);
    for (const seat of seats) {
      useTablePerspectiveStore.getState().selectSeat(seat);
      const html = await render(game);
      const bottom = html.split('data-table-seat="bottom"')[1]?.split('data-hand-zone')[0];
      expect(bottom).toContain(`Player ${seat}`);
      expect(html).toContain(`aria-label="View Player ${seat} at the bottom"`);
      expect(html).not.toContain('/players/viewer-');
      expect(html).not.toMatch(/<p[^>]*>Your turn!<\/p>/);
      expect(useRoomStore.getState().mySeat).toBeNull();
      const projected = spectatorGame(game, seat, view);
      expect(projected.observer).toBe('spectator');
      if (projected.gameType === 'blackjack') {
        expect(blackjackNeedsBet(projected)).toBe(false);
        expect(blackjackActions(projected, true)).toEqual([]);
      } else if (projected.gameType === 'holdem') {
        expect(holdemControls(projected, true)).toBeNull();
      } else if (projected.gameType === 'napoleon') {
        expect(napoleonOwnTurn(projected)).toBe(false);
      } else if (projected.gameType !== 'bridge' && projected.gameType !== 'chinesepoker') {
        expect(isOwnTurn(projected)).toBe(false);
      }
      if (game.gameType !== 'blackjack' && projected.gameType !== 'blackjack') {
        expect(projected.myHand).toEqual(game.observedHands?.[seat] ?? []);
      }
    }
    expect(game).toEqual(original);
  });

  it('keeps the previous selected hand and covered cards while a presentation plays', () => {
    const game = snapshot('sevens');
    if (game.gameType !== 'sevens') throw new Error('Expected Sevens');
    const hand: Card[] = [{ suit: 'hearts', rank: 8 }];
    const covered: Card[] = [{ suit: 'clubs', rank: 4 }];
    const first = { ...game, observedHands: { ...game.observedHands!, N: hand },
      observedCovered: { ...game.observedCovered!, N: covered } };
    const frozen = nextGodView(HIDDEN_GOD_VIEW, first, false);
    const later = { ...first, observedHands: { ...first.observedHands, N: [] },
      observedCovered: { ...first.observedCovered, N: [...covered, ...hand] } };
    const projected = spectatorGame(later, 'N', nextGodView(frozen, later, true));
    expect(projected.myHand).toEqual(hand);
    expect(projected.myCovered).toEqual(covered);
    expect(spectatorGame(later, 'N', nextGodView(frozen, later, false)).myHand).toEqual([]);
  });

  it('does not project a seated or eliminated player onto another seat', () => {
    const game = snapshot('ninetynine', 'E');
    expect(spectatorGame(game, 'N', HIDDEN_GOD_VIEW)).toBe(game);
    expect(perspectiveSeat(game, 'N', 'E')).toBe('E');
    const eliminated = { ...game, observer: 'eliminated' as const };
    expect(spectatorGame(eliminated, 'N', HIDDEN_GOD_VIEW)).toBe(eliminated);
    expect(perspectiveSeat(eliminated, 'N', 'E')).toBe('E');
  });

  it('uses an occupied match seat when the preferred perspective is absent', () => {
    const game = snapshot('holdem');
    if (game.gameType !== 'holdem') throw new Error('Expected Hold\'em');
    expect(perspectiveSeat({ ...game, seats: ['N', 'E'] }, 'S', null)).toBe('N');
  });

  it('keeps submitted Chinese Poker hands visible without copying another seat arrangement', async () => {
    const game = snapshot('chinesepoker');
    if (game.gameType !== 'chinesepoker') throw new Error('Expected Chinese Poker');
    const next = { ...game, submitted: { ...game.submitted, N: true } };
    useTablePerspectiveStore.getState().selectSeat('N');
    const html = await render(next);
    expect(html.split('data-hand-zone')[1]).toContain('aria-label="Your hand, 13 cards"');
    expect(spectatorGame(next, 'N', nextGodView(HIDDEN_GOD_VIEW, next, false)).myArrangement).toBeNull();
  });

  it('does not transfer Liar\'s Deck private played cards to another perspective', () => {
    const game = snapshot('liarsdeck');
    if (game.gameType !== 'liarsdeck') throw new Error('Expected Liar\'s Deck');
    const next = { ...game, myPlayed: [{ id: 1, face: 'K' as const }] };
    expect(spectatorGame(next, 'N', nextGodView(HIDDEN_GOD_VIEW, next, false)).myPlayed).toEqual([]);
  });

  it('enlarges a player dealer hand without offering dealer actions to spectators', async () => {
    blackjack.startGame(code, players, 10_000, Date.now(), { playerDealer: true }, () => 0);
    const game = blackjack.getGameState(code)!;
    for (const seat of blackjack.pendingBetSeats(game)) {
      expect(blackjack.bet(code, seat, 10, false, Date.now(), () => 0)).toEqual({ success: true });
    }
    const visible = games.getRecipientVisibleState(code, null)!;
    if (visible.gameType !== 'blackjack') throw new Error('Expected Blackjack');
    expect(visible.phase).toBe('playing');
    useTablePerspectiveStore.getState().selectSeat(visible.dealerSeat!);
    const handZone = (await render(visible)).split('data-hand-zone')[1]?.split('</main>')[0];
    expect(handZone).toContain(`Dealer · Player ${visible.dealerSeat}`);
    expect(handZone?.match(/<img [^>]*src="[^"]*\/cards\//g)).toHaveLength(2);
    expect(handZone).not.toMatch(/<button/);
  });

  it('shows the selected frozen Hold\'em hand rather than the original seat previous hand', async () => {
    const game = snapshot('holdem');
    if (game.gameType !== 'holdem') throw new Error('Expected Hold\'em');
    const opening = game.log[0];
    if (opening.type !== 'hand') throw new Error('Expected opening hand');
    const previous = { ...game, myHand: [{ suit: 'clubs' as const, rank: 2 as const }],
      observedHands: { ...game.observedHands!, N: [{ suit: 'hearts' as const, rank: 13 as const }] } };
    useGameStore.getState().restore(previous);
    useGodViewStore.getState().update(previous, false);
    const later = { ...previous, hand: game.hand + 1,
      myHand: [{ suit: 'clubs' as const, rank: 3 as const }],
      observedHands: { ...previous.observedHands, N: [{ suit: 'spades' as const, rank: 14 as const }] },
      log: [...game.log, { ...opening, hand: game.hand + 1 }],
      presentation: { id: 'pending-next-hand', startedAt: Date.now(), logStart: 0, timingVersion: 2 as const },
    };
    useTablePerspectiveStore.getState().selectSeat('N');
    const handZone = (await render(later, true)).split('data-hand-zone')[1];
    expect(handZone).toContain('alt="♥K"');
    expect(handZone).not.toContain('alt="♣2"');
    expect(handZone).not.toContain('alt="♠A"');
  });
});
