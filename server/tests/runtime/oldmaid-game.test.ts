import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AnyGameState, Card, CardOrJoker, GameSeat, OldMaidGameState, PlayerInfo, PlayerVisibleGameState, Seat,
} from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { getPresentationFrames } from '@shared/game-presentation';
import { cardKey, isJoker } from '@shared/rules/cards';
import { OM_DEALS, omDeck } from '@shared/rules/oldmaid';
import { gameSeatMap } from '@shared/rules/seats';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as oldmaid from '../../src/managers/games/oldmaid-game';
import { oldMaidAdapter } from '../../src/managers/games/oldmaid-adapter';
import * as games from '../../src/managers/game-manager';
import { isOldMaidResult, isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'MAID01';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function table(seats: readonly GameSeat[]): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(seats.map((seat) => [seat, player(seat)]));
}

const TWO = table(['N', 'E']);
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

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const JOKER: CardOrJoker = { joker: 'big' };

function game(): OldMaidGameState {
  const state = oldmaid.getGameState(CODE);
  if (!state) throw new Error('Expected an Old Maid game');
  return state;
}

/** Replaces the hands of the listed seats (others empty) and hands the turn to `turn`. */
function setHands(hands: Partial<Record<GameSeat, CardOrJoker[]>>, turn: GameSeat): void {
  const state = game();
  state.hands = gameSeatMap((seat) => hands[seat] ?? []);
  state.currentTurnSeat = turn;
  state.finished = [];
}

