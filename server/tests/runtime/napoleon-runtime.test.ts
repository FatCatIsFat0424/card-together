import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NAPOLEON_OPTIONS } from '@shared/napoleon-options';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { isNapoleonCard, napoleonCardKey, napoleonReviewSeconds, sameNapoleonCard } from '@shared/rules/napoleon';
import type {
  AnyGameState, GameSeat, NapoleonAction, NapoleonCard, NapoleonGameState, NapoleonVisibleState, PlayerInfo, Seat,
  TimeControl,
} from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as napoleon from '../../src/managers/games/napoleon-game';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import * as decisions from '../../src/bots/bot-decisions';
import { getBotAction } from '../../src/bots/bot-decisions';
import { dailyGameProgress } from '../../src/database/daily-rewards';
import { achievementGameProgress } from '../../src/database/achievements';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { startBotTurns } from '../../src/runtime/bot-turns';
import { startSharedDeadlines } from '../../src/runtime/shared-deadline';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import { runSeededGame } from './seeded-game-runner';
import { createSocketHarness, SEATS } from '../performance/socket-harness';
import type { SocketHarness } from '../performance/socket-harness';

const SETTINGS: TimeControl = { baseSeconds: 10, bankSeconds: 20 };
const REVIEW_MS = napoleonReviewSeconds(SETTINGS.baseSeconds) * 1000;
const ALL_SEATS: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6'];

function human(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** A persisted room whose humans fill `seats` and whose bots fill `bots`, already playing Napoleon. */
async function fixture(seats: readonly GameSeat[], bots: readonly GameSeat[] = []) {
  let saved: RuntimeSnapshot | null = null;
  const repository = {
    loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
    saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => {
      expect(isRuntimeSnapshot(state)).toBe(true);
      saved = structuredClone(state);
    }),
  };
  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    code = rooms.createRoom('napoleon', seats[0]);
    for (const seat of seats) {
      players.attachPlayer(seat, human(seat));
      players.setPlayerRoom(seat, code);
      expect(rooms.joinRoom(code, seat).success).toBe(true);
    }
    for (const seat of seats.filter((entry) => entry.startsWith('P'))) {
      expect(rooms.addSeat(code, seats[0]).success).toBe(true);
      expect(rooms.changeAdditionalSeat(code, human(seat), seat === 'P5' ? 0 : 1).success).toBe(true);
    }
    for (const seat of seats.filter((entry) => !entry.startsWith('P'))) {
      expect(rooms.changeSeat(code, human(seat), seat as 'N').success).toBe(true);
    }
    for (const seat of bots) expect(rooms.addBot(code, seats[0], seat as 'N').success).toBe(true);
    rooms.setRoomStatus(code, 'playing');
    expect(games.startGame(code, 'napoleon', rooms.getSeatPlayers(code)!, SETTINGS, undefined, undefined, undefined,
      rooms.getRoomInfo(code)!.napoleonOptions)).toEqual({ success: true });
  });
  repository.saveRuntime.mockClear();
  const game = (): NapoleonGameState => {
    const state = games.getGameState(code);
    if (state?.gameType !== 'napoleon') throw new Error('Expected a Napoleon game');
    return state;
  };
  const view = (seat: GameSeat): NapoleonVisibleState => {
    const visible = games.getPlayerVisibleState(code, seat);
    if (visible?.gameType !== 'napoleon') throw new Error('Expected a Napoleon view');
    return visible;
  };
  /** Waits out any presentation, then commits one action. */
  const act = async (seat: GameSeat, action: NapoleonAction): Promise<void> => {
    vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(game())) + 1);
    await runtime.mutate(() => {
      expect(games.handleNapoleonAction(code, seat, action)).toEqual({ success: true });
    });
  };
  /** The current bidder takes the contract at 9 clubs and everyone else passes. */
  const auction = async (): Promise<GameSeat> => {
    const bidder = game().currentTurnSeat!;
    await act(bidder, { type: 'bid', action: { type: 'bid', level: 9, suit: 'clubs' } });
    while (game().phase === 'bidding') await act(game().currentTurnSeat!, { type: 'bid', action: { type: 'pass' } });
    return bidder;
  };
  return { code, runtime, repository, game, view, act, auction, saved: () => saved! };
}

