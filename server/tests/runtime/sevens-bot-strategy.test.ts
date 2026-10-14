import { runSeededGame } from './seeded-game-runner';
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
    table: tableState, validCards: svLegalPlays(myHand, tableState, false, overrides.options?.closeOnEnd), currentTurnSeat: 'N',
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

  it('opens a suit toward its own high cards even across gaps', () => {
    const rows = table({ spades: { low: 6, high: 8 }, hearts: { low: 7, high: 7 } });
    const hand = [card('diamonds', 12), card('hearts', 6), card('diamonds', 11), card('diamonds', 7), card('clubs', 13)];
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('diamonds', 7) });
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

describe('Sevens bot Dragon Slaying', () => {
  const options = { closeOnEnd: true };

  it.each([
    { end: 13 as const, own: 5 as const, row: { low: 6, high: 12 } },
    { end: 14 as const, own: 9 as const, row: { low: 2, high: 8 } },
  ])('saves its opposite-end card before closing with rank $end', ({ end, own, row }) => {
    const hand = [card('spades', end), card('spades', own)];
    const visible = state(hand, table({ spades: row }), { options });
    expect(visible.validCards).toEqual(hand);
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', own) });
    }
    for (const action of decisions(state(hand, visible.table))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', end) });
    }
  });

  it('closes a suit to block opponents heavy cards when it sacrifices none of its own', () => {
    const hand = [card('spades', 14), card('hearts', 8), card('hearts', 9)];
    const rows = table({ spades: { low: 2, high: 8 }, hearts: { low: 7, high: 7 } });
    for (const action of decisions(state(hand, rows, { options }))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 14) });
    }
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 8) });
    }
  });

  it('discounts the blocking benefit when opponents have already covered many cards', () => {
    const hand = [card('spades', 14), card('hearts', 8), card('hearts', 9)];
    const visible = state(hand, table({ spades: { low: 2, high: 8 }, hearts: { low: 7, high: 7 } }), {
      options, handCounts: { N: 3, E: 5, S: 5, W: 5 }, coveredCounts: { N: 0, E: 8, S: 8, W: 8 },
    });
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 8) });
    }
  });

  it('does not sacrifice cards already cut off by its own earlier cover', () => {
    const hand = [card('spades', 13), card('spades', 4), card('hearts', 8)];
    const visible = state(hand, table({ spades: { low: 7, high: 12 }, hearts: { low: 7, high: 7 } }), {
      options, myCovered: [card('spades', 5)],
    });
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 13) });
    }
  });

  it('covers a closed-suit card before sacrificing a card in a suit that can still open', () => {
    const hand = [card('spades', 13), card('hearts', 4)];
    const rows = table({ spades: { low: 1, high: 7 } });
    const visible = state(hand, rows, { options });
    expect(visible.validCards).toEqual([]);
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'sevens-cover', card: card('spades', 13) });
    }
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-cover', card: card('hearts', 4) });
    }
  });

  it('does not consult observed opponent hands', () => {
    const hand = [card('spades', 13), card('spades', 5)];
    const visible = state(hand, table({ spades: { low: 6, high: 12 } }), { options });
    expect(decisions({ ...visible, observedHands: { N: hand, E: [], S: [], W: [] } }))
      .toEqual(decisions({ ...visible, observedHands: { N: [], E: hand, S: hand, W: hand } }));
  });
});

describe('Sevens bot penalty-aware planning', () => {
  it('prefers saving higher penalties when both continuations have the same length', () => {
    const visible = state([card('spades', 11), card('spades', 12), card('hearts', 3), card('hearts', 2)],
      table({ spades: { low: 7, high: 10 }, hearts: { low: 4, high: 7 } }));
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 11) });
  });

  it('does not reward high cards behind a covered gate', () => {
    const visible = state([card('spades', 8), card('spades', 10), card('spades', 11), card('hearts', 6), card('hearts', 5)],
      table({ spades: { low: 7, high: 7 }, hearts: { low: 7, high: 7 } }), { myCovered: [card('spades', 9)] });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 6) });
  });

  it('covers a high dead card before a low card that can still be saved', () => {
    const visible = state([card('spades', 13), card('hearts', 14)], table({ spades: { low: 1, high: 7 } }),
      { options: { closeOnEnd: true } });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-cover', card: card('spades', 13) });
  });

  it('uses forced-cover history to identify a dead direction', () => {
    const visible = state([card('spades', 13), card('hearts', 14)],
      table({ spades: { low: 7, high: 7 }, hearts: { low: 7, high: 7 } }), {
        coveredCounts: { N: 0, E: 1, S: 1, W: 1 },
        log: [
          { type: 'play', seat: 'N', card: card('spades', 7), timestamp: 0 },
          { type: 'cover', seat: 'W', timestamp: 1 },
          { type: 'cover', seat: 'S', timestamp: 2 },
          { type: 'cover', seat: 'E', timestamp: 3 },
          { type: 'play', seat: 'N', card: card('hearts', 7), timestamp: 4 },
        ],
      });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-cover', card: card('spades', 13) });
    for (const action of decisions({ ...visible, log: [] })) {
      expect(action).toEqual({ type: 'sevens-cover', card: card('hearts', 14) });
    }
  });

  it('never reads spectator information or settlement results while planning', () => {
    const visible = state([card('spades', 8), card('spades', 9), card('hearts', 7)],
      table({ spades: { low: 7, high: 7 } }), { options: { closeOnEnd: true } });
    const expected = decisions(visible);
    for (const property of ['observedHands', 'observedCovered', 'result']) {
      Object.defineProperty(visible, property, { get: () => { throw new Error(`Private property read: ${property}`); } });
    }
    expect(decisions(visible)).toEqual(expected);
  });
});