function wholeDeckKeys(state: OldMaidGameState): string[] {
  const pairs = state.log.reduce<number>((from, entry, index) => (entry.type === 'deal' ? index : from), 0);
  const gone = state.log.slice(pairs).flatMap((entry) => (entry.type === 'deal'
    ? GAME_SEAT_ORDER.flatMap((seat) => entry.discards[seat]) : entry.type === 'draw' ? entry.discarded : []));
  return [...GAME_SEAT_ORDER.flatMap((seat) => state.hands[seat]), ...gone].map(cardKey).sort();
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
        code: CODE, gameType: 'oldmaid', status: playing ? 'playing' : 'waiting', createdAt: 1,
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

/** Plays with the hard bot, or the easy one for odd seats, until the match ends. */
function playOut(random: () => number, onStep?: () => void): void {
  for (let step = 0; step < 5_000 && game().phase === 'playing'; step++) {
    const seat = game().currentTurnSeat;
    const visible = oldmaid.getPlayerVisibleState(CODE, seat)!;
    const action = getBotAction(visible, random, GAME_SEAT_ORDER.indexOf(seat) % 2 === 0 ? 'hard' : 'easy');
    if (action?.type !== 'game-action' || action.request.gameType !== 'oldmaid') throw new Error('Expected an Old Maid action');
    const move = action.request.action;
    if (move.type !== 'draw') throw new Error('Bots only draw');
    expect(oldmaid.draw(CODE, seat, move.index, move.reorder, Date.now(), random)).toEqual({ success: true });
    onStep?.();
  }
  expect(game().phase).toBe('scoring');
}

describe('Old Maid gameplay', () => {
  beforeEach(() => oldmaid.restoreGames([]));
  afterEach(() => oldmaid.restoreGames([]));

  describe('start', () => {
    it('should deal all 53 cards, discard pairs publicly, and open with the first seat', () => {
      oldmaid.startGame(CODE, FOUR, seeded(1), 1000);
      const state = game();
      expect(wholeDeckKeys(state)).toEqual(omDeck().map(cardKey).sort());
      const entry = state.log[0];
      if (entry.type !== 'deal') throw new Error('Expected a deal');
      expect(entry).toMatchObject({ deal: 1, starter: 'N', timestamp: 1000 });
      for (const seat of ['N', 'E', 'S', 'W'] as const) {
        expect(entry.counts[seat]).toBe(state.hands[seat].length);
        expect(entry.discards[seat].length % 2).toBe(0);
        const ranks = state.hands[seat].filter((card): card is Card => !isJoker(card)).map((card) => card.rank);
        expect(new Set(ranks).size).toBe(ranks.length);
      }
      expect(state.hands.N.length + entry.discards.N.length).toBe(14);
      expect(state.hands.W.length + entry.discards.W.length).toBe(13);
      expect(state).toMatchObject({ phase: 'playing', deal: 1, totals: gameSeatMap(() => 0), result: null });
    });

    it('should seat only the players present and keep empty seats out of every hand', () => {
      oldmaid.startGame(CODE, table(['E', 'P6', 'P8']), seeded(2), 1);
      const state = game();
      expect(GAME_SEAT_ORDER.map((seat) => state.hands[seat].length > 0)).toEqual([false, true, false, false, false, true, false, true]);
      expect(state.currentTurnSeat).toBe('E');
      expect(wholeDeckKeys(state)).toEqual(omDeck().map(cardKey).sort());
    });

    it('should shuffle from the injected source only', () => {
      oldmaid.startGame(CODE, FOUR, seeded(9), 1);
      const first = structuredClone(game().hands);
      oldmaid.startGame(CODE, FOUR, seeded(9), 1);
      expect(game().hands).toEqual(first);
      oldmaid.startGame(CODE, FOUR, seeded(10), 1);
      expect(game().hands).not.toEqual(first);
    });

    it('should use a secure default source whose deals vary between games', () => {
      const seen = new Set<string>();
      for (let index = 0; index < 8; index++) {
        oldmaid.startGame(CODE, EIGHT);
        seen.add(JSON.stringify(game().hands));
      }
      expect(seen.size).toBeGreaterThan(1);
    });

    it('should let the starter be the first seat that holds cards when the starter is already out', () => {
      // A random source tuned until the first hand pairs out would be brittle; check the rule on the module's output.
      for (let seed = 1; seed < 400; seed++) {
        oldmaid.startGame(CODE, THREE, seeded(seed), 1);
        const state = game();
        const deal = state.log[0];
        if (deal.type !== 'deal' || deal.finished.length === 0) continue;
        expect(state.finished).toEqual(expect.arrayContaining(deal.finished));
        expect(state.hands[state.currentTurnSeat].length).toBeGreaterThan(0);
        return;
      }
    });
  });

  describe('drawing', () => {
    beforeEach(() => oldmaid.startGame(CODE, THREE, seeded(5), 1));

    it('should take the chosen position from the next seat and discard a completed pair', () => {
      setHands({ N: [c('hearts', 5), c('clubs', 9)], E: [c('clubs', 2), c('spades', 5), JOKER], S: [c('diamonds', 3)] }, 'N');
      expect(oldmaid.draw(CODE, 'N', 1, undefined, 50, () => 0)).toEqual({ success: true });
      const state = game();
      expect(state.hands.N).toEqual([c('clubs', 9)]);
      expect(state.hands.E).toEqual([c('clubs', 2), JOKER]);
      expect(state.log.at(-1)).toEqual({
        type: 'draw', seat: 'N', from: 'E', index: 1, discarded: [c('spades', 5), c('hearts', 5)], finished: [], timestamp: 50,
      });
      expect(state.currentTurnSeat).toBe('E');
    });

    it('should place the drawn card at a position chosen by the random source', () => {
      for (const [random, expected] of [[0, 0], [0.999, 2]] as const) {
        setHands({ N: [c('hearts', 5), c('clubs', 9)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
        oldmaid.draw(CODE, 'N', 0, undefined, 1, () => random);
        expect(game().hands.N.findIndex((card) => cardKey(card) === 'C2')).toBe(expected);
      }
    });

    it('should draw from the joker position and keep the joker in the drawer\'s hand', () => {
      setHands({ N: [c('hearts', 5)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
      oldmaid.draw(CODE, 'N', 1, undefined, 1, () => 0);
      expect(game().hands.N.some(isJoker)).toBe(true);
      expect(game().hands.E).toEqual([c('clubs', 2)]);
    });

    it('should skip seats that finished when choosing who draws next and from whom', () => {
      setHands({ N: [c('hearts', 5), c('clubs', 9)], E: [c('spades', 5)], S: [c('diamonds', 3), JOKER] }, 'N');
      oldmaid.draw(CODE, 'N', 0, undefined, 1, () => 0);
      const state = game();
      expect(state.finished).toEqual(['E']);
      expect(state.log.at(-1)).toMatchObject({ type: 'draw', finished: ['E'], discarded: [c('spades', 5), c('hearts', 5)] });
      expect(state.currentTurnSeat).toBe('S');
      expect(oldmaid.drawSource(state, 'S')).toBe('N');
    });

    it('should finish the drawer and the drawn-from seat in that order when both run out', () => {
      setHands({ N: [c('hearts', 5)], E: [c('spades', 5)], S: [c('diamonds', 3), JOKER] }, 'N');
      oldmaid.draw(CODE, 'N', 0, undefined, 1, () => 0);
      expect(game().log.find((entry) => entry.type === 'draw')).toMatchObject({ finished: ['E', 'N'] });
      expect(game().dealOrders).toEqual([['E', 'N', 'S']]);
    });

    it('should reject picks outside the neighbour\'s hand without changing anything', () => {
      setHands({ N: [c('hearts', 5)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
      const before = structuredClone(game());
      for (const index of [-1, 2, 1.5, Number.NaN]) {
        expect(oldmaid.draw(CODE, 'N', index, undefined, 1).success).toBe(false);
      }
      expect(game()).toEqual(before);
    });

    it('should reject draws out of turn, from outsiders, or in the wrong phase', () => {
      setHands({ N: [c('hearts', 5)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
      const before = structuredClone(game());
      expect(oldmaid.draw(CODE, 'E', 0, undefined, 1).success).toBe(false);
      expect(oldmaid.draw(CODE, 'W', 0, undefined, 1).success).toBe(false);
      expect(oldmaid.draw('NOPE', 'N', 0, undefined, 1)).toEqual({ success: false, reason: 'Game not found' });
      expect(game()).toEqual(before);
      game().phase = 'scoring';
      expect(oldmaid.draw(CODE, 'N', 0, undefined, 1)).toEqual({ success: false, reason: 'Not in playing phase' });
    });

    it('should apply a reorder carried by the draw first and reject one that is not a permutation', () => {
      setHands({ N: [c('hearts', 5), c('clubs', 9), c('spades', 11)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
      const before = structuredClone(game());
      expect(oldmaid.draw(CODE, 'N', 0, [0, 0, 1], 1).success).toBe(false);
      expect(oldmaid.draw(CODE, 'N', 0, [0, 1], 1).success).toBe(false);
      expect(game()).toEqual(before);
      expect(oldmaid.draw(CODE, 'N', 0, [2, 1, 0], 1, () => 0.999).success).toBe(true);
      expect(game().hands.N).toEqual([c('spades', 11), c('clubs', 9), c('hearts', 5), c('clubs', 2)]);
    });
  });

  describe('reordering', () => {
    beforeEach(() => oldmaid.startGame(CODE, THREE, seeded(5), 1));

    it('should let any seated player rearrange their own hand at any time without a log entry', () => {
      setHands({ N: [c('hearts', 5)], E: [c('clubs', 2), c('clubs', 4), JOKER], S: [c('diamonds', 3)] }, 'N');
      const log = game().log.length;
      expect(oldmaid.reorder(CODE, 'E', [2, 0, 1])).toEqual({ success: true });
      expect(game().hands.E).toEqual([JOKER, c('clubs', 2), c('clubs', 4)]);
      expect(game().log).toHaveLength(log);
      expect(game().currentTurnSeat).toBe('N');
    });

    it('should reject a bad order, an outsider and a finished game', () => {
      setHands({ N: [c('hearts', 5)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
      const before = structuredClone(game());
      expect(oldmaid.reorder(CODE, 'E', [0, 0]).success).toBe(false);
      expect(oldmaid.reorder(CODE, 'E', [0]).success).toBe(false);
      expect(oldmaid.reorder(CODE, 'E', [0, 2]).success).toBe(false);
      expect(oldmaid.reorder(CODE, 'W', []).success).toBe(false);
      expect(oldmaid.reorder('NOPE', 'E', [0, 1]).success).toBe(false);
      expect(game()).toEqual(before);
      game().phase = 'scoring';
      expect(oldmaid.reorder(CODE, 'E', [1, 0]).success).toBe(false);
    });
  });

  describe('deals and scoring', () => {
    it('should settle a deal with placement points and open the next deal with the next starter', () => {
      oldmaid.startGame(CODE, THREE, seeded(5), 1);
      setHands({ N: [c('hearts', 5)], E: [c('spades', 5), JOKER], S: [] }, 'N');
      game().finished = ['S'];
      expect(oldmaid.draw(CODE, 'N', 0, undefined, 9, seeded(1))).toEqual({ success: true });
      const settle = game().log.find((entry) => entry.type === 'settle');
      expect(settle).toEqual({
        type: 'settle', deal: 1, order: ['S', 'N', 'E'], loser: 'E', points: { N: 1, E: 0, S: 2, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 },
        totals: { N: 1, E: 0, S: 2, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, timestamp: 9,
      });
      const state = game();
      expect(state).toMatchObject({ phase: 'playing', deal: 2, totals: { N: 1, E: 0, S: 2 }, dealOrders: [['S', 'N', 'E']] });
      const deal = state.log.at(-1);
      expect(deal).toMatchObject({ type: 'deal', deal: 2, starter: 'E' });
      expect(wholeDeckKeys(state)).toEqual(omDeck().map(cardKey).sort());
    });

    it('should end the match after the last deal with totals, orders and the top scorers', () => {
      oldmaid.startGame(CODE, TWO, seeded(5), 1);
      const random = seeded(77);
      playOut(random);
      const state = game();
      expect(state.deal).toBe(OM_DEALS);
      expect(state.dealOrders).toHaveLength(OM_DEALS);
      const result = state.result!;
      expect(result).toMatchObject({ gameType: 'oldmaid', seats: ['N', 'E'], deals: OM_DEALS });
      expect(result.dealOrders.map((order) => order.length)).toEqual([2, 2, 2]);
      const wins = (seat: GameSeat): number => result.dealOrders.filter((order) => order[0] === seat).length;
      expect(result.totals.N).toBe(wins('N'));
      expect(result.totals.E).toBe(wins('E'));
      expect(result.winners).toEqual(result.totals.N === result.totals.E ? ['N', 'E']
        : result.totals.N > result.totals.E ? ['N'] : ['E']);
      expect(oldmaid.draw(CODE, state.currentTurnSeat, 0, undefined, 1).success).toBe(false);
    });

    it('should hold the joker only in the loser\'s hand when a deal ends', () => {
      for (let seed = 1; seed <= 12; seed++) {
        const random = seeded(seed);
        oldmaid.startGame(CODE, FOUR, random, 1);
        let deal = 1;
        while (game().phase === 'playing') {
          const seat = game().currentTurnSeat;
          const visible = oldmaid.getPlayerVisibleState(CODE, seat)!;
          const action = getBotAction(visible, random, 'easy');
          if (action?.type !== 'game-action' || action.request.gameType !== 'oldmaid' || action.request.action.type !== 'draw') {
            throw new Error('Expected a draw');
          }
          oldmaid.draw(CODE, seat, action.request.action.index, undefined, 1, random);
          const settled = game().log.findLast((entry) => entry.type === 'settle');
          if (settled?.type === 'settle' && settled.deal === deal) {
            expect(settled.order.at(-1)).toBe(settled.loser);
            expect(settled.order).toHaveLength(4);
            deal += 1;
          }
        }
        const last = game().result!.dealOrders.at(-1)!;
        const holders = GAME_SEAT_ORDER.filter((seat) => game().hands[seat].length > 0);
        expect(holders).toEqual([last.at(-1)]);
        expect(game().hands[holders[0]]).toEqual([JOKER]);
      }
    });
  });

  describe('visible state', () => {
    beforeEach(() => {
      oldmaid.startGame(CODE, FOUR, seeded(8), 1);
      setHands({
        N: [c('hearts', 5), c('clubs', 9)],
        E: [c('clubs', 2), JOKER, c('hearts', 13)],
        S: [c('diamonds', 3), c('spades', 8)],
        W: [c('spades', 10), c('hearts', 4)],
      }, 'N');
    });

    it('should show a seat only its own hand and the counts of the others', () => {
      const view = oldmaid.getPlayerVisibleState(CODE, 'N')!;
      expect(view.myHand).toEqual([c('hearts', 5), c('clubs', 9)]);
      expect(view.handCounts).toEqual({ N: 2, E: 3, S: 2, W: 2, P5: 0, P6: 0, P7: 0, P8: 0 });
      expect(view.drawFrom).toBe('E');
      expect(view).not.toHaveProperty('hands');
      expect(view.observedHands).toBeUndefined();
      const json = JSON.stringify(view);
      const published = JSON.stringify(view.log);
      const hidden = [...game().hands.E, ...game().hands.S, ...game().hands.W].map((card) => JSON.stringify(card))
        .filter((text) => !published.includes(text));
      expect(hidden).toContain(JSON.stringify(JOKER));
      for (const text of hidden) expect(json).not.toContain(text);
    });

    it('should not let the drawer learn where the joker is: the view is identical wherever it sits', () => {
      const views = [[JOKER, c('clubs', 2), c('hearts', 13)], [c('clubs', 2), JOKER, c('hearts', 13)],
        [c('clubs', 2), c('hearts', 13), JOKER]].map((hand) => {
        game().hands.E = hand;
        return JSON.stringify(oldmaid.getPlayerVisibleState(CODE, 'N'));
      });
      expect(new Set(views).size).toBe(1);
    });

    it('should not let a reorder change what the drawer or anyone else sees', () => {
      const before = ['N', 'S', 'W'].map((seat) => JSON.stringify(oldmaid.getPlayerVisibleState(CODE, seat as GameSeat)));
      expect(oldmaid.reorder(CODE, 'E', [2, 0, 1])).toEqual({ success: true });
      expect(oldmaid.reorder(CODE, 'E', [1, 2, 0])).toEqual({ success: true });
      const after = ['N', 'S', 'W'].map((seat) => JSON.stringify(oldmaid.getPlayerVisibleState(CODE, seat as GameSeat)));
      expect(after).toEqual(before);
      expect(oldmaid.getPlayerVisibleState(CODE, 'E')!.myHand).toEqual([c('clubs', 2), JOKER, c('hearts', 13)]
        .map((_card, index) => game().hands.E[index]));
    });

    it('should publish only pairs and positions: a drawn non-pair card never reaches the log', () => {
      oldmaid.draw(CODE, 'N', 1, undefined, 5, () => 0.5);
      const log = JSON.stringify(oldmaid.getPlayerVisibleState(CODE, 'S')!.log);
      expect(log).not.toContain('joker');
      const entry = oldmaid.getPlayerVisibleState(CODE, 'S')!.log.at(-1);
      expect(entry).toEqual({ type: 'draw', seat: 'N', from: 'E', index: 1, discarded: [], finished: [], timestamp: 5 });
      // The drawer's own view holds the card, other seats' views do not.
      expect(oldmaid.getPlayerVisibleState(CODE, 'N')!.myHand.some(isJoker)).toBe(true);
      for (const seat of ['E', 'S', 'W'] as const) {
        expect(oldmaid.getPlayerVisibleState(CODE, seat)!.myHand.some(isJoker)).toBe(false);
      }
    });

    it('should give the joker\'s drawer no hint through the insertion position', () => {
      // The joker lands wherever the random source says, so its slot is independent of the card taken.
      const slots = new Set<number>();
      for (const random of [0, 0.4, 0.7, 0.99]) {
        setHands({ N: [c('hearts', 5), c('clubs', 9)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] }, 'N');
        oldmaid.draw(CODE, 'N', 1, undefined, 1, () => random);
        slots.add(game().hands.N.findIndex(isJoker));
      }
      expect(slots.size).toBeGreaterThan(1);
    });

    it('should add every hand only to spectators through the game manager', () => {
      games.startGame(CODE, 'oldmaid', FOUR);
      const live = games.getGameState(CODE);
      if (live?.gameType !== 'oldmaid') throw new Error('Expected an Old Maid game');
      delete live.presentation;
      const spectator = games.getRecipientVisibleState(CODE, null) as Extract<PlayerVisibleGameState, { gameType: 'oldmaid' }>;
      expect(spectator.observer).toBe('spectator');
      expect(spectator.observedHands).toEqual(live.hands);
      for (const seat of ['N', 'E', 'S', 'W'] as const) {
        const seated = games.getRecipientVisibleState(CODE, seat);
        expect(seated?.observer).toBeUndefined();
        expect(seated && 'observedHands' in seated ? seated.observedHands : undefined).toBeUndefined();
      }
      games.removeGame(CODE);
    });
  });

  describe('adapter hooks', () => {
    it('should expose the turn and the stored result', () => {
      oldmaid.startGame(CODE, THREE, seeded(3), 1);
      const state = game();
      expect(oldMaidAdapter.turnSeat(state)).toBe(state.currentTurnSeat);
      expect(oldMaidAdapter.matchResult(state)).toBeNull();
      playOut(seeded(4));
      expect(oldMaidAdapter.matchResult(game())).toBe(game().result);
    });

    it('should apply reorder without a presentation or turn change and draws with one', () => {
      games.startGame(CODE, 'oldmaid', THREE);
      const state = games.getGameState(CODE);
      if (state?.gameType !== 'oldmaid') throw new Error('Expected an Old Maid game');
      delete state.presentation;
      const turn = state.currentTurnSeat;
      const other = GAME_SEAT_ORDER.find((seat) => THREE[seat] && seat !== turn && state.hands[seat].length >= 2)!;
      const order = state.hands[other].map((_card, index) => state.hands[other].length - 1 - index);
      expect(games.handleGameAction(CODE, other, { gameType: 'oldmaid', action: { type: 'reorder', order } }).success).toBe(true);
      expect(state.presentation).toBeUndefined();
      expect(state.currentTurnSeat).toBe(turn);
      expect(games.handleGameAction(CODE, turn, { gameType: 'oldmaid', action: { type: 'draw', index: 0 } }).success).toBe(true);
      expect(state.presentation).toBeDefined();
      games.removeGame(CODE);
    });
  });

  describe('presentation', () => {
    afterEach(() => vi.useRealTimers());

    it('should open with a deal frame that lists discards, then show a draw frame without naming the card', () => {
      games.startGame(CODE, 'oldmaid', THREE);
      const state = games.getGameState(CODE)!;
      if (state.gameType !== 'oldmaid') throw new Error('Expected an Old Maid game');
      expect(getPresentationFrames(state)).toEqual([expect.objectContaining({
        kind: 'deal', durationMs: 2600, seat: 'N', cards: [] })]);
      delete state.presentation;
      state.hands = gameSeatMap((seat) => ({ N: [c('hearts', 5), c('clubs', 9)], E: [c('clubs', 2), JOKER], S: [c('diamonds', 3)] } as Partial<Record<GameSeat, CardOrJoker[]>>)[seat] ?? []);
      state.currentTurnSeat = 'N';
      state.finished = [];
      expect(games.handleGameAction(CODE, 'N', { gameType: 'oldmaid', action: { type: 'draw', index: 1 } }).success).toBe(true);
      const frames = getPresentationFrames(state);
      expect(frames).toEqual([expect.objectContaining({ kind: 'draw', durationMs: 1600, seat: 'N', target: 'E',
        handIndex: 1, cards: [] })]);
      expect(JSON.stringify(frames)).not.toContain('joker');
      games.removeGame(CODE);
    });
  });

  describe('persistence', () => {
    it('should accept every committed state of bot-played matches, for small and full tables', () => {
      for (const [seed, seats] of [[11, FOUR], [12, THREE], [13, EIGHT], [14, table(['N', 'P5'])]] as const) {
        const random = seeded(seed);
        oldmaid.startGame(CODE, seats, random, 1);
        expect(persists(game())).toBe(true);
        playOut(random, () => expect(persists(game())).toBe(true));
        const finished = game();
        expect(persists(finished)).toBe(true);
        expect(isOldMaidResult(finished.result)).toBe(true);
        expect(finished.result?.seats).toEqual(GAME_SEAT_ORDER.filter((seat) => seats[seat]));
      }
    });

    it('should reject altered logs, hands, totals, turns and results', () => {
      const random = seeded(21);
      oldmaid.startGame(CODE, FOUR, random, 1);
      for (let step = 0; step < 6; step++) {
        const seat = game().currentTurnSeat;
        oldmaid.draw(CODE, seat, 0, undefined, 1, random);
      }
      const live = structuredClone(game());
      expect(persists(live)).toBe(true);
      const mutate = (base: OldMaidGameState, change: (copy: OldMaidGameState) => void): boolean => {
        const copy = structuredClone(base);
        change(copy);
        return persists(copy);
      };
      expect(mutate(live, (copy) => { copy.currentTurnSeat = copy.currentTurnSeat === 'N' ? 'E' : 'N'; })).toBe(false);
      expect(mutate(live, (copy) => { copy.hands.N.pop(); })).toBe(false);
      expect(mutate(live, (copy) => { copy.hands.N.reverse().push({ joker: 'small' }); })).toBe(false);
      expect(mutate(live, (copy) => { copy.log.splice(1, 1); })).toBe(false);
      expect(mutate(live, (copy) => { copy.deal = 2; })).toBe(false);
      expect(mutate(live, (copy) => { copy.totals.N += 1; })).toBe(false);
      expect(mutate(live, (copy) => {
        const draw = copy.log.find((entry) => entry.type === 'draw');
        if (draw?.type === 'draw') (draw as { index: number }).index += 9;
      })).toBe(false);

      playOut(random);
      const finished = structuredClone(game());
      expect(persists(finished)).toBe(true);
      expect(mutate(finished, (copy) => { copy.result = { ...copy.result!, winners: [] }; })).toBe(false);
      expect(mutate(finished, (copy) => { copy.result = { ...copy.result!, totals: { ...copy.result!.totals, N: 99 } }; })).toBe(false);
      expect(mutate(finished, (copy) => { copy.result = null; })).toBe(false);
      expect(mutate(finished, (copy) => { copy.dealOrders.pop(); })).toBe(false);
    });
  });
});