function cardsIn(value: unknown): NapoleonCard[] {
  if (Array.isArray(value)) return value.flatMap(cardsIn);
  if (typeof value !== 'object' || value === null) return [];
  if (isNapoleonCard(value)) return [value];
  return Object.values(value).flatMap(cardsIn);
}

describe('Napoleon runtime', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    players.restorePlayers([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts only with four to six occupied seats and serves P5 and P6 their own views', async () => {
    const tooMany = Object.fromEntries([...ALL_SEATS, 'P7' as const].map((seat) => [seat, human(seat)]));
    expect(games.startGame('NAPX', 'napoleon', tooMany)).toEqual({ success: false, reason: 'Too many players for this game.' });
    const tooFew = Object.fromEntries(ALL_SEATS.slice(0, 3).map((seat) => [seat, human(seat)]));
    expect(games.startGame('NAPX', 'napoleon', tooFew).success).toBe(false);
    expect(games.getGameState('NAPX')).toBeNull();
    const { game, view } = await fixture(ALL_SEATS);
    expect(game()).toMatchObject({ seats: ALL_SEATS, options: DEFAULT_NAPOLEON_OPTIONS });
    expect(view('P6').myHand).toEqual(game().hands.P6);
    expect(game().clock?.bankRemainingMs).toMatchObject({ P5: 20_000, P6: 20_000 });
    expect(game().clock?.turn?.seat).toBe(game().currentTurnSeat);
  });

  it('gives spectators every hand and the secretary but never the face-down cards before the pickup', async () => {
    const { code, game, act, auction } = await fixture(['N', 'E', 'S', 'W', 'P5']);
    const spectator = (): NapoleonVisibleState => {
      const visible = games.getRecipientVisibleState(code, null);
      if (visible?.gameType !== 'napoleon') throw new Error('Expected a Napoleon view');
      return visible;
    };
    let visible = spectator();
    expect(visible.observer).toBe('spectator');
    expect(visible.observedHands).toEqual(game().hands);
    for (const shown of cardsIn(visible)) {
      expect(game().kitty.some((entry) => sameNapoleonCard(entry, shown)), napoleonCardKey(shown)).toBe(false);
    }
    const napoleonSeat = await auction();
    visible = spectator();
    expect(visible.pickedUp).toEqual(game().pickedUp);
    expect(visible.discards).toBeNull();
    await act(napoleonSeat, { type: 'discard', cards: game().hands[napoleonSeat]!.slice(-4) });
    const holder = ALL_SEATS.slice(0, 5).find((seat) => seat !== napoleonSeat)!;
    await act(napoleonSeat, { type: 'call', card: game().hands[holder]![0] });
    visible = spectator();
    expect(visible).toMatchObject({ pickedUp: null, discards: game().kitty, secretarySeat: holder });
    expect(games.getRecipientVisibleState(code, napoleonSeat)).toMatchObject({ secretarySeat: null });
    expect(games.getRecipientVisibleState(code, holder)).not.toHaveProperty('observedHands');
  });

  it('refills every reserve when an all-pass auction redeals', async () => {
    const { game, act } = await fixture(['N', 'E', 'S', 'W']);
    vi.setSystemTime(Date.now() + SETTINGS.baseSeconds * 1000 + 5_000);
    const first = game().currentTurnSeat!;
    await act(first, { type: 'bid', action: { type: 'pass' } });
    expect(game().clock?.bankRemainingMs[first]).toBeLessThan(20_000);
    for (let index = 0; index < 3; index++) await act(game().currentTurnSeat!, { type: 'bid', action: { type: 'pass' } });
    expect(game().log.filter((entry) => entry.type === 'deal')).toHaveLength(2);
    expect(game().clock?.bankRemainingMs[first]).toBe(20_000);
  });

  it('acknowledges overdue public discards at the shared deadline without a turn clock', async () => {
    const { code, runtime, game, act, auction, saved } = await fixture(['N', 'E', 'S', 'W']);
    const napoleonSeat = await auction();
    await act(napoleonSeat, { type: 'discard', cards: game().hands[napoleonSeat]!.slice(-2) });
    const discardedAt = Date.now();
    expect(game()).toMatchObject({ phase: 'reviewing', currentTurnSeat: null, reviewDeadline: discardedAt + REVIEW_MS });
    expect(game().clock?.turn).toBeNull();
    const other = ALL_SEATS.slice(0, 4).find((seat) => seat !== napoleonSeat)!;
    await act(other, { type: 'review' });
    const choose = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn(() => expect(saved().games[0]).toEqual(game()));
    stops.push(startSharedDeadlines(runtime, publish));
    stops.push(await startTurnTimers(runtime, vi.fn()));
    await vi.advanceTimersByTimeAsync(discardedAt + REVIEW_MS - Date.now() - 1);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game()).toMatchObject({ phase: 'calling', currentTurnSeat: napoleonSeat, reviewDeadline: null });
    expect(game().reviewed).toEqual(ALL_SEATS.slice(0, 4).filter((seat) => seat !== napoleonSeat));
    expect(game().clock?.turn?.seat).toBe(napoleonSeat);
    expect(choose).not.toHaveBeenCalled();
    expect(games.overdueSharedDeadlineSeats(code, game().id)).toEqual([]);
  });

  it('resumes an overdue review deadline after a restart', async () => {
    const { runtime, game, act, auction, saved } = await fixture(['N', 'E', 'S', 'W']);
    const napoleonSeat = await auction();
    await act(napoleonSeat, { type: 'discard', cards: game().hands[napoleonSeat]!.slice(0, 2) });
    const restored = saved();
    games.restoreGames([]);
    games.restoreGames(restored.games);
    expect(game().phase).toBe('reviewing');
    vi.setSystemTime(Date.now() + REVIEW_MS + 5_000);
    const publish = vi.fn();
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game()).toMatchObject({ phase: 'calling', currentTurnSeat: napoleonSeat });
  });

  it('decides an expired turn from the seat\'s own filtered view', async () => {
    const { runtime, game } = await fixture(['N', 'E', 'S', 'W']);
    const seat = game().currentTurnSeat!;
    const choose = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish));
    await vi.advanceTimersByTimeAsync(game().clock!.turn!.deadline - Date.now());
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().log.at(-1)).toMatchObject({ type: 'bid', seat });
    expect(game().clock?.lastTimeout?.seat).toBe(seat);
    const [visible] = choose.mock.calls[0];
    expect(visible).toMatchObject({ gameType: 'napoleon', mySeat: seat });
    expect(visible).not.toHaveProperty('hands');
    expect(visible).not.toHaveProperty('kitty');
    expect(visible).not.toHaveProperty('observedHands');
  });

  it('lets bots finish a six-seat match with three humans through the durable schedulers', async () => {
    const humans: readonly GameSeat[] = ['N', 'P5', 'P6'];
    const { runtime, game, view, act } = await fixture(humans, ['E', 'S', 'W']);
    stops.push(startBotTurns(runtime, vi.fn()));
    stops.push(startSharedDeadlines(runtime, vi.fn()));
    for (let step = 0; step < 2_000 && game().phase !== 'scoring'; step++) {
      const state = game();
      const pending = state.phase === 'reviewing' ? napoleon.pendingReviewSeats(state) : [state.currentTurnSeat];
      const seat = humans.find((entry) => pending.includes(entry));
      const action = seat ? firstLegalAction(view(seat)) : null;
      if (seat && action?.type === 'napoleon-action') await act(seat, action.action);
      else await vi.advanceTimersByTimeAsync(2_500);
      await runtime.idle();
    }
    expect(game().phase).toBe('scoring');
    expect(game().result?.seats).toEqual(ALL_SEATS);
  });
});

