import { describe, expect, it } from 'vitest';
import { nextTrackIndex } from '../../../client/src/audio/music-playlist';

const all = (count: number): boolean[] => Array.from({ length: count }, () => true);

describe('nextTrackIndex', () => {
  it('should stay on the current track in loop-one mode', () => {
    expect(nextTrackIndex(2, all(5), 'loop-one', Math.random)).toBe(2);
  });

  it('should step forward and back with wrap-around in sequential mode', () => {
    expect(nextTrackIndex(4, all(5), 'sequential', Math.random)).toBe(0);
    expect(nextTrackIndex(0, all(5), 'sequential', Math.random, -1)).toBe(4);
    expect(nextTrackIndex(1, all(5), 'sequential', Math.random)).toBe(2);
  });

  it('should shuffle to any other track without repeating the current track', () => {
    const picks = new Set<number>();
    for (const value of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
      const pick = nextTrackIndex(2, all(5), 'shuffle', () => value);
      expect(pick).not.toBe(2);
      picks.add(pick);
    }
    expect([...picks].sort()).toEqual([0, 1, 3, 4]);
    expect(nextTrackIndex(0, all(1), 'shuffle', () => 0.5)).toBe(0);
  });

  it('should skip unplayable tracks, including from an unplayable current track', () => {
    const playable = [true, false, false, true, false];
    expect(nextTrackIndex(0, playable, 'sequential', Math.random)).toBe(3);
    expect(nextTrackIndex(3, playable, 'sequential', Math.random)).toBe(0);
    expect(nextTrackIndex(0, playable, 'sequential', Math.random, -1)).toBe(3);
    expect(nextTrackIndex(1, playable, 'sequential', Math.random)).toBe(3);
    expect(nextTrackIndex(2, playable, 'sequential', Math.random, -1)).toBe(0);
    for (const value of [0, 0.5, 0.999999]) {
      expect(nextTrackIndex(1, playable, 'shuffle', () => value)).not.toBe(1);
      expect(nextTrackIndex(1, playable, 'shuffle', () => value)).toSatisfy((index: number) => playable[index]);
      expect(nextTrackIndex(0, playable, 'shuffle', () => value)).toBe(3);
    }
  });

  it('should keep the current track when no other track is playable', () => {
    expect(nextTrackIndex(1, [false, true, false], 'sequential', Math.random)).toBe(1);
    expect(nextTrackIndex(1, [false, true, false], 'shuffle', () => 0.5)).toBe(1);
  });
});
