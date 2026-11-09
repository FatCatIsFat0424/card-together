import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnyGameState, GameSeat, PlayerInfo, Seat } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { YachtGameState } from '@shared/games/yacht/types';
import { YACHT_BOXES, YACHT_ROUNDS, yachtTotals } from '@shared/rules/yacht';
import type { YachtBox, YachtFace } from '@shared/rules/yacht';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as yacht from '../../src/managers/games/yacht-game';
import { yachtAdapter } from '../../src/managers/games/yacht-adapter';
import { coherentYachtGame, isYachtResult, yachtGame } from '../../src/managers/games/yacht-validation';
import * as games from '../../src/managers/game-manager';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'YACHT1';
const ROUND_MS = 60_000;

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function table(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat)]));
}

const TWO = table(['N', 'S']);
const THREE = table(['N', 'E', 'S']);
const EIGHT = table(GAME_SEAT_ORDER);

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function game(): YachtGameState {
  const state = yacht.getGameState(CODE);
  if (!state) throw new Error('Expected a Yacht Dice game');
  return state;
}

function start(players = TWO, mode: 'turns' | 'simultaneous' = 'turns', now = 1_000): void {
  yacht.startGame(CODE, players, { mode }, ROUND_MS, now);
}

/** Replaces a seat's dice in the open round, as if it had rolled them. */
function setDice(seat: GameSeat, faces: readonly number[], rolls = 1): void {
  const state = game();
  state.turns = { ...state.turns, [seat]: { dice: faces as YachtFace[], held: [false, false, false, false, false], rolls, done: false } };
}

function setCard(seat: GameSeat, boxes: Partial<Record<YachtBox, number>>, extraYachts = 0): void {
  game().cards = { ...game().cards, [seat]: { boxes, extraYachts } };
}

function snapshotOf(state: AnyGameState): RuntimeSnapshot {
  const players: Partial<Record<GameSeat, PlayerInfo>> = state.players;
  const seats = GAME_SEAT_ORDER.filter((seat) => players[seat]);
  const playing = state.phase !== 'scoring';
  const entry = (seat: GameSeat): { player: PlayerInfo; isReady: boolean } => ({ player: players[seat]!, isReady: playing });
  const compass = seats.filter((seat): seat is Seat => ['N', 'E', 'S', 'W'].includes(seat));
  const extra = seats.filter((seat) => !compass.includes(seat as Seat));
  return {
    players: seats.map((seat) => ({ info: players[seat]!, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'yacht', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: seats[0], abortVote: null, abortVoteCooldownUntil: null,
        seats: Object.fromEntries((['N', 'E', 'S', 'W'] as const).map((seat) => [seat,
          players[seat] ? entry(seat) : { player: null, isReady: false }])) as RuntimeSnapshot['rooms'][number]['info']['seats'],
        ...(extra.length > 0 ? { additionalSeats: GAME_SEAT_ORDER.slice(4).map((seat) => players[seat]
          ? entry(seat) : { player: null, isReady: false }) } : {}),
        gameOptions: { yacht: (state as YachtGameState).options },
      },
      memberIds: seats.map((seat) => players[seat]!.id),
    }],
    games: [JSON.parse(JSON.stringify(state)) as AnyGameState],
    chat: [{ roomCode: CODE, messages: [] }],
  };
}

/** Plays every pending seat with the given difficulty until the match is over, checking each committed state. */
function playOut(random: () => number, check?: (state: YachtGameState) => void): void {
  for (let step = 0; step < 3_000 && game().phase === 'playing'; step++) {
    const state = game();
    const seat = state.options.mode === 'turns' ? state.currentTurnSeat! : yacht.pendingSeats(state)[0];
    const visible = yacht.getPlayerVisibleState(CODE, seat)!;
    const action = getBotAction(visible, random, GAME_SEAT_ORDER.indexOf(seat) % 2 === 0 ? 'hard' : 'easy');
    if (action?.type !== 'game-action' || action.request.gameType !== 'yacht') throw new Error('Expected a Yacht Dice action');
    const move = action.request.action;
    const result = move.type === 'roll' ? yacht.roll(CODE, seat, move.held, random)
      : move.type === 'score' ? yacht.score(CODE, seat, move.box) : { success: false as const, reason: `unexpected ${move.type}` };
    expect(result).toEqual({ success: true });
    check?.(game());
  }
  expect(game().phase).toBe('scoring');
}

