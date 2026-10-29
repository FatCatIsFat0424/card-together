import type { SlashTiming, SoundPack, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, thump, tone } from '../voices';

/** A plucked oud string: a sawtooth through a gentle lowpass, bending up into pitch. */
const oud = (at: number, frequency: number, level: number, decay: number, sag = 1): Voice[] => [
  tone(at, frequency * 0.97, level * 0.7, decay, {
    wave: 'sawtooth', attack: 0.003, filter: { type: 'lowpass', frequency: 1800, q: 0.7 },
    glide: { ratio: sag / 0.97, time: sag === 1 ? 0.04 : decay * 0.9 },
  }),
  tone(at, frequency * 2, level * 0.2, decay * 0.5, { wave: 'triangle', attack: 0.003 }),
];

/** The sharp, high "tek" of a hand drum. */
const tek = (at: number, level: number): Voice[] => [
  tone(at, 700, level * 0.4, 0.05, { attack: 0.002, glide: { ratio: 0.6, time: 0.04 } }),
  noise(at, 0.035, 'bandpass', 3000, 1, level, { decay: 3 }),
];

/** The deep "doum" of a hand drum. */
const doum = (at: number, level: number): Voice[] => [
  tone(at, 220, level, 0.12, { attack: 0.003, glide: { ratio: 0.6, time: 0.09 } }),
  noise(at, 0.08, 'lowpass', 500, 0.7, level * 3, { decay: 3 }),
];

/** Oud strings in a hijaz mode with hand-drum hits, warm and dry like a desert evening. */
export const DUNE_SOUND_PACK: SoundPack = {
  id: 'sound-dune',
  turn: cue(oud(0, note('A4'), 0.22, 0.35), oud(0.13, note('D5'), 0.22, 0.42)),
  // D, E-flat and F-sharp: the augmented second marks the hijaz scale.
  join: cue(oud(0, note('D5'), 0.15, 0.2), oud(0.09, note('Eb5'), 0.15, 0.2), oud(0.18, note('F#5'), 0.15, 0.28)),
  card: cue(tek(0, 0.38)),
  pass: cue(doum(0, 0.16)),
  out: cue(
    oud(0, note('D5'), 0.2, 0.3, 0.95), oud(0.17, note('A4'), 0.2, 0.3, 0.95), oud(0.34, note('D4'), 0.2, 0.55, 0.95),
  ),
  start: cue(
    thump(0, 100, 0.32, 0.55),
    noise(0, 0.5, 'lowpass', 220, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 2800, 0.7, 0.3, { decay: 4 }),
  ),
  collapse: cue(
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.06, 'bandpass', 2400, 1, 0.6, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    // Sand pouring through the gap, then a few dull drum hits as it settles.
    noise(0.4, 1.3, 'bandpass', 1800, 0.6, 0.5, { attack: 0.2, decay: 1.5 }),
    [0.6, 0.85, 1.15].map((at) => doum(at, 0.15)),
  ),
  diceRoll: cue(
    [0, 0.06, 0.11, 0.18, 0.26, 0.36, 0.48].map((at, index) => tek(at, 0.24 - index * 0.015)),
    noise(0, 0.6, 'bandpass', 1800, 0.6, 0.25, { attack: 0.2, decay: 1.5 }),
  ),
  diceReveal: cue(doum(0, 0.3), tek(0, 0.3), oud(0.04, note('D4'), 0.16, 0.3)),
  place: cue(doum(0, 0.14), tek(0, 0.22)),
  capture: cue(tek(0, 0.3), doum(0.07, 0.2), tek(0.14, 0.26)),
  flip: cue(tek(0, 0.2), tek(0.05, 0.26), noise(0, 0.08, 'highpass', 4000, 0.7, 0.15, { rise: 1.5 })),
  check: cue(oud(0, note('D5'), 0.22, 0.18), oud(0.1, note('D5'), 0.22, 0.18), oud(0.2, note('Eb5'), 0.24, 0.4)),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    // Wind-blown sand over a driving drum pattern.
    noise(fireStart, fireEnd - fireStart, 'bandpass', 1600, 0.7, 0.55, { attack: 0.35, hold: 4 }, 3000),
    pattern(fireStart, fireEnd, 0.14, (at, index) => (index % 4 === 0 ? doum(at, 0.12) : tek(at, 0.25)), 12),
    noise(strike - 0.02, cut + 0.02, 'highpass', 4000, 0.7, 0.25, { rise: 2 }),
    thump(strike + cut, 85, 0.42, 0.55),
    noise(strike + cut, 0.5, 'lowpass', 280, 0.7, 1, { decay: 3 }),
  ),
};
