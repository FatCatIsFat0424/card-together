import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomInfo } from '@shared/types';
import { INTRO_END_MS, INTRO_EXIT_MS, INTRO_REVEAL_MS, scheduleGameIntro, shouldStartGameIntro }
  from '../../../client/src/games/game-intro';

const waiting: RoomInfo = {
  code: 'ABC123', gameType: 'holdem', status: 'waiting', hostId: 'alice', createdAt: 0,
  abortVote: null, abortVoteCooldownUntil: null,
  seats: { N: { player: null, isReady: false }, E: { player: null, isReady: false },
    S: { player: null, isReady: false }, W: { player: null, isReady: false } },
};
const playing: RoomInfo = { ...waiting, status: 'playing' };
afterEach(() => vi.useRealTimers());

describe('game intro', () => {
  it('starts only for a live start on the current room or game page', () => {
    expect(shouldStartGameIntro(waiting, playing, true, true, '/room/ABC123')).toBe(true);
    expect(shouldStartGameIntro(waiting, playing, true, true, '/game/ABC123')).toBe(true);
    expect(shouldStartGameIntro(null, playing, true, true, '/game/ABC123')).toBe(false);
    expect(shouldStartGameIntro(playing, playing, true, true, '/game/ABC123')).toBe(false);
    expect(shouldStartGameIntro(waiting, playing, false, true, '/room/ABC123')).toBe(false);
    expect(shouldStartGameIntro(waiting, playing, true, false, '/room/ABC123')).toBe(false);
    expect(shouldStartGameIntro(waiting, playing, true, true, '/messages')).toBe(false);
    expect(shouldStartGameIntro(waiting, { ...playing, code: 'OTHER' }, true, true, '/room/OTHER')).toBe(false);
  });

  it('reveals all players with one impact, then exits and finishes', () => {
    vi.useFakeTimers();
    const callbacks = { stage: vi.fn(), impact: vi.fn(), finish: vi.fn() };
    scheduleGameIntro(Date.now(), false, callbacks);
    vi.advanceTimersByTime(INTRO_REVEAL_MS - 1);
    expect(callbacks.stage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callbacks.stage).toHaveBeenLastCalledWith('players');
    expect(callbacks.impact).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(INTRO_EXIT_MS - INTRO_REVEAL_MS);
    expect(callbacks.stage).toHaveBeenLastCalledWith('exit');
    vi.advanceTimersByTime(INTRO_END_MS - INTRO_EXIT_MS);
    expect(callbacks.finish).toHaveBeenCalledOnce();
    expect(callbacks.impact).toHaveBeenCalledOnce();
  });

  it('cancels pending reveals and sound when skipped or unmounted', () => {
    vi.useFakeTimers();
    const callbacks = { stage: vi.fn(), impact: vi.fn(), finish: vi.fn() };
    const cancel = scheduleGameIntro(Date.now(), false, callbacks);
    cancel();
    vi.runAllTimers();
    expect(callbacks.stage).not.toHaveBeenCalled();
    expect(callbacks.impact).not.toHaveBeenCalled();
    expect(callbacks.finish).not.toHaveBeenCalled();
  });

  it('does not replay sounds or reveal players after the intro expires', () => {
    vi.useFakeTimers();
    const callbacks = { stage: vi.fn(), impact: vi.fn(), finish: vi.fn() };
    scheduleGameIntro(Date.now() - INTRO_END_MS, false, callbacks);
    vi.runAllTimers();
    expect(callbacks.impact).not.toHaveBeenCalled();
    expect(callbacks.stage).not.toHaveBeenCalled();
    expect(callbacks.finish).toHaveBeenCalled();
  });

  it('uses a short static reveal for reduced motion', () => {
    vi.useFakeTimers();
    const callbacks = { stage: vi.fn(), impact: vi.fn(), finish: vi.fn() };
    scheduleGameIntro(Date.now(), true, callbacks);
    vi.advanceTimersByTime(0);
    expect(callbacks.stage).toHaveBeenLastCalledWith('players');
    vi.advanceTimersByTime(1000);
    expect(callbacks.finish).toHaveBeenCalledOnce();
  });
});
