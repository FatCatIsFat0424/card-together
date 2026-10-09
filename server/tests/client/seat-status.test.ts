import { describe, expect, it } from 'vitest';
import type { GameClock } from '@shared/types';
import { latestSeatAction, seatStatus, showsAutoPlayed } from '../../../client/src/components/seat-status';

function clock(overrides: Partial<Pick<GameClock, 'lastTimeout' | 'turn'>> = {}): Pick<GameClock, 'lastTimeout' | 'turn'> {
  return {
    lastTimeout: { seat: 'E', at: 1_000 },
    turn: { id: 't', seat: 'S', startsAt: 1_000, baseRemainingMs: 15_000, deadline: 50_000 },
    ...overrides,
  };
}

describe('seat status badges', () => {
  it('should find the latest action of a seat', () => {
    const log = [
      { seat: 'E' as const, timestamp: 10 },
      { timestamp: 20 },
      { seat: 'N' as const, timestamp: 30 },
      { seat: 'E' as const, timestamp: 40 },
    ];
    expect(latestSeatAction(log, 'E')).toBe(40);
    expect(latestSeatAction(log, 'W')).toBe(0);
  });

  it('should keep the timeout badge while other seats take their turns', () => {
    expect(showsAutoPlayed(clock(), 'E', 990)).toBe(true);
    expect(showsAutoPlayed(clock({
      turn: { id: 'u', seat: 'W', startsAt: 9_000, baseRemainingMs: 15_000, deadline: 60_000 },
    }), 'E', 1_000)).toBe(true);
  });

  it('should clear the badge once the seat starts another turn or acts again', () => {
    expect(showsAutoPlayed(clock({
      turn: { id: 'u', seat: 'E', startsAt: 4_000, baseRemainingMs: 15_000, deadline: 60_000 },
    }), 'E', 990)).toBe(false);
    expect(showsAutoPlayed(clock({ turn: null }), 'E', 5_000)).toBe(false);
  });

  it('should only badge the seat that timed out', () => {
    expect(showsAutoPlayed(clock(), 'N', 0)).toBe(false);
    expect(showsAutoPlayed(clock({ lastTimeout: undefined }), 'E', 0)).toBe(false);
    expect(showsAutoPlayed(undefined, 'E', 0)).toBe(false);
  });

  it('should show one status, lasting states first', () => {
    const none = { busted: false, locked: false, thinking: false, autoPlayed: false };
    expect(seatStatus(none)).toBeNull();
    expect(seatStatus({ ...none, thinking: true, autoPlayed: true })).toBe('thinking');
    expect(seatStatus({ ...none, locked: true, autoPlayed: true })).toBe('locked');
    expect(seatStatus({ busted: true, locked: true, thinking: true, autoPlayed: true })).toBe('busted');
    expect(seatStatus({ ...none, autoPlayed: true })).toBe('autoPlayed');
  });
});
