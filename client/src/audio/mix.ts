/** One output channel's switch and volume; `volume` is 0-1. */
export interface ChannelLevel {
  readonly enabled: boolean;
  readonly volume: number;
}

export function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Restores a stored 0-1 volume; missing or unparsable values use the fallback and out-of-range ones are clamped. */
export function parseVolume(stored: string | null, fallback: number): number {
  if (stored === null || stored.trim() === '') return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? clampVolume(value) : fallback;
}

/** Linear gain for one channel on its own: its volume while switched on, silence while off. */
export function channelGain(level: ChannelLevel): number {
  return level.enabled ? clampVolume(level.volume) : 0;
}

/** Master and channel gains multiply, so either switch or slider can silence the channel. */
export function mixedGain(master: ChannelLevel, channel: ChannelLevel): number {
  return channelGain(master) * channelGain(channel);
}

/** Per-player voice volume under the overall voice output gain. */
export function peerOutputVolume(peerVolume: number, outputGain: number): number {
  return clampVolume(clampVolume(peerVolume) * clampVolume(outputGain));
}

/** 0-1 volume as the whole percent shown beside a slider. */
export function volumePercent(volume: number): number {
  return Math.round(clampVolume(volume) * 100);
}

/** Linear gain for a level in decibels. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Loudness added to every effect. Cues are calibrated to the targets in `sound-levels.ts`, which left them 6 to
 * 10 dB under the music at its default volume; this lifts them to sit with it.
 */
export const EFFECTS_BOOST_DB = 6;

/** Samples below this amplitude (-6 dBFS) pass the soft ceiling unchanged. */
export const CEILING_KNEE = 0.5;

/** Input amplitude the ceiling's curve covers; mixes louder than this (+12 dBFS) flatten at its end. */
export const CEILING_RANGE = 4;

/** Transfer of the soft ceiling: linear up to the knee, then a smooth approach to full scale that never exceeds it. */
export function softCeiling(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  if (magnitude <= CEILING_KNEE) return amplitude;
  const room = 1 - CEILING_KNEE;
  return Math.sign(amplitude) * (CEILING_KNEE + room * Math.tanh((magnitude - CEILING_KNEE) / room));
}

/** Curve table for a `WaveShaperNode` whose input is scaled by `1 / CEILING_RANGE`. */
export function ceilingCurve(points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) curve[i] = softCeiling(((2 * i) / (points - 1) - 1) * CEILING_RANGE);
  return curve;
}
