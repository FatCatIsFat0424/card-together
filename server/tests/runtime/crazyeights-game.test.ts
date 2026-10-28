import { beforeEach, describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, PlayerInfo } from '@shared/types';
import type { CrazyEightsGameState } from '@shared/games/crazyeights/types';
import { CE_HANDS, ceHandPoints, ceHandSize } from '@shared/rules/crazyeights';
import { createDeck } from '../../src/engine/deck';
import * as ce from '../../src/managers/games/crazyeights-game';
import { crazyEightsAdapter } from '../../src/managers/games/crazyeights-adapter';
import { isCrazyEightsResult, isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const CODE = 'CE0001';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, player(seat)]));
}

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/**
 * Deck layout for `count` players: each seat's hand in seat order, then the stock top-first (the first
 * non-8 stock card becomes the starter); unset slots are filled from the remaining cards in order.
 */
function deckWith(count: number, hands: Record<number, Card[]> = {}, stock: Card[] = []): Card[] {
  const size = ceHandSize(count);
  const decks = count >= 5 ? 2 : 1;
  const slots: (Card | null)[] = Array.from({ length: 52 * decks }, () => null);
  for (const [index, cards] of Object.entries(hands)) cards.forEach((entry, offset) => { slots[Number(index) * size + offset] = entry; });
  stock.forEach((entry, offset) => { slots[size * count + offset] = entry; });
  const rest = Array.from({ length: decks }, () => createDeck()).flat();
  for (const slot of slots) if (slot) rest.splice(rest.findIndex((entry) => same(slot, entry)), 1);
  return slots.map((slot) => slot ?? rest.shift()!);
}

function state(): CrazyEightsGameState {
  const game = ce.getGameState(CODE);
  if (!game) throw new Error('Expected a Crazy Eights game');
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
        code: CODE, gameType: 'crazyeights', status: playing ? 'playing' : 'waiting', createdAt: 1,
        hostId: ids[0], abortVote: null, abortVoteCooldownUntil: null,
        seats: { N: seat('N'), E: seat('E'), S: seat('S'), W: seat('W') },
        additionalSeats: GAME_SEAT_ORDER.slice(4).map(seat),
      },
      memberIds: ids,
    }],
    games: [structuredClone(game)],
    chat: [],
  };
  return isRuntimeSnapshot(snapshot);
}

/** Every deck card is somewhere exactly once per deck. */
function conserved(): boolean {
  const game = state();
  const count = Object.keys(game.players).length;
  const all = [...GAME_SEAT_ORDER.flatMap((seat) => game.hands[seat]), ...game.stock, ...game.discard];
  const copies = new Map<string, number>();
  for (const entry of all) copies.set(`${entry.suit}-${entry.rank}`, (copies.get(`${entry.suit}-${entry.rank}`) ?? 0) + 1);
  return all.length === 52 * (count >= 5 ? 2 : 1) && copies.size === 52
    && [...copies.values()].every((value) => value === (count >= 5 ? 2 : 1));
}

/**
 * Gives `seat` exactly `wanted`, taking each wanted card from the stock or another hand and parking the
 * cards it replaces there, so the deck stays whole.
 */
function setHand(seat: GameSeat, wanted: Card[]): void {
  const game = state();
  const old = game.hands[seat];
  const spare = [...old];
  for (const entry of wanted) {
    const inOld = spare.findIndex((own) => same(own, entry));
    if (inOld >= 0) { spare.splice(inOld, 1); continue; }
    const fromStock = game.stock.findIndex((other) => same(other, entry));
    if (fromStock >= 0) { game.stock.splice(fromStock, 1); continue; }
    const holder = GAME_SEAT_ORDER.find((other) => other !== seat && game.hands[other].some((own) => same(own, entry)));
    if (!holder) throw new Error('Wanted card is not available');
    game.hands[holder].splice(game.hands[holder].findIndex((own) => same(own, entry)), 1, spare.pop()!);
  }
  game.stock.push(...spare);
  game.hands[seat] = [...wanted];
}