describe('Napoleon seeded bot matches', () => {
  beforeEach(() => napoleon.restoreGames([]));

  it.each([
    [4, 'hard', 11], [5, 'hard', 12], [6, 'hard', 13], [4, 'easy', 21], [5, 'easy', 22], [6, 'easy', 23],
  ] as const)('%i %s bots finish a match from their own views', (count, difficulty, seed) => {
    const code = `BOTN${count}${difficulty[0]}`;
    const seats = ALL_SEATS.slice(0, count);
    const random = seeded(seed);
    napoleon.startGame(code, Object.fromEntries(seats.map((seat) => [seat, human(seat)])), undefined,
      napoleon.shuffleNapoleonDeck(random), seats[0], 0);
    const state = (): NapoleonGameState => napoleon.getGameState(code)!;
    runSeededGame(`Napoleon ${count} ${difficulty}`, 600, () => state().phase === 'scoring', () => {
      const current = state();
      const seat = current.phase === 'reviewing' ? napoleon.pendingReviewSeats(current)[0] : current.currentTurnSeat;
      if (!seat) throw new Error('Expected a seat to act');
      const visible = napoleon.getPlayerVisibleState(code, seat)!;
      const action = getBotAction(visible, random, difficulty);
      if (action?.type !== 'napoleon-action') throw new Error(`No Napoleon action for ${seat} in ${current.phase}`);
      const result = napoleon.act(code, seat, action.action, 30_000, 0, () => napoleon.shuffleNapoleonDeck(random));
      if (!result.success) throw new Error(`${seat} ${JSON.stringify(action.action)}: ${result.reason}`);
    });
    const result = state().result!;
    expect(result.seats).toEqual(seats);
    expect(result.napoleonPoints + result.defenderPoints).toBe(16);
  });
});

