import { SOUND_CUES, noiseEnvelope } from '../../../client/src/audio/sound-pack';
import type { Cue, SlashTiming, SoundPack, Voice } from '../../../client/src/audio/sound-pack';

export const SAMPLE_SLASH: SlashTiming = { fireStart: 0.3, fireEnd: 1.85, strike: 1.85, cut: 0.12 };
const NYQUIST = 24000;

/**
 * Rough peak of a voice. White noise through a narrow filter keeps only a small share of its power, so a noise
 * level cannot be compared directly with a tone level; a burst peaks near three times its estimated RMS.
 */
export function peakEstimate(voice: Voice): number {
  if (voice.kind === 'tone') return voice.level;
  const { type, frequency, q } = voice.filter;
  const top = Math.max(frequency, voice.sweepTo ?? frequency);
  const bottom = Math.min(frequency, voice.sweepTo ?? frequency);
  const share = type === 'lowpass' ? top / NYQUIST
    : type === 'highpass' ? 1 - bottom / NYQUIST : (top / q) * 1.57 / NYQUIST;
  return 3 * voice.level * 0.577 * Math.sqrt(Math.min(1, share));
}

/** Estimated amplitude of a voice `t` seconds into the cue, following its attack and decay. */
export function amplitudeAt(voice: Voice, t: number): number {
  const local = t - voice.at;
  if (local < 0) return 0;
  if (voice.kind === 'tone') {
    if (local >= voice.decay) return 0;
    if (local < voice.attack) return voice.level * (local / voice.attack);
    const floor = voice.floor ?? 0.0001;
    return voice.level * (floor / voice.level) ** ((local - voice.attack) / (voice.decay - voice.attack));
  }
  if (local >= voice.length) return 0;
  // Crackle boosts random single samples that the voice's filter smooths out; leaving it in made the estimate random.
  return peakEstimate(voice) * noiseEnvelope({ ...voice.envelope, crackle: undefined })(local / voice.length);
}

/** Largest summed amplitude at any instant. */
export function worstOverlap(cue: Cue, tonesOnly = false): number {
  let worst = 0;
  for (let t = 0; t < 4; t += 0.002) {
    let sum = 0;
    for (const voice of cue) {
      if (tonesOnly && voice.kind !== 'tone') continue;
      sum += amplitudeAt(voice, t);
    }
    worst = Math.max(worst, sum);
  }
  return worst;
}

export function allCues(pack: SoundPack): Record<string, Cue> {
  return {
    ...Object.fromEntries(SOUND_CUES.map((name) => [name, pack[name]])),
    slash: pack.slash(SAMPLE_SLASH),
  };
}
