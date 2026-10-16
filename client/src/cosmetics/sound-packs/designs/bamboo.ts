import type { SlashTiming, SoundPack, ToneVoice, Voice } from '../../../audio/sound-pack';
import { cue, noise, note, pattern, scatter, stack, thump, tone } from '../voices';

/** A hollow wooden knock: the pitch drops as the tube settles, with a dry click. */
const knock = (at: number, frequency: number, level: number, decay: number): Voice[] => [
  tone(at, frequency * 1.2, level * 0.85, decay, { attack: 0.002, glide: { ratio: 1 / 1.2, time: 0.025 } }),
  noise(at, 0.03, 'bandpass', frequency * 3, 1.5, level * 2, { decay: 3 }),
];

/** A mallet on a marimba bar: a clear fundamental with a short, woody fourth partial. */
const marimba = (at: number, frequency: number, level: number, decay: number): ToneVoice[] =>
  stack(at, frequency, level, decay, [[1, 1, 1], [4, 0.25, 0.15]], { attack: 0.002 });

/** Wooden knocks and marimba bars, like a bamboo grove tapped by a mallet. */
export const BAMBOO_SOUND_PACK: SoundPack = {
  id: 'sound-bamboo',
  turn: cue(marimba(0, note('C5'), 0.22, 0.3), marimba(0.14, note('G5'), 0.22, 0.35)),
  join: cue(knock(0, 700, 0.14, 0.12), knock(0.08, 880, 0.14, 0.12), knock(0.16, 1100, 0.14, 0.16)),
  card: cue(knock(0, 1100, 0.22, 0.05)),
  pass: cue(knock(0, 650, 0.16, 0.07)),
  out: cue(marimba(0, note('G5'), 0.2, 0.25), marimba(0.16, note('D5'), 0.2, 0.25), marimba(0.32, note('G4'), 0.2, 0.45)),
  // A log drum with a bright knock on top.
  start: cue(
    thump(0, 130, 0.3, 0.4),
    knock(0, 900, 0.18, 0.08),
    noise(0, 0.4, 'lowpass', 250, 0.7, 0.8, { decay: 3 }),
  ),
  collapse: cue(
    // Splintering bamboo: irregular sharp cracks, then the pieces knocking down.
    scatter(0, 0.7, 8).map((at, index) => noise(at, 0.05, 'bandpass', 1800 + (index % 3) * 700, 1, 0.6, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
    [900, 780, 660, 560, 480].map((frequency, index) => knock(0.5 + index * 0.09, frequency, 0.1, 0.1)),
  ),
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => cue(
    noise(fireStart, fireEnd - fireStart, 'lowpass', 900, 0.7, 0.7, { attack: 0.2, hold: 5 }),
    // Burning bamboo pops.
    scatter(fireStart, fireEnd, 9).map((at, index) => noise(at, 0.04, 'bandpass', 2000 + (index % 3) * 600, 1, 0.5, { decay: 3 })),
    pattern(fireStart, fireEnd, 0.4, (at, index) => knock(at + 0.05, [520, 700, 600][index % 3], 0.06, 0.06), 5),
    noise(strike - 0.02, cut + 0.02, 'bandpass', 3500, 0.8, 0.45, { rise: 2 }, 6500),
    thump(strike + cut, 150, 0.32, 0.4),
    knock(strike + cut, 500, 0.14, 0.1),
    noise(strike + cut, 0.5, 'lowpass', 300, 0.7, 1, { decay: 3 }),
  ),
};