beforeEach(() => ce.restoreGames([]));

describe('Crazy Eights dealing', () => {
  it('deals five cards to four players and turns up a starter', () => {
    ce.startGame(CODE, playersOf(4), deckWith(4), 'N');
    const game = state();
    expect(GAME_SEAT_ORDER.slice(0, 4).map((seat) => game.hands[seat].length)).toEqual([5, 5, 5, 5]);
    expect(game.stock).toHaveLength(52 - 20 - 1);
    expect(game.discard).toHaveLength(1);
    expect(game).toMatchObject({ phase: 'playing', hand: 1, currentTurnSeat: 'N', direction: 'ccw', drawn: false });
    expect(game.activeSuit).toBe(game.discard[0].suit);
    expect(game.log[0]).toMatchObject({ type: 'hand', hand: 1, first: 'N', starter: game.discard[0] });
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('deals seven cards heads-up', () => {
    ce.startGame(CODE, playersOf(2), deckWith(2), 'E');
    expect(state().hands.N).toHaveLength(7);
    expect(state().hands.E).toHaveLength(7);
    expect(state().stock).toHaveLength(52 - 14 - 1);
  });

  it('uses two decks from five players, with both copies of every card in play', () => {
    ce.startGame(CODE, playersOf(5), deckWith(5), 'N');
    const game = state();
    expect(game.stock).toHaveLength(104 - 25 - 1);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('never starts on an 8 and leaves the skipped 8 in the stock', () => {
    const wild = card('spades', 8);
    ce.startGame(CODE, playersOf(3), deckWith(3, {}, [wild, card('hearts', 5)]), 'N');
    const game = state();
    expect(game.discard).toEqual([card('hearts', 5)]);
    expect(game.activeSuit).toBe('hearts');
    expect(game.stock[0]).toEqual(wild);
    expect(conserved()).toBe(true);
  });
});

describe('Crazy Eights plays', () => {
  const startedWith = (hand: Card[], top: Card = card('hearts', 6), count = 4): void => {
    ce.startGame(CODE, playersOf(count), deckWith(count, { 0: hand }, [top]), 'N');
  };

  it('rejects illegal plays with a reason', () => {
    startedWith([card('hearts', 9), card('clubs', 3), card('clubs', 8), card('spades', 6), card('diamonds', 2)]);
    expect(ce.play(CODE, 'E', card('hearts', 9))).toEqual({ success: false, reason: 'Not your turn' });
    expect(ce.play(CODE, 'N', card('hearts', 10))).toEqual({ success: false, reason: 'Card not in hand' });
    expect(ce.play(CODE, 'N', card('clubs', 3))).toEqual({ success: false, reason: 'That card does not match' });
    expect(ce.play(CODE, 'N', card('clubs', 8))).toEqual({ success: false, reason: 'Declare a suit for the 8' });
    expect(ce.play(CODE, 'N', card('hearts', 9), 'clubs')).toEqual({ success: false, reason: 'Only an 8 declares a suit' });
    expect(ce.play(CODE, 'N', card('clubs', 8), 'stars' as never)).toEqual({ success: false, reason: 'Invalid suit' });
    expect(state().hands.N).toHaveLength(5);
  });

  it('plays by suit or rank and moves the turn counterclockwise', () => {
    startedWith([card('hearts', 9), card('clubs', 3), card('clubs', 8), card('spades', 6), card('diamonds', 2)]);
    expect(ce.play(CODE, 'N', card('spades', 6))).toEqual({ success: true });
    expect(state()).toMatchObject({ activeSuit: 'spades', currentTurnSeat: 'W', drawn: false });
    expect(state().discard.at(-1)).toEqual(card('spades', 6));
    expect(state().hands.N).toHaveLength(4);
    expect(state().log.at(-1)).toMatchObject({ type: 'play', seat: 'N', suit: null, effect: null, target: null, drawn: 0 });
    expect(persists()).toBe(true);
  });

  it('lets an 8 declare a suit that the next player must follow', () => {
    startedWith([card('hearts', 9), card('clubs', 3), card('clubs', 8), card('spades', 6), card('diamonds', 2)]);
    setHand('W', [card('clubs', 5), card('spades', 5), card('diamonds', 12), card('hearts', 12), card('clubs', 9)]);
    expect(ce.play(CODE, 'N', card('clubs', 8), 'diamonds')).toEqual({ success: true });
    expect(state().activeSuit).toBe('diamonds');
    expect(state().log.at(-1)).toMatchObject({ type: 'play', suit: 'diamonds' });
    expect(ce.play(CODE, 'W', card('clubs', 5))).toEqual({ success: false, reason: 'That card does not match' });
    expect(ce.play(CODE, 'W', card('diamonds', 12))).toEqual({ success: true });
    expect(state().activeSuit).toBe('diamonds');
    expect(persists()).toBe(true);
  });

  it('treats a played 8 as matching only by the declared suit or another 8', () => {
    startedWith([card('clubs', 8), card('spades', 8), card('clubs', 3), card('spades', 6), card('diamonds', 2)]);
    setHand('W', [card('clubs', 5), card('hearts', 8), card('diamonds', 12), card('hearts', 12), card('clubs', 9)]);
    ce.play(CODE, 'N', card('clubs', 8), 'diamonds');
    expect(ce.play(CODE, 'W', card('hearts', 8), 'spades')).toEqual({ success: true });
    expect(state().activeSuit).toBe('spades');
  });

  it('allows the last card to be an 8 without a suit and ends the hand', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 8)] }, [card('hearts', 6)]), 'N');
    setHand('N', [card('clubs', 8)]);
    expect(ce.play(CODE, 'N', card('clubs', 8))).toEqual({ success: true });
    expect(state().log.at(-3)).toMatchObject({ type: 'play', seat: 'N', suit: null });
    expect(state().log.at(-2)).toMatchObject({ type: 'handEnd', hand: 1, winner: 'N' });
    expect(state().hand).toBe(2);
  });
});

