import { noiseEnvelope } from '../../../client/src/audio/sound-pack';
import type { BiquadSpec, Cue, NoiseVoice, ToneVoice } from '../../../client/src/audio/sound-pack';

/** Offline stand-in for an `OfflineAudioContext`: renders a cue's voices to mono samples before any bus gain. */
export const RENDER_RATE = 48000;
const BLOCK = 64;

/** Small deterministic generator so noise bursts and crackle measure the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Coefficients { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Biquad coefficients per the Web Audio specification; lowpass and highpass take `q` in dB. */
function biquad(spec: BiquadSpec, frequency: number): Coefficients {
  const omega = 2 * Math.PI * Math.min(frequency, RENDER_RATE * 0.49) / RENDER_RATE;
  const cos = Math.cos(omega);
  const sin = Math.sin(omega);
  let b0: number; let b1: number; let b2: number; let a0: number; let a1: number; let a2: number;
  if (spec.type === 'bandpass') {
    const alpha = sin / (2 * spec.q);
    b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    const alpha = sin / (2 * 10 ** (spec.q / 20));
    if (spec.type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    }
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Filters `input` in place; `frequencyAt` supplies the cutoff per sample index so sweeps are followed. */
function filterInPlace(input: Float32Array, spec: BiquadSpec, frequencyAt: (index: number) => number): void {
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  let c = biquad(spec, frequencyAt(0));
  for (let i = 0; i < input.length; i++) {
    if (i % BLOCK === 0) c = biquad(spec, frequencyAt(i));
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    input[i] = y;
  }
}

function waveAt(wave: ToneVoice['wave'], phase: number): number {
  const turn = phase - Math.floor(phase);
  if (wave === 'sine') return Math.sin(2 * Math.PI * turn);
  if (wave === 'square') return turn < 0.5 ? 1 : -1;
  if (wave === 'sawtooth') return 2 * turn - 1;
  return 1 - 4 * Math.abs(turn - 0.5);
}

function renderTone(voice: ToneVoice, out: Float32Array): void {
  const start = Math.round(voice.at * RENDER_RATE);
  const length = Math.round((voice.decay + (voice.tail ?? 0)) * RENDER_RATE);
  const floor = voice.floor ?? 0.0001;
  const samples = new Float32Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RENDER_RATE;
    let frequency = voice.frequency;
    if (voice.glide) frequency *= voice.glide.ratio ** Math.min(1, t / voice.glide.time);
    phase += frequency / RENDER_RATE;
    let gain = 0;
    if (t < voice.decay) {
      if (t < voice.attack) {
        gain = voice.attackCurve === 'linear' ? voice.level * (t / voice.attack)
          : floor * (voice.level / floor) ** (t / voice.attack);
      } else {
        gain = voice.level * (floor / voice.level) ** ((t - voice.attack) / (voice.decay - voice.attack));
      }
    }
    samples[i] = waveAt(voice.wave, phase) * gain;
  }
  if (voice.filter) {
    const { frequency } = voice.filter;
    // The filter sits before the gain in the graph, but the linear chain commutes, so filtering the product is exact.
    filterInPlace(samples, voice.filter, () => frequency);
  }
  for (let i = 0; i < length && start + i < out.length; i++) out[start + i] += samples[i];
}

function renderNoise(voice: NoiseVoice, out: Float32Array, random: () => number): void {
  const start = Math.round(voice.at * RENDER_RATE);
  const length = Math.ceil(RENDER_RATE * voice.length);
  const samples = new Float32Array(length);
  const envelope = noiseEnvelope(voice.envelope);
  const original = Math.random;
  Math.random = random;
  try {
    for (let i = 0; i < length; i++) samples[i] = (random() * 2 - 1) * envelope(i / length);
  } finally {
    Math.random = original;
  }
  const { frequency } = voice.filter;
  const sweepTo = voice.sweepTo;
  filterInPlace(samples, voice.filter, (index) => (sweepTo === undefined ? frequency
    : frequency * (sweepTo / frequency) ** (index / length)));
  for (let i = 0; i < length && start + i < out.length; i++) out[start + i] += samples[i] * voice.level;
}

/** Renders a cue at unity bus gain, with room after the last voice. */
export function renderCueSamples(cue: Cue, seed = 1): Float32Array {
  const random = seededRandom(seed);
  let end = 0;
  for (const voice of cue) {
    end = Math.max(end, voice.at + (voice.kind === 'tone' ? voice.decay + (voice.tail ?? 0) : voice.length));
  }
  const out = new Float32Array(Math.ceil((end + 0.05) * RENDER_RATE));
  for (const voice of cue) {
    if (voice.kind === 'tone') renderTone(voice, out);
    else renderNoise(voice, out, random);
  }
  return out;
}

export interface CueLoudness {
  /** Largest absolute sample. */
  readonly peak: number;
  /** Loudest 100 ms window RMS after a 150 Hz high-pass, in dBFS; small phone speakers do not reproduce rumble. */
  readonly shortTermDb: number;
}

export function toDb(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-9));
}

export function measureSamples(samples: Float32Array): CueLoudness {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const weighted = Float32Array.from(samples);
  const highpass: BiquadSpec = { type: 'highpass', frequency: 150, q: -3.01 };
  filterInPlace(weighted, highpass, () => 150);
  filterInPlace(weighted, highpass, () => 150);
  const window = Math.round(RENDER_RATE * 0.1);
  const hop = Math.round(RENDER_RATE * 0.025);
  let worst = 0;
  for (let from = 0; from < Math.max(1, weighted.length - window / 2); from += hop) {
    let sum = 0;
    for (let i = from; i < from + window; i++) sum += (weighted[i] ?? 0) ** 2;
    worst = Math.max(worst, sum / window);
  }
  return { peak, shortTermDb: toDb(Math.sqrt(worst)) };
}

export function measureCue(cue: Cue): CueLoudness {
  return measureSamples(renderCueSamples(cue));
}
