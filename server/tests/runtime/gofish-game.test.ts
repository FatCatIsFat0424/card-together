import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER, RANK_ORDER_DESC } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo, Rank } from '@shared/types';
import type { GoFishGameState } from '@shared/games/gofish/types';
import { GF_BOOKS_PER_HAND, GF_HANDS, gfHandSize } from '@shared/rules/gofish';
import { createDeck } from '../../src/engine/deck';
import * as gf from '../../src/managers/games/gofish-game';
import { goFishAdapter } from '../../src/managers/games/gofish-adapter';
import { isGoFishResult } from '../../src/managers/games/gofish-validation';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'GF0001';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, player(seat)]));
}

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/**
 * Deck layout for `count` players: each seat's hand in seat order, then the stock top-first;
 * unset slots are filled from the remaining cards in order.
 */
function deckWith(count: number, hands: Record<number, Card[]> = {}, stock: Card[] = []): Card[] {
  const size = gfHandSize(count);
  const slots: (Card | null)[] = Array.from({ length: 52 }, () => null);
  for (const [index, cards] of Object.entries(hands)) cards.forEach((entry, offset) => { slots[Number(index) * size + offset] = entry; });
  stock.forEach((entry, offset) => { slots[size * count + offset] = entry; });
  const rest = createDeck();
  for (const slot of slots) if (slot) rest.splice(rest.findIndex((entry) => same(slot, entry)), 1);
  return slots.map((slot) => slot ?? rest.shift()!);
}

function state(): GoFishGameState {
  const game = gf.getGameState(CODE);
  if (!game) throw new Error('Expected a Go Fish game');
  return game;
}

function persists(): boolean {
  const game = state();
  const playing = game.phase === 'playing';
  const ids = Object.values(game.players).map((entry) => entry.id);
  const seat = (position: GameSeat): { player: PlayerInfo | null; isReady: boolean } => ({
    player: game.players[position] ?? null, isReady: playing && Boolean(game.players[position]),
  });
  const snapshot: RuntimeSnapshot = {
    players: Object.values(game.players).map((info) => ({ info, currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{
      info: {
        code: CODE, gameType: 'gofish', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: ids[0], abortVote: null, abortVoteCooldownUntil: null,
        seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
        additionalSeats: GAME_SEAT_ORDER.slice(4, 6).map(seat),
      },
      memberIds: ids,
    }],
    games: [structuredClone(game)],
    chat: [],
  };
  return isRuntimeSnapshot(snapshot);
}

/** Every card is in a hand, the stock, or a laid-down book. */
function conserved(): boolean {
  const game = state();
  const booked = GAME_SEAT_ORDER.reduce((sum, seat) => sum + game.books[seat].length, 0);
  const loose = [...GAME_SEAT_ORDER.flatMap((seat) => game.hands[seat]), ...game.stock];
  return loose.length + booked * 4 === 52 && new Set(loose.map((entry) => `${entry.suit}-${entry.rank}`)).size === loose.length;
}

interface Arrangement {
  readonly hands: Partial<Record<GameSeat, Card[]>>;
  readonly stock?: Card[];
  readonly turn: GameSeat;
  /** Books each seat holds; ranks missing from every hand and the stock are dealt out in this order */
  readonly booksBy?: Partial<Record<GameSeat, number>>;
}

/**
 * Replaces the hand in play with a chosen position. Every rank is either wholly in hands and stock or
 * already a book, so the position stays a legal one.
 */
function arrange(spec: Arrangement): void {
  const game = state();
  const stock = spec.stock ?? [];
  const loose = [...GAME_SEAT_ORDER.flatMap((seat) => spec.hands[seat] ?? []), ...stock];
  const present = new Set(loose.map((entry) => entry.rank));
  for (const rank of present) expect(loose.filter((entry) => entry.rank === rank)).toHaveLength(4);
  const booked = RANK_ORDER_DESC.filter((rank) => !present.has(rank)).reverse();
  const by = spec.booksBy ?? { [GAME_SEAT_ORDER[0]]: booked.length };
  expect(Object.values(by).reduce((sum, count) => sum + count, 0)).toBe(booked.length);
  game.hands = Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, [...(spec.hands[seat] ?? [])]])) as Record<GameSeat, Card[]>;
  game.stock = [...stock];
  game.books = Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, [] as Rank[]])) as Record<GameSeat, Rank[]>;
  game.log.length = game.log.map((entry) => entry.type).lastIndexOf('hand') + 1;
  const queue = [...booked];
  for (const seat of GAME_SEAT_ORDER) {
    for (let count = by[seat] ?? 0; count > 0; count--) {
      const rank = queue.shift()!;
      game.books[seat].push(rank);
      game.log.push({ type: 'book', seat, rank, timestamp: 1 });
    }
  }
  game.currentTurnSeat = spec.turn;
  expect(persists()).toBe(true);
}