describe('Crazy Eights drawing', () => {
  it('draws when nothing is playable and passes at once if the card does not fit', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6), card('diamonds', 10)]), 'N');
    expect(ce.pass(CODE, 'N')).toEqual({ success: false, reason: 'Draw a card first' });
    expect(ce.draw(CODE, 'N')).toEqual({ success: true });
    expect(state().hands.N).toHaveLength(6);
    expect(state().log.slice(-2).map((entry) => entry.type)).toEqual(['draw', 'pass']);
    expect(state()).toMatchObject({ currentTurnSeat: 'S', drawn: false });
    expect(persists()).toBe(true);
  });

  it('keeps the turn after a playable draw, which may be played or passed but not drawn again', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6), card('hearts', 10)]), 'N');
    expect(ce.draw(CODE, 'N')).toEqual({ success: true });
    expect(state()).toMatchObject({ currentTurnSeat: 'N', drawn: true });
    expect(state().log.at(-1)).toMatchObject({ type: 'draw', seat: 'N' });
    expect(ce.draw(CODE, 'N')).toEqual({ success: false, reason: 'You already drew this turn' });
    expect(persists()).toBe(true);
    expect(ce.play(CODE, 'N', card('hearts', 10))).toEqual({ success: true });
    expect(state()).toMatchObject({ currentTurnSeat: 'S', drawn: false });
  });

  it('allows keeping a playable drawn card by passing', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6), card('hearts', 10)]), 'N');
    ce.draw(CODE, 'N');
    expect(ce.pass(CODE, 'N')).toEqual({ success: true });
    expect(state().hands.N).toHaveLength(6);
    expect(state().currentTurnSeat).toBe('S');
  });

  it('refuses to draw or pass while a card can be played', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('hearts', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6)]), 'N');
    expect(ce.draw(CODE, 'N')).toEqual({ success: false, reason: 'You must play a card' });
    expect(ce.pass(CODE, 'N')).toEqual({ success: false, reason: 'You must play a card' });
  });

  it('refills an empty stock from the discards below the top card without losing a card', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6)]), 'N');
    const game = state();
    const pile = game.stock.splice(0);
    game.discard = [...pile.slice(0, 20), game.discard[0]];
    game.stock = [];
    game.hands.E = [...game.hands.E, ...pile.slice(20)];
    expect(conserved()).toBe(true);
    expect(ce.draw(CODE, 'N')).toEqual({ success: true });
    expect(state().discard).toHaveLength(1);
    expect(state().stock.length + state().hands.N.length).toBe(20 + 5);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('allows a pass only when nothing can be played or drawn', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7), card('clubs', 9)] },
      [card('hearts', 6)]), 'N');
    const game = state();
    game.hands.E.push(...game.stock.splice(0));
    expect(ce.draw(CODE, 'N')).toEqual({ success: false, reason: 'Nothing left to draw' });
    expect(ce.pass(CODE, 'N')).toEqual({ success: true });
    expect(state().currentTurnSeat).toBe('S');
  });
});

