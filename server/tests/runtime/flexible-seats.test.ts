import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { heLegalActions } from '@shared/rules/holdem';
import type { BlackjackGameState, BlackjackMatchResult, Card, HoldemGameState, PlayerInfo, Seat } from '@shared/types';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord } from '../../src/database/repository';
import { createDeck } from '../../src/engine/deck';
import * as blackjack from '../../src/managers/games/blackjack-game';
import * as holdem from '../../src/managers/games/holdem-game';
import * as gameManager from '../../src/managers/game-manager';
import * as playerManager from '../../src/managers/player-manager';
import * as roomManager from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'FLEX01';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename) };
});

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function seated(seats: readonly Seat[]): Partial<Record<Seat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat.toLowerCase())]));
}

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/** Fisher-Yates draws that put `top` first, in order. */
function shuffleDraws(top: readonly Card[]): number[] {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return draws;
}

/** The first draw picks the button among the seats taking part; each hand then deals `decks[n]`. */
function rigged(seats: readonly Seat[], button: Seat, decks: readonly (readonly Card[])[]): () => number {
  const draws = [(seats.indexOf(button) + 0.5) / seats.length, ...decks.flatMap(shuffleDraws)];
  let index = 0;
  return () => draws[index++] ?? 0.5;
}

function holdemGame(): HoldemGameState {
  const state = holdem.getGameState(CODE);
  if (!state) throw new Error("Expected a Hold'em game");
  return state;
}

function blackjackGame(): BlackjackGameState {
  const state = blackjack.getGameState(CODE);
  if (!state) throw new Error('Expected a Blackjack game');
  return state;
}

/** A playing room seating `seats` with its running game, as the runtime would persist them. */
function snapshot(seats: readonly Seat[], gameType: 'blackjack' | 'holdem'): RuntimeSnapshot {
  const players = seated(seats);
  const ids = seats.map((seat) => players[seat]!.id);
  return {
    players: seats.map((seat) => ({ info: players[seat]!, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType, status: 'playing', createdAt: 1, hostId: ids[0], abortVote: null,
        abortVoteCooldownUntil: null,
        seats: {
          N: { player: players.N ?? null, isReady: Boolean(players.N) },
          E: { player: players.E ?? null, isReady: Boolean(players.E) },
          S: { player: players.S ?? null, isReady: Boolean(players.S) },
          W: { player: players.W ?? null, isReady: Boolean(players.W) },
        },
      },
      memberIds: ids,
    }],
    games: structuredClone(gameType === 'blackjack' ? blackjack.exportGames() : holdem.exportGames()),
    chat: [{ roomCode: CODE, messages: [] }],
  };
}

