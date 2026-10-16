import { getActiveSoundPack } from '../cosmetics/sound-packs/active-sound-pack';
import { cueDuration } from './sound-pack';
import type { Cue, SlashTiming, SoundPack } from './sound-pack';
import { createVoiceTracker, renderCue } from './sound-synth';

let context: AudioContext | null = null;
const voices = createVoiceTracker();

/** Call only from a trusted user gesture; missed sounds are never queued. */
export function unlockCardSounds(): void {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  } catch {
    // Audio support and browser permission are optional.
  }
}

/** Cuts off every sound still playing without closing the audio context. */
export function stopCardSounds(): void {
  voices.stopAll();
}

export function disposeCardSounds(): void {
  voices.stopAll();
  const audio = context;
  context = null;
  if (audio) {
    try { void audio.close().catch(() => undefined); } catch { /* Already closed. */ }
  }
}

/** Plays a cue from the equipped pack; locked audio drops it rather than replaying it after the next gesture. */
function play(pick: (pack: SoundPack) => Cue): void {
  const audio = context;
  if (!audio || audio.state !== 'running') return;
  try {
    renderCue(audio, pick(getActiveSoundPack()), voices.track);
  } catch {
    disposeCardSounds();
  }
}

/** Falling cue: a player is eliminated. */
export function playOutSound(): void {
  play((pack) => pack.out);
}

/** Card snap for a play; a softer, lower knock for a pass. */
export function playCardSound(pass = false): void {
  play((pack) => (pass ? pack.pass : pack.card));
}

/**
 * Dragon Slaying: a fire roar while the fire burns, a whoosh rising across the blade's sweep, and an impact as
 * it reaches the far end. Times are seconds from the start of the presentation.
 */
export function playSlashSound(timing: SlashTiming): void {
  play((pack) => pack.slash(timing));
}

/** Table collapse: a sharp crack, splintering as the cracks run, and a deep rumble as the table gives way. */
export function playCollapseSound(): void {
  play((pack) => pack.collapse);
}

/** A single low impact with a crisp attack for the simultaneous player reveal. */
export function playStartSound(): void {
  play((pack) => pack.start);
}

/** Gap between the previewed turn cue and the card sound that follows it. */
const PREVIEW_GAP_SECONDS = 0.2;

/**
 * Shop preview of `pack`: its turn cue, then a card play. Call from a user gesture. Unlike in-game cues this
 * waits for the context to resume, because the click that asks for it is also what unlocks audio.
 * Returns the preview's length in seconds.
 */
export function playSoundPackPreview(pack: SoundPack): number {
  unlockCardSounds();
  const audio = context;
  const cardAt = cueDuration(pack.turn) + PREVIEW_GAP_SECONDS;
  if (!audio) return 0;
  const run = (): void => {
    if (context !== audio || audio.state !== 'running') return;
    try {
      stopCardSounds();
      renderCue(audio, pack.turn, voices.track);
      renderCue(audio, pack.card, voices.track, cardAt);
    } catch {
      disposeCardSounds();
    }
  };
  if (audio.state === 'running') run();
  else void audio.resume().then(run).catch(() => undefined);
  return cardAt + cueDuration(pack.card);
}