describe('Crazy Eights two-deck card identity', () => {
  it('keeps both copies in one hand and removes exactly one when played', () => {
    const copy = card('hearts', 9);
    ce.startGame(CODE, playersOf(5), deckWith(5, { 0: [copy, copy, card('clubs', 3), card('clubs', 4), card('clubs', 5)] },
      [card('hearts', 6)]), 'N');
    expect(state().hands.N.filter((entry) => same(entry, copy))).toHaveLength(2);
    expect(conserved()).toBe(true);
    expect(ce.play(CODE, 'N', copy)).toEqual({ success: true });
    expect(state().hands.N.filter((entry) => same(entry, copy))).toHaveLength(1);
    expect(state().discard.filter((entry) => same(entry, copy))).toHaveLength(1);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('lets a later turn play the second copy and keeps the multiset intact', () => {
    const copy = card('hearts', 9);
    ce.startGame(CODE, playersOf(5), deckWith(5, { 0: [copy, copy, card('clubs', 3), card('clubs', 4), card('clubs', 5)] },
      [card('hearts', 6)]), 'N');
    ce.play(CODE, 'N', copy);
    const game = state();
    game.currentTurnSeat = 'N';
    expect(ce.play(CODE, 'N', copy)).toEqual({ success: true });
    expect(state().hands.N.some((entry) => same(entry, copy))).toBe(false);
    expect(state().discard.filter((entry) => same(entry, copy))).toHaveLength(2);
    expect(conserved()).toBe(true);
  });

  it('rejects persisted two-deck state that lost or duplicated a copy', () => {
    ce.startGame(CODE, playersOf(5), deckWith(5), 'N');
    expect(persists()).toBe(true);
    const game = state();
    const lost = game.stock.pop()!;
    expect(persists()).toBe(false);
    game.stock.push(lost, lost);
    expect(persists()).toBe(false);
    game.stock.pop();
    expect(persists()).toBe(true);
  });
});

describe('Crazy Eights action cards', () => {
  const setup = (count: number, actionCards: boolean, hand: Card[], top: Card = card('hearts', 6)): void => {
    ce.startGame(CODE, playersOf(count), deckWith(count, { 0: hand }, [top]), 'N', { actionCards });
  };
  const filler = [card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7)];

  it('does nothing special for 2, Q and A when the option is off', () => {
    setup(3, false, [card('hearts', 2), ...filler]);
    expect(ce.play(CODE, 'N', card('hearts', 2))).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ effect: null, target: null, drawn: 0 });
    expect(state().currentTurnSeat).toBe('S');
    expect(state().hands.S).toHaveLength(5);
  });

  it('skips the next player with Q', () => {
    setup(4, true, [card('hearts', 12), ...filler]);
    expect(ce.play(CODE, 'N', card('hearts', 12))).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ effect: 'skip', target: 'W', drawn: 0 });
    expect(state().currentTurnSeat).toBe('S');
    expect(persists()).toBe(true);
  });

  it('makes the next player draw two and lose the turn with a 2', () => {
    setup(4, true, [card('hearts', 2), ...filler]);
    expect(ce.play(CODE, 'N', card('hearts', 2))).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ effect: 'draw', target: 'W', drawn: 2 });
    expect(state().hands.W).toHaveLength(7);
    expect(state().currentTurnSeat).toBe('S');
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('draws only what is left for the penalty, counting the old top card that refills the stock', () => {
    setup(3, true, [card('hearts', 2), ...filler]);
    const game = state();
    game.hands.E.push(...game.stock.splice(0));
    expect(ce.play(CODE, 'N', card('hearts', 2))).toEqual({ success: true });
    expect(state().log.at(-1)).toMatchObject({ effect: 'draw', target: 'S', drawn: 1 });
  });

  it('reverses the direction with A, and gives a heads-up player another turn', () => {
    setup(3, true, [card('hearts', 14), ...filler]);
    expect(ce.play(CODE, 'N', card('hearts', 14))).toEqual({ success: true });
    expect(state()).toMatchObject({ direction: 'cw', currentTurnSeat: 'E' });
    expect(state().log.at(-1)).toMatchObject({ effect: 'reverse', target: null });

    ce.restoreGames([]);
    setup(2, true, [card('hearts', 14), ...filler]);
    expect(ce.play(CODE, 'N', card('hearts', 14))).toEqual({ success: true });
    expect(state()).toMatchObject({ direction: 'cw', currentTurnSeat: 'N' });
    expect(state().log.at(-1)).toMatchObject({ effect: 'reverse', target: 'E' });
    expect(persists()).toBe(true);
  });

  it('applies no effect to the card that empties the hand', () => {
    setup(3, true, [card('hearts', 2)]);
    setHand('N', [card('hearts', 2)]);
    expect(ce.play(CODE, 'N', card('hearts', 2))).toEqual({ success: true });
    expect(state().log.at(-3)).toMatchObject({ type: 'play', effect: null, drawn: 0 });
    expect(state().log.at(-2)).toMatchObject({ type: 'handEnd', winner: 'N' });
  });
});