describe('Yacht Dice gameplay', () => {
  beforeEach(() => yacht.restoreGames([]));
  afterEach(() => yacht.restoreGames([]));

  describe('start', () => {
    it('opens round one with the first seat on turn and fresh cards', () => {
      start(table(['E', 'P6', 'P8']));
      expect(game()).toMatchObject({
        phase: 'playing', round: 1, currentTurnSeat: 'E', roundDeadline: null, result: null, log: [],
        options: { mode: 'turns' },
      });
      expect(Object.keys(game().cards)).toEqual(['E', 'P6', 'P8']);
      expect(game().turns.P6).toEqual({ dice: [], held: [false, false, false, false, false], rolls: 0, done: false });
    });

    it('opens simultaneous rounds with no seat on turn and one round deadline', () => {
      start(THREE, 'simultaneous', 5_000);
      expect(game()).toMatchObject({ currentTurnSeat: null, roundDeadline: 5_000 + ROUND_MS, roundMs: ROUND_MS });
      expect(yacht.pendingSeats(game())).toEqual(['N', 'E', 'S']);
    });
  });

  describe('rolls and holds', () => {
    beforeEach(() => start());

    it('rolls five dice from the injected source and rolls only the dice that are not held', () => {
      expect(yacht.roll(CODE, 'N', undefined, () => 0)).toEqual({ success: true });
      expect(game().turns.N).toMatchObject({ dice: [1, 1, 1, 1, 1], rolls: 1 });
      expect(yacht.hold(CODE, 'N', [true, false, true, false, false])).toEqual({ success: true });
      expect(yacht.roll(CODE, 'N', undefined, () => 0.999)).toEqual({ success: true });
      expect(game().turns.N).toMatchObject({ dice: [1, 6, 1, 6, 6], held: [true, false, true, false, false], rolls: 2 });
      expect(yacht.roll(CODE, 'N', [false, false, false, false, true], () => 0.4)).toEqual({ success: true });
      expect(game().turns.N).toMatchObject({ dice: [3, 3, 3, 3, 6], rolls: 3 });
    });

    it('allows three rolls and no more', () => {
      for (let roll = 0; roll < 3; roll++) expect(yacht.roll(CODE, 'N', undefined, seeded(roll))).toEqual({ success: true });
      expect(yacht.roll(CODE, 'N')).toEqual({ success: false, reason: 'No rolls left' });
      expect(yacht.hold(CODE, 'N', [true, true, false, false, false])).toEqual({ success: false, reason: 'No rolls left' });
    });

    it('rejects holds before the first roll, malformed masks, and rolling with every die held', () => {
      expect(yacht.hold(CODE, 'N', [true, false, false, false, false])).toEqual({ success: false, reason: 'Roll the dice first' });
      yacht.roll(CODE, 'N', undefined, seeded(1));
      expect(yacht.hold(CODE, 'N', [true])).toEqual({ success: false, reason: 'Invalid dice' });
      expect(yacht.roll(CODE, 'N', [true, true, true, true, true])).toEqual({ success: false, reason: 'Release at least one die to roll' });
      expect(game().turns.N?.rolls).toBe(1);
    });

    it('keeps the hold mask a roll used visible to the table', () => {
      yacht.roll(CODE, 'N', undefined, seeded(2));
      yacht.hold(CODE, 'N', [false, true, false, false, true]);
      expect(yacht.getPlayerVisibleState(CODE, 'S')!.turns.N?.held).toEqual([false, true, false, false, true]);
    });

    it('rejects actions out of turn, from empty seats, and after the match', () => {
      expect(yacht.roll(CODE, 'S')).toEqual({ success: false, reason: 'Not your turn' });
      expect(yacht.roll(CODE, 'W')).toEqual({ success: false, reason: 'Only players in this match can roll.' });
      expect(yacht.score(CODE, 'S', 'chance')).toEqual({ success: false, reason: 'Not your turn' });
      game().phase = 'scoring';
      expect(yacht.roll(CODE, 'N')).toEqual({ success: false, reason: 'Not in playing phase' });
      expect(yacht.roll('NOPE', 'N')).toEqual({ success: false, reason: 'Game not found' });
    });
  });

  describe('scoring', () => {
    beforeEach(() => start(THREE));

    it('needs a roll first and fills exactly one empty box, then passes the turn', () => {
      expect(yacht.score(CODE, 'N', 'chance')).toEqual({ success: false, reason: 'Roll the dice first' });
      setDice('N', [2, 2, 2, 5, 5]);
      expect(yacht.score(CODE, 'N', 'fullHouse', 5_000)).toEqual({ success: true });
      expect(game().cards.N).toEqual({ boxes: { fullHouse: 25 }, extraYachts: 0 });
      expect(game().turns.N?.done).toBe(true);
      expect(game().currentTurnSeat).toBe('E');
      expect(game().log).toEqual([{ type: 'score', round: 1, seat: 'N', box: 'fullHouse', score: 25, bonus: false,
        dice: [2, 2, 2, 5, 5], rolls: 1, timestamp: 5_000 }]);
      expect(yacht.score(CODE, 'N', 'chance')).toEqual({ success: false, reason: 'Not your turn' });
    });

    it('rejects a box that is already filled and leaves the turn open', () => {
      setCard('N', { chance: 10 });
      setDice('N', [1, 2, 3, 4, 6]);
      expect(yacht.score(CODE, 'N', 'chance')).toEqual({ success: false, reason: 'That box is not available for these dice' });
      expect(game().turns.N?.done).toBe(false);
      expect(game().log).toEqual([]);
    });

    it('scores a zero in a box the dice cannot fill', () => {
      setDice('N', [1, 2, 3, 4, 6]);
      expect(yacht.score(CODE, 'N', 'yacht')).toEqual({ success: true });
      expect(game().cards.N?.boxes.yacht).toBe(0);
    });

    it('forces the joker rule and pays the extra Yacht bonus', () => {
      setCard('N', { yacht: 50 });
      setDice('N', [4, 4, 4, 4, 4]);
      expect(yacht.score(CODE, 'N', 'chance')).toEqual({ success: false, reason: 'That box is not available for these dice' });
      expect(yacht.score(CODE, 'N', 'fours', 9_000)).toEqual({ success: true });
      expect(game().cards.N).toEqual({ boxes: { yacht: 50, fours: 20 }, extraYachts: 1 });
      expect(game().log[0]).toMatchObject({ box: 'fours', score: 20, bonus: true });
      // The next Yacht may go to any lower box once the upper one is full, with a full-value straight.
      game().turns = { ...game().turns, N: { dice: [4, 4, 4, 4, 4], held: [false, false, false, false, false], rolls: 1, done: false } };
      game().currentTurnSeat = 'N';
      expect(yacht.score(CODE, 'N', 'largeStraight')).toEqual({ success: true });
      expect(game().cards.N?.boxes.largeStraight).toBe(40);
      expect(game().cards.N?.extraYachts).toBe(2);
    });

    it('opens the next round after the last seat scores, with fresh dice for everyone', () => {
      for (const seat of ['N', 'E', 'S'] as const) {
        setDice(seat, [1, 2, 3, 4, 6]);
        expect(yacht.score(CODE, seat, 'chance')).toEqual({ success: true });
      }
      expect(game()).toMatchObject({ round: 2, currentTurnSeat: 'N' });
      expect(game().turns.N).toEqual({ dice: [], held: [false, false, false, false, false], rolls: 0, done: false });
    });
  });

  describe('simultaneous rounds', () => {
    beforeEach(() => start(THREE, 'simultaneous', 1_000));

    it('lets every seat roll and score its own dice in any order', () => {
      expect(yacht.roll(CODE, 'S', undefined, () => 0)).toEqual({ success: true });
      expect(yacht.roll(CODE, 'N', undefined, () => 0.999)).toEqual({ success: true });
      expect(game().turns.S?.dice).toEqual([1, 1, 1, 1, 1]);
      expect(game().turns.N?.dice).toEqual([6, 6, 6, 6, 6]);
      expect(yacht.score(CODE, 'S', 'ones', 2_000)).toEqual({ success: true });
      expect(yacht.pendingSeats(game())).toEqual(['N', 'E']);
      expect(game().round).toBe(1);
      expect(yacht.roll(CODE, 'S')).toEqual({ success: false, reason: 'You have already scored this round' });
    });

    it('ends the round when everyone has scored and restarts the round timer', () => {
      for (const seat of ['E', 'S', 'N'] as const) {
        setDice(seat, [1, 2, 3, 4, 6]);
        expect(yacht.score(CODE, seat, 'chance', 20_000)).toEqual({ success: true });
      }
      expect(game()).toMatchObject({ round: 2, currentTurnSeat: null, roundDeadline: 20_000 + ROUND_MS });
      expect(yacht.pendingSeats(game())).toEqual(['N', 'E', 'S']);
    });

    it('lets the wrong player never act for another seat', () => {
      expect(yacht.score(CODE, 'W', 'chance')).toEqual({ success: false, reason: 'Only players in this match can roll.' });
    });
  });

  describe('timeout action', () => {
    beforeEach(() => start(THREE));

    it('rolls an unrolled turn and writes the dice into the best box', () => {
      expect(yacht.autoPlay(CODE, 'N', 3_000, () => 0.999)).toEqual({ success: true });
      expect(game().cards.N).toEqual({ boxes: { yacht: 50 }, extraYachts: 0 });
      expect(game().log[0]).toMatchObject({ seat: 'N', dice: [6, 6, 6, 6, 6], rolls: 1 });
      expect(game().currentTurnSeat).toBe('E');
    });

    it('keeps dice that were already rolled', () => {
      setDice('N', [1, 2, 3, 4, 5], 2);
      expect(yacht.autoPlay(CODE, 'N', 3_000, () => 0)).toEqual({ success: true });
      expect(game().log[0]).toMatchObject({ box: 'largeStraight', score: 40, rolls: 2, dice: [1, 2, 3, 4, 5] });
    });

    it('is refused for a seat that is not to act', () => {
      expect(yacht.autoPlay(CODE, 'S')).toEqual({ success: false, reason: 'Not your turn' });
    });

    it('completes every pending seat of a simultaneous round', () => {
      start(THREE, 'simultaneous');
      for (const seat of yacht.pendingSeats(game())) expect(yacht.autoPlay(CODE, seat, 7_000, seeded(3))).toEqual({ success: true });
      expect(game().round).toBe(2);
    });
  });

  describe('match end', () => {
    it('plays thirteen rounds, fills every box, and ranks by total', () => {
      start(THREE);
      playOut(seeded(11));
      const state = game();
      expect(state.log).toHaveLength(YACHT_ROUNDS * 3);
      expect(state.round).toBe(YACHT_ROUNDS);
      for (const seat of ['N', 'E', 'S'] as const) {
        expect(Object.keys(state.cards[seat]!.boxes).sort()).toEqual([...YACHT_BOXES].sort());
      }
      const totals = Object.fromEntries((['N', 'E', 'S'] as const).map((seat) => [seat, yachtTotals(state.cards[seat]!).total]));
      expect(state.result).toMatchObject({ gameType: 'yacht', seats: ['N', 'E', 'S'], mode: 'turns', totals });
      const best = Math.max(...Object.values(totals));
      expect(state.result?.winners).toEqual((['N', 'E', 'S'] as const).filter((seat) => totals[seat] === best));
      expect(state.currentTurnSeat).toBeNull();
    });

    it('lets tied top totals share the win', () => {
      start(TWO);
      const withoutChance = (): Partial<Record<YachtBox, number>> =>
        Object.fromEntries(YACHT_BOXES.filter((box) => box !== 'chance').map((box) => [box, 0]));
      game().round = YACHT_ROUNDS;
      setCard('N', withoutChance());
      setCard('S', withoutChance());
      setDice('N', [1, 2, 3, 4, 6]);
      expect(yacht.score(CODE, 'N', 'chance')).toEqual({ success: true });
      setDice('S', [6, 6, 2, 1, 1]);
      expect(yacht.score(CODE, 'S', 'chance')).toEqual({ success: true });
      expect(game().phase).toBe('scoring');
      expect(game().result).toMatchObject({ winners: ['N', 'S'], totals: { N: 16, S: 16 } });
    });

    it('names the single winner when totals differ', () => {
      start(TWO);
      const withoutChance = (): Partial<Record<YachtBox, number>> =>
        Object.fromEntries(YACHT_BOXES.filter((box) => box !== 'chance').map((box) => [box, 0]));
      game().round = YACHT_ROUNDS;
      setCard('N', withoutChance());
      setCard('S', withoutChance());
      setDice('N', [1, 2, 3, 4, 6]);
      yacht.score(CODE, 'N', 'chance');
      setDice('S', [6, 6, 6, 6, 5]);
      yacht.score(CODE, 'S', 'chance');
      expect(game().result).toMatchObject({ winners: ['S'], totals: { N: 16, S: 29 } });
    });

    it('plays a simultaneous match to the end too', () => {
      start(THREE, 'simultaneous');
      playOut(seeded(5));
      expect(game().result).toMatchObject({ mode: 'simultaneous' });
      expect(game().roundDeadline).toBeNull();
    });
  });

  describe('visible state', () => {
    it('shows every seat the same public dice and cards', () => {
      start(THREE);
      yacht.roll(CODE, 'N', undefined, seeded(4));
      const north = yacht.getPlayerVisibleState(CODE, 'N')!;
      const south = yacht.getPlayerVisibleState(CODE, 'S')!;
      expect(north.mySeat).toBe('N');
      expect(south.mySeat).toBe('S');
      expect({ ...north, mySeat: 'S' }).toEqual(south);
      expect(north.turns.N?.dice).toHaveLength(5);
      expect(north.seats).toEqual(['N', 'E', 'S']);
    });

    it('gives spectators the same view through the game manager', () => {
      games.startGame(CODE, 'yacht', THREE, undefined, { yacht: { mode: 'turns' } });
      expect(games.getPlayerVisibleState(CODE, 'N')).toMatchObject({ gameType: 'yacht', options: { mode: 'turns' } });
      games.abortGame(CODE);
    });
  });

  describe('adapter hooks', () => {
    afterEach(() => games.abortGame(CODE));

    it('exposes the turn seat in turn mode and only the shared window in simultaneous mode', () => {
      start(THREE);
      expect(yachtAdapter.turnSeat(game())).toBe('N');
      expect(yachtAdapter.sharedDeadline?.window(game())).toBeNull();
      expect(yachtAdapter.sharedDeadline?.owingSeats(game())).toBeNull();
      start(THREE, 'simultaneous', 9_000);
      expect(yachtAdapter.turnSeat(game())).toBeNull();
      expect(yachtAdapter.sharedDeadline?.window(game())).toEqual({ key: `${game().id}:round:1`, deadline: 9_000 + ROUND_MS });
      expect(yachtAdapter.sharedDeadline?.owingSeats(game())).toEqual(['N', 'E', 'S']);
      expect(yachtAdapter.matchResult(game())).toBeNull();
    });

    it('refuses the automatic action from a player but runs it for the schedulers', () => {
      games.startGame(CODE, 'yacht', THREE, undefined, { yacht: { mode: 'turns' } });
      const auto = { gameType: 'yacht', action: { type: 'auto' } } as const;
      expect(games.handleGameAction(CODE, 'N', auto).success).toBe(false);
      expect(games.handleGameAction(CODE, 'N', auto, true).success).toBe(true);
      expect(games.getGameState(CODE)).toMatchObject({ currentTurnSeat: 'E' });
    });

    it('keeps one turn clock across rolls and refills the reserves in a new round', () => {
      games.startGame(CODE, 'yacht', TWO, undefined, { yacht: { mode: 'turns' } });
      const state = games.getGameState(CODE)!;
      const first = state.clock!.turn!.id;
      expect(games.handleGameAction(CODE, 'N', { gameType: 'yacht', action: { type: 'roll' } }).success).toBe(true);
      expect(state.clock!.turn).toMatchObject({ seat: 'N' });
      expect(games.handleGameAction(CODE, 'N', { gameType: 'yacht', action: { type: 'score', box: 'chance' } }).success).toBe(true);
      expect(state.clock!.turn).toMatchObject({ seat: 'S' });
      expect(state.clock!.turn!.id).not.toBe(first);
    });

    it('gives a simultaneous match no turn clock and rejects manual moves after the round deadline', () => {
      games.startGame(CODE, 'yacht', TWO, undefined, { yacht: { mode: 'simultaneous' } });
      const state = games.getGameState(CODE) as YachtGameState;
      expect(state.clock?.turn).toBeNull();
      expect(games.handleGameAction(CODE, 'N', { gameType: 'yacht', action: { type: 'roll' } }).success).toBe(true);
      state.roundDeadline = Date.now() - 1;
      expect(games.handleGameAction(CODE, 'S', { gameType: 'yacht', action: { type: 'roll' } })).toEqual({
        success: false, reason: 'The round time is over' });
      expect(games.handleGameAction(CODE, 'S', { gameType: 'yacht', action: { type: 'auto' } }, true).success).toBe(true);
    });
  });

  describe('persistence', () => {
    it('accepts every committed state of bot-played matches in both modes', () => {
      for (const [players, mode, seed] of [[TWO, 'turns', 1], [THREE, 'simultaneous', 2], [EIGHT, 'turns', 3], [EIGHT, 'simultaneous', 4]] as const) {
        start(players, mode);
        expect(isRuntimeSnapshot(snapshotOf(game()))).toBe(true);
        playOut(seeded(seed), (state) => {
          const stored = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
          expect(yachtGame(stored, () => true)).toBe(true);
          expect(coherentYachtGame(state)).toBe(true);
        });
        expect(isRuntimeSnapshot(snapshotOf(game()))).toBe(true);
        expect(isYachtResult(JSON.parse(JSON.stringify(game().result)))).toBe(true);
      }
    });

    it('rejects altered scores, totals, turns, rounds, and results', () => {
      start(THREE);
      playOut(seeded(8), undefined);
      const finished = structuredClone(game());
      expect(coherentYachtGame(finished)).toBe(true);
      const tamper = (change: (state: YachtGameState) => void): boolean => {
        const copy = structuredClone(finished);
        change(copy);
        return coherentYachtGame(copy);
      };
      expect(tamper((state) => { state.cards.N = { boxes: { ...state.cards.N!.boxes, chance: 1 }, extraYachts: 0 }; })).toBe(false);
      expect(tamper((state) => { state.log[0] = { ...state.log[0], score: state.log[0].score + 1 }; })).toBe(false);
      expect(tamper((state) => { state.log.reverse(); })).toBe(false);
      expect(tamper((state) => { state.log.pop(); })).toBe(false);
      expect(tamper((state) => { state.result = { ...state.result!, winners: ['N', 'E', 'S'] }; })).toBe(false);
      expect(tamper((state) => { state.phase = 'playing'; })).toBe(false);
    });

    it('rejects a playing state with a misplaced turn, a stale deadline, or a finished turn out of the log', () => {
      start(THREE);
      yacht.roll(CODE, 'N', undefined, seeded(6));
      const open = structuredClone(game());
      expect(coherentYachtGame(open)).toBe(true);
      const tamper = (change: (state: YachtGameState) => void): boolean => {
        const copy = structuredClone(open);
        change(copy);
        return coherentYachtGame(copy);
      };
      expect(tamper((state) => { state.currentTurnSeat = 'E'; })).toBe(false);
      expect(tamper((state) => { state.roundDeadline = 1; })).toBe(false);
      expect(tamper((state) => { state.turns.E = { ...state.turns.E!, done: true }; })).toBe(false);
      expect(tamper((state) => { state.turns.S = { ...state.turns.S!, rolls: 2, dice: [1, 2, 3, 4, 5] }; })).toBe(false);
      expect(tamper((state) => { state.round = 2; })).toBe(false);
    });
  });
});