describe('two to four seat tables', () => {
  beforeEach(() => {
    roomManager.restoreRooms([]);
    gameManager.restoreGames([]);
  });

  it('should block two- and three-player room starts for every mode during the four-player rollout', () => {
    const code = roomManager.createRoom('blackjack', 'host');
    roomManager.joinRoom(code, 'guest');
    roomManager.joinRoom(code, 'third');
    roomManager.changeSeat(code, player('host'), 'N');
    roomManager.setReady(code, 'host', true);
    expect(roomManager.isAllReady(code)).toBe(false);
    roomManager.changeSeat(code, player('guest'), 'S');
    roomManager.setReady(code, 'guest', true);
    // The guest sitting down asked the host to confirm the new table.
    expect(roomManager.isAllReady(code)).toBe(false);
    roomManager.setReady(code, 'host', true);
    expect(roomManager.isAllReady(code)).toBe(false);
    expect(Object.keys(roomManager.getSeatPlayers(code)!)).toEqual(['N', 'S']);

    roomManager.changeSeat(code, player('third'), 'E');
    expect(roomManager.getRoomInfo(code)!.seats.N.isReady).toBe(false);
    for (const id of ['host', 'guest', 'third']) roomManager.setReady(code, id, true);
    expect(roomManager.isAllReady(code)).toBe(false);
    expect(roomManager.setGameType(code, 'host', 'holdem').success).toBe(true);
    for (const id of ['host', 'guest', 'third']) roomManager.setReady(code, id, true);
    expect(roomManager.isAllReady(code)).toBe(false);

    expect(roomManager.setGameType(code, 'host', 'bridge').success).toBe(true);
    for (const id of ['host', 'guest', 'third']) roomManager.setReady(code, id, true);
    expect(roomManager.isAllReady(code)).toBe(false);
    expect(gameManager.startGame(code, 'bridge', roomManager.getSeatPlayers(code)!)).toEqual(
      { success: false, reason: 'Not enough players to start this game.' });
    expect(gameManager.startGame(code, 'holdem', seated(['N']))).toMatchObject({ success: false });
    expect(gameManager.hasActiveGame(code)).toBe(false);
  });

  it('should ask for readiness again when a flexible-seat table changes, but not for four-seat games', () => {
    const code = roomManager.createRoom('holdem', 'host');
    roomManager.joinRoom(code, 'guest');
    roomManager.changeSeat(code, player('host'), 'N');
    roomManager.setReady(code, 'host', true);
    expect(roomManager.addBot(code, 'host', 'E').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.seats.N.isReady).toBe(false);
    expect(roomManager.isAllReady(code)).toBe(false);
    roomManager.changeSeat(code, player('guest'), 'S');
    roomManager.setReady(code, 'host', true);
    roomManager.setReady(code, 'guest', true);
    expect(roomManager.standUp(code, 'guest').success).toBe(true);
    // Host and bot remain, but the host readied for a three-seat table.
    expect(roomManager.isAllReady(code)).toBe(false);
    roomManager.setReady(code, 'host', true);
    expect(roomManager.removeBot(code, 'host', 'E').success).toBe(true);
    expect(roomManager.getRoomInfo(code)!.seats.N.isReady).toBe(false);

    const bridge = roomManager.createRoom('bridge', 'solo');
    roomManager.joinRoom(bridge, 'other');
    roomManager.changeSeat(bridge, player('solo'), 'N');
    roomManager.setReady(bridge, 'solo', true);
    roomManager.changeSeat(bridge, player('other'), 'E');
    expect(roomManager.getRoomInfo(bridge)!.seats.N.isReady).toBe(true);
  });

  it('should leave an empty Hold\'em seat out of the deal, button, blinds, and turn order', () => {
    const seats: Seat[] = ['N', 'E', 'W'];
    holdem.startGame(CODE, seated(seats), rigged(seats, 'W', [[card(2), card(3), card(4), card(5), card(6), card(7)],
      []]), 0);
    let state = holdemGame();
    // Button W, so N and E post the blinds and W opens preflop.
    expect(state).toMatchObject({ button: 'W', dealt: ['N', 'E', 'W'], currentTurnSeat: 'W',
      chips: { N: 990, E: 980, S: 0, W: 1000 }, streetBets: { N: 10, E: 20, S: 0, W: 0 } });
    expect(state.hands.S).toEqual([]);
    expect(holdem.getPlayerVisibleState(CODE, 'N')!.seats).toEqual(seats);
    expect(holdem.act(CODE, 'S', { type: 'fold' }).success).toBe(false);
    expect(holdem.act(CODE, 'W', { type: 'call' }).success).toBe(true);
    expect(holdemGame().currentTurnSeat).toBe('N');
    expect(holdem.act(CODE, 'N', { type: 'fold' }).success).toBe(true);
    expect(holdem.act(CODE, 'E', { type: 'raise', to: 100 }).success).toBe(true);
    expect(holdemGame().currentTurnSeat).toBe('W');
    expect(holdem.act(CODE, 'W', { type: 'fold' }).success).toBe(true);
    state = holdemGame();
    // The button skips the empty seat: W → N, with E and W in the blinds.
    expect(state).toMatchObject({ hand: 2, button: 'N', dealt: ['N', 'E', 'W'], currentTurnSeat: 'N',
      streetBets: { N: 0, E: 10, S: 0, W: 20 } });
    expect(state.chips.S).toBe(0);
    expect(state.eliminated).toEqual([]);
  });

  it('should play a heads-up Hold\'em table to a result listing only the seats that took part', () => {
    const seats: Seat[] = ['E', 'W'];
    holdem.startGame(CODE, seated(seats), rigged(seats, 'E', [
      [card(14), card(2), card(14, 'hearts'), card(7, 'clubs'), card(13), card(9, 'diamonds'), card(5, 'clubs'),
        card(4, 'hearts'), card(3, 'diamonds')],
    ]), 0);
    let state = holdemGame();
    // Heads-up the button posts the small blind and acts first preflop.
    expect(state).toMatchObject({ button: 'E', currentTurnSeat: 'E', streetBets: { N: 0, E: 10, S: 0, W: 20 } });
    expect(holdem.act(CODE, 'E', { type: 'raise', to: 1000 }).success).toBe(true);
    expect(holdem.act(CODE, 'W', { type: 'call' }).success).toBe(true);
    state = holdemGame();
    expect(state.phase).toBe('scoring');
    // W's aces beat E's seven high.
    expect(state.result).toEqual({ gameType: 'holdem', seats, chips: { N: 0, E: 0, S: 0, W: 2000 }, hands: 1,
      winners: ['W'], eliminationOrder: ['E'] });
    expect(isRuntimeSnapshot({ ...snapshot(seats, 'holdem'),
      rooms: snapshot(seats, 'holdem').rooms.map((room) => ({ ...room, info: { ...room.info, status: 'waiting' } })) }))
      .toBe(true);
  });

  it('should keep empty Blackjack seats out of betting, dealing, and the result', () => {
    const seats: Seat[] = ['N', 'S'];
    blackjack.startGame(CODE, seated(seats), 15_000, 1000);
    expect(blackjackGame().chips).toEqual({ N: 1000, E: 0, S: 1000, W: 0 });
    expect(blackjack.pendingBetSeats(blackjackGame())).toEqual(seats);
    expect(blackjack.bet(CODE, 'E', 10, true, 1000).success).toBe(false);
    expect(blackjack.getPlayerVisibleState(CODE, 'S')!.seats).toEqual(seats);
    expect(isRuntimeSnapshot(snapshot(seats, 'blackjack'))).toBe(true);
    expect(blackjack.bet(CODE, 'N', 50, true, 1000).success).toBe(true);
    expect(blackjack.bet(CODE, 'S', 50, true, 1000).success).toBe(true);
    const state = blackjackGame();
    expect(state.hands.E).toEqual([]);
    expect(state.hands.W).toEqual([]);
    expect(state.log.find((entry) => entry.type === 'deal')).toMatchObject({ bets: { N: 50, E: 0, S: 50, W: 0 } });
    expect(isRuntimeSnapshot(snapshot(seats, 'blackjack'))).toBe(true);
  });

  it('should reject persisted empty seats that hold chips or results that disagree with the seats', () => {
    const seats: Seat[] = ['N', 'E', 'S'];
    blackjack.startGame(CODE, seated(seats), 15_000, 1000);
    const valid = snapshot(seats, 'blackjack');
    expect(isRuntimeSnapshot(valid)).toBe(true);
    const rich = structuredClone(valid);
    (rich.games[0] as BlackjackGameState).chips.W = 1000;
    expect(isRuntimeSnapshot(rich)).toBe(false);
    const lonely = structuredClone(valid);
    lonely.games[0] = { ...lonely.games[0], players: { N: lonely.games[0].players.N } } as BlackjackGameState;
    expect(isRuntimeSnapshot(lonely)).toBe(false);
  });

  it('should still restore legacy four-seat results that do not list seats', () => {
    const seats: Seat[] = ['N', 'E', 'S', 'W'];
    blackjack.startGame(CODE, seated(seats), 15_000, 1000);
    // Every seat bets the minimum and stands until the last hand settles.
    for (let steps = 0; blackjackGame().phase !== 'scoring' && steps < 100; steps++) {
      const state = blackjackGame();
      if (state.phase === 'betting') {
        blackjack.openBetting(CODE, 1000);
        for (const seat of blackjack.pendingBetSeats(state)) blackjack.bet(CODE, seat, 10, true, 1000);
      } else blackjack.act(CODE, state.currentTurnSeat, 'stand');
    }
    const finished = snapshot(seats, 'blackjack');
    finished.rooms[0].info = { ...finished.rooms[0].info, status: 'waiting' };
    const state = finished.games[0] as BlackjackGameState;
    const result = state.result!;
    expect(result.seats).toEqual(seats);
    expect(isRuntimeSnapshot(finished)).toBe(true);
    const legacy: BlackjackMatchResult = { gameType: 'blackjack', chips: result.chips, hands: result.hands,
      winners: result.winners };
    state.result = legacy;
    expect(isRuntimeSnapshot(finished)).toBe(true);
    state.result = { ...legacy, seats: ['N', 'E'] };
    expect(isRuntimeSnapshot(finished)).toBe(false);
  });
});

