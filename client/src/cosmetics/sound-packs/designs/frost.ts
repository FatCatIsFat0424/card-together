import type { SlashTiming, SoundPack, ToneVoice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, scatter, stack, thump, tone } from '../voices';

/** A struck wine glass: a pure ring with brittle upper partials. */
const glass = (at: number, frequency: number, level: number, decay: number, sag = 1): ToneVoice[] =>
  stack(at, frequency, level, decay, [[1, 1, 1], [2.32, 0.35, 0.5], [4.25, 0.18, 0.3]], {
    attack: 0.002, ...(sag === 1 ? {} : { glide: { ratio: sag, time: decay * 0.8 } }),
  });

const SHARDS = ['E6', 'A6', 'C#7', 'B6', 'F#6'].map(note);

/** Glass rings and brittle ice ticks, cold and clear. */
export const FROST_SOUND_PACK: SoundPack = {
  id: 'sound-frost',
  turn: cue(glass(0, note('A5'), 0.2, 0.45), glass(0.13, note('E6'), 0.2, 0.6)),
  join: cue(glass(0, note('E6'), 0.14, 0.2), glass(0.07, note('A6'), 0.14, 0.2), glass(0.14, note('C#7'), 0.14, 0.3)),
  card: cue(
    noise(0, 0.035, 'highpass', 6500, 0.7, 0.22, { decay: 3 }),
    tone(0, 4400, 0.04, 0.04, { attack: 0.002 }),
  ),
  pass: cue(
    noise(0, 0.08, 'bandpass', 3200, 1.5, 0.45, { attack: 0.3, decay: 2 }),
    tone(0, 1760, 0.04, 0.08, { attack: 0.003 }),
  ),
  out: cue(
    glass(0, note('A6'), 0.18, 0.25, 0.96), glass(0.13, note('E6'), 0.18, 0.25, 0.96),
    glass(0.26, note('A5'), 0.18, 0.5, 0.96),
    tone(0.1, 3520, 0.03, 0.12), tone(0.22, 2637, 0.03, 0.12), tone(0.34, 1760, 0.03, 0.2),
  ),
  start: cue(
    thump(0, 150, 0.26, 0.4),
    noise(0, 0.45, 'lowpass', 220, 0.7, 1, { decay: 3 }),
    noise(0, 0.15, 'bandpass', 4500, 0.8, 0.3, { decay: 4 }),
    glass(0.01, note('F5'), 0.1, 0.8),
  ),
  collapse: cue(
    // Ice cracking with a brief ring on each fracture, then everything shattering.
    [0, 0.08, 0.17, 0.29, 0.43].map((at, index) => [
      noise(at, 0.06, 'bandpass', 4200, 1, 0.55, { decay: 4 }),
      tone(at, 2600 + index * 150, 0.04, 0.12, { attack: 0.002, glide: { ratio: 0.7, time: 0.1 } }),
    ]),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    noise(0.45, 0.8, 'highpass', 3500, 0.7, 0.18, { attack: 0.05, decay: 2.5 }),
    scatter(0.6, 1.5, 5).map((at, index) => tone(at, SHARDS[index], 0.04, 0.2, { attack: 0.002 })),
  ),
  diceRoll: cue(
    scatter(0, 0.6, 9).map((at, index) => [
      tone(at, SHARDS[index % SHARDS.length], 0.05, 0.06, { attack: 0.002 }),
      noise(at, 0.03, 'highpass', 6500, 0.7, 0.2, { decay: 3 }),
    ]),
    noise(0, 0.6, 'bandpass', 3800, 1, 0.2, { attack: 0.2, decay: 1.5 }),
  ),
  diceReveal: cue(
    thump(0, 150, 0.26, 0.3),
    noise(0, 0.3, 'lowpass', 230, 0.7, 0.8, { decay: 3 }),
    noise(0, 0.08, 'bandpass', 4500, 0.8, 0.35, { decay: 4 }),
    glass(0.01, note('A5'), 0.12, 0.45),
  ),
  place: cue(
    noise(0, 0.035, 'highpass', 6000, 0.7, 0.24, { decay: 3 }),
    tone(0, 3300, 0.07, 0.07, { attack: 0.002 }),
    glass(0, note('E6'), 0.07, 0.15),
  ),
  capture: cue(
    noise(0, 0.035, 'highpass', 6000, 0.7, 0.24, { decay: 3 }),
    tone(0, 3300, 0.07, 0.07, { attack: 0.002 }),
    glass(0.06, note('A5'), 0.12, 0.3, 0.96),
    noise(0.06, 0.07, 'bandpass', 4800, 1, 0.4, { decay: 4 }),
  ),
  flip: cue(
    noise(0, 0.08, 'bandpass', 3200, 1.2, 0.35, { attack: 0.3, decay: 2 }, 8000),
    tone(0.045, 5000, 0.05, 0.08, { attack: 0.002 }),
  ),
  check: cue(glass(0, note('E6'), 0.2, 0.2), glass(0.1, note('E6'), 0.2, 0.2), glass(0.2, note('A6'), 0.22, 0.5)),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    // An icy gale in place of the fire's roar.
    noise(fireStart, fireEnd - fireStart, 'bandpass', 1200, 1.5, 0.9, { attack: 0.4, hold: 4 }, 3200),
    pattern(fireStart + 0.1, fireEnd, 0.28, (at, index) => glass(at, SHARDS[index % SHARDS.length], 0.04, 0.3), 6),
    noise(strike - 0.02, cut + 0.02, 'highpass', 6000, 0.7, 0.3, { rise: 2 }, 9500),
    thump(strike + cut, 110, 0.26, 0.4),
    noise(strike + cut, 0.5, 'highpass', 3500, 0.7, 0.2, { decay: 2.5 }),
    noise(strike + cut, 0.5, 'lowpass', 280, 0.7, 1, { decay: 3 }),
    glass(strike + cut, note('A5'), 0.1, 0.7),
  ),
};
