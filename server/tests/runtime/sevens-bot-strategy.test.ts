import { describe, expect, it } from 'vitest';
import type { Card, PlayerInfo, Seat, SevensTable, SevensVisibleState } from '@shared/types';
import { svEmptyTable, svLegalPlays } from '@shared/rules/sevens';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import { getSevensBotAction } from '../../src/bots/sevens-strategy';
import * as sevens from '../../src/managers/games/sevens-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'BOT123';
const samples = [0, 0.25, 0.5, 0.75, 0.9999];

const PLAYERS: Record<Seat, PlayerInfo> = Object.fromEntries(
  SEATS.map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }]),
) as Record<Seat, PlayerInfo>;

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

function table(rows: Partial<SevensTable>): SevensTable {
  return { ...svEmptyTable(), ...rows };
}

/** A bot-turn view whose valid cards come from the real rules. */
function state(myHand: Card[], tableState: SevensTable, overrides: Partial<SevensVisibleState> = {}): SevensVisibleState {
  return {
    gameType: 'sevens', phase: 'playing', mySeat: 'N', myHand, myCovered: [],
    handCounts: { N: myHand.length, E: 10, S: 10, W: 10 }, coveredCounts: { N: 0, E: 0, S: 0, W: 0 },
    table: tableState, validCards: svLegalPlays(myHand, tableState, false), currentTurnSeat: 'N',
    log: [], result: null, ...overrides,
  };
}

function decisions(visible: SevensVisibleState): ReturnType<typeof getSevensBotAction>[] {
  return samples.map((sample) => getSevensBotAction(visible, () => sample));
}

function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Sevens bot turn handling', () => {
  const open = table({ spades: { low: 7, high: 7 } });

  it('returns null when it is not the bot turn or the game is over', () => {
    const hand = [card('spades', 8)];
    expect(decisions(state(hand, open, { currentTurnSeat: 'E' }))).toEqual(samples.map(() => null));
    expect(decisions(state(hand, open, { phase: 'scoring' }))).toEqual(samples.map(() => null));
  });

  it('does not mutate the filtered view', () => {
    const visible = state([card('spades', 8), card('hearts', 3)], open);
    const original = structuredClone(visible);
    decisions(visible);
    expect(visible).toEqual(original);
  });

  it('plays the spade seven when it is the only legal card', () => {
    const hand = [card('spades', 7), card('hearts', 3)];
    const visible = state(hand, svEmptyTable(), { validCards: [card('spades', 7)] });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 7) });
  });
});

describe('Sevens bot playing', () => {
  const open = table({ spades: { low: 7, high: 7 } });

  it('extends toward its own follow-up cards instead of a dead-end direction', () => {
    const visible = state([card('spades', 8), card('spades', 9), card('spades', 6)], open);
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 8) });
  });

  it('opens a suit it holds heavily rather than one it does not hold', () => {
    const hand = [card('hearts', 7), card('hearts', 6), card('hearts', 5), card('hearts', 8), card('spades', 8)];
    for (const action of decisions(state(hand, open))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 7) });
    }
  });

  it('avoids opening a suit it has no other cards in when another play is available', () => {
    const hand = [card('diamonds', 7), card('spades', 8), card('spades', 9)];
    for (const action of decisions(state(hand, open))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 8) });
    }
  });

  it('plays a row-end card for free', () => {
    const rows = table({ spades: { low: 7, high: 12 }, hearts: { low: 7, high: 7 } });
    const visible = state([card('spades', 13), card('hearts', 8)], rows);
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 13) });
  });
});

describe('Sevens bot covering', () => {
  const open = table({ spades: { low: 7, high: 7 } });

  it('covers the lowest-penalty card when nothing else differs', () => {
    const visible = state([card('diamonds', 13), card('clubs', 14), card('hearts', 9)], open);
    expect(visible.validCards).toEqual([]);
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-cover', card: card('clubs', 14) });
  });

  it('does not cover the only path to its other cards in the same direction', () => {
    const visible = state([card('hearts', 3), card('hearts', 4)], open);
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-cover', card: card('hearts', 3) });
  });

  it('covers cards already cut off by an earlier cover first', () => {
    const visible = state([card('hearts', 3), card('clubs', 2)], open, { myCovered: [card('hearts', 5)] });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-cover', card: card('hearts', 3) });
  });
});

describe('Sevens bot full games', () => {
  it('always returns a legal action over many seeded deals', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = mulberry32(seed);
      sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random));
      for (let turn = 0; turn < 52; turn++) {
        const seat = sevens.getGameState(CODE)!.currentTurnSeat;
        const view = sevens.getPlayerVisibleState(CODE, seat)!;
        const action = getSevensBotAction(view, random);
        if (!action) throw new Error(`Bot returned no action on seed ${seed} turn ${turn}`);
        if (action.type === 'sevens-play') {
          expect(view.validCards.some((entry) => same(entry, action.card))).toBe(true);
          expect(sevens.play(CODE, seat, action.card)).toEqual({ success: true });
        } else if (action.type === 'sevens-cover') {
          expect(view.validCards).toEqual([]);
          expect(sevens.cover(CODE, seat, action.card)).toEqual({ success: true });
        } else {
          throw new Error('Unexpected action type');
        }
      }
      const final = sevens.getGameState(CODE)!;
      expect(final.phase).toBe('scoring');
      expect(final.result).not.toBeNull();
      expect(SEATS.every((seat) => final.hands[seat].length === 0)).toBe(true);
    }
  });
});
