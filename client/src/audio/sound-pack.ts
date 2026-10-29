import type { SoundPackId } from '@shared/types';

/** Seconds from the cue start and frequency in Hz for each tone. */
export type ToneNotes = readonly (readonly [offset: number, frequency: number])[];

export interface BiquadSpec {
  readonly type: 'lowpass' | 'bandpass' | 'highpass';
  readonly frequency: number;
  readonly q: number;
}

/** An oscillator note: a fast attack followed by an exponential decay to `floor`. */
export interface ToneVoice {
  readonly kind: 'tone';
  /** Seconds from the start of the cue. */
  readonly at: number;
  readonly frequency: number;
  readonly wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  /** Peak gain reached after `attack`. */
  readonly level: number;
  readonly attack: number;
  /** Seconds from `at` until the gain reaches `floor`. */
  readonly decay: number;
  readonly attackCurve?: 'exponential' | 'linear';
  readonly floor?: number;
  /** Seconds the oscillator keeps running after the gain reached `floor`. */
  readonly tail?: number;
  /** Exponential pitch glide to `frequency * ratio` over `time` seconds. */
  readonly glide?: { readonly ratio: number; readonly time: number };
  readonly filter?: BiquadSpec;
}

/** Shape of a noise burst; `position` runs from 0 to 1 across the burst. */
export interface NoiseEnvelope {
  /** Fraction of the burst spent ramping linearly up to full level. */
  readonly attack?: number;
  /** Exponent on `position`; larger values delay the peak toward the end. */
  readonly rise?: number;
  /** Exponent on the remaining fraction; larger values fall away faster. */
  readonly decay?: number;
  /** Exponent `k` of `1 - position^k`: stays loud, then drops near the end. */
  readonly hold?: number;
  /** Rare per-sample spikes that give the burst a crackling texture. */
  readonly crackle?: { readonly chance: number; readonly boost: number };
}

/** Filtered white-noise burst whose envelope is baked into its buffer. */
export interface NoiseVoice {
  readonly kind: 'noise';
  readonly at: number;
  readonly length: number;
  readonly filter: BiquadSpec;
  /** Exponential sweep of the filter frequency across the burst. */
  readonly sweepTo?: number;
  readonly level: number;
  readonly envelope: NoiseEnvelope;
}

export type Voice = ToneVoice | NoiseVoice;
export type Cue = readonly Voice[];

/** Seconds from the start of the Dragon Slaying presentation. */
export interface SlashTiming {
  readonly fireStart: number;
  readonly fireEnd: number;
  readonly strike: number;
  readonly cut: number;
}

export const SOUND_CUES = [
  'turn', 'join', 'card', 'pass', 'out', 'start', 'collapse',
  'diceRoll', 'diceReveal', 'place', 'capture', 'flip', 'check',
] as const;
export type SoundCueName = typeof SOUND_CUES[number];

/** Every sound the application can play; `classic` is the unequipped default. */
export interface SoundPack extends Readonly<Record<SoundCueName, Cue>> {
  readonly id: SoundPackId | 'classic';
  readonly slash: (timing: SlashTiming) => Cue;
}

/** Plain sine notes with the turn reminder's envelope. */
export function notesToCue(notes: ToneNotes): Cue {
  return notes.map(([at, frequency]): ToneVoice => ({
    kind: 'tone', at, frequency, wave: 'sine', level: 0.18, attack: 0.015, decay: 0.17,
    attackCurve: 'linear', floor: 0.001, tail: 0.01,
  }));
}

/** Seconds until every voice of the cue has finished. */
export function cueDuration(cue: Cue): number {
  return cue.reduce((end, voice) => Math.max(end, voice.at + (voice.kind === 'tone'
    ? voice.decay + (voice.tail ?? 0) : voice.length)), 0);
}

export function noiseEnvelope(shape: NoiseEnvelope): (position: number) => number {
  const { attack = 0, rise = 0, decay = 0, hold = 0, crackle } = shape;
  return (position) => {
    let value = attack > 0 ? Math.min(1, position / attack) : 1;
    if (rise > 0) value *= position ** rise;
    if (decay > 0) value *= (1 - position) ** decay;
    if (hold > 0) value *= 1 - position ** hold;
    if (crackle && Math.random() < crackle.chance) value *= crackle.boost;
    return value;
  };
}
