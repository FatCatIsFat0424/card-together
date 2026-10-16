import type { SlashTiming, SoundPack, ToneVoice, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, thump, tone } from '../voices';

/** A rising bloop: a bubble's pitch climbs as the drop settles. */
const drop = (at: number, frequency: number, level: number, decay: number): Voice[] => [
  tone(at, frequency * 0.65, level, decay, { attack: 0.004, glide: { ratio: 1 / 0.65, time: 0.06 } }),
  tone(at, frequency * 1.3, level * 0.12, decay * 0.4, { attack: 0.004 }),
];

/** The same bubble sinking instead. */
const sink = (at: number, frequency: number, level: number, decay: number): ToneVoice =>
  tone(at, frequency, level, decay, { attack: 0.008, glide: { ratio: 0.55, time: decay * 0.8 } });

/** Water drops and soft filtered-noise swells, like a quiet tide pool. */
export const TIDE_SOUND_PACK: SoundPack = {
  id: 'sound-tide',
  turn: cue(
    drop(0, note('D5'), 0.2, 0.26), drop(0.14, note('A5'), 0.2, 0.3),
    // A faint ripple trailing the second drop.
    drop(0.32, note('A5'), 0.05, 0.25),
  ),
  join: cue(drop(0, note('E5'), 0.15, 0.16), drop(0.085, note('A5'), 0.15, 0.16), drop(0.17, note('D6'), 0.15, 0.2)),
  card: cue(
    noise(0, 0.1, 'lowpass', 2200, 0.7, 0.8, { attack: 0.15, decay: 2 }, 900),
    tone(0, 1000, 0.08, 0.07, { attack: 0.003, glide: { ratio: 1.5, time: 0.03 } }),
  ),
  pass: cue(
    noise(0, 0.13, 'lowpass', 700, 0.7, 1, { attack: 0.3, decay: 2 }),
    tone(0, 420, 0.12, 0.12, { attack: 0.01, glide: { ratio: 0.7, time: 0.1 } }),
  ),
  out: cue(sink(0, 700, 0.22, 0.25), sink(0.17, 520, 0.22, 0.25), sink(0.34, 380, 0.22, 0.5)),
  start: cue(
    noise(0, 0.8, 'lowpass', 260, 0.7, 1.2, { attack: 0.12, decay: 2 }, 100),
    thump(0, 100, 0.3, 0.5),
    noise(0, 0.12, 'bandpass', 2000, 0.7, 0.3, { decay: 3 }),
  ),
  collapse: cue(
    [0, 0.1, 0.2, 0.32, 0.46].map((at) => noise(at, 0.09, 'lowpass', 2400, 0.7, 0.5, { decay: 3 })),
    noise(0.3, 1.6, 'lowpass', 2400, 0.7, 0.8, { attack: 0.08, decay: 1.5 }, 150),
    thump(0.35, 70, 0.3, 1.0),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 500, 0.7, 0.7, { attack: 0.5, hold: 6 }, 1800),
    pattern(fireStart + 0.1, fireEnd, 0.2, (at, index) =>
      drop(at, [note('D5'), note('A4'), note('E5')][index % 3], 0.05, 0.14), 8),
    noise(strike - 0.02, cut + 0.02, 'highpass', 2500, 0.7, 0.35, { rise: 2 }, 7000),
    noise(strike + cut, 0.6, 'lowpass', 900, 0.7, 0.8, { decay: 3 }, 200),
    thump(strike + cut, 90, 0.3, 0.5),
    noise(strike + cut, 0.2, 'bandpass', 2500, 0.7, 0.3, { decay: 3 }),
  ),
};
