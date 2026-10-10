import { describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { LiarCard, LiarsDeckLogEntry, LiarsDeckVisibleState } from '@shared/types';
import {
  liarFaceCard, liarsDeckHandMode, liarsDeckView, recentLiarsDeckMoves, replayLiarsDeck, toggleSelection, truthCount,
} from '../../../client/src/games/liarsdeck/liarsdeck-view';
import { liarsDeckTranslations } from '../../../client/src/liarsdeck-i18n';

const hand: LiarCard[] = [{ id: 0, face: 'K' }, { id: 6, face: 'Q' }, { id: 12, face: 'A' }, { id: 18, face: 'joker' }];

/** N lied in round 1, W called, N's first pull fired, and round 2 began with W. */
const log: LiarsDeckLogEntry[] = [
  { type: 'round', round: 1, tableFace: 'K', starter: 'N', timestamp: 1 },
  { type: 'play', seat: 'N', count: 2, timestamp: 2 },
  { type: 'challenge', seat: 'W', target: 'N', revealed: ['Q', 'K'], lied: true, timestamp: 3 },
  { type: 'shot', seat: 'N', shot: 1, survived: false, timestamp: 4 },
  { type: 'round', round: 2, tableFace: 'A', starter: 'W', timestamp: 5 },
];

function game(overrides: Partial<LiarsDeckVisibleState> = {}): LiarsDeckVisibleState {
  return {
    gameType: 'liarsdeck', phase: 'playing', mySeat: 'S', myHand: hand, myPlayed: [],
    handCounts: { N: 0, E: 5, S: 5, W: 5 }, pileCount: 0, lastPlay: null, tableFace: 'A', round: 2,
    currentTurnSeat: 'W', shots: { N: 1, E: 0, S: 0, W: 0 }, eliminated: ['N'], log,
    presentation: { id: 'p', startedAt: 0, logStart: 2, timingVersion: 2 }, result: null, ...overrides,
  };
}

describe("Liar's Deck table view", () => {
  it('should replay counts, the pile, pulls, and eliminations from the public log', () => {
    expect(replayLiarsDeck(log, 2)).toMatchObject({
      round: 1, tableFace: 'K', handCounts: { N: 3, E: 5, S: 5, W: 5 }, pileCount: 2,
      lastPlay: { seat: 'N', count: 2 }, eliminated: [],
    });
    expect(replayLiarsDeck(log, 5)).toMatchObject({
      round: 2, tableFace: 'A', handCounts: { N: 0, E: 5, S: 5, W: 5 }, pileCount: 0, lastPlay: null,
      shots: { N: 1, E: 0, S: 0, W: 0 }, eliminated: ['N'],
    });
  });

  it('should hold a pull unresolved during its suspense frame and hide the next deal until it is presented', () => {
    const state = game();
    const [challenge, roulette, shot, deal] = getPresentationFrames(state);
    expect(liarsDeckView(state, challenge)).toMatchObject({ round: 1, eliminated: [], handHidden: true, logEnd: 3 });
    expect(liarsDeckView(state, roulette)).toMatchObject({ shots: { N: 0 }, eliminated: [], handHidden: true });
    expect(liarsDeckView(state, shot)).toMatchObject({ shots: { N: 1 }, eliminated: ['N'], handHidden: true });
    expect(liarsDeckView(state, deal)).toMatchObject({ round: 2, tableFace: 'A', handHidden: false, logEnd: 5 });
    expect(liarsDeckView(state, null)).toMatchObject({ round: 2, handHidden: false, logEnd: 5 });
  });

  it('should offer a play, a call, or a forced call for the seat to act', () => {
    expect(liarsDeckHandMode(game({ currentTurnSeat: 'S' }), true)).toBe('play');
    expect(liarsDeckHandMode(game({ lastPlay: { seat: 'E', count: 1 } }), true)).toBe('playOrCall');
    expect(liarsDeckHandMode(game({ lastPlay: { seat: 'E', count: 1 }, handCounts: { N: 0, E: 0, S: 4, W: 0 } }), true))
      .toBe('mustCall');
    expect(liarsDeckHandMode(game(), false)).toBe('wait');
    expect(liarsDeckHandMode(game({ phase: 'scoring' }), true)).toBe('wait');
  });

  it('should select up to three cards still in hand', () => {
    expect(toggleSelection([], 0, hand)).toEqual([0]);
    expect(toggleSelection([0], 0, hand)).toEqual([]);
    expect(toggleSelection([0, 6, 12], 18, hand)).toEqual([0, 6, 12]);
    expect(toggleSelection([0, 99], 6, hand)).toEqual([0, 6]);
  });

  it('should count jokers as truths and draw K/Q/A with standard card art', () => {
    expect(truthCount(hand, 'Q')).toBe(2);
    expect(liarFaceCard('K', 0)).toEqual({ suit: 'spades', rank: 13 });
    expect(liarFaceCard('A', 5)).toEqual({ suit: 'hearts', rank: 14 });
    expect(recentLiarsDeckMoves(log, 2).map((entry) => entry.type)).toEqual(['round', 'shot']);
  });

  it('should translate every key in both languages', () => {
    const english = Object.keys(liarsDeckTranslations.en).sort();
    expect(Object.keys(liarsDeckTranslations['zh-TW']).sort()).toEqual(english);
    for (const value of Object.values(liarsDeckTranslations['zh-TW'])) expect(value.trim()).not.toBe('');
  });
});
