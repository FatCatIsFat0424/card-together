import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnyGameState, DiceFace, GameSeat, LiarsDiceGameState, LiarsDiceLogEntry, PlayerInfo, PlayerVisibleGameState, Seat,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { getPresentationEndsAt, getPresentationFrames } from '@shared/game-presentation';
import { gameSeatMap } from '@shared/rules/seats';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as liarsdice from '../../src/managers/games/liarsdice-game';
import { liarsDiceAdapter } from '../../src/managers/games/liarsdice-adapter';
import * as games from '../../src/managers/game-manager';
import { isLiarsDiceResult, isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'DICE01';

type Writable<T> = { -readonly [K in keyof T]: T[K] };

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function table(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat)]));
}

const THREE = table(['N', 'E', 'S']);
const FOUR = table(['N', 'E', 'S', 'W']);
const EIGHT = table(GAME_SEAT_ORDER);

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): LiarsDiceGameState {
  const state = liarsdice.getGameState(CODE);
  if (!state) throw new Error("Expected a Liar's Dice game");
  return state;
}

/** Replaces the current round's dice, keeping each seat's count, and gives the turn to the starter. */
function setRound(hands: Partial<Record<GameSeat, DiceFace[]>>, starter: GameSeat): void {
  const state = game();
  state.hands = gameSeatMap((seat) => hands[seat] ?? state.hands[seat]);
  state.bid = null;
  state.onesWild = true;
  state.currentTurnSeat = starter;
}

/** Wraps a game in a minimal persisted room, as the coordinator saves it. */
function persists(state: AnyGameState): boolean {
  const players: Partial<Record<GameSeat, PlayerInfo>> = state.players;
  const seats = GAME_SEAT_ORDER.filter((seat) => players[seat]);
  const playing = state.phase !== 'scoring';
  const entry = (seat: GameSeat): { player: PlayerInfo; isReady: boolean } => ({ player: players[seat]!, isReady: playing });
  const compass = seats.filter((seat): seat is Seat => ['N', 'E', 'S', 'W'].includes(seat));
  const extra = seats.filter((seat) => !compass.includes(seat as Seat));
  const snapshot: RuntimeSnapshot = {
    players: seats.map((seat) => ({ info: players[seat]!, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'liarsdice', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: seats[0], abortVote: null, abortVoteCooldownUntil: null,
        seats: Object.fromEntries((['N', 'E', 'S', 'W'] as const).map((seat) => [seat,
          players[seat] ? entry(seat) : { player: null, isReady: false }])) as RuntimeSnapshot['rooms'][number]['info']['seats'],
        ...(extra.length > 0 ? { additionalSeats: GAME_SEAT_ORDER.slice(4).map((seat) => players[seat]
          ? entry(seat) : { player: null, isReady: false }) } : {}),
      },
      memberIds: seats.map((seat) => players[seat]!.id),
    }],
    games: [JSON.parse(JSON.stringify(state)) as AnyGameState],
    chat: [{ roomCode: CODE, messages: [] }],
  };
  return isRuntimeSnapshot(snapshot);
}

/** Plays with the hard bot, or the easy one for odd seats, until the last player stands. */
function playOut(random: () => number, onStep?: () => void): void {
  for (let step = 0; step < 3_000 && game().phase === 'playing'; step++) {
    const state = game();
    const seat = state.currentTurnSeat;
    const visible = liarsdice.getPlayerVisibleState(CODE, seat)!;
    const action = getBotAction(visible, random, GAME_SEAT_ORDER.indexOf(seat) % 2 === 0 ? 'hard' : 'easy');
    if (action?.type !== 'game-action' || action.request.gameType !== 'liarsdice') throw new Error('Expected a dice action');
    const move = action.request.action;
    const result = move.type === 'bid' ? liarsdice.bid(CODE, seat, move.quantity, move.face)
      : liarsdice.challenge(CODE, seat, Date.now(), random);
    expect(result).toEqual({ success: true });
    onStep?.();
  }
  expect(game().phase).toBe('scoring');
}