describe('Napoleon room options and seats', () => {
  afterEach(() => rooms.restoreRooms([]));

  it('creates rooms with joker summoning on and lets only the waiting host change it', () => {
    const code = rooms.createRoom('napoleon', 'host');
    expect(rooms.getRoomInfo(code)?.napoleonOptions).toEqual({ jokerSummon: true });
    rooms.joinRoom(code, 'guest');
    rooms.joinRoom(code, 'N');
    expect(rooms.changeSeat(code, human('N'), 'N').success).toBe(true);
    rooms.setReady(code, 'N', true);
    expect(rooms.setNapoleonOptions(code, 'guest', { jokerSummon: false }).success).toBe(false);
    expect(rooms.setNapoleonOptions(code, 'host', { jokerSummon: 'no' } as never).success).toBe(false);
    expect(rooms.getRoomInfo(code)?.seats.N.isReady).toBe(true);
    expect(rooms.setNapoleonOptions(code, 'host', { jokerSummon: false })).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)).toMatchObject({ napoleonOptions: { jokerSummon: false }, seats: { N: { isReady: false } } });
    rooms.setRoomStatus(code, 'playing');
    expect(rooms.setNapoleonOptions(code, 'host', { jokerSummon: true }).success).toBe(false);
    rooms.setRoomStatus(code, 'waiting');
    expect(rooms.setGameType(code, 'host', 'bridge').success).toBe(true);
    expect(rooms.setNapoleonOptions(code, 'host', { jokerSummon: true }).success).toBe(false);
  });

  it('caps Napoleon rooms at two extra seats and trims empty extra seats on a game switch', () => {
    const code = rooms.createRoom('holdem', 'host');
    for (let index = 0; index < 4; index++) expect(rooms.addSeat(code, 'host').success).toBe(true);
    rooms.joinRoom(code, 'P7');
    expect(rooms.changeAdditionalSeat(code, human('P7'), 2).success).toBe(true);
    expect(rooms.setGameType(code, 'host', 'napoleon').success).toBe(false);
    expect(rooms.changeAdditionalSeat(code, human('P7'), 1).success).toBe(true);
    expect(rooms.setGameType(code, 'host', 'napoleon')).toEqual({ success: true });
    expect(rooms.getRoomInfo(code)?.additionalSeats).toHaveLength(2);
    expect(rooms.getRoomInfo(code)?.additionalSeats?.[1].player?.id).toBe('P7');
    expect(rooms.addSeat(code, 'host')).toEqual({ success: false, reason: 'Seat limit reached.' });
  });

  it('restores legacy rooms with the default options', () => {
    const code = rooms.createRoom('napoleon', 'host');
    const [record] = structuredClone(rooms.exportRooms());
    const legacy = { ...record, info: { ...record.info, napoleonOptions: undefined } };
    rooms.restoreRooms([legacy]);
    expect(rooms.getRoomInfo(code)?.napoleonOptions).toEqual(DEFAULT_NAPOLEON_OPTIONS);
  });
});

