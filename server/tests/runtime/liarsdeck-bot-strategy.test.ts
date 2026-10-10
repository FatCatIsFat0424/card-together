import { describe, expect, it } from 'vitest';
import type { LiarCard, LiarFace, LiarsDeckLogEntry, LiarsDeckVisibleState } from '@shared/types';
import { LD_DECK } from '@shared/rules/liarsdeck';
import { atLeastTruths, getLiarsDeckBotAction, lieChance } from '../../src/bots/liarsdeck-strategy';

const samples = [0, 0.25, 0.5, 0.75, 0.9999];

function hand(faces: readonly LiarFace[]): LiarCard[] {
  const used = new Set<number>();
  return faces.map((face) => {
    const card = LD_DECK.find((entry) => entry.face === face && !used.has(entry.id))!;
    used.add(card.id);
    return card;
  });
}

const round: LiarsDeckLogEntry = { type: 'round', round: 1, tableFace: 'K', starter: 'E', timestamp: 1 };

/** North to act in round 1 with K as the table card. */
function state(myHand: LiarCard[], overrides: Partial<LiarsDeckVisibleState> = {}): LiarsDeckVisibleState {
  return {
    gameType: 'liarsdeck', phase: 'playing', mySeat: 'N', myHand, myPlayed: [],
    handCounts: { N: myHand.length, E: 5, S: 5, W: 5 }, pileCount: 0, lastPlay: null, tableFace: 'K', round: 1,
    currentTurnSeat: 'N', shots: { N: 0, E: 0, S: 0, W: 0 }, eliminated: [], log: [round], result: null,
    ...overrides,
  };
}

/** East just claimed `count` cards. */
function afterClaim(myHand: LiarCard[], count: number, eastLeft: number): LiarsDeckVisibleState {
  return state(myHand, {
    handCounts: { N: myHand.length, E: eastLeft, S: 5, W: 5 }, pileCount: count, lastPlay: { seat: 'E', count },
    log: [round, { type: 'play', seat: 'E', count, timestamp: 2 }],
  });
}

const decide = (visible: LiarsDeckVisibleState): ReturnType<typeof getLiarsDeckBotAction>[] =>
  samples.map((sample) => getLiarsDeckBotAction(visible, () => sample));

describe("Liar's Deck bot strategy", () => {
  it('should compute hypergeometric truth chances', () => {
    expect(atLeastTruths(15, 6, 5, 0)).toBeCloseTo(1);
    expect(atLeastTruths(15, 6, 5, 1)).toBeCloseTo(1 - 126 / 3003);
    expect(atLeastTruths(15, 2, 5, 3)).toBe(0);
  });

  it('should always call when it is the last seat holding cards and never call on the first play', () => {
    const forced = state(hand(['Q', 'A']), {
      handCounts: { N: 2, E: 0, S: 0, W: 0 }, pileCount: 1, lastPlay: { seat: 'E', count: 1 },
    });
    expect(decide(forced).every((action) => action?.type === 'liarsdeck-challenge')).toBe(true);
    expect(decide(state(hand(['Q', 'A', 'Q', 'A', 'Q']))).every((action) => action?.type === 'liarsdeck-play')).toBe(true);
  });

  it('should play only matching cards when every card in hand matches', () => {
    const myHand = hand(['K', 'K', 'joker']);
    for (const action of decide(state(myHand))) {
      expect(action?.type).toBe('liarsdeck-play');
      if (action?.type === 'liarsdeck-play') expect(action.cardIds.length).toBeGreaterThan(0);
    }
  });

  it('should treat a claim beyond the unseen truths as certain and call unlikely claims', () => {
    // North holds five of the eight truths, so East needed all three others for a three-card claim.
    const visible = afterClaim(hand(['K', 'K', 'K', 'joker', 'joker']), 3, 2);
    expect(lieChance(visible)).toBeGreaterThan(0.9);
    expect(lieChance({ ...visible, myPlayed: hand(['K']).map((card) => ({ ...card, id: 5 })) })).toBe(1);
    expect(decide(visible).every((action) => action?.type === 'liarsdeck-challenge')).toBe(true);
  });

  it('should trust a single-card claim when it can still play honestly', () => {
    const visible = afterClaim(hand(['K', 'Q', 'A', 'Q', 'A']), 1, 4);
    expect(lieChance(visible)).toBeLessThan(0.3);
    expect(decide(visible).every((action) => action?.type === 'liarsdeck-play')).toBe(true);
  });

  it('should wait outside its turn and after the game ends', () => {
    expect(getLiarsDeckBotAction(state(hand(['K']), { currentTurnSeat: 'E' }), () => 0)).toBeNull();
    expect(getLiarsDeckBotAction(state(hand(['K']), { phase: 'scoring' }), () => 0)).toBeNull();
  });
});
