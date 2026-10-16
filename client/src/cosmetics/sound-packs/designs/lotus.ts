import type { SlashTiming, SoundPack, ToneVoice } from '../../../audio/sound-pack';
import { cue, noise, note, stack, thump, tone } from '../voices';

/** A singing bowl: the fundamental beats against a slightly sharp twin, over its characteristic 2.7x overtone. */
const bowl = (at: number, frequency: number, level: number, decay: number): ToneVoice[] => stack(at, frequency, level, decay,
  [[1, 0.55, 1], [2 ** (6 / 1200), 0.55, 1], [2.71, 0.22, 0.45], [5.15, 0.08, 0.2]], { attack: 0.015 });

/** A bowl struck lightly: no beating twin, for short accents. */
const chime = (at: number, frequency: number, level: number, decay: number): ToneVoice[] =>
  stack(at, frequency, level, decay, [[1, 1, 1], [2.71, 0.2, 0.4]], { attack: 0.01 });

/** Singing bowls and soft cushion thuds, calm and rounded. */
export const LOTUS_SOUND_PACK: SoundPack = {
  id: 'sound-lotus',
  turn: cue(bowl(0, note('A4'), 0.22, 0.45), bowl(0.14, note('E5'), 0.22, 0.55)),
  join: cue(chime(0, note('D5'), 0.13, 0.32), chime(0.1, note('F#5'), 0.13, 0.32), chime(0.2, note('A5'), 0.13, 0.42)),
  card: cue(
    noise(0, 0.07, 'lowpass', 900, 0.7, 1, { attack: 0.1, decay: 3 }),
    tone(0, 260, 0.12, 0.07, { attack: 0.004, glide: { ratio: 0.7, time: 0.05 } }),
  ),
  pass: cue(
    noise(0, 0.1, 'lowpass', 500, 0.7, 1, { attack: 0.1, decay: 3 }),
    tone(0, 196, 0.1, 0.09, { attack: 0.005, glide: { ratio: 0.75, time: 0.07 } }),
  ),
  out: cue(bowl(0, note('A4'), 0.2, 0.4), bowl(0.17, note('E4'), 0.2, 0.4), bowl(0.34, note('A3'), 0.2, 0.7)),
  start: cue(
    bowl(0, 147, 0.3, 0.9),
    thump(0, 90, 0.2, 0.4),
    noise(0, 0.5, 'lowpass', 200, 0.7, 1, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1500, 0.7, 0.2, { decay: 4 }),
  ),
  collapse: cue(
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.06, 'bandpass', 2000, 1, 0.5, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    // Bowls sinking in a slow, low cluster.
    bowl(0.3, note('A3'), 0.12, 1.0), bowl(0.45, note('E3'), 0.12, 1.2),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => {
    const burn = fireEnd - fireStart;
    return cue(
      noise(fireStart, burn, 'lowpass', 450, 0.7, 0.7, { attack: 0.5, hold: 4 }),
      // A drone that swells with the flames.
      tone(fireStart, 110, 0.12, burn, { attack: burn * 0.5 }),
      tone(fireStart, 165, 0.08, burn, { attack: burn * 0.5, glide: { ratio: 1.2, time: burn } }),
      noise(strike - 0.02, cut + 0.02, 'bandpass', 2500, 0.8, 0.5, { rise: 2 }, 5000),
      bowl(strike + cut, 98, 0.28, 0.9),
      thump(strike + cut, 90, 0.2, 0.4),
      noise(strike + cut, 0.5, 'lowpass', 280, 0.7, 1, { decay: 3 }),
    );
  },
};