beforeEach(() => gf.restoreGames([]));

describe('Go Fish dealing', () => {
  it.each([[2, 7, 38], [3, 7, 31], [4, 5, 32], [6, 5, 22]])('deals %i players %i cards each', (count, size, stock) => {
    gf.startGame(CODE, playersOf(count), deckWith(count), 'N');
    const game = state();
    for (const seat of GAME_SEAT_ORDER.slice(0, count)) expect(game.hands[seat]).toHaveLength(size);
    for (const seat of GAME_SEAT_ORDER.slice(count)) expect(game.hands[seat]).toHaveLength(0);
    expect(game.stock).toHaveLength(stock);
    expect(game).toMatchObject({ phase: 'playing', hand: 1, currentTurnSeat: 'N' });
    expect(game.log).toMatchObject([{ type: 'hand', hand: 1, first: 'N' }]);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('lays down a book dealt in one hand at once', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2, {
      0: [card('spades', 14), card('hearts', 14), card('diamonds', 14), card('clubs', 14), card('clubs', 2), card('clubs', 3), card('clubs', 4)],
    }), 'N');
    const game = state();
    expect(game.books.N).toEqual([14]);
    expect(game.hands.N).toHaveLength(3);
    expect(game.log.map((entry) => entry.type)).toEqual(['hand', 'book']);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });
});

describe('Go Fish asking', () => {
  const started = (): void => {
    gf.startGame(CODE, playersOf(3), deckWith(3, {
      0: [card('spades', 7), card('clubs', 2), card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 6), card('clubs', 8)],
      1: [card('hearts', 7), card('diamonds', 7), card('hearts', 9), card('hearts', 10), card('hearts', 11), card('hearts', 12), card('hearts', 13)],
    }, [card('diamonds', 5), card('clubs', 7)]), 'N');
  };

  it('rejects an ask that breaks the rules, with a reason', () => {
    started();
    expect(gf.ask(CODE, 'E', 'N', 7)).toEqual({ success: false, reason: 'Not your turn' });
    expect(gf.ask(CODE, 'N', 'N', 7)).toEqual({ success: false, reason: 'You cannot ask yourself' });
    expect(gf.ask(CODE, 'N', 'W', 7)).toEqual({ success: false, reason: 'That seat is not playing' });
    expect(gf.ask(CODE, 'N', 'E', 9)).toEqual({ success: false, reason: 'You must hold the rank you ask for' });
    expect(gf.ask(CODE, 'N', 'E', 1 as Rank)).toEqual({ success: false, reason: 'Invalid rank' });
    expect(state().log).toHaveLength(1);
    expect(state().hands.N).toHaveLength(7);
  });

  it('hands over every card of the rank and lets the asker go again', () => {
    started();
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const game = state();
    expect(game.hands.N.filter((entry) => entry.rank === 7)).toHaveLength(3);
    expect(game.hands.E.some((entry) => entry.rank === 7)).toBe(false);
    expect(game.hands.E).toHaveLength(5);
    expect(game.currentTurnSeat).toBe('N');
    expect(game.log.at(-1)).toMatchObject({ type: 'ask', seat: 'N', target: 'E', rank: 7, given: 2, fished: null });
    expect(game.stock).toHaveLength(31);
    expect(persists()).toBe(true);
  });

  it('goes fishing when the target has none, and passes the turn after any other draw', () => {
    started();
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    expect(gf.ask(CODE, 'N', 'S', 7)).toEqual({ success: true });
    const game = state();
    // S held no 7: N drew the top card, a 5, which is not the asked rank.
    expect(game.log.at(-1)).toMatchObject({ type: 'ask', target: 'S', rank: 7, given: 0, fished: 'miss' });
    expect(game.hands.N).toContainEqual(card('diamonds', 5));
    expect(game.stock[0]).not.toEqual(card('diamonds', 5));
    expect(game.currentTurnSeat).toBe('E');
    expect(persists()).toBe(true);
  });

  it('lets the asker go again when the drawn card is the asked rank', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3, {
      0: [card('spades', 7), card('clubs', 2), card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 6), card('clubs', 8)],
      1: [card('hearts', 9), card('diamonds', 9), card('hearts', 10), card('hearts', 11), card('hearts', 12), card('hearts', 13), card('diamonds', 13)],
    }, [card('diamonds', 7)]), 'N');
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const game = state();
    expect(game.log.at(-1)).toMatchObject({ type: 'ask', rank: 7, given: 0, fished: 'lucky' });
    expect(game.hands.N).toContainEqual(card('diamonds', 7));
    expect(game.currentTurnSeat).toBe('N');
  });

  it('passes the turn without drawing when the stock is empty', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    arrange({
      turn: 'N',
      hands: { N: [card('spades', 14), card('spades', 13)], E: [card('hearts', 14), card('diamonds', 14), card('clubs', 14)],
        S: [card('hearts', 13), card('diamonds', 13), card('clubs', 13)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 13)).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ given: 0, fished: 'empty' });
    expect(state().hands.N).toHaveLength(2);
    expect(state().currentTurnSeat).toBe('E');
  });
});

