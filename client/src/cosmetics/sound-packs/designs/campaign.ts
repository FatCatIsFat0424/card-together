import type { Cue, SoundPack, ToneVoice } from '../../../audio/sound-pack';
import { cue, noise, pair, pattern, stack, thump, tone } from '../voices';

type Signal = (at: number, frequency: number, level: number, decay: number) => readonly ToneVoice[];

// Each synthesis topology has a different envelope and spectrum; all are short UI signals.
const navigation: Signal = (at, frequency, level, decay) => pair(at, frequency, level, decay, 9,
  { attack: 0.008, glide: { ratio: 1.08, time: decay * 0.7 } });
const shrineBell: Signal = (at, frequency, level, decay) => stack(at, frequency, level, decay,
  [[1, 1, 1], [2.73, 0.22, 0.6], [4.1, 0.08, 0.3]], { attack: 0.003 });
const radio: Signal = (at, frequency, level, decay) => [tone(at, frequency, level, decay,
  { wave: 'triangle', attack: 0.004, filter: { type: 'lowpass', frequency: 1900, q: 0.7 } })];
const circuit: Signal = (at, frequency, level, decay) => [
  tone(at, frequency, level * 0.8, decay * 0.7, { wave: 'square', attack: 0.003,
    filter: { type: 'lowpass', frequency: 2600, q: 0.65 } }),
  tone(at + 0.018, frequency * 2, level * 0.2, decay, { attack: 0.003 }),
];
const herald: Signal = (at, frequency, level, decay) => stack(at, frequency, level, decay,
  [[1, 1, 1], [2, 0.3, 0.8], [3, 0.1, 0.4]], { wave: 'triangle', attack: 0.012 });

interface SignalProfile {
  readonly id: SoundPack['id'];
  readonly signal: Signal;
  readonly pitches: readonly [number, number, number];
  readonly gap: number;
  readonly decay: number;
  readonly noiseHz: number;
  readonly engineHz: number;
  readonly pulse: number;
}

function createSignals({ id, signal, pitches: [low, middle, high], gap, decay, noiseHz, engineHz, pulse }: SignalProfile): SoundPack {
  const click = (at: number, length: number, level: number): Cue => cue(
    noise(at, length, 'bandpass', noiseHz, 1.2, level, { decay: 4 }),
    signal(at, middle * 0.7, 0.055, length * 0.8),
  );
  return {
    id,
    turn: cue(signal(0, low, 0.18, decay), signal(gap, high, 0.18, decay)),
    join: cue(signal(0, low, 0.16, decay * 0.7), signal(gap * 0.4, middle, 0.16, decay * 0.7),
      signal(gap * 0.8, high, 0.16, decay)),
    card: click(0, 0.045, 0.32),
    pass: cue(noise(0, 0.07, 'lowpass', noiseHz * 0.45, 0.7, 0.5, { decay: 3 }, noiseHz * 0.2),
      signal(0, low * 0.65, 0.05, 0.07)),
    out: cue(signal(0, high * 0.7, 0.17, decay), signal(gap * 0.7, middle * 0.65, 0.17, decay),
      tone(gap * 1.4, low * 0.65, 0.18, 0.42, { attack: 0.01, glide: { ratio: 0.5, time: 0.35 } })),
    start: cue(thump(0, engineHz, 0.3, 0.32),
      noise(0, 0.3, 'lowpass', noiseHz * 0.4, 0.7, 0.6, { decay: 3 }, engineHz * 2),
      signal(0.08, low, 0.12, decay), signal(0.08 + pulse, high, 0.12, decay)),
    collapse: cue(
      pattern(0, 0.8, pulse, (at, index) => click(at, 0.04, 0.3 + (index % 2) * 0.05), 7),
      noise(0.35, 1.25, 'lowpass', noiseHz * 0.2, 0.7, 0.75, { attack: 0.1, decay: 3 }, engineHz),
      thump(0.45, engineHz * 0.85, 0.28, 0.6),
    ),
    slash: ({ fireStart, fireEnd, strike, cut }) => cue(
      noise(fireStart, fireEnd - fireStart, 'lowpass', noiseHz * 0.3, 0.7, 0.38, { attack: 0.2, hold: 3 }, noiseHz * 0.5),
      pattern(fireStart, fireEnd, pulse, (at, index) => signal(at, index % 2 ? low : middle, 0.07, 0.11), 10),
      tone(strike, engineHz * 3, 0.14, cut + 0.04, { attack: 0.006, glide: { ratio: 5, time: cut } }),
      noise(strike, cut, 'bandpass', noiseHz, 0.8, 0.4, { rise: 2 }),
      thump(strike + cut, engineHz, 0.3, 0.4),
      noise(strike + cut, 0.5, 'lowpass', noiseHz * 0.3, 0.7, 0.65, { decay: 4 }),
      signal(strike + cut + 0.08, low * 0.6, 0.1, 0.45),
    ),
  };
}

export const CAMPAIGN_SOUND_PACKS = {
  'sound-starfleet': createSignals({ id: 'sound-starfleet', signal: navigation,
    pitches: [740, 990, 1480], gap: 0.19, decay: 0.25, noiseHz: 3200, engineHz: 95, pulse: 0.14 }),
  'sound-shrine': createSignals({ id: 'sound-shrine', signal: shrineBell,
    pitches: [659, 880, 1175], gap: 0.22, decay: 0.39, noiseHz: 2100, engineHz: 130, pulse: 0.19 }),
  'sound-ironfront': createSignals({ id: 'sound-ironfront', signal: radio,
    pitches: [540, 720, 1080], gap: 0.16, decay: 0.18, noiseHz: 1600, engineHz: 72, pulse: 0.105 }),
  'sound-neoncity': createSignals({ id: 'sound-neoncity', signal: circuit,
    pitches: [830, 1245, 1660], gap: 0.14, decay: 0.15, noiseHz: 4300, engineHz: 115, pulse: 0.085 }),
  'sound-crownrealm': createSignals({ id: 'sound-crownrealm', signal: herald,
    pitches: [587, 784, 1046], gap: 0.2, decay: 0.3, noiseHz: 2500, engineHz: 147, pulse: 0.17 }),
} as const;
