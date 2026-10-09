import { describe, expect, it } from 'vitest';
import type { GameClock } from '@shared/types';
import { clockTickDelay, countingMs, seatClock } from '../../../client/src/games/turn-clock';

function clock(): GameClock {
  return {
    settings: { baseSeconds: 5, bankSeconds: 20 },
    bankRemainingMs: { N: 20000, E: 17000, S: 15000, W: 0 },
    turn: { id: 'turn', seat: 'N', startsAt: 12000, baseRemainingMs: 5000, deadline: 37000 },
    serverNow: 10000,
  };
}

describe('seat clock presentation', () => {
  it('holds base time and reserve until the animation finishes on a skewed client clock', () => {
    expect(seatClock(clock(), 'N', 900000, 901999)).toEqual({
      active: true, paused: true, expired: false, baseMs: 5000, bankMs: 20000,
    });
    expect(seatClock(clock(), 'N', 900000, 902000).paused).toBe(false);
  });

  it('uses base time before reserve and keeps other players reserves unchanged', () => {
    expect(seatClock(clock(), 'N', 900000, 905000)).toMatchObject({ baseMs: 2000, bankMs: 20000 });
    expect(seatClock(clock(), 'N', 900000, 909000)).toMatchObject({ baseMs: 0, bankMs: 18000 });
    expect(seatClock(clock(), 'E', 900000, 909000)).toMatchObject({ active: false, bankMs: 17000 });
  });

  it('expires exactly at the deadline and skips elapsed time after a background-tab delay', () => {
    expect(seatClock(clock(), 'N', 900000, 926999).expired).toBe(false);
    expect(seatClock(clock(), 'N', 900000, 927000)).toMatchObject({ expired: true, baseMs: 0, bankMs: 0 });
    expect(seatClock(clock(), 'N', 900000, 999999)).toMatchObject({ expired: true, bankMs: 0 });
  });

  it('continues a partially consumed base period after an intermediate animation', () => {
    const resumed: GameClock = { ...clock(),
      turn: { id: 'flip', seat: 'N', startsAt: 12000, baseRemainingMs: 1000, deadline: 33000 } };
    expect(seatClock(resumed, 'N', 900000, 903500)).toMatchObject({ baseMs: 0, bankMs: 19500 });
  });

  it('keeps final reserves available when no turn is active', () => {
    const finished = { ...clock(), turn: null };
    expect(seatClock(finished, 'N', 900000, 999999)).toMatchObject({ active: false, expired: false, bankMs: 20000 });
  });
});

describe('turn clock ticks', () => {
  it('should wait until the displayed whole second changes', () => {
    expect(clockTickDelay(4300)).toBe(315);
    expect(clockTickDelay(4000)).toBe(1015);
    expect(clockTickDelay(1)).toBe(16);
  });

  it('should fall back to one second for finished or invalid values', () => {
    expect(clockTickDelay(0)).toBe(1000);
    expect(clockTickDelay(-5)).toBe(1000);
    expect(clockTickDelay(Number.NaN)).toBe(1000);
  });

  it('should count the turn allowance before the reserve', () => {
    const time = { active: true, paused: false, expired: false, baseMs: 0, bankMs: 7000 };
    expect(countingMs(time)).toBe(7000);
    expect(countingMs({ ...time, baseMs: 2500 })).toBe(2500);
  });
});