describe('Go Fish books', () => {
  it('lays down a book as soon as an ask completes it, and the asker keeps the turn', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    arrange({
      turn: 'N',
      hands: { N: [card('spades', 7), card('hearts', 7), card('diamonds', 7), card('spades', 2)],
        E: [card('clubs', 7), card('hearts', 2), card('diamonds', 2), card('clubs', 2)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const game = state();
    expect(game.books.N.at(-1)).toBe(7);
    expect(game.hands.N).toEqual([card('spades', 2)]);
    expect(game.log.slice(-2)).toMatchObject([{ type: 'ask', given: 1 }, { type: 'book', seat: 'N', rank: 7 }]);
    expect(game.currentTurnSeat).toBe('N');
    expect(persists()).toBe(true);
  });

  it('lays down a different book completed by the fished card, and the turn still passes', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    arrange({
      turn: 'N',
      stock: [card('clubs', 9), card('hearts', 7), card('diamonds', 7), card('clubs', 7), card('clubs', 2)],
      hands: { N: [card('spades', 7), card('spades', 9), card('hearts', 9), card('diamonds', 9)],
        E: [card('spades', 2), card('hearts', 2), card('diamonds', 2)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const game = state();
    expect(game.log.slice(-2)).toMatchObject([{ type: 'ask', rank: 7, given: 0, fished: 'miss' }, { type: 'book', seat: 'N', rank: 9 }]);
    expect(game.hands.N).toEqual([card('spades', 7)]);
    expect(game.currentTurnSeat).toBe('E');
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });
});

describe('Go Fish empty hands', () => {
  it('draws a card at once for a target who handed over its last cards', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    arrange({
      turn: 'N',
      stock: [card('spades', 4), card('hearts', 4), card('diamonds', 4), card('clubs', 4)],
      hands: { N: [card('spades', 7), card('clubs', 7), card('spades', 2), card('spades', 3)],
        E: [card('hearts', 7), card('diamonds', 7)],
        S: [card('hearts', 2), card('diamonds', 2), card('clubs', 2), card('hearts', 3), card('diamonds', 3), card('clubs', 3)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const game = state();
    expect(game.log.slice(-3)).toMatchObject([{ type: 'ask', given: 2 }, { type: 'book', rank: 7 }, { type: 'refill', seat: 'E' }]);
    expect(game.hands.E).toEqual([card('spades', 4)]);
    expect(game.stock).toHaveLength(3);
    expect(game.currentTurnSeat).toBe('N');
    expect(persists()).toBe(true);
  });

  it('refills an asker whose book emptied the hand, who then goes on', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    arrange({
      turn: 'N',
      stock: [card('spades', 3), card('spades', 4), card('hearts', 4), card('diamonds', 4), card('clubs', 4)],
      hands: { N: [card('spades', 7), card('hearts', 7), card('diamonds', 7)],
        E: [card('clubs', 7), card('spades', 2), card('hearts', 2), card('diamonds', 2)],
        S: [card('clubs', 2), card('hearts', 3), card('diamonds', 3), card('clubs', 3)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    expect(state().hands.N).toEqual([card('spades', 3)]);
    expect(state().log.at(-1)).toMatchObject({ type: 'refill', seat: 'N' });
    expect(state().currentTurnSeat).toBe('N');
  });

  it('sits out an emptied seat once the stock is gone: it is skipped and cannot be asked', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    arrange({
      turn: 'N',
      hands: { N: [card('spades', 7), card('hearts', 7), card('diamonds', 7)],
        E: [card('clubs', 7), card('spades', 2), card('hearts', 2), card('diamonds', 2)], S: [card('clubs', 2)] },
    });
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    expect(state().hands.N).toEqual([]);
    expect(state().currentTurnSeat).toBe('E');
    expect(gf.ask(CODE, 'E', 'N', 2)).toEqual({ success: false, reason: 'That player has no cards' });
  });

  it('skips a seat with no cards when passing the turn', () => {
    gf.startGame(CODE, playersOf(4), deckWith(4), 'N');
    arrange({
      turn: 'E',
      hands: { N: [card('spades', 14), card('spades', 13)], E: [card('hearts', 14), card('diamonds', 14), card('clubs', 14)],
        W: [card('hearts', 13), card('diamonds', 13), card('clubs', 13)] },
    });
    expect(gf.ask(CODE, 'E', 'W', 14)).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ given: 0, fished: 'empty' });
    expect(state().currentTurnSeat).toBe('W');
  });
});

/** The winner holds three aces and asks the one holder of the fourth, completing the last book of the hand. */
function finishHand(winner: GameSeat, other: GameSeat, booksBy: Arrangement['booksBy']): void {
  arrange({ turn: winner, booksBy, hands: {
    [winner]: [card('spades', 14), card('hearts', 14), card('diamonds', 14)], [other]: [card('clubs', 14)],
  } });
  expect(gf.ask(CODE, winner, other, 14)).toEqual({ success: true });
}

describe('Go Fish hands and the match', () => {
  it('ends the hand when all 13 books are down, adds them to the totals and deals the next hand', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    finishHand('N', 'E', { N: 6, E: 6 });
    const game = state();
    expect(game.log.filter((entry) => entry.type === 'handEnd')).toMatchObject([{ hand: 1, books: { N: 7, E: 6 } }]);
    expect(game).toMatchObject({ phase: 'playing', hand: 2, currentTurnSeat: 'E' });
    expect(game.scores).toMatchObject({ N: 7, E: 6 });
    expect(GAME_SEAT_ORDER.map((seat) => game.books[seat].length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(game.hands.N).toHaveLength(7);
    expect(game.log.at(-1)).toMatchObject({ type: 'hand', hand: 2, first: 'E' });
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('plays three hands, starting each from the next seat, and ends with the most books winning', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    finishHand('N', 'E', { N: 6, E: 6 });
    finishHand('E', 'N', { N: 6, E: 6 });
    expect(state().hand).toBe(3);
    expect(state().currentTurnSeat).toBe('N');
    finishHand('N', 'E', { N: 6, E: 6 });
    const game = state();
    expect(game.phase).toBe('scoring');
    expect(game.result).toMatchObject({ gameType: 'gofish', hands: GF_HANDS, seats: ['N', 'E'], winners: ['N'] });
    expect(game.result?.scores).toMatchObject({ N: 20, E: 19 });
    expect(game.result?.handBooks).toMatchObject([{ N: 7, E: 6 }, { N: 6, E: 7 }, { N: 7, E: 6 }]);
    expect(GF_BOOKS_PER_HAND * GF_HANDS).toBe(39);
    expect(isGoFishResult(game.result)).toBe(true);
    expect(persists()).toBe(true);
    expect(goFishAdapter.matchResult(game)).toBe(game.result);
  });

  it('lets seats on the same total share the win', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    finishHand('N', 'E', { N: 4, E: 4, S: 4 });
    finishHand('E', 'S', { N: 4, E: 4, S: 4 });
    finishHand('S', 'N', { N: 4, E: 4, S: 4 });
    const game = state();
    expect(game.result?.scores).toMatchObject({ N: 13, E: 13, S: 13 });
    expect(game.result?.winners).toEqual(['N', 'E', 'S']);
    expect(isGoFishResult(game.result)).toBe(true);
  });

  it('rejects further asks after the match ends', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    finishHand('N', 'E', { N: 6, E: 6 });
    finishHand('E', 'N', { N: 6, E: 6 });
    finishHand('N', 'E', { N: 6, E: 6 });
    expect(gf.ask(CODE, 'E', 'N', 7)).toEqual({ success: false, reason: 'Not in playing phase' });
  });
});

describe('Go Fish stored state', () => {
  it('rejects a result whose winners or totals disagree with the hands', () => {
    gf.startGame(CODE, playersOf(2), deckWith(2), 'N');
    finishHand('N', 'E', { N: 6, E: 6 });
    finishHand('E', 'N', { N: 6, E: 6 });
    finishHand('N', 'E', { N: 6, E: 6 });
    const result = state().result!;
    expect(isGoFishResult({ ...result, winners: ['E'] })).toBe(false);
    expect(isGoFishResult({ ...result, scores: { ...result.scores, N: 21 } })).toBe(false);
    expect(isGoFishResult({ ...result, hands: 2 })).toBe(false);
  });

  it('rejects state that lost, duplicated or double-booked a card', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    expect(persists()).toBe(true);
    const lost = state().stock.pop()!;
    expect(persists()).toBe(false);
    state().stock.push(lost);
    state().stock.push(state().hands.N[0]);
    expect(persists()).toBe(false);
    state().stock.pop();
    expect(persists()).toBe(true);
    state().books.E.push(state().hands.N[0].rank);
    expect(persists()).toBe(false);
  });

  it('survives a JSON round trip', () => {
    gf.startGame(CODE, playersOf(4), deckWith(4), 'N');
    const before = structuredClone(state());
    gf.restoreGames(JSON.parse(JSON.stringify(gf.exportGames())) as GoFishGameState[]);
    expect(state()).toEqual(before);
  });
});

describe('Go Fish visible state', () => {
  it('shows the viewer hand and counts for everyone else, and no stock contents', () => {
    gf.startGame(CODE, playersOf(4), deckWith(4), 'N');
    const visible = gf.getPlayerVisibleState(CODE, 'E');
    if (!visible) throw new Error('Expected a view');
    expect(visible.myHand).toEqual(state().hands.E);
    expect(visible.handCounts).toMatchObject({ N: 5, E: 5, S: 5, W: 5 });
    expect(visible.stockCount).toBe(32);
    expect(visible.observedHands).toBeUndefined();
    expect(Object.keys(visible)).not.toContain('stock');
    expect(Object.keys(visible)).not.toContain('hands');
    // Apart from the viewer's own hand, the view names no card at all.
    expect(JSON.stringify({ ...visible, myHand: [] })).not.toContain('"suit"');
  });

  it('keeps fished and refilled cards private: the log names only the asked rank', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3, {
      0: [card('spades', 7), card('clubs', 2), card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 6), card('clubs', 8)],
      1: [card('hearts', 9), card('diamonds', 9), card('hearts', 10), card('hearts', 11), card('hearts', 12), card('hearts', 13), card('diamonds', 13)],
    }, [card('diamonds', 5)]), 'N');
    expect(gf.ask(CODE, 'N', 'E', 7)).toEqual({ success: true });
    const view = gf.getPlayerVisibleState(CODE, 'S');
    expect(view?.log.at(-1)).toEqual({ type: 'ask', seat: 'N', target: 'E', rank: 7, given: 0, fished: 'miss', timestamp: expect.any(Number) });
    expect(JSON.stringify(view?.log)).not.toContain('suit');
  });

  it('adds every hand only for observers', () => {
    gf.startGame(CODE, playersOf(3), deckWith(3), 'N');
    const visible = gf.getPlayerVisibleState(CODE, 'S');
    if (!visible) throw new Error('Expected a view');
    const watched = goFishAdapter.withObserverView(visible, state(), 'spectator');
    expect(watched.observer).toBe('spectator');
    expect(watched.observedHands?.N).toEqual(state().hands.N);
  });
});