describe('Napoleon team wins', () => {
  const now = Date.parse('2026-10-15T10:00:00Z');
  const seats: GameSeat[] = ['N', 'E', 'S', 'W', 'P5'];
  const finished = (winners: GameSeat[]): Pick<AnyGameState, 'gameType' | 'players' | 'result'> => ({
    gameType: 'napoleon',
    players: Object.fromEntries(seats.map((seat) => [seat, human(seat)])),
    result: {
      gameType: 'napoleon', seats, contract: { level: 12, suit: 'spades', napoleon: 'N' }, secretaryCard: { joker: 'big' },
      secretarySeat: 'S', points: { N: 8, E: 1, S: 5, W: 1, P5: 1, P6: 0, P7: 0, P8: 0 }, discards: [],
      discardPoints: 0, napoleonPoints: 13, defenderPoints: 3, napoleonWins: true, winners,
    },
  });

  it('counts a win for both the Napoleon and the secretary, not as a tie', () => {
    const game = finished(['N', 'S']);
    expect(dailyGameProgress(undefined, game, 'N', now).wins).toBe(1);
    expect(dailyGameProgress(undefined, game, 'S', now).wins).toBe(1);
    expect(dailyGameProgress(undefined, game, 'E', now)).toMatchObject({ wins: 0, gameTypes: ['napoleon'] });
    expect(achievementGameProgress(undefined, game, 'S')).toMatchObject({ games: 1, wins: 1 });
    expect(dailyGameProgress(undefined, finished(['E', 'W', 'P5']), 'P5', now).wins).toBe(1);
  });
});

describe('Napoleon socket actions', () => {
  let harness: SocketHarness | undefined;
  afterEach(async () => { await harness?.close(); harness = undefined; });

  it('authenticates options and actions and stores only the known action fields', async () => {
    const app = await (harness = await createSocketHarness(1));
    const clients = app.clients[0];
    const [host, guest] = clients;
    expect(await host.emitWithAck('room:setGameType', { gameType: 'napoleon' })).toEqual({ success: true });
    expect(await guest.emitWithAck('room:setNapoleonOptions', { jokerSummon: false })).toMatchObject({ success: false });
    expect(await host.emitWithAck('room:setNapoleonOptions', { jokerSummon: 1 } as never))
      .toEqual({ success: false, error: 'Invalid Napoleon options.' });
    expect(await host.emitWithAck('room:setNapoleonOptions', { jokerSummon: false })).toEqual({ success: true });
    for (const client of clients) expect(await client.emitWithAck('room:ready')).toEqual({ success: true });
    expect(await host.emitWithAck('room:start')).toEqual({ success: true });
    const state = (await host.emitWithAck('player:resume')).gameState;
    if (state?.gameType !== 'napoleon') throw new Error('Expected a Napoleon game');
    expect(state.options).toEqual({ jokerSummon: false });
    const bidder = clients[SEATS.indexOf(state.currentTurnSeat as Seat)];
    for (const action of [
      null, { type: 'bid', action: { type: 'bid', level: 8, suit: 'clubs' } }, { type: 'bid', action: { type: 'bid', level: 9, suit: 'x' } },
      { type: 'discard', cards: [] }, { type: 'discard', cards: Array.from({ length: 7 }, (_, rank) => ({ suit: 'clubs', rank: rank + 2 })) },
      { type: 'discard', cards: [{ joker: 'big' }, { joker: 'big' }] }, { type: 'call', card: { joker: 'big', suit: 'clubs' } },
      { type: 'play', card: { suit: 'clubs', rank: 1 } }, { type: 'play', card: { joker: 'small' }, leadSuit: 'nt' },
      { type: 'play', card: { joker: 'small' }, summon: 'king' }, { type: 'claim' },
    ]) {
      expect(await bidder.emitWithAck('game:napoleon:action', { action: action as NapoleonAction }))
        .toEqual({ success: false, error: 'Invalid action.' });
    }
    const injected = { type: 'bid', injected: 'x', action: { type: 'bid', level: 9, suit: 'hearts', seat: 'N' } };
    expect(await bidder.emitWithAck('game:napoleon:action', { action: injected as unknown as NapoleonAction }))
      .toEqual({ success: true });
    expect(await bidder.emitWithAck('game:napoleon:action', { action: { type: 'bid', action: { type: 'pass' } } }))
      .toMatchObject({ success: false });
    const saved = (await app.repository.loadRuntime())?.games[0];
    if (saved?.gameType !== 'napoleon') throw new Error('Expected a saved Napoleon game');
    expect(saved.log.at(-1)).toEqual({ type: 'bid', seat: state.currentTurnSeat, timestamp: expect.any(Number),
      action: { type: 'bid', level: 9, suit: 'hearts' } });
  });
});
