import { getActiveSoundPack } from '../cosmetics/sound-packs/active-sound-pack';
import { notesToCue } from './sound-pack';
import type { ToneNotes } from './sound-pack';
import { effectsOutput, releaseEffectsBus } from './audio-bus';
import { createVoiceTracker, renderCue } from './sound-synth';

export type { ToneNotes } from './sound-pack';
export { JOIN_NOTES } from './classic-sound-pack';

/** Which cue of the equipped sound pack a `TurnSound` plays. */
export type TurnCue = 'turn' | 'join';

export interface TurnSound {
  ready: () => boolean;
  unlock: () => void;
  play: () => void;
  stop: () => void;
  dispose: () => void;
}

/**
 * A short original tone cue, independent of the music player. A named cue follows the equipped sound pack at play
 * time; explicit notes always play as plain classic tones.
 */
export function createTurnSound(cue: TurnCue | ToneNotes = 'turn'): TurnSound {
  let context: AudioContext | null = null;
  let disposed = false;
  const voices = createVoiceTracker();
  const stop = voices.stopAll;
  return {
    ready: () => !disposed && context?.state === 'running',
    unlock: () => {
      if (disposed) return;
      try {
        if (!context) context = new AudioContext();
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
      } catch { /* Audio support and permission are optional. */ }
    },
    play: () => {
      if (disposed || context?.state !== 'running') return;
      stop();
      try {
        renderCue(context, typeof cue === 'string' ? getActiveSoundPack()[cue] : notesToCue(cue), voices.track,
          effectsOutput(context));
      } catch { stop(); }
    },
    stop,
    dispose: () => {
      disposed = true;
      stop();
      if (context) releaseEffectsBus(context);
      try { void context?.close().catch(() => undefined); } catch { /* Already closed. */ }
      context = null;
    },
  };
}
