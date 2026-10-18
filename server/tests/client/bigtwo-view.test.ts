import { describe, expect, it } from 'vitest';
import type { BigTwoComboType } from '@shared/rules/bigtwo';
import type { BigTwoLogEntry, BigTwoVisibleState, Card, Seat } from '@shared/types';
import {
  comboLabelKey, currentRoundEntries, penaltyFormula, summarizeBigTwoRound, toggleCard,
} from '../../../client/src/games/bigtwo/bigtwo-view';
import { deriveRoundHistory } from '../../../client/src/games/round-history';
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

describe('summarizeBigTwoRound', () => {
  const rounds = (log: BigTwoLogEntry[], phase: 'playing' | 'scoring' = 'playing') =>
    deriveRoundHistory({ gameType: 'bigtwo', phase, log });
  const play = (seat: Seat, cards: Card[], comboType: BigTwoComboType): BigTwoLogEntry =>
    ({ type: 'play', seat, cards, comboType, timestamp: 0 });

  it('names the lead combo and the winning play once the round ends', () => {
    const [done, ongoing] = rounds([
      play('N', [c(3, 'clubs')], 'single'),
      play('E', [c(13, 'spades')], 'single'),
      { type: 'pass', seat: 'S', timestamp: 0 },
      { type: 'pass', seat: 'N', timestamp: 0 },
      { type: 'round_end', leaderSeat: 'E', timestamp: 0 },
      play('E', [c(5, 'hearts'), c(5, 'spades')], 'pair'),
    ]);
    expect(summarizeBigTwoRound(done)).toEqual({ leadCombo: 'single', winnerSeat: 'E', winningIndex: 1 });
    expect(summarizeBigTwoRound(ongoing)).toEqual({ leadCombo: 'pair', winnerSeat: null, winningIndex: -1 });
  });

  it('credits the last play when the match ends mid-round, and dragons', () => {
    const [last] = rounds([play('N', [c(4, 'clubs')], 'single'), play('W', [c(2, 'spades')], 'single')], 'scoring');
    expect(summarizeBigTwoRound(last)).toEqual({ leadCombo: 'single', winnerSeat: 'W', winningIndex: 1 });
    const [dragon] = rounds([{ type: 'dragon', seat: 'S', timestamp: 0 }], 'scoring');
    expect(summarizeBigTwoRound(dragon)).toEqual({ leadCombo: null, winnerSeat: 'S', winningIndex: 0 });
  });
});
