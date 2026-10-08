import { describe, expect, it } from 'vitest';
import { identifyCombo, legalPlays } from '@shared/rules/bigtwo';
import type { BigTwoComboType } from '@shared/rules/bigtwo';
import type { BigTwoLogEntry, BigTwoVisibleState, Card } from '@shared/types';
import {
  comboLabelKey, currentRoundEntries, nextHint, penaltyFormula, quickPlayPage, quickPlayTypes, toggleCard,
} from '../../../client/src/games/bigtwo/bigtwo-view';
import { gameTranslations } from '../../../client/src/game-i18n';
import { useGameStore } from '../../../client/src/stores/game-store';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('comboLabelKey', () => {
  it('maps every combo to its Chinese name', () => {
    const expected: Record<BigTwoComboType, string> = {
      single: '單張', pair: '對子', straight: '順子',
      fullHouse: '葫蘆', fourOfAKind: '鐵支', straightFlush: '同花順',
    };
    for (const [type, label] of Object.entries(expected)) {
      expect(gameTranslations['zh-TW'][comboLabelKey(type as BigTwoComboType)]).toBe(label);
    }
  });
});

describe('toggleCard', () => {
  it('adds an unselected card and removes a selected one', () => {
    const once = toggleCard([], c(3, 'clubs'));
    expect(once).toEqual([c(3, 'clubs')]);
    expect(toggleCard([...once, c(5, 'hearts')], { suit: 'clubs', rank: 3 })).toEqual([c(5, 'hearts')]);
  });
});

describe('nextHint', () => {
  const hand = [c(3, 'clubs'), c(3, 'spades'), c(9, 'hearts')];
  const plays = legalPlays(hand, null, false);

  it('cycles through legal plays and wraps around', () => {
    const seen: Card[][] = [];
    let selection: Card[] = [];
    for (let i = 0; i < plays.length; i += 1) {
      selection = nextHint(plays, selection);
      seen.push(selection);
    }
    expect(seen.map((cards) => identifyCombo(cards)?.type)).toEqual(plays.map((play) => play.type));
    expect(nextHint(plays, selection)).toEqual(plays[0].cards);
  });

  it('starts at the first play for an unrelated selection and returns nothing when no plays exist', () => {
    expect(nextHint(plays, [c(9, 'hearts'), c(3, 'clubs')])).toEqual(plays[0].cards);
    expect(nextHint([], [])).toEqual([]);
  });
});

describe('currentRoundEntries', () => {
  it('returns plays and passes after the last round end', () => {
    const log: BigTwoLogEntry[] = [
      { type: 'play', seat: 'N', cards: [c(3, 'clubs')], comboType: 'single', timestamp: 1 },
      { type: 'pass', seat: 'W', timestamp: 2 },
      { type: 'round_end', leaderSeat: 'N', timestamp: 3 },
      { type: 'play', seat: 'N', cards: [c(4, 'clubs')], comboType: 'single', timestamp: 4 },
      { type: 'pass', seat: 'W', timestamp: 5 },
    ];
    expect(currentRoundEntries(log).map((entry) => entry.timestamp)).toEqual([4, 5]);
    expect(currentRoundEntries(log.slice(0, 2))).toHaveLength(2);
  });
});

describe('penaltyFormula', () => {
  it('formats cards × 2^twos', () => {
    expect(penaltyFormula(5, 2, 20)).toBe('5 × 2² = 20');
    expect(penaltyFormula(7, 0, 7)).toBe('7 × 2⁰ = 7');
  });
});

describe('game store bigtwo restore', () => {
  const state: BigTwoVisibleState = {
    gameType: 'bigtwo', phase: 'playing', mySeat: 'S', myHand: [c(3, 'clubs')],
    handCounts: { N: 13, E: 13, S: 1, W: 13 }, currentTurnSeat: 'E', lastPlay: null,
    lockedSeats: ['W'], firstPlay: true, log: [], result: null, revealedHands: null,
  };

  it('keeps the visible state and turn seat, and retains identity for equal snapshots', () => {
    useGameStore.getState().reset();
    useGameStore.getState().restore(state);
    const first = useGameStore.getState();
    expect(first.gameType).toBe('bigtwo');
    expect(first.currentTurnSeat).toBe('E');
    expect(first.bigTwo).toEqual(state);
    useGameStore.getState().restore(structuredClone(state));
    expect(useGameStore.getState()).toBe(first);
  });
});

describe('quickPlayPage', () => {
  const hand = [c(3, 'clubs'), c(3, 'spades'), c(9, 'hearts'), c(10, 'clubs')];
  const plays = legalPlays(hand, null, false);

  it('shows at most three groups and makes every legal alternative reachable', () => {
    const first = quickPlayPage(plays, 0);
    const second = quickPlayPage(plays, 1);
    expect(first.plays).toHaveLength(3);
    expect([...first.plays, ...second.plays]).toEqual(plays);
    expect(quickPlayPage(plays, first.totalPages)).toEqual(first);
  });

  it('handles a turn without legal responses without inventing a group', () => {
    expect(quickPlayPage([], 4)).toEqual({ plays: [], page: 0, totalPages: 1 });
  });

  it('keeps first-play and response restrictions when paging available groups', () => {
    const first = legalPlays(hand, null, true);
    expect(quickPlayPage(first, 0).plays.every((play) =>
      play.cards.some((card) => card.rank === 3 && card.suit === 'clubs'))).toBe(true);
    const response = legalPlays(hand, identifyCombo([c(9, 'clubs')]), false);
    expect(quickPlayPage(response, 0).plays).toEqual(response);
    expect(response.map((play) => play.cards)).toEqual([[c(9, 'hearts')], [c(10, 'clubs')]]);
  });
});

describe('quick play type filters', () => {
  const hand = [c(3, 'clubs'), c(3, 'spades'), c(4, 'hearts'), c(4, 'clubs'), c(5, 'hearts'), c(6, 'clubs'), c(7, 'diamonds')];
  const plays = legalPlays(hand, null, false);

  it('offers only types that have a legal play, once each', () => {
    expect(quickPlayTypes(plays)).toEqual(['single', 'pair', 'straight']);
    expect(quickPlayTypes([])).toEqual([]);
  });

  it('reaches pairs and five-card groups without paging through singles', () => {
    expect(quickPlayPage(plays, 0, 'pair').plays).toEqual(plays.filter((play) => play.type === 'pair'));
    const straights = plays.filter((play) => play.type === 'straight');
    const first = quickPlayPage(plays, 0, 'straight');
    const second = quickPlayPage(plays, 1, 'straight');
    expect(first.plays).toHaveLength(3);
    expect([...first.plays, ...second.plays]).toEqual(straights);
    expect(quickPlayPage(plays, first.totalPages, 'straight')).toEqual(first);
  });

  it('keeps all alternatives and does not mutate the input when filtering', () => {
    const original = structuredClone(plays);
    quickPlayPage(Object.freeze(plays), 0, 'pair');
    expect(plays).toEqual(original);
    expect(quickPlayPage(plays, 0, 'all')).toEqual(quickPlayPage(plays, 0));
    expect(quickPlayPage(plays, 0, 'fourOfAKind').plays).toEqual([]);
  });
});
