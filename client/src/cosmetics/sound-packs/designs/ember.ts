import type { NoiseVoice, SlashTiming, SoundPack, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, scatter, thump, tone } from '../voices';

/** A warm, softly filtered sawtooth with a sub-octave: a horn-like glow. */
const glow = (at: number, frequency: number, level: number, decay: number, sag = 1): Voice[] => [
  tone(at, frequency, level * 0.7, decay, {
    wave: 'sawtooth', attack: 0.02, filter: { type: 'lowpass', frequency: 1000, q: 1 },
    ...(sag === 1 ? {} : { glide: { ratio: sag, time: decay * 0.9 } }),
  }),
  tone(at, frequency / 2, level * 0.3, decay, {
    attack: 0.03, ...(sag === 1 ? {} : { glide: { ratio: sag, time: decay * 0.9 } }),
  }),
];

/** A single crackle of burning wood. */
const pop = (at: number, level: number): NoiseVoice => noise(at, 0.03, 'bandpass', 3200, 1.5, level, { decay: 3 });

/** Warm saw tones and crackling pops, like a hearth fire settling. */
export const EMBER_SOUND_PACK: SoundPack = {
  id: 'sound-ember',
  turn: cue(glow(0, note('A4'), 0.2, 0.38), glow(0.13, note('D5'), 0.2, 0.45), pop(0, 0.4), pop(0.31, 0.25), pop(0.41, 0.3)),
  join: cue(
    glow(0, note('G4'), 0.16, 0.22), glow(0.09, note('B4'), 0.16, 0.22), glow(0.18, note('D5'), 0.16, 0.3), pop(0.3, 0.25),
  ),
  card: cue(noise(0, 0.05, 'bandpass', 2600, 1.5, 0.5, { decay: 4 }), pop(0.035, 0.3)),
  pass: cue(noise(0, 0.1, 'lowpass', 700, 0.7, 0.7, { attack: 0.1, decay: 2 }), pop(0, 0.15)),
  // The glow sags in pitch and dies away, with a few last pops.
  out: cue(glow(0, note('A4'), 0.2, 0.75, 0.35), pop(0.1, 0.3), pop(0.25, 0.25), pop(0.42, 0.2)),
  start: cue(
    thump(0, 80, 0.36, 0.6),
    noise(0, 0.6, 'lowpass', 170, 0.7, 1.1, { decay: 3 }),
    [0.1, 0.17, 0.3, 0.34].map((at) => pop(at, 0.25)),
  ),
  collapse: cue(
    // Charred timber cracking, with the fire roaring up through the gap.
    [0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.08, 'bandpass', 1600, 1, 0.8, { decay: 4 })),
    noise(0.3, 1.4, 'lowpass', 500, 0.7, 0.6, { attack: 0.3, hold: 4, crackle: { chance: 0.006, boost: 4 } }),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    scatter(0.5, 1.5, 6).map((at) => pop(at, 0.3)),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 900, 0.7, 0.6,
      { attack: 0.2, hold: 5, crackle: { chance: 0.006, boost: 4 } }),
    scatter(fireStart, fireEnd, 10).map((at) => pop(at, 0.4)),
    tone(fireStart, 80, 0.1, fireEnd - fireStart, {
      wave: 'sawtooth', attack: (fireEnd - fireStart) * 0.5, filter: { type: 'lowpass', frequency: 300, q: 1 },
      glide: { ratio: 1.4, time: fireEnd - fireStart },
    }),
    noise(strike - 0.02, cut + 0.02, 'bandpass', 3000, 0.8, 0.4, { rise: 2 }, 6000),
    thump(strike + cut, 90, 0.4, 0.5),
    noise(strike + cut, 0.5, 'lowpass', 350, 0.7, 1, { decay: 3 }),
  ),
};
