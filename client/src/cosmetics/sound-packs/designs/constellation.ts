import type { SlashTiming, SoundPack, ToneVoice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, stack, thump, tone } from '../voices';

/** A celesta-like twinkle: pure fundamental with a fourth-partial shine. */
const twinkle = (at: number, frequency: number, level: number, decay: number): ToneVoice[] => stack(at, frequency, level, decay,
  [[1, 1, 1], [4, 0.2, 0.25]], { attack: 0.003 });

/** A twinkle followed by a faint echo, so the star seems to blink. */
const star = (at: number, frequency: number, level: number, decay: number): ToneVoice[] =>
  [twinkle(at, frequency, level, decay), twinkle(at + 0.1, frequency, level * 0.3, decay * 0.7)].flat();

const SKY = ['C6', 'D6', 'E6', 'G6', 'A6'].map(note);

/** Celesta twinkles with echoes, shooting-star glides and deep cosmic thumps. */
export const CONSTELLATION_SOUND_PACK: SoundPack = {
  id: 'sound-constellation',
  turn: cue(star(0, note('C6'), 0.17, 0.4), star(0.15, note('G6'), 0.17, 0.45)),
  join: cue(
    twinkle(0, note('E6'), 0.14, 0.2), twinkle(0.06, note('G6'), 0.14, 0.2), twinkle(0.12, note('C7'), 0.14, 0.3),
    twinkle(0.2, note('C7'), 0.04, 0.2),
  ),
  card: cue(
    tone(0, 3520, 0.05, 0.04, { attack: 0.002 }),
    noise(0, 0.03, 'highpass', 7000, 0.7, 0.2, { decay: 3 }),
  ),
  pass: cue(
    tone(0, 1760, 0.05, 0.06, { attack: 0.003 }),
    noise(0, 0.06, 'bandpass', 1800, 1, 0.2, { decay: 3 }),
  ),
  // A shooting star sliding down, then a few embers of light behind it.
  out: cue(
    tone(0, 2600, 0.16, 0.55, { attack: 0.01, glide: { ratio: 0.12, time: 0.5 } }),
    twinkle(0.1, note('E6'), 0.07, 0.2), twinkle(0.2, note('C6'), 0.07, 0.25), twinkle(0.3, note('G5'), 0.07, 0.35),
  ),
  start: cue(
    thump(0, 110, 0.34, 0.6),
    noise(0, 0.5, 'lowpass', 200, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1800, 0.7, 0.3, { decay: 4 }),
    star(0.05, note('C6'), 0.04, 0.5), star(0.05, note('G6'), 0.04, 0.5),
  ),
  collapse: cue(
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.06, 'bandpass', 2800, 1, 0.6, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    // Stars tumbling out of the sky.
    [...SKY].reverse().flatMap((frequency, index) => twinkle(0.3 + index * 0.16, frequency, 0.05, 0.3)),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 600, 0.7, 0.8, { attack: 0.3, hold: 4 }),
    pattern(fireStart + 0.05, fireEnd, 0.13, (at, index) =>
      twinkle(at, SKY[(index * 3) % SKY.length], 0.05, 0.25), 12),
    tone(strike - 0.02, 600, 0.1, cut + 0.06, { attack: 0.01, glide: { ratio: 8, time: cut + 0.02 } }),
    noise(strike - 0.02, cut + 0.02, 'bandpass', 5000, 1, 0.4, { rise: 2 }),
    thump(strike + cut, 100, 0.38, 0.5),
    noise(strike + cut, 0.5, 'lowpass', 300, 0.7, 1, { decay: 3 }),
    stack(strike + cut, 196, 0.15, 0.8, [[1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.15, 0.3]], { attack: 0.004 }),
  ),
};