describe('Sevens bot anticipatory Dragon Slaying', () => {
  it('delays 2 to avoid exposing A while its high cards remain vulnerable', () => {
    const hand = [card('spades', 2), card('spades', 11), card('spades', 12), card('spades', 13), card('hearts', 8)];
    const rows = table({ spades: { low: 3, high: 9 }, hearts: { low: 7, high: 7 } });
    for (const action of decisions(state(hand, rows, { options: { closeOnEnd: true } }))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 8) });
    }
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 2) });
    }
  });

  it('delays Q to avoid exposing K while its low cards remain vulnerable', () => {
    const hand = [card('spades', 12), card('spades', 3), card('spades', 2), card('spades', 14), card('hearts', 7)];
    const rows = table({ spades: { low: 5, high: 11 } });
    for (const action of decisions(state(hand, rows, { options: { closeOnEnd: true } }))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 7) });
    }
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 12) });
    }
  });

  it('detects a two-play path to closure before exposing 2', () => {
    const hand = [card('spades', 3), card('spades', 11), card('spades', 12), card('spades', 13), card('hearts', 7)];
    const rows = table({ spades: { low: 4, high: 9 } });
    for (const action of decisions(state(hand, rows, { options: { closeOnEnd: true } }))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('hearts', 7) });
    }
    for (const action of decisions(state(hand, rows))) {
      expect(action).toEqual({ type: 'sevens-play', card: card('spades', 3) });
    }
  });

  it('does not assume one opponent can play both 2 and A in one rotation', () => {
    const hand = [card('spades', 3), card('spades', 11), card('spades', 12), card('spades', 13), card('hearts', 7)];
    const visible = state(hand, table({ spades: { low: 4, high: 9 } }), {
      options: { closeOnEnd: true }, handCounts: { N: hand.length, E: 0, S: 0, W: 10 },
    });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 3) });
  });

  it('can safely expose A when it holds that endpoint itself', () => {
    const hand = [card('spades', 2), card('spades', 14), card('spades', 11), card('spades', 12), card('spades', 13), card('hearts', 8)];
    const visible = state(hand, table({ spades: { low: 3, high: 9 }, hearts: { low: 7, high: 7 } }),
      { options: { closeOnEnd: true } });
    for (const action of decisions(visible)) expect(action).toEqual({ type: 'sevens-play', card: card('spades', 2) });
  });

  it('still plays its only legal card even when closure exposure is costly', () => {
    const hand = [card('spades', 2), card('spades', 11), card('spades', 12), card('spades', 13)];
    const visible = state(hand, table({ spades: { low: 3, high: 9 } }), { options: { closeOnEnd: true } });
    const action = getSevensBotAction(visible, () => { throw new Error('Single move needs no random selection'); });
    expect(action).toEqual({ type: 'sevens-play', card: card('spades', 2) });
  });
});

describe('Sevens bot full games', () => {
  it.each([false, true])('always returns a legal action over many seeded deals with closeOnEnd=%s', (closeOnEnd) => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = mulberry32(seed);
      sevens.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random), { closeOnEnd });
      // A collapse after every suit is slain covers the rest at once, so a match can end before 52 turns.
      runSeededGame(`sevens/${seed}/closeOnEnd=${closeOnEnd}`, 52, () => sevens.getGameState(CODE)?.phase === 'scoring', (turn) => {
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
      });
      const final = sevens.getGameState(CODE)!;
      expect(final.phase).toBe('scoring');
      expect(final.result).not.toBeNull();
      expect(SEATS.every((seat) => final.hands[seat].length === 0)).toBe(true);
    }
  });
});
