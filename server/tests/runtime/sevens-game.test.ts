import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, PlayerInfo, Seat, SevensGameState } from '@shared/types';
import { svPenalty } from '@shared/rules/sevens';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as sevens from '../../src/managers/games/sevens-game';
import * as games from '../../src/managers/game-manager';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'ABC123';
const PLAYERS: Record<Seat, PlayerInfo> = {
  N: player('north'), E: player('east'), S: player('south'), W: player('west'),
};

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function card(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** Deals round robin like the engine; unset slots are filled from the remaining cards in deck order. */
function deckWith(hands: Partial<Record<Seat, Card[]>>): Card[] {
  const slots: (Card | null)[] = Array.from({ length: 52 }, () => null);
  SEATS.forEach((seat, index) => (hands[seat] ?? []).forEach((entry, offset) => { slots[offset * 4 + index] = entry; }));
  const rest = createDeck().filter((entry) => !slots.some((slot) => slot && same(slot, entry)));
  return slots.map((slot) => slot ?? rest.shift()!);
}

/** South holds no seven and nothing that fits next to the spade seven, so it must cover on its first turn. */
const STUCK_SOUTH: Card[] = [
  ...([14, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13] as const).map((rank) => card('clubs', rank)),
  card('diamonds', 2),
];

function stuckSouthDeck(): Card[] {
  return deckWith({ W: [card('spades', 7)], S: STUCK_SOUTH });
}

function game(): SevensGameState {
  const state = sevens.getGameState(CODE);
  if (!state) throw new Error('Expected a Sevens game');
  return state;
}

function visible(seat: Seat): NonNullable<ReturnType<typeof sevens.getPlayerVisibleState>> {
  const state = sevens.getPlayerVisibleState(CODE, seat);
  if (!state) throw new Error('Expected a visible state');
  return state;
}

/** Simple driver: play the first legal card, otherwise cover the first card in hand. */
function step(): Seat {
  const seat = game().currentTurnSeat;
  const view = visible(seat);
  const result = view.validCards.length > 0
    ? sevens.play(CODE, seat, view.validCards[0])
    : sevens.cover(CODE, seat, view.myHand[0]);
  expect(result).toEqual({ success: true });
  return seat;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Sevens gameplay', () => {
  beforeEach(() => sevens.restoreGames([]));

  it('should start with the spade seven holder and deal sorted 13-card hands', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'W', result: null, log: [] });
    for (const seat of SEATS) expect(game().hands[seat]).toHaveLength(13);
    expect(game().table).toEqual({ spades: null, hearts: null, clubs: null, diamonds: null });
    expect(visible('W').validCards).toEqual([card('spades', 7)]);
    expect(visible('N').validCards).toEqual([]);
    expect(game().hands.S[0]).toEqual(card('clubs', 14));
  });

  it('should reject wrong turn, missing cards, illegal first plays and early covers', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    expect(sevens.play(CODE, 'N', game().hands.N[0])).toEqual({ success: false, reason: 'Not your turn' });
    expect(sevens.cover(CODE, 'N', game().hands.N[0])).toEqual({ success: false, reason: 'Not your turn' });
    expect(sevens.play(CODE, 'W', card('diamonds', 2))).toEqual({ success: false, reason: 'Card not in hand' });
    const other = game().hands.W.find((entry) => !same(entry, card('spades', 7)))!;
    expect(sevens.play(CODE, 'W', other)).toEqual({ success: false, reason: 'Illegal play' });
    expect(sevens.cover(CODE, 'W', other)).toEqual({ success: false, reason: 'You must play a card when you can' });
    expect(sevens.play('NOPE', 'W', other)).toEqual({ success: false, reason: 'Game not found' });
    expect(game().hands.W).toHaveLength(13);
    expect(game().log).toEqual([]);
  });

  it('should require covering when stuck and pass the turn counterclockwise', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    expect(sevens.play(CODE, 'W', card('spades', 7))).toEqual({ success: true });
    expect(game().table.spades).toEqual({ low: 7, high: 7 });
    expect(game().currentTurnSeat).toBe('S');
    expect(visible('S').validCards).toEqual([]);

    expect(sevens.play(CODE, 'S', card('diamonds', 2))).toEqual({ success: false, reason: 'Illegal play' });
    expect(sevens.cover(CODE, 'S', card('hearts', 3))).toEqual({ success: false, reason: 'Card not in hand' });
    expect(sevens.cover(CODE, 'S', card('diamonds', 2))).toEqual({ success: true });
    expect(game().currentTurnSeat).toBe('E');
    expect(game().hands.S).toHaveLength(12);
    expect(game().covered.S).toEqual([card('diamonds', 2)]);
  });

  it('should keep covered cards private and out of the log', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    sevens.play(CODE, 'W', card('spades', 7));
    sevens.cover(CODE, 'S', card('diamonds', 2));

    expect(visible('S').myCovered).toEqual([card('diamonds', 2)]);
    for (const seat of ['N', 'E', 'W'] as const) {
      const view = visible(seat);
      expect(view.myCovered).toEqual([]);
      expect(view.coveredCounts).toEqual({ N: 0, E: 0, S: 1, W: 0 });
      expect(view.handCounts).toMatchObject({ S: 12 });
    }
    const coverEntry = game().log[1];
    expect(coverEntry).toMatchObject({ type: 'cover', seat: 'S' });
    expect('card' in coverEntry).toBe(false);
    expect(game().log[0]).toMatchObject({ type: 'play', seat: 'W', card: card('spades', 7) });
  });

  it('should expose valid cards only on the recipient turn', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    sevens.play(CODE, 'W', card('spades', 7));
    for (const seat of SEATS) {
      if (seat !== 'S') expect(visible(seat).validCards).toEqual([]);
    }
    sevens.cover(CODE, 'S', card('diamonds', 2));
    const east = visible('E');
    expect(east.validCards.every((entry) => east.myHand.some((own) => same(own, entry)))).toBe(true);
  });

  it('should reveal all covered cards only to spectators, including after restoring a match', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    const state = game();
    state.table.spades = { low: 7, high: 7 };
    state.currentTurnSeat = 'N';
    state.hands = {
      N: [card('clubs', 2), card('clubs', 3)],
      E: [card('diamonds', 4), card('diamonds', 5)],
      S: [card('hearts', 6), card('hearts', 8)],
      W: [card('clubs', 9), card('clubs', 10)],
    };
    for (const seat of ['N', 'W', 'S', 'E'] as const) {
      expect(sevens.cover(CODE, seat, state.hands[seat][0])).toEqual({ success: true });
    }
    const expected = {
      N: [card('clubs', 2)], E: [card('diamonds', 4)],
      S: [card('hearts', 6)], W: [card('clubs', 9)],
    };
    const assertViews = (): void => {
      const watching = games.getRecipientVisibleState(CODE, null);
      expect(watching).toMatchObject({ gameType: 'sevens', observer: 'spectator', phase: 'playing',
        mySeat: 'S', observedCovered: expected, observedHands: game().hands });
      for (const seat of SEATS) {
        const seated = games.getRecipientVisibleState(CODE, seat);
        expect(seated).toMatchObject({ myCovered: expected[seat] });
        expect(seated).not.toHaveProperty('observedCovered');
        expect(seated).not.toHaveProperty('observedHands');
        expect(games.getPlayerVisibleState(CODE, seat)).not.toHaveProperty('observedCovered');
      }
      for (const entry of game().log) expect(entry).not.toHaveProperty('card');
    };
    assertViews();
    const exported = structuredClone(sevens.exportGames());
    sevens.abortGame(CODE);
    sevens.restoreGames(exported);
    assertViews();
  });

  it('should play whole games to scoring with correct penalties and winners', () => {
    for (let seed = 1; seed <= 25; seed++) {
      sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), mulberry32(seed)));
      let lastSeat: Seat = game().currentTurnSeat;
      let turns = 0;
      while (game().phase === 'playing') {
        lastSeat = step();
        turns++;
        expect(turns).toBeLessThanOrEqual(52);
      }
      expect(turns).toBe(52);
      const final = game();
      expect(final.currentTurnSeat).toBe(lastSeat);
      expect(final.log).toHaveLength(52);
      expect(final.result).not.toBeNull();
      const result = final.result!;
      let played = 0;
      for (const seat of SEATS) {
        expect(final.hands[seat]).toEqual([]);
        expect(result.covered[seat]).toEqual(final.covered[seat]);
        expect(result.penalties[seat]).toBe(svPenalty(final.covered[seat]));
        played += 13 - final.covered[seat].length;
      }
      expect(played).toBe(final.log.filter((entry) => entry.type === 'play').length);
      const lowest = Math.min(...SEATS.map((seat) => result.penalties[seat]));
      expect(result.winners).toEqual(SEATS.filter((seat) => result.penalties[seat] === lowest));
      expect(sevens.play(CODE, lastSeat, card('spades', 7))).toEqual({ success: false, reason: 'Not in playing phase' });
      expect(sevens.cover(CODE, lastSeat, card('spades', 7))).toEqual({ success: false, reason: 'Not in playing phase' });
      expect(visible('N').validCards).toEqual([]);
    }
  });

  it('should reject a deck without the spade seven', () => {
    const deck = createDeck().filter((entry) => !same(entry, card('spades', 7)));
    expect(() => sevens.startGame(CODE, PLAYERS, deck)).toThrow();
  });

  it('should export, abort and restore games mid-match', () => {
    sevens.startGame(CODE, PLAYERS, stuckSouthDeck());
    step();
    step();
    const exported = structuredClone(sevens.exportGames());
    expect(exported).toHaveLength(1);

    sevens.abortGame(CODE);
    expect(sevens.getGameState(CODE)).toBeNull();
    expect(sevens.getPlayerVisibleState(CODE, 'N')).toBeNull();

    sevens.restoreGames(exported);
    expect(game()).toEqual(exported[0]);
    expect(game().currentTurnSeat).toBe('E');
    step();
    expect(game().log).toHaveLength(3);
  });
});