describe('Crazy Eights hands and scoring', () => {
  /** The seat is left holding one card that matches the table, and plays it. */
  function goOut(winner: GameSeat): void {
    const game = state();
    const out: Card = { suit: game.activeSuit, rank: game.discard.at(-1)!.rank === 9 ? 10 : 9 };
    setHand(winner, [out]);
    game.currentTurnSeat = winner;
    expect(ce.play(CODE, winner, out)).toEqual({ success: true });
  }

  it('scores the remaining cards when a hand ends and deals the next hand from the next seat', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3), 'N');
    const loserPoints = (seat: GameSeat): number => ceHandPoints(state().hands[seat]);
    goOut('N');
    const end = state().log.find((entry) => entry.type === 'handEnd');
    expect(end).toMatchObject({ type: 'handEnd', hand: 1, winner: 'N' });
    expect(end?.type === 'handEnd' ? end.points.N : -1).toBe(0);
    expect(state().scores.N).toBe(0);
    expect(state()).toMatchObject({ hand: 2, phase: 'playing', currentTurnSeat: 'S', direction: 'ccw', drawn: false });
    expect(state().hands.N).toHaveLength(5);
    expect(state().log.at(-1)).toMatchObject({ type: 'hand', hand: 2, first: 'S' });
    expect(loserPoints('E')).toBeGreaterThanOrEqual(0);
    expect(conserved()).toBe(true);
    expect(persists()).toBe(true);
  });

  it('adds the exact remaining points of every other hand to the totals', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 1: [card('spades', 8), card('hearts', 13), card('clubs', 14), card('clubs', 5), card('clubs', 6)],
      2: [card('diamonds', 2), card('diamonds', 3), card('diamonds', 4), card('clubs', 10), card('clubs', 12)] }, [card('hearts', 9)]), 'N');
    setHand('N', [card('hearts', 3)]);
    expect(ce.play(CODE, 'N', card('hearts', 3))).toEqual({ success: true });
    expect(state().scores).toMatchObject({ N: 0, E: 50 + 10 + 1 + 5 + 6, S: 2 + 3 + 4 + 10 + 10 });
  });

  it('plays three hands, ends the match, and picks the lowest total with ties sharing the win', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3), 'N');
    goOut('N');
    goOut('S');
    goOut('N');
    const game = state();
    expect(game.phase).toBe('scoring');
    expect(game.hand).toBe(CE_HANDS);
    expect(game.result).toMatchObject({ gameType: 'crazyeights', hands: CE_HANDS, handWinners: ['N', 'S', 'N'] });
    expect(game.result?.winners.length).toBeGreaterThanOrEqual(1);
    const totals = game.result!.seats!.map((seat) => game.scores[seat]);
    expect(game.result!.winners).toEqual(game.result!.seats!.filter((seat) => game.scores[seat] === Math.min(...totals)));
    expect(isCrazyEightsResult(game.result)).toBe(true);
    expect(crazyEightsAdapter.matchResult(game)).toBe(game.result);
    expect(persists()).toBe(true);
  });

  it('rejects further actions after the match ends', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3), 'N');
    goOut('N');
    goOut('S');
    goOut('N');
    expect(ce.draw(CODE, 'E')).toEqual({ success: false, reason: 'Not in playing phase' });
    expect(ce.pass(CODE, 'E')).toEqual({ success: false, reason: 'Not in playing phase' });
  });
});

