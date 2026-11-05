import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import type { GongZhuPlay, GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { gongZhuLegalCards, gongZhuSeatMap } from '@shared/rules/gongzhu';
import { getGongZhuBotAction } from '../../src/bots/gongzhu-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const seeds = Array.from({ length: 64 }, (_, index) => index + 1);

function view(myHand: readonly Card[], trick: readonly GongZhuPlay[]): GongZhuVisibleState {
  return { gameType: 'gongzhu', phase: 'playing', mySeat: 'N', myHand,
    validCards: gongZhuLegalCards(myHand, trick, false), handCounts: gongZhuSeatMap(() => myHand.length),
    hand: 1, captures: gongZhuSeatMap(() => []), trick, tricks: [], currentTurnSeat: 'N',
    scores: gongZhuSeatMap(() => 0), handResults: [], log: [], result: null };
}

function played(visible: GongZhuVisibleState, seed: number): Card {
  const action = getGongZhuBotAction(visible, seededRandom(seed));
  if (action?.type !== 'game-action' || action.request.gameType !== 'gongzhu') throw new Error('Expected Gong Zhu play.');
  return action.request.action.card;
}

describe('Gong Zhu hard bot bounded variety', () => {
  it('varies near-equal safe discards while preserving a valuable scoring card', () => {
    const visible = view([c('clubs', 13), c('diamonds', 13), c('diamonds', 11)], [{ seat: 'W', card: c('spades', 14) }]);
    const before = structuredClone(visible);
    const choices = seeds.map((seed) => played(visible, seed));
    expect(new Set(choices.map((card) => card.suit)).size).toBe(2);
    expect(choices.every((card) => card.rank === 13)).toBe(true);
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
    expect(visible).toEqual(before);
    Object.defineProperty(visible, 'observedHands', { get: () => { throw new Error('Spectator data read.'); } });
    expect(seeds.map((seed) => played(visible, seed))).toEqual(choices);
  });

  it('dumps the pig when void and wins a valuable final trick across seeds', () => {
    const dump = view([c('spades', 12), c('hearts', 14), c('diamonds', 11)], [{ seat: 'W', card: c('clubs', 14) }]);
    const win = view([c('diamonds', 12), c('diamonds', 14), c('diamonds', 2)], [
      { seat: 'E', card: c('diamonds', 11) }, { seat: 'S', card: c('diamonds', 3) }, { seat: 'W', card: c('diamonds', 4) },
    ]);
    for (const seed of seeds) {
      expect(played(dump, seed)).toEqual(c('spades', 12));
      expect(played(win, seed).rank).toBeGreaterThan(11);
    }
  });
});
