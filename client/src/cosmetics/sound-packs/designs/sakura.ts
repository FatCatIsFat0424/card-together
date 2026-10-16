import type { SlashTiming, SoundPack, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, scatter, thump, tone } from '../voices';

/** A koto-like pluck: the string starts slightly sharp and settles, with quick overtones. */
const pluck = (at: number, frequency: number, level: number, decay: number): Voice[] => [
  tone(at, frequency * 1.015, level * 0.7, decay,
    { wave: 'triangle', attack: 0.003, glide: { ratio: 1 / 1.015, time: 0.03 } }),
  tone(at, frequency * 2, level * 0.2, decay * 0.4, { attack: 0.002 }),
  tone(at, frequency * 3, level * 0.1, decay * 0.2, { attack: 0.002 }),
];

const PENTATONIC = ['D5', 'E5', 'G5', 'A5', 'B5', 'D6'].map(note);

/** Plucked koto strings on a pentatonic scale, with soft drum thumps and paper-light rustles. */
export const SAKURA_SOUND_PACK: SoundPack = {
  id: 'sound-sakura',
  turn: cue(pluck(0, note('D5'), 0.22, 0.3), pluck(0.13, note('A5'), 0.22, 0.36)),
  join: cue(
    pluck(0, note('G5'), 0.16, 0.2), pluck(0.08, note('A5'), 0.16, 0.2), pluck(0.16, note('D6'), 0.16, 0.26),
  ),
  card: cue(
    noise(0, 0.05, 'bandpass', 3200, 1.2, 0.35, { decay: 3 }),
    tone(0, note('G6'), 0.06, 0.09, { wave: 'triangle', attack: 0.003 }),
  ),
  pass: cue(
    noise(0, 0.09, 'bandpass', 900, 1, 0.35, { decay: 3 }),
    tone(0, note('G4'), 0.08, 0.12, { wave: 'triangle', attack: 0.004 }),
  ),
  out: cue(pluck(0, note('A5'), 0.22, 0.3), pluck(0.15, note('E5'), 0.22, 0.3), pluck(0.3, note('A4'), 0.22, 0.5)),
  start: cue(
    thump(0, 120, 0.34, 0.5),
    noise(0, 0.45, 'lowpass', 250, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1800, 0.7, 0.3, { decay: 4 }),
    // A short rising run like petals lifting after the drum.
    PENTATONIC.map((frequency, index) => pluck(0.06 + index * 0.055, frequency, 0.04, 0.25)),
  ),
  collapse: cue(
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.06, 'bandpass', 2200, 1, 0.6, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 150, 0.7, 1, { attack: 0.1, decay: 2 }),
    // A glissando tumbling down the scale as the table gives way.
    [...PENTATONIC].reverse().map((frequency, index) => pluck(0.4 + index * 0.1, frequency / 2, 0.05, 0.3)),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 800, 0.7, 0.8, { attack: 0.2, hold: 5 }),
    // A shamisen-style tremolo over the flames.
    pattern(fireStart, fireEnd, 0.11, (at, index) =>
      tone(at, PENTATONIC[(index * 2) % PENTATONIC.length], 0.05, 0.12, { wave: 'triangle', attack: 0.003 }), 14),
    scatter(fireStart, fireEnd, 3).map((at) => noise(at, 0.04, 'bandpass', 3000, 1, 0.3, { decay: 3 })),
    noise(strike - 0.02, cut + 0.02, 'bandpass', 4000, 0.8, 0.4, { rise: 2 }, 8000),
    thump(strike + cut, 110, 0.4, 0.5),
    noise(strike + cut, 0.5, 'lowpass', 300, 0.7, 1, { decay: 3 }),
  ),
};
