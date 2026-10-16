import type { BiquadSpec, Cue, NoiseEnvelope, NoiseVoice, ToneVoice, Voice } from '../../audio/sound-pack';

const SEMITONES: Readonly<Record<string, number>> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** Equal-tempered pitch from a name such as `A4`, `Eb5` or `F#5`. */
export function note(name: string): number {
  const match = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!match) throw new Error(`Invalid note name: ${name}`);
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 440 * 2 ** ((SEMITONES[match[1]] + accidental + (Number(match[3]) - 4) * 12) / 12);
}

type ToneOptions = Partial<Pick<ToneVoice, 'wave' | 'attack' | 'glide' | 'filter' | 'tail'>>;

export function tone(at: number, frequency: number, level: number, decay: number, options: ToneOptions = {}): ToneVoice {
  return { kind: 'tone', at, frequency, level, decay, wave: 'sine', attack: 0.006, ...options };
}

export function noise(
  at: number, length: number, type: BiquadSpec['type'], frequency: number, q: number, level: number,
  envelope: NoiseEnvelope, sweepTo?: number,
): NoiseVoice {
  const filter: BiquadSpec = { type, frequency, q };
  return sweepTo === undefined
    ? { kind: 'noise', at, length, filter, level, envelope }
    : { kind: 'noise', at, length, filter, level, envelope, sweepTo };
}

/** Frequency ratio, relative weight and relative decay of one partial. */
export type PartialSpec = readonly [ratio: number, weight: number, decayScale: number];

/** Additive partials sharing one nominal peak: the weights split `level`, so stacking never adds loudness. */
export function stack(
  at: number, frequency: number, level: number, decay: number, partials: readonly PartialSpec[], options: ToneOptions = {},
): ToneVoice[] {
  const total = partials.reduce((sum, [, weight]) => sum + weight, 0);
  return partials.map(([ratio, weight, scale]) =>
    tone(at, frequency * ratio, level * weight / total, decay * scale, options));
}

/** Two oscillators a few cents apart; the slow beating reads as a shimmer. */
export function pair(
  at: number, frequency: number, level: number, decay: number, cents: number, options: ToneOptions = {},
): ToneVoice[] {
  return [tone(at, frequency, level / 2, decay, options),
    tone(at, frequency * 2 ** (cents / 1200), level / 2, decay, options)];
}

/** A low drum hit: a sine that falls to half its pitch, with an octave overtone so small speakers carry it. */
export function thump(at: number, frequency: number, level: number, decay: number): ToneVoice[] {
  return [
    tone(at, frequency, level * 0.7, decay, { attack: 0.004, glide: { ratio: 0.5, time: decay * 0.8 } }),
    tone(at, frequency * 2, level * 0.3, decay * 0.5, { attack: 0.003, glide: { ratio: 0.5, time: decay * 0.4 } }),
  ];
}

/**
 * Deterministic, irregular offsets in `[from, to)`; packs need repeatable textures without a random source so a
 * cue sounds the same every time it plays.
 */
export function scatter(from: number, to: number, count: number): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = ((i * 7919 + 13) % 17) / 17;
    offsets.push(from + (to - from) * (i + jitter * 0.8) / count);
  }
  return offsets;
}

type VoiceTree = Voice | readonly VoiceTree[];

/** Joins voices and nested voice lists into one cue. */
export function cue(...parts: readonly VoiceTree[]): Cue {
  const voices: Voice[] = [];
  const add = (part: VoiceTree): void => {
    if ('kind' in part) voices.push(part);
    else for (const child of part) add(child);
  };
  parts.forEach(add);
  return voices;
}

/** Repeats a note pattern every `step` seconds from `from` until `to`, capped so a long cue stays light. */
export function pattern(
  from: number, to: number, step: number, make: (at: number, index: number) => VoiceTree,
  maxCount = 14,
): Voice[] {
  const voices: Voice[] = [];
  for (let index = 0, at = from; at < to - step * 0.5 && index < maxCount; index++, at += step) {
    voices.push(...cue(make(at, index)));
  }
  return voices;
}