describe("Liar's Dice gameplay", () => {
  beforeEach(() => liarsdice.restoreGames([]));
  afterEach(() => liarsdice.restoreGames([]));

  describe('start', () => {
    it('should roll five dice for every seated player and none for empty seats', () => {
      liarsdice.startGame(CODE, table(['E', 'P6', 'P8']), seeded(1), 1000);
      const state = game();
      expect(GAME_SEAT_ORDER.map((seat) => state.hands[seat].length)).toEqual([0, 5, 0, 0, 0, 5, 0, 5]);
      for (const seat of GAME_SEAT_ORDER) for (const die of state.hands[seat]) expect([1, 2, 3, 4, 5, 6]).toContain(die);
      expect(state.log).toEqual([{ type: 'round', round: 1, starter: state.currentTurnSeat,
        counts: { N: 0, E: 5, S: 0, W: 0, P5: 0, P6: 5, P7: 0, P8: 5 }, timestamp: 1000 }]);
      expect(['E', 'P6', 'P8']).toContain(state.currentTurnSeat);
      expect(state).toMatchObject({ phase: 'playing', round: 1, bid: null, onesWild: true, eliminated: [], result: null });
    });

    it('should roll from the injected source only', () => {
      liarsdice.startGame(CODE, FOUR, () => 0, 1);
      expect(game().hands.N).toEqual([1, 1, 1, 1, 1]);
      liarsdice.startGame(CODE, FOUR, () => 0.999, 1);
      expect(game().hands.W).toEqual([6, 6, 6, 6, 6]);
      liarsdice.startGame(CODE, FOUR, seeded(9), 1);
      const first = structuredClone(game().hands);
      liarsdice.startGame(CODE, FOUR, seeded(9), 1);
      expect(game().hands).toEqual(first);
    });

    it('should use a secure default source whose dice vary between games', () => {
      const seen = new Set<string>();
      for (let index = 0; index < 8; index++) {
        liarsdice.startGame(CODE, EIGHT);
        seen.add(JSON.stringify(game().hands));
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });

  describe('bids', () => {
    beforeEach(() => liarsdice.startGame(CODE, THREE, seeded(2), 1));

    it('should record a bid, remember its bidder and pass the turn', () => {
      setRound({}, 'N');
      expect(liarsdice.bid(CODE, 'N', 3, 4, 50)).toEqual({ success: true });
      expect(game()).toMatchObject({ bid: { seat: 'N', quantity: 3, face: 4 }, currentTurnSeat: 'E', onesWild: true });
      expect(game().log.at(-1)).toEqual({ type: 'bid', seat: 'N', quantity: 3, face: 4, timestamp: 50 });
    });

    it('should reject bids that do not outbid, exceed the dice in play, or are malformed, without changes', () => {
      setRound({}, 'N');
      expect(liarsdice.bid(CODE, 'N', 3, 4).success).toBe(true);
      const before = structuredClone(game());
      expect(liarsdice.bid(CODE, 'E', 3, 4).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 3, 3).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 2, 6).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 16, 2).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 0, 5).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 4, 7 as DiceFace).success).toBe(false);
      expect(liarsdice.bid(CODE, 'E', 4.5, 2).success).toBe(false);
      expect(game()).toEqual(before);
    });

    it('should reject actions out of turn, from empty seats, or in the wrong phase', () => {
      setRound({}, 'N');
      const before = structuredClone(game());
      expect(liarsdice.bid(CODE, 'E', 1, 2).success).toBe(false);
      expect(liarsdice.bid(CODE, 'W', 1, 2).success).toBe(false);
      expect(liarsdice.challenge(CODE, 'E').success).toBe(false);
      expect(liarsdice.bid('NOPE', 'N', 1, 2)).toEqual({ success: false, reason: 'Game not found' });
      expect(game()).toEqual(before);
      game().phase = 'scoring';
      expect(liarsdice.bid(CODE, 'N', 1, 2)).toEqual({ success: false, reason: 'Not in playing phase' });
    });

    it('should reject a challenge before any bid and a challenge of the seat\'s own bid', () => {
      setRound({}, 'N');
      expect(liarsdice.challenge(CODE, 'N')).toEqual({ success: false, reason: 'There is no bid to challenge' });
      game().bid = { seat: 'N', quantity: 1, face: 2 };
      expect(liarsdice.challenge(CODE, 'N').success).toBe(false);
    });

    it('should stop ones from being wild once anyone bids on ones, for the rest of the round', () => {
      setRound({ N: [1, 2, 2, 3, 4], E: [1, 1, 5, 5, 6], S: [3, 3, 4, 4, 6] }, 'N');
      expect(liarsdice.bid(CODE, 'N', 3, 2).success).toBe(true);
      expect(game().onesWild).toBe(true);
      expect(liarsdice.bid(CODE, 'E', 4, 1).success).toBe(true);
      expect(game().onesWild).toBe(false);
      expect(liarsdice.bid(CODE, 'S', 5, 2).success).toBe(true);
      expect(game().onesWild).toBe(false);
      // Ones no longer help: 2s are 2 of the table, so the 5-2s bid fails.
      expect(liarsdice.challenge(CODE, 'N', 90, seeded(3))).toEqual({ success: true });
      const call = game().log.find((entry) => entry.type === 'challenge');
      expect(call).toMatchObject({ wild: false, count: 2, bidTrue: false, loser: 'S' });
    });

    it('should wild ones again at the next round', () => {
      setRound({}, 'N');
      expect(liarsdice.bid(CODE, 'N', 1, 1).success).toBe(true);
      expect(game().onesWild).toBe(false);
      expect(liarsdice.challenge(CODE, 'E', 5, seeded(4)).success).toBe(true);
      expect(game()).toMatchObject({ onesWild: true, bid: null, round: 2 });
    });
  });

  describe('challenges', () => {
    beforeEach(() => liarsdice.startGame(CODE, THREE, seeded(6), 1));

    it('should cost the challenger a die when the table shows at least the bid', () => {
      setRound({ N: [2, 2, 5, 6, 6], E: [2, 3, 3, 4, 4], S: [5, 5, 6, 6, 1] }, 'N');
      liarsdice.bid(CODE, 'N', 4, 2);
      expect(liarsdice.challenge(CODE, 'E', 77, seeded(5))).toEqual({ success: true });
      const call = game().log.find((entry) => entry.type === 'challenge');
      expect(call).toEqual({
        type: 'challenge', seat: 'E', target: 'N', quantity: 4, face: 2, wild: true,
        dice: { N: [2, 2, 5, 6, 6], E: [2, 3, 3, 4, 4], S: [5, 5, 6, 6, 1], W: [], P5: [], P6: [], P7: [], P8: [] },
        count: 4, bidTrue: true, loser: 'E', eliminated: false, timestamp: 77,
      });
      expect(GAME_SEAT_ORDER.map((seat) => game().hands[seat].length)).toEqual([5, 4, 5, 0, 0, 0, 0, 0]);
    });

    it('should cost the bidder a die when the table falls short', () => {
      setRound({ N: [2, 3, 5, 6, 6], E: [3, 3, 4, 4, 4], S: [5, 5, 6, 6, 2] }, 'N');
      liarsdice.bid(CODE, 'N', 4, 2);
      expect(liarsdice.challenge(CODE, 'E', 77, seeded(5)).success).toBe(true);
      expect(game().log.find((entry) => entry.type === 'challenge')).toMatchObject({ count: 2, bidTrue: false, loser: 'N' });
      expect(GAME_SEAT_ORDER.map((seat) => game().hands[seat].length)).toEqual([4, 5, 5, 0, 0, 0, 0, 0]);
    });

    it('should open the next round with the loser and reroll everyone\'s dice', () => {
      setRound({ N: [2, 3, 5, 6, 6], E: [3, 3, 4, 4, 4], S: [5, 5, 6, 6, 2] }, 'N');
      const previous = game().hands;
      liarsdice.bid(CODE, 'N', 4, 2);
      liarsdice.challenge(CODE, 'E', 77, seeded(5));
      const state = game();
      expect(state).toMatchObject({ round: 2, currentTurnSeat: 'N', bid: null, phase: 'playing' });
      expect(state.hands).not.toBe(previous);
      expect(state.log.at(-1)).toMatchObject({ type: 'round', round: 2, starter: 'N',
        counts: { N: 4, E: 5, S: 5, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 } });
    });

    it('should eliminate a player who loses their last die and skip them afterwards', () => {
      setRound({ N: [2, 3, 5, 6, 6], E: [3, 3, 4, 4, 4], S: [5, 5, 6, 6, 2] }, 'N');
      game().hands.E = [3];
      liarsdice.bid(CODE, 'N', 1, 3);
      liarsdice.bid(CODE, 'E', 8, 6);
      const lost = liarsdice.challenge(CODE, 'S', 12, seeded(7));
      expect(lost.success).toBe(true);
      const state = game();
      expect(state.log.find((entry) => entry.type === 'challenge')).toMatchObject({ loser: 'E', eliminated: true });
      expect(state.eliminated).toEqual(['E']);
      expect(state.hands.E).toEqual([]);
      // The next survivor after the eliminated opener starts.
      expect(state.currentTurnSeat).toBe('S');
      expect(liarsdice.bid(CODE, 'S', 1, 2).success).toBe(true);
      expect(state.currentTurnSeat).toBe('N');
      expect(liarsdice.bid(CODE, 'N', 2, 2).success).toBe(true);
      expect(state.currentTurnSeat).toBe('S');
    });

    it('should end the match with the last survivor and a result in elimination order', () => {
      setRound({ N: [2, 2, 5, 6, 6], E: [2, 3, 3, 4, 4], S: [5, 5, 6, 6, 1] }, 'N');
      game().hands.E = [4];
      game().eliminated = ['S'];
      game().hands.S = [];
      game().bid = null;
      liarsdice.bid(CODE, 'N', 2, 6);
      expect(liarsdice.challenge(CODE, 'E', 9, seeded(1)).success).toBe(true);
      const state = game();
      expect(state.phase).toBe('scoring');
      expect(state.currentTurnSeat).toBe('N');
      expect(state.result).toEqual({
        gameType: 'liarsdice', seats: ['N', 'E', 'S'], winnerSeat: 'N', eliminationOrder: ['S', 'E'],
        dice: { N: 5, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, rounds: 1,
      });
      expect(state.bid).toBeNull();
      expect(liarsdice.bid(CODE, 'N', 1, 2).success).toBe(false);
    });
  });

  describe('visible state', () => {
    beforeEach(() => {
      liarsdice.startGame(CODE, FOUR, seeded(8), 1);
      setRound({ N: [1, 2, 3, 4, 5], E: [6, 6, 6, 6, 6], S: [2, 2, 2, 2, 2], W: [3, 3, 3, 3, 3] }, 'N');
    });

    it('should show a seat only its own dice and the public dice counts', () => {
      const view = liarsdice.getPlayerVisibleState(CODE, 'N')!;
      expect(view.myDice).toEqual([1, 2, 3, 4, 5]);
      expect(view.diceCounts).toEqual({ N: 5, E: 5, S: 5, W: 5, P5: 0, P6: 0, P7: 0, P8: 0 });
      expect(view).not.toHaveProperty('hands');
      expect(view.observedHands).toBeUndefined();
      for (const other of ['E', 'S', 'W'] as const) {
        const json = JSON.stringify(liarsdice.getPlayerVisibleState(CODE, other));
        expect(json).not.toContain('[1,2,3,4,5]');
        expect(json).toContain(JSON.stringify(game().hands[other]));
      }
    });

    it('should keep every other cup out of the log until a challenge lifts them', () => {
      liarsdice.bid(CODE, 'N', 2, 6);
      const view = liarsdice.getPlayerVisibleState(CODE, 'S')!;
      expect(JSON.stringify(view.log)).not.toMatch(/dice/);
      expect(JSON.stringify(view)).not.toContain('[6,6,6,6,6]');
      liarsdice.challenge(CODE, 'E', 5, seeded(2));
      const after = liarsdice.getPlayerVisibleState(CODE, 'S')!;
      const call = after.log.find((entry) => entry.type === 'challenge');
      expect(call && 'dice' in call ? call.dice.E : null).toEqual([6, 6, 6, 6, 6]);
    });

    it('should show the next round as roll counts only after a challenge', () => {
      liarsdice.bid(CODE, 'N', 2, 6);
      liarsdice.challenge(CODE, 'E', 5, seeded(2));
      for (const seat of ['N', 'E', 'S', 'W'] as const) {
        const view = liarsdice.getPlayerVisibleState(CODE, seat)!;
        expect(view.myDice).toEqual(game().hands[seat]);
        expect(view.log.at(-1)).toMatchObject({ type: 'round', round: 2 });
        expect(view.log.at(-1)).not.toHaveProperty('dice');
        expect(view.log.filter((entry) => 'dice' in entry)).toHaveLength(1);
      }
    });

    it('should add every cup only to spectators and eliminated players through the game manager', () => {
      games.startGame(CODE, 'liarsdice', FOUR);
      const live = games.getGameState(CODE);
      if (live?.gameType !== 'liarsdice') throw new Error('Expected a dice game');
      delete live.presentation;
      const spectator = games.getRecipientVisibleState(CODE, null) as Extract<PlayerVisibleGameState, { gameType: 'liarsdice' }>;
      expect(spectator.observer).toBe('spectator');
      expect(spectator.observedHands).toEqual(live.hands);
      const seated = games.getRecipientVisibleState(CODE, 'N');
      expect(seated?.observer).toBeUndefined();
      expect(seated && 'observedHands' in seated ? seated.observedHands : undefined).toBeUndefined();
      live.hands = gameSeatMap((seat) => ({ N: [2, 2, 2, 2, 2], E: [3], S: [4, 4, 4, 4, 4], W: [5, 5, 5, 5, 5] } as Partial<Record<GameSeat, DiceFace[]>>)[seat] ?? []);
      live.bid = { seat: 'E', quantity: 5, face: 6 };
      live.currentTurnSeat = 'S';
      expect(games.handleGameAction(CODE, 'S', { gameType: 'liarsdice', action: { type: 'challenge' } }).success).toBe(true);
      const out = games.getRecipientVisibleState(CODE, 'E');
      expect(out?.observer).toBe('eliminated');
      expect(out && 'observedHands' in out ? out.observedHands : null).toEqual(live.hands);
      games.removeGame(CODE);
    });
  });

  describe('adapter hooks', () => {
    it('should expose the turn, the elimination entry and the stored result', () => {
      liarsdice.startGame(CODE, THREE, seeded(3), 1);
      const state = game();
      expect(liarsDiceAdapter.turnSeat(state)).toBe(state.currentTurnSeat);
      expect(liarsDiceAdapter.eliminationIndex?.(state, 'N')).toBe(-1);
      expect(liarsDiceAdapter.matchResult(state)).toBeNull();
      setRound({}, 'N');
      state.hands.E = [3];
      liarsdice.bid(CODE, 'N', 1, 2);
      liarsdice.bid(CODE, 'E', 9, 6);
      liarsdice.challenge(CODE, 'S', 4, seeded(2));
      expect(liarsDiceAdapter.eliminationIndex?.(state, 'E')).toBe(state.log.findIndex((entry) => entry.type === 'challenge'));
      expect(liarsDiceAdapter.eliminationIndex?.(state, 'N')).toBe(-1);
    });
  });

  describe('presentation', () => {
    afterEach(() => vi.useRealTimers());

    it('should open with a roll frame, time bids like plays, and keep the reveal out of the call frame', () => {
      games.startGame(CODE, 'liarsdice', THREE);
      const state = games.getGameState(CODE)!;
      if (state.gameType !== 'liarsdice') throw new Error('Expected a dice game');
      expect(getPresentationFrames(state)).toEqual([expect.objectContaining({
        kind: 'deal', durationMs: 2000, seat: state.currentTurnSeat, cards: [] })]);
      delete state.presentation;
      const opener = state.currentTurnSeat;
      state.hands = gameSeatMap((seat) => seat === 'N' ? [2, 2, 3, 4, 5] : state.hands[seat]);
      expect(games.handleGameAction(CODE, opener, { gameType: 'liarsdice', action: { type: 'bid', quantity: 2, face: 3 } }).success)
        .toBe(true);
      expect(getPresentationFrames(state)).toEqual([expect.objectContaining({
        kind: 'bid', durationMs: 1300, seat: opener, liarsDice: { quantity: 2, face: 3 } })]);
      vi.useFakeTimers();
      vi.setSystemTime(getPresentationEndsAt(state));
      const caller = state.currentTurnSeat;
      expect(games.handleGameAction(CODE, caller, { gameType: 'liarsdice', action: { type: 'challenge' } }).success).toBe(true);
      const frames = getPresentationFrames(state);
      expect(frames.map((frame) => frame.kind)).toEqual(['challenge', 'diceReveal', state.phase === 'scoring' ? 'finish' : 'deal']);
      expect(frames.map((frame) => frame.durationMs)).toEqual([2000, 4000, state.phase === 'scoring' ? 3000 : 2000]);
      expect(frames[0]).toMatchObject({ seat: caller, target: opener, liarsDice: { quantity: 2, face: 3 } });
      expect(frames[0].liarsDice).not.toHaveProperty('dice');
      expect(frames[0].liarsDice).not.toHaveProperty('loser');
      const reveal = state.log.find((entry) => entry.type === 'challenge');
      expect(frames[1].liarsDice).toMatchObject({ dice: reveal && 'dice' in reveal ? reveal.dice : null, loser: expect.any(String) });
      expect(frames[1].key).toBe(`${frames[0].key}:reveal`);
      games.removeGame(CODE);
    });
  });

  describe('persistence', () => {
    it('should accept every committed state of bot-played matches, for small and full tables', () => {
      for (const [seed, seats] of [[11, FOUR], [12, THREE], [13, EIGHT], [14, table(['N', 'P5'])]] as const) {
        const random = seeded(seed);
        liarsdice.startGame(CODE, seats, random, 1);
        expect(persists(game())).toBe(true);
        playOut(random, () => expect(persists(game())).toBe(true));
        const finished = game();
        expect(persists(finished)).toBe(true);
        expect(isLiarsDiceResult(finished.result)).toBe(true);
        expect(finished.result?.seats).toEqual(GAME_SEAT_ORDER.filter((seat) => seats[seat]));
      }
    });

    it('should reject altered reveals, tallies, counts, bids, turns and results', () => {
      const random = seeded(21);
      liarsdice.startGame(CODE, FOUR, random, 1);
      playOut(random);
      const finished = game();
      const call = finished.log.findIndex((entry) => entry.type === 'challenge');
      const mutate = (change: (copy: LiarsDiceGameState) => void): boolean => {
        const copy = structuredClone(finished);
        change(copy);
        return persists(copy);
      };
      expect(persists(finished)).toBe(true);
      const challenge = (copy: LiarsDiceGameState): Writable<Extract<LiarsDiceLogEntry, { type: 'challenge' }>> => {
        const entry = copy.log[call];
        if (entry.type !== 'challenge') throw new Error('Expected a challenge');
        return entry;
      };
      expect(mutate((copy) => { const entry = challenge(copy); entry.bidTrue = !entry.bidTrue; })).toBe(false);
      expect(mutate((copy) => { challenge(copy).count += 1; })).toBe(false);
      expect(mutate((copy) => { const entry = challenge(copy); entry.wild = !entry.wild; })).toBe(false);
      expect(mutate((copy) => { const entry = challenge(copy); entry.dice.N = entry.dice.N.slice(1); })).toBe(false);
      expect(mutate((copy) => { copy.log.splice(1, 1); })).toBe(false);
      expect(mutate((copy) => { copy.round += 1; })).toBe(false);
      expect(mutate((copy) => { copy.result = { ...copy.result!, rounds: copy.result!.rounds + 1 }; })).toBe(false);
      expect(mutate((copy) => { copy.result = { ...copy.result!, winnerSeat: copy.result!.eliminationOrder[0] }; })).toBe(false);
      expect(mutate((copy) => { copy.hands[copy.result!.winnerSeat].pop(); })).toBe(false);
    });

    it('should reject a playing state with a misplaced turn, a stale bid or a changed cup size', () => {
      liarsdice.startGame(CODE, FOUR, seeded(31), 1);
      setRound({}, game().currentTurnSeat);
      const opener = game().currentTurnSeat;
      const next = GAME_SEAT_ORDER[(GAME_SEAT_ORDER.indexOf(opener) + 1) % 4];
      liarsdice.bid(CODE, opener, 1, 2);
      const state = game();
      expect(persists(state)).toBe(true);
      const turn = structuredClone(state);
      turn.currentTurnSeat = GAME_SEAT_ORDER[(GAME_SEAT_ORDER.indexOf(next) + 1) % 4];
      expect(persists(turn)).toBe(false);
      const bid = structuredClone(state);
      bid.bid = { seat: opener, quantity: 2, face: 2 };
      expect(persists(bid)).toBe(false);
      const wild = structuredClone(state);
      wild.onesWild = false;
      expect(persists(wild)).toBe(false);
      const cup = structuredClone(state);
      cup.hands[next] = cup.hands[next].slice(1);
      expect(persists(cup)).toBe(false);
      const face = structuredClone(state);
      face.hands[next][0] = 9 as DiceFace;
      expect(persists(face)).toBe(false);
      const illegal = structuredClone(state);
      illegal.log.push({ type: 'bid', seat: next, quantity: 1, face: 2, timestamp: 2 });
      illegal.currentTurnSeat = GAME_SEAT_ORDER[(GAME_SEAT_ORDER.indexOf(next) + 1) % 4];
      expect(persists(illegal)).toBe(false);
    });
  });
});
