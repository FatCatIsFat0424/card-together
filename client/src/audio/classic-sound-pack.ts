import { notesToCue } from './sound-pack';
import type { Cue, NoiseVoice, SlashTiming, SoundPack, ToneNotes, ToneVoice } from './sound-pack';

export const TURN_NOTES: ToneNotes = [[0, 660], [0.12, 880]];
/** A rising three-note cue, distinct from the turn reminder, for a player joining the room. */
export const JOIN_NOTES: ToneNotes = [[0, 523], [0.1, 659], [0.2, 784]];

function noise(
  at: number, length: number, type: NoiseVoice['filter']['type'], frequency: number, q: number, level: number,
  envelope: NoiseVoice['envelope'], sweepTo?: number,
): NoiseVoice {
  return { kind: 'noise', at, length, filter: { type, frequency, q }, level, envelope, sweepTo };
}

const OUT: Cue = ([[523, 0, 0.2], [392, 0.16, 0.2], [262, 0.32, 0.45]] as const).map(
  ([frequency, at, decay]): ToneVoice => ({
    kind: 'tone', at, frequency, wave: 'sine', level: 0.3, attack: 0.015, decay,
  }));

/** Today's hard-coded tones; used whenever no pack is equipped. */
export const CLASSIC_SOUND_PACK: SoundPack = {
  id: 'classic',
  turn: notesToCue(TURN_NOTES),
  join: notesToCue(JOIN_NOTES),
  card: [noise(0, 0.08, 'bandpass', 2400, 0.9, 0.6, { decay: 3 })],
  pass: [noise(0, 0.12, 'bandpass', 700, 0.9, 0.35, { decay: 3 })],
  out: OUT,
  start: [
    noise(0, 0.55, 'lowpass', 180, 0.7, 0.85, { decay: 3 }),
    noise(0, 0.1, 'bandpass', 1800, 0.7, 0.35, { decay: 4 }),
  ],
  collapse: [
    ...[0, 0.08, 0.17, 0.29, 0.43].map((at) => noise(at, 0.07, 'bandpass', 2600, 0.7, 0.7, { decay: 4 })),
    noise(0.35, 1.6, 'lowpass', 140, 0.7, 1, { attack: 0.1, decay: 2 }),
  ],
  // A fire roar while the fire burns, a whoosh across the blade's sweep, and an impact as it reaches the far end.
  slash: ({ fireStart, fireEnd, strike, cut }: SlashTiming) => [
    noise(fireStart, fireEnd - fireStart, 'lowpass', 750, 0.7, 0.35,
      { attack: 1 / 6, hold: 6, crackle: { chance: 0.004, boost: 3 } }),
    noise(strike - 0.02, cut + 0.02, 'bandpass', 4200, 0.7, 0.6, { rise: 2 }),
    noise(strike + cut, 0.5, 'lowpass', 280, 0.7, 0.9, { decay: 3 }),
  ],
};
