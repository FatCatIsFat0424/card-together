import { describe, expect, it } from 'vitest';
import type { BigTwoComboType } from '@shared/rules/bigtwo';
import type { BigTwoLogEntry, BigTwoVisibleState, Card } from '@shared/types';
import {
  comboLabelKey, currentRoundEntries, penaltyFormula, toggleCard,
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
