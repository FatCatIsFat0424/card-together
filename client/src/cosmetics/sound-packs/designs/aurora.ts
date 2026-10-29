import type { SlashTiming, SoundPack, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, pair, scatter, thump, tone } from '../voices';

/** Detuned triangle pair with a soft octave: a slow-beating, airy pad. */
const pad = (at: number, frequency: number, level: number, decay: number): Voice[] => [
  ...pair(at, frequency, level * 0.8, decay, 7, { wave: 'triangle', attack: 0.03 }),
  tone(at, frequency * 2, level * 0.2, decay * 0.6, { attack: 0.03 }),
];

/** A quick glass sparkle with a bright third harmonic. */
const spark = (at: number, frequency: number, level: number, decay: number): Voice[] => [
  tone(at, frequency, level * 0.8, decay, { attack: 0.012 }),
  tone(at, frequency * 3, level * 0.2, decay * 0.4, { attack: 0.012 }),
];

/** Shimmering pads and glassy sparkles, like light moving across a night sky. */
export const AURORA_SOUND_PACK: SoundPack = {
  id: 'sound-aurora',
  turn: cue(pad(0, note('E5'), 0.2, 0.42), pad(0.13, note('B5'), 0.2, 0.5)),
  join: cue(
    spark(0, note('A5'), 0.15, 0.28), spark(0.09, note('C#6'), 0.15, 0.28), spark(0.18, note('E6'), 0.15, 0.36),
  ),
  card: cue(
    noise(0, 0.06, 'highpass', 5200, 0.7, 0.14, { decay: 3 }),
    tone(0, note('D7'), 0.05, 0.07, { attack: 0.003 }),
  ),
  pass: cue(
    noise(0, 0.1, 'bandpass', 1400, 1, 0.3, { decay: 3 }),
    tone(0, note('A5'), 0.04, 0.1, { wave: 'triangle', attack: 0.008 }),
  ),
  out: cue(
    pad(0, note('G5'), 0.19, 0.3).map((voice) => ({ ...voice, glide: { ratio: 0.97, time: 0.25 } })),
    pad(0.16, note('D5'), 0.19, 0.3).map((voice) => ({ ...voice, glide: { ratio: 0.97, time: 0.25 } })),
    pad(0.32, note('A4'), 0.19, 0.55).map((voice) => ({ ...voice, glide: { ratio: 0.97, time: 0.45 } })),
  ),
  start: cue(
    thump(0, 140, 0.32, 0.55),
    noise(0, 0.5, 'lowpass', 220, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1800, 0.7, 0.3, { decay: 4 }),
    tone(0.02, note('E6'), 0.06, 0.9, { attack: 0.05 }),
    tone(0.02, note('B6'), 0.04, 0.9, { attack: 0.07 }),
  ),
  collapse: cue(
    [0, 0.07, 0.15, 0.26, 0.4].map((at) => noise(at, 0.06, 'bandpass', 3400, 1, 0.55, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 150, 0.7, 1, { attack: 0.1, decay: 2 }),
    tone(0.3, 330, 0.1, 1.5, { wave: 'triangle', attack: 0.1, glide: { ratio: 0.25, time: 1.4 } }),
  ),
  diceRoll: cue(
    scatter(0, 0.6, 9).map((at, index) => [
      noise(at, 0.03, 'highpass', 5600, 0.7, 0.16, { decay: 3 }),
      tone(at, [note('E7'), note('B6'), note('G#6')][index % 3], 0.05, 0.08, { attack: 0.004 }),
    ]),
    noise(0, 0.7, 'bandpass', 4200, 0.8, 0.3, { attack: 0.2, hold: 3 }),
  ),
  diceReveal: cue(
    noise(0, 0.12, 'bandpass', 1500, 0.8, 0.35, { rise: 2 }, 5000),
    thump(0.12, 130, 0.3, 0.35),
    noise(0.12, 0.3, 'lowpass', 240, 0.7, 0.8, { decay: 3 }),
    spark(0.12, note('B6'), 0.1, 0.5),
  ),
  place: cue(
    noise(0, 0.05, 'highpass', 4800, 0.7, 0.2, { decay: 3 }),
    tone(0, note('A6'), 0.1, 0.1, { attack: 0.004 }),
    thump(0, 220, 0.12, 0.08),
  ),
  capture: cue(
    noise(0, 0.05, 'highpass', 4800, 0.7, 0.2, { decay: 3 }),
    tone(0, note('A6'), 0.1, 0.1, { attack: 0.004 }),
    thump(0, 220, 0.12, 0.08),
    pad(0.07, note('E5'), 0.16, 0.3).map((voice) => ({ ...voice, glide: { ratio: 0.9, time: 0.25 } })),
  ),
  flip: cue(
    noise(0, 0.09, 'bandpass', 2500, 1, 0.3, { attack: 0.3, decay: 2 }, 7000),
    spark(0.06, note('E7'), 0.09, 0.14),
  ),
  check: cue(pad(0, note('B5'), 0.2, 0.25), pad(0.11, note('B5'), 0.2, 0.25), pad(0.22, note('F#6'), 0.2, 0.45)),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => {
    const burn = fireEnd - fireStart;
    return cue(
      noise(fireStart, burn, 'bandpass', 900, 0.8, 0.6, { attack: 0.3, hold: 4 }, 2600),
      tone(fireStart, 220, 0.08, burn, { wave: 'triangle', attack: burn * 0.4, glide: { ratio: 1.5, time: burn } }),
      noise(strike - 0.02, cut + 0.02, 'bandpass', 3000, 1.2, 0.55, { rise: 2 }, 9000),
      thump(strike + cut, 150, 0.34, 0.45),
      noise(strike + cut, 0.5, 'lowpass', 320, 0.7, 1, { decay: 3 }),
      tone(strike + cut, note('E6'), 0.05, 0.9, { attack: 0.03 }),
      tone(strike + cut, note('B6'), 0.04, 0.9, { attack: 0.03 }),
    );
  },
};
