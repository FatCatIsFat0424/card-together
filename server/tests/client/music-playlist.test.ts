import { describe, expect, it } from 'vitest';
import { nextTrackIndex } from '../../../client/src/audio/music-playlist';

describe('nextTrackIndex', () => {
  it('should stay on the current track in loop-one mode', () => {
    expect(nextTrackIndex(2, 5, 'loop-one', Math.random)).toBe(2);
  });

  it('should step forward and back with wrap-around in sequential mode', () => {
    expect(nextTrackIndex(4, 5, 'sequential', Math.random)).toBe(0);
    expect(nextTrackIndex(0, 5, 'sequential', Math.random, -1)).toBe(4);
    expect(nextTrackIndex(1, 5, 'sequential', Math.random)).toBe(2);
  });

  it('should shuffle to any other track without repeating the current track', () => {
    const picks = new Set<number>();
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
      const pick = nextTrackIndex(2, 5, 'shuffle', () => value);
      expect(pick).not.toBe(2);
      picks.add(pick);
    }
    expect([...picks].sort()).toEqual([0, 1, 3, 4]);
    expect(nextTrackIndex(0, 1, 'shuffle', () => 0.5)).toBe(0);
  });
});
