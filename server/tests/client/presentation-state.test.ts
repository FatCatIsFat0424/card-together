import { describe, expect, it } from 'vitest';
import type { BigTwoVisibleState } from '@shared/types';
import { presentationMoment } from '../../../client/src/games/presentation-state';
import { useGameStore } from '../../../client/src/stores/game-store';

function snapshot(): BigTwoVisibleState {
  return {
    gameType: 'bigtwo', phase: 'playing', mySeat: 'N', myHand: [],
    handCounts: { N: 1, E: 1, S: 1, W: 1 }, currentTurnSeat: 'N',
    lastPlay: null, lockedSeats: [], firstPlay: false, result: null, revealedHands: null,
    presentation: { timingVersion: 2, id: 'action', startedAt: 10000, serverNow: 10000, logStart: 0 },
    log: [
      { type: 'play', seat: 'N', cards: [{ suit: 'spades', rank: 2 }], comboType: 'single', timestamp: 10000 },
      { type: 'pass', seat: 'W', timestamp: 10000 },
      { type: 'pass', seat: 'S', timestamp: 10000 },
      { type: 'pass', seat: 'E', timestamp: 10000 },
      { type: 'round_end', leaderSeat: 'N', timestamp: 10000 },
    ],
  };
}

describe('client presentation timeline', () => {
  it('holds a played result for one second after its 300 ms arrival animation', () => {
    const game = snapshot();
    for (const elapsed of [0, 300, 1000, 1299]) {
      const moment = presentationMoment(game, 1000, 1000 + elapsed);
      expect(moment.frame?.kind).toBe('play');
      expect(moment.locked).toBe(true);
    }
    expect(presentationMoment(game, 1000, 2300).frame?.kind).toBe('pass');
  });

  it('preserves legacy timing without extending an already persisted presentation', () => {
    const base = snapshot();
    const game = { ...base, presentation: { ...base.presentation!, timingVersion: undefined } };
    expect(presentationMoment(game, 1000, 1399).frame?.kind).toBe('play');
    expect(presentationMoment(game, 1000, 1400).frame?.kind).toBe('pass');
    expect(presentationMoment(game, 1000, 4450).locked).toBe(false);
  });

  it('shows all automatic passes in order and unlocks exactly at the deadline', () => {
    const game = snapshot();
    const frames = [0, 1300, 2300, 3300, 4300].map((elapsed) =>
      presentationMoment(game, 1000, 1000 + elapsed).frame);
    expect(frames.map((frame) => frame?.kind)).toEqual(['play', 'pass', 'pass', 'pass', 'round']);
    expect(frames.map((frame) => frame?.seat)).toEqual(['N', 'W', 'S', 'E', 'N']);
    expect(presentationMoment(game, 1000, 7299).locked).toBe(true);
    expect(presentationMoment(game, 1000, 7300).locked).toBe(false);
  });

  it('uses server time to resume only the remaining frame on a skewed client clock', () => {
    const base = snapshot();
    const game = { ...base, presentation: { ...base.presentation!, serverNow: 12000 } };
    const resumed = presentationMoment(game, 900000, 900000);
    expect(resumed.frame?.kind).toBe('pass');
    expect(resumed.frame?.seat).toBe('W');
    expect(resumed.nextAt).toBe(900300);
    expect(resumed.endsAt).toBe(904300);
    expect(presentationMoment(game, 900000, 910000).frame).toBeNull();
  });

  it('does not restart the timer for an identical authoritative snapshot', () => {
    const game = snapshot();
    useGameStore.getState().reset();
    useGameStore.getState().restore(game);
    const before = useGameStore.getState();
    useGameStore.getState().restore(structuredClone(game));
    expect(useGameStore.getState()).toBe(before);
    useGameStore.getState().reset();
    expect(useGameStore.getState().visible).toBeNull();
  });

  it('allows old snapshots without metadata and does not replay an expired result', () => {
    const game = snapshot();
    const old = { ...game, presentation: undefined };
    expect(presentationMoment(old, 1000, 1000).locked).toBe(false);
    expect(presentationMoment(null, 1000, 1000).locked).toBe(false);
    const scored = { ...game, phase: 'scoring' as const };
    expect(presentationMoment(scored, 1000, 7300).frame?.kind).toBe('finish');
    expect(presentationMoment(scored, 1000, 10300).locked).toBe(false);
  });
});
