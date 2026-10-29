import { describe, expect, it } from 'vitest';
import { CLASSIC_SOUND_PACK } from '../../../client/src/audio/classic-sound-pack';
import { EFFECTS_BOOST_DB, dbToGain, softCeiling } from '../../../client/src/audio/mix';
import {
  CALIBRATED_CUES, CUE_TARGET_DB, PACK_CUE_TRIM_DB, calibratePack,
} from '../../../client/src/audio/sound-levels';
import type { Cue, SoundPack } from '../../../client/src/audio/sound-pack';
import { SOUND_PACK_DEFINITIONS, resolveSoundPack } from '../../../client/src/cosmetics/sound-packs/sound-packs';
import { allCues } from './sound-pack-loudness';
import { measureSamples, renderCueSamples, toDb } from './sound-pack-render';

const RAW_PACKS: readonly SoundPack[] = [CLASSIC_SOUND_PACK, ...Object.values(SOUND_PACK_DEFINITIONS)];
const SEEDS = [1, 2, 3, 4, 5, 6];
/** Allowed gap between a calibrated cue and its target; a trim table step is 0.5 dB. */
const TOLERANCE_DB = 0.6;

/** Noise bursts are random, so loudness is the power average over several renders of the same cue. */
function averageLoudness(cue: Cue): { shortTermDb: number; peakDb: number } {
  let power = 0;
  let peak = 0;
  for (const seed of SEEDS) {
    const measured = measureSamples(renderCueSamples(cue, seed));
    power += 10 ** (measured.shortTermDb / 10);
    peak = Math.max(peak, measured.peak);
  }
  return { shortTermDb: 10 * Math.log10(power / SEEDS.length), peakDb: toDb(peak) };
}

describe('effect loudness calibration', () => {
  it('should define a trim for every pack and cue and a target for every cue', () => {
    expect(Object.keys(PACK_CUE_TRIM_DB).sort()).toEqual(RAW_PACKS.map((pack) => pack.id).sort());
    for (const [id, trims] of Object.entries(PACK_CUE_TRIM_DB)) {
      expect(Object.keys(trims).sort(), id).toEqual([...CALIBRATED_CUES].sort());
      for (const trim of Object.values(trims)) {
        expect(Number.isFinite(trim), id).toBe(true);
        expect(trim, id).toBeGreaterThanOrEqual(-8);
        expect(trim, id).toBeLessThanOrEqual(12);
      }
    }
    expect(Object.keys(CUE_TARGET_DB).sort()).toEqual([...CALIBRATED_CUES].sort());
  });

  it('should scale voice levels by the trim and leave everything else alone', () => {
    const trims = { ...PACK_CUE_TRIM_DB.classic, card: 6, slash: -6 };
    const pack = calibratePack(CLASSIC_SOUND_PACK, trims);
    expect(pack.id).toBe('classic');
    const [raw] = CLASSIC_SOUND_PACK.card;
    const [scaled] = pack.card;
    expect(scaled).toEqual({ ...raw, level: raw.level * dbToGain(6) });
    expect(CLASSIC_SOUND_PACK.card[0].level).toBe(0.6);
    const timing = { fireStart: 0.3, fireEnd: 1.85, strike: 1.85, cut: 0.12 };
    expect(pack.slash(timing).map((voice) => voice.level)).toEqual(
      CLASSIC_SOUND_PACK.slash(timing).map((voice) => voice.level * dbToGain(-6)));
  });

  it('should resolve to calibrated packs', () => {
    expect(resolveSoundPack(null).card[0].level).toBeCloseTo(0.6 * dbToGain(PACK_CUE_TRIM_DB.classic.card), 10);
    expect(resolveSoundPack('sound-gilded').card[0].level)
      .toBeCloseTo(SOUND_PACK_DEFINITIONS['sound-gilded'].card[0].level * dbToGain(PACK_CUE_TRIM_DB['sound-gilded'].card), 10);
  });

  // A failing assertion here means a recipe changed: regenerate PACK_CUE_TRIM_DB from the measured values.
  it.each(RAW_PACKS.map((pack) => [pack.id, pack] as const))(
    '%s should play every cue at its target loudness without crowding the ceiling', (id, pack) => {
      const calibrated = resolveSoundPack(id === 'classic' ? null : id);
      const cues = allCues(calibrated);
      for (const [name, cue] of Object.entries(cues)) {
        const { shortTermDb, peakDb } = averageLoudness(cue);
        const target = CUE_TARGET_DB[name as keyof typeof CUE_TARGET_DB];
        expect(Math.abs(shortTermDb - target), `${name} ${shortTermDb.toFixed(1)} dB vs ${target}`)
          .toBeLessThanOrEqual(TOLERANCE_DB);
        // After the boost a single cue stays within the ceiling curve, which covers up to +12 dBFS but should rarely be reached.
        expect(peakDb + EFFECTS_BOOST_DB, `${name} peak`).toBeLessThanOrEqual(4);
      }
      expect(Object.keys(cues).sort()).toEqual(Object.keys(allCues(pack)).sort());
    });

  it('should bring the quietest recipes up most', () => {
    const rawCard = averageLoudness(SOUND_PACK_DEFINITIONS['sound-ironfront'].card).shortTermDb;
    const calibratedCard = averageLoudness(resolveSoundPack('sound-ironfront').card).shortTermDb;
    expect(rawCard).toBeLessThan(CUE_TARGET_DB.card - 8);
    expect(calibratedCard - rawCard).toBeGreaterThan(8);
  });
});

describe('soft ceiling', () => {
  it('should pass ordinary levels unchanged and never exceed full scale', () => {
    for (const value of [0, 0.1, 0.3, 0.5, -0.4]) expect(softCeiling(value)).toBe(value);
    let previous = -Infinity;
    for (let value = -8; value <= 8; value += 0.05) {
      const out = softCeiling(value);
      expect(Math.abs(out)).toBeLessThanOrEqual(1);
      expect(out).toBeGreaterThanOrEqual(previous);
      previous = out;
    }
    expect(softCeiling(4)).toBeGreaterThan(0.99);
    expect(softCeiling(-4)).toBeCloseTo(-softCeiling(4), 12);
  });
});