it.each([false, true])('awards a completed Hold\'em match once with bot=%s, preserving history and spectators', async (withBot) => {
  const directory = await mkdtemp(join(tmpdir(), 'card-flexible-history-'));
  const path = join(directory, 'database.json');
  let repository = await createJsonRepository(path);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(10000);
  try {
    const accounts: AccountRecord[] = ['north', 'south'].map((username) => ({
      id: randomUUID(), username, usernameNormalized: username, nickname: username,
      color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null,
      tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
      passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
      createdAt: 1, updatedAt: 1,
    }));
    for (const account of accounts) await repository.createAccount(account);
    roomManager.restoreRooms([]);
    gameManager.restoreGames([]);
    const runtime = await createRuntimeCoordinator(repository);
    const rewards = vi.fn();
    runtime.subscribeCoinRewards(rewards);
    let rejectedCompletion = false;
    let code = '';
    await runtime.mutate(() => {
      code = roomManager.createRoom('holdem', accounts[0].id);
      accounts.forEach((account, index) => {
        const info = playerManager.toPlayerInfo(account);
        playerManager.attachPlayer(`socket-${index}`, info);
        if (index > 0) roomManager.joinRoom(code, account.id);
        playerManager.setPlayerRoom(account.id, code);
        if (!withBot || index === 0) roomManager.changeSeat(code, info, index === 0 ? 'N' : 'S');
      });
      if (withBot) expect(roomManager.addBot(code, accounts[0].id, 'S').success).toBe(true);
      for (const account of accounts) roomManager.setReady(code, account.id, true);
      // The engine retains legacy two-seat snapshot compatibility; new room starts are gated.
      expect(roomManager.isAllReady(code)).toBe(false);
      roomManager.setRoomStatus(code, 'playing');
      expect(gameManager.startGame(code, 'holdem', roomManager.getSeatPlayers(code)!).success).toBe(true);
    });
    for (let actions = 0; gameManager.getGameState(code)?.phase === 'playing' && actions < 400; actions++) {
      expect((await repository.getAccountById(accounts[0].id))?.coins ?? 0).toBe(0);
      const game = gameManager.getGameState(code)!;
      if (game.gameType !== 'holdem') throw new Error("Expected Hold'em");
      vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(game)) + 1);
      const mutation = runtime.mutate(() => {
        const legal = heLegalActions(game, game.currentTurnSeat)!;
        const action = legal.raise ? { type: 'raise', to: legal.raise.max } as const : { type: 'call' } as const;
        expect(gameManager.handleHoldemAction(code, game.currentTurnSeat, action).success).toBe(true);
        if (gameManager.getGameState(code)?.result && !rejectedCompletion) {
          vi.mocked(rename).mockRejectedValueOnce(new Error('Reward write failed'));
          rejectedCompletion = true;
        }
      });
      try {
        await mutation;
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Reward write failed');
        expect(gameManager.getGameState(code)?.result).toBeNull();
        expect((await repository.getAccountById(accounts[0].id))?.coins ?? 0).toBe(0);
        expect(rewards).not.toHaveBeenCalled();
      }
    }
    const finished = gameManager.getGameState(code);
    if (finished?.gameType !== 'holdem' || !finished.result) throw new Error('Expected a finished match');
    expect(finished.result.seats).toEqual(['N', 'S']);
    expect(rejectedCompletion).toBe(true);
    expect(rewards).toHaveBeenCalledTimes(1);
    expect(rewards).toHaveBeenCalledWith(withBot ? [accounts[0].id] : accounts.map((account) => account.id));
    expect((await repository.getAccountById(accounts[0].id))?.coins).toBe(10);
    expect((await repository.getAccountById(accounts[1].id))?.coins ?? 0).toBe(withBot ? 0 : 10);
    const records = await repository.listMatches(accounts[1].id);
    if (withBot) expect(records).toEqual([]);
    else expect(records[0].accountIds).toEqual(accounts.map((account) => account.id));
    const persisted = await repository.loadRuntime();
    expect(persisted).not.toBeNull();
    await Promise.all([
      repository.saveRuntime(persisted!, [], [finished.id, finished.id]),
      repository.saveRuntime(persisted!, [], [finished.id]),
    ]);
    expect((await repository.getAccountById(accounts[0].id))?.coins).toBe(10);
    await repository.close();
    repository = await createJsonRepository(path);
    expect((await repository.getAccountById(accounts[0].id))?.coins).toBe(10);
    expect((await repository.listMatches(accounts[0].id)).map((match) => match.id)).toEqual(withBot ? [] : [records[0].id]);
  } finally {
    vi.useRealTimers();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});
