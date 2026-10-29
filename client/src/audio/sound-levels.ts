import { dbToGain } from './mix';
import { SOUND_CUES } from './sound-pack';
import type { Cue, SlashTiming, SoundCueName, SoundPack, Voice } from './sound-pack';

/** Every cue a pack plays; the slash is a function of the presentation timing and is calibrated as one cue. */
export type CalibratedCueName = SoundCueName | 'slash';
export const CALIBRATED_CUES: readonly CalibratedCueName[] = [...SOUND_CUES, 'slash'];

/**
 * Target loudness of each cue, measured as the loudest 100 ms RMS in dBFS after a 150 Hz high-pass, at unity bus
 * gain and before the effects boost. Pack recipes differ by 10 dB or more for the same cue, so a pack's cue is
 * trimmed to this value rather than boosted by one blanket multiplier. The values follow the classic pack, with
 * its quiet cues (pass, flip) lifted so frequent table sounds stay audible next to the music.
 */
export const CUE_TARGET_DB: Readonly<Record<CalibratedCueName, number>> = {
  turn: -25, join: -26, card: -26, pass: -29, out: -22, start: -25, collapse: -23,
  diceRoll: -26, diceReveal: -25, place: -27, capture: -26, flip: -27, check: -25, slash: -20,
};

/** Trim in dB per pack and cue that brings the recipe to `CUE_TARGET_DB`; regenerate it when a recipe changes. */
export const PACK_CUE_TRIM_DB: Readonly<Record<SoundPack['id'], Readonly<Record<CalibratedCueName, number>>>> = {
  classic: {
    turn: 0, join: -1, card: 1, pass: 5.5, out: -2, start: 4.5, collapse: 0.5,
    diceRoll: 0.5, diceReveal: -0.5, place: 2.5, capture: 1, flip: 0, check: 2, slash: 0.5,
  },
  'sound-starfleet': {
    turn: 1, join: -0.5, card: 9.5, pass: 1.5, out: 1.5, start: -1, collapse: 3,
    diceRoll: 3, diceReveal: 0, place: 3.5, capture: 2, flip: 5, check: 1, slash: 2.5,
  },
  'sound-shrine': {
    turn: 1, join: 1, card: 11, pass: 4, out: 2, start: -0.5, collapse: 4,
    diceRoll: 5, diceReveal: -0.5, place: 5.5, capture: 5.5, flip: 7, check: -1, slash: 3.5,
  },
  'sound-ironfront': {
    turn: 2.5, join: 1, card: 12, pass: 5.5, out: 2, start: 2, collapse: 6.5,
    diceRoll: 5.5, diceReveal: 3.5, place: 7, capture: 4.5, flip: 6.5, check: 0.5, slash: 6,
  },
  'sound-neoncity': {
    turn: 2.5, join: 0.5, card: 8.5, pass: 1, out: 1.5, start: -2.5, collapse: 0.5,
    diceRoll: 1.5, diceReveal: -1, place: 2.5, capture: 1, flip: 4.5, check: 0, slash: 1.5,
  },
  'sound-crownrealm': {
    turn: 4, join: 3.5, card: 10.5, pass: 3.5, out: 2, start: -1, collapse: 2,
    diceRoll: 4.5, diceReveal: -1.5, place: 5, capture: 5.5, flip: 7.5, check: 2, slash: 2.5,
  },
  'sound-aurora': {
    turn: 1.5, join: 1, card: 6, pass: 5, out: 4, start: -1, collapse: 2,
    diceRoll: -5, diceReveal: -1.5, place: 1.5, capture: 2, flip: 5, check: 4, slash: -1,
  },
  'sound-tide': {
    turn: -1, join: 1, card: -1, pass: -1.5, out: -0.5, start: 1.5, collapse: -6,
    diceRoll: -3.5, diceReveal: -4, place: 0.5, capture: -2.5, flip: 3, check: -1.5, slash: -2,
  },
  'sound-sakura': {
    turn: 2, join: 3.5, card: 7, pass: 4, out: 3.5, start: 0.5, collapse: 4,
    diceRoll: 2, diceReveal: 1, place: 5, capture: 2.5, flip: 4.5, check: 1, slash: -0.5,
  },
  'sound-constellation': {
    turn: 0, join: 1, card: 6.5, pass: 8.5, out: 1.5, start: 0.5, collapse: 3.5,
    diceRoll: -4.5, diceReveal: 2, place: 2, capture: 1, flip: 3.5, check: -1, slash: 1,
  },
  'sound-bamboo': {
    turn: -0.5, join: 2.5, card: 4.5, pass: 3.5, out: 2.5, start: 1, collapse: 3,
    diceRoll: 3, diceReveal: 0, place: 0.5, capture: -1.5, flip: 3.5, check: -2, slash: -0.5,
  },
  'sound-gilded': {
    turn: 0.5, join: 4, card: 8.5, pass: 9, out: 3.5, start: -0.5, collapse: 2.5,
    diceRoll: -4.5, diceReveal: 1, place: 5.5, capture: 7.5, flip: 5.5, check: 1, slash: 0,
  },
  'sound-ember': {
    turn: 1, join: 3.5, card: 6, pass: 1, out: 3, start: 5, collapse: 1,
    diceRoll: 1, diceReveal: 4.5, place: 3.5, capture: 2.5, flip: 4.5, check: 0.5, slash: 1,
  },
  'sound-lotus': {
    turn: -2, join: 1.5, card: 2.5, pass: 1, out: 2, start: -1.5, collapse: 3.5,
    diceRoll: 1, diceReveal: -2.5, place: 1, capture: 0.5, flip: 4.5, check: -1, slash: 1.5,
  },
  'sound-frost': {
    turn: -0.5, join: 3, card: 5, pass: 4, out: 4, start: -1.5, collapse: -1,
    diceRoll: 0.5, diceReveal: -0.5, place: 2.5, capture: 0, flip: 6, check: -0.5, slash: -3,
  },
  'sound-dune': {
    turn: 1, join: 4.5, card: 5, pass: 1, out: 5, start: 1, collapse: -1.5,
    diceRoll: 1.5, diceReveal: -1.5, place: 3, capture: 2, flip: 0, check: 0.5, slash: -2,
  },
};

function scaleVoice(voice: Voice, gain: number): Voice {
  return { ...voice, level: voice.level * gain };
}

function scaleCue(cue: Cue, db: number): Cue {
  const gain = dbToGain(db);
  return cue.map((voice) => scaleVoice(voice, gain));
}

/** Returns a copy of `pack` whose cues are trimmed to the target loudness; the recipes themselves stay untouched. */
export function calibratePack(pack: SoundPack, trims: Readonly<Record<CalibratedCueName, number>>): SoundPack {
  const scaled = Object.fromEntries(SOUND_CUES.map((name) => [name, scaleCue(pack[name], trims[name])]));
  return {
    ...(scaled as Record<SoundCueName, Cue>),
    id: pack.id,
    slash: (timing: SlashTiming) => scaleCue(pack.slash(timing), trims.slash),
  };
}
