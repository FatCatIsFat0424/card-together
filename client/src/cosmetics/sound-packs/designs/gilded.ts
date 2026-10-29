import type { SlashTiming, SoundPack, ToneVoice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, scatter, stack, thump, tone } from '../voices';

/** A struck metal bell: inharmonic partials that die away at different speeds. */
const bell = (at: number, frequency: number, level: number, decay: number): ToneVoice[] => stack(at, frequency, level, decay,
  [[1, 1, 1], [2, 0.55, 0.7], [2.76, 0.4, 0.5], [4.07, 0.25, 0.3], [5.4, 0.15, 0.2]], { attack: 0.002 });

/** A small bell with only two partials, for accents that must stay light. */
const ding = (at: number, frequency: number, level: number, decay: number): ToneVoice[] =>
  stack(at, frequency, level, decay, [[1, 1, 1], [2.76, 0.4, 0.5]], { attack: 0.002 });

const COINS = ['E7', 'C7', 'G6', 'D7', 'A6'].map(note);

/** Struck bells, coin tinks and a deep gong, like a velvet salon with brass fittings. */
export const GILDED_SOUND_PACK: SoundPack = {
  id: 'sound-gilded',
  turn: cue(bell(0, note('G5'), 0.25, 0.5), bell(0.14, note('C6'), 0.25, 0.55)),
  join: cue(bell(0, note('G5'), 0.17, 0.28), bell(0.1, note('B5'), 0.17, 0.28), bell(0.2, note('D6'), 0.17, 0.38)),
  card: cue(
    tone(0, 3136, 0.05, 0.05, { attack: 0.002 }),
    tone(0, 4222, 0.03, 0.04, { attack: 0.002 }),
    noise(0, 0.03, 'highpass', 6000, 0.7, 0.15, { decay: 3 }),
  ),
  pass: cue(
    bell(0, note('C5'), 0.08, 0.1),
    noise(0, 0.06, 'bandpass', 1200, 1, 0.2, { decay: 3 }),
  ),
  out: cue(bell(0, note('A5'), 0.22, 0.45), bell(0.18, note('E5'), 0.22, 0.45), bell(0.36, note('A4'), 0.22, 0.8)),
  start: cue(
    stack(0, 130, 0.3, 0.8, [[1, 1, 1], [2, 0.6, 0.7], [2.76, 0.4, 0.5], [4.1, 0.2, 0.3]], { attack: 0.004 }),
    noise(0, 0.5, 'lowpass', 200, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1800, 0.7, 0.3, { decay: 4 }),
  ),
  collapse: cue(
    // Clanging metal in place of the splintering wood.
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.06, 'bandpass', 3000, 1, 0.6, { decay: 4 })),
    [0.02, 0.19, 0.4].map((at, index) => ding(at, [note('F#5'), note('D5'), note('B4')][index], 0.07, 0.3)),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    // Coins scattering across the floor.
    scatter(0.5, 1.4, 5).map((at, index) => ding(at, COINS[index], 0.04, 0.12)),
  ),
  diceRoll: cue(
    scatter(0, 0.6, 9).map((at, index) => ding(at, COINS[index % COINS.length], 0.06, 0.1)),
    noise(0, 0.6, 'highpass', 5500, 0.7, 0.14, { attack: 0.2, hold: 3 }),
    noise(0, 0.6, 'bandpass', 2200, 0.8, 0.2, { attack: 0.2, decay: 1.5 }),
  ),
  diceReveal: cue(
    bell(0, note('C5'), 0.2, 0.5),
    thump(0, 120, 0.22, 0.3),
    noise(0, 0.3, 'lowpass', 220, 0.7, 0.7, { decay: 3 }),
  ),
  place: cue(
    ding(0, note('G6'), 0.1, 0.1),
    noise(0, 0.05, 'bandpass', 2100, 1, 0.35, { decay: 4 }),
    thump(0, 210, 0.1, 0.08),
  ),
  capture: cue(
    ding(0, note('G6'), 0.1, 0.1),
    noise(0, 0.05, 'bandpass', 2100, 1, 0.35, { decay: 4 }),
    scatter(0.07, 0.25, 3).map((at, index) => ding(at, COINS[index], 0.07, 0.12)),
  ),
  flip: cue(
    ding(0, note('E7'), 0.09, 0.07), ding(0.05, note('C7'), 0.1, 0.09),
    noise(0, 0.04, 'highpass', 6000, 0.7, 0.12, { decay: 3 }),
  ),
  check: cue(bell(0, note('C6'), 0.22, 0.2), bell(0.11, note('C6'), 0.22, 0.2), bell(0.22, note('G6'), 0.25, 0.5)),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 700, 0.7, 0.7, { attack: 0.25, hold: 4 }),
    pattern(fireStart + 0.1, fireEnd, 0.3, (at, index) => ding(at, COINS[index % COINS.length], 0.035, 0.3), 6),
    // A cymbal-like swell into the strike.
    noise(strike - 0.02, cut + 0.02, 'highpass', 5000, 0.7, 0.3, { rise: 2.5 }, 9000),
    stack(strike + cut, 110, 0.3, 0.9, [[1, 1, 1], [2, 0.6, 0.7], [2.76, 0.4, 0.5], [4.1, 0.2, 0.3]], { attack: 0.004 }),
    thump(strike + cut, 100, 0.2, 0.4),
    noise(strike + cut, 0.5, 'highpass', 4000, 0.7, 0.15, { decay: 3 }),
  ),
};
