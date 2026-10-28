import { describe, expect, it } from 'vitest';
import { coverGradient, hashText } from '../../../client/src/audio/music-cover';
import { createToneWav } from '../../../client/src/voice/test-tone';
import {
  createSpeakingTracker, levelFromSamples, SPEAKING_HOLD_MS, SPEAKING_LEVEL,
} from '../../../client/src/voice/voice-levels';

describe('voice level', () => {
  it('reads silence as zero and a full-scale wave as the maximum', () => {
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
    expect(levelFromSamples([])).toBe(0);
    expect(levelFromSamples(Uint8Array.from({ length: 64 }, (_, index) => index % 2 ? 255 : 0))).toBe(1);
  });

  it('grows with loudness', () => {
    const wave = (amplitude: number): number[] => Array.from({ length: 128 }, (_, index) =>
      128 + Math.round(Math.sin(index / 4) * amplitude));
    expect(levelFromSamples(wave(10))).toBeLessThan(levelFromSamples(wave(40)));
  });
});

describe('speaking tracker', () => {
  it('switches on at once, holds through short pauses, and drops after the hold', () => {
    let time = 0;
    const track = createSpeakingTracker(() => time);
    expect(track(0.05)).toBe(false);
    expect(track(SPEAKING_LEVEL)).toBe(true);
    time += SPEAKING_HOLD_MS - 1;
    expect(track(0.01)).toBe(true);
    time += 2;
    expect(track(0.01)).toBe(false);
  });

  it('drops immediately on exact silence, such as a muted or stopped stream', () => {
    let time = 0;
    const track = createSpeakingTracker(() => time);
    expect(track(0.5)).toBe(true);
    time += 10;
    expect(track(0)).toBe(false);
    expect(track(0.01)).toBe(false);
  });
});

describe('speaker test tone', () => {
  it('is a well-formed mono 16-bit WAV', () => {
    const wav = createToneWav();
    const view = new DataView(wav.buffer);
    const text = (offset: number): string => String.fromCharCode(...wav.slice(offset, offset + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(40, true)).toBe(wav.length - 44);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    // Audible but well below full scale.
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(view.getInt16(offset, true)));
    expect(peak).toBeGreaterThan(5000);
    expect(peak).toBeLessThan(20000);
  });
});

describe('album cover colours', () => {
  it('are stable per name and differ between names', () => {
    expect(coverGradient('Sharou')).toBe(coverGradient('Sharou'));
    expect(coverGradient('Sharou')).not.toBe(coverGradient('Sweet Dove'));
    expect(hashText('a')).not.toBe(hashText('b'));
    expect(coverGradient('x')).toMatch(/^linear-gradient\(135deg, hsl\(\d+ /);
  });
});