describe('Crazy Eights visible state', () => {
  it('shows only the viewer hand, counts for the others, and no stock contents', () => {
    ce.startGame(CODE, playersOf(4), deckWith(4), 'N');
    const visible = ce.getPlayerVisibleState(CODE, 'E');
    if (!visible) throw new Error('Expected a view');
    expect(visible.myHand).toEqual(state().hands.E);
    expect(visible.handCounts).toMatchObject({ N: 5, E: 5, S: 5, W: 5 });
    expect(visible.stockCount).toBe(state().stock.length);
    expect(visible.reserveCount).toBe(0);
    expect(visible.observedHands).toBeUndefined();
    expect(Object.keys(visible)).not.toContain('stock');
    expect(Object.keys(visible)).not.toContain('hands');
    // Nothing in the serialized view repeats a card another seat holds, except through public play.
    const text = JSON.stringify({ ...visible, myHand: [], lastPlayed: null, log: [] });
    for (const seat of ['N', 'S', 'W'] as const) {
      for (const own of state().hands[seat]) expect(text).not.toContain(JSON.stringify(own));
    }
  });

  it('keeps penalty cards private: the log counts them without naming them', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3, { 0: [card('hearts', 2), card('clubs', 3), card('clubs', 4), card('clubs', 5), card('clubs', 7)] },
      [card('hearts', 6)]), 'N', { actionCards: true });
    ce.play(CODE, 'N', card('hearts', 2));
    const entry = ce.getPlayerVisibleState(CODE, 'E')?.log.at(-1);
    expect(entry).toMatchObject({ type: 'play', effect: 'draw', target: 'S', drawn: 2 });
    expect(JSON.stringify(entry)).not.toContain(JSON.stringify(state().hands.S.at(-1)));
  });

  it('adds every hand only for observers', () => {
    ce.startGame(CODE, playersOf(3), deckWith(3), 'N');
    const visible = ce.getPlayerVisibleState(CODE, 'S');
    if (!visible) throw new Error('Expected a view');
    const watched = crazyEightsAdapter.withObserverView(visible, state(), 'spectator');
    expect(watched.observer).toBe('spectator');
    expect(watched.observedHands?.N).toEqual(state().hands.N);
  });
});
