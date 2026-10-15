export interface TurnSound {
  ready: () => boolean;
  unlock: () => void;
  play: () => void;
  stop: () => void;
  dispose: () => void;
}

/** Seconds from the cue start and frequency in Hz for each tone. */
export type ToneNotes = readonly (readonly [offset: number, frequency: number])[];

const TURN_NOTES: ToneNotes = [[0, 660], [0.12, 880]];
/** A rising three-note cue, distinct from the turn reminder, for a player joining the room. */
export const JOIN_NOTES: ToneNotes = [[0, 523], [0.1, 659], [0.2, 784]];

/** A short original tone cue, independent of the music player. */
export function createTurnSound(notes: ToneNotes = TURN_NOTES): TurnSound {
  let context: AudioContext | null = null;
  let disposed = false;
  const voices = new Set<() => void>();
  const stop = (): void => {
    for (const release of voices) release();
  };
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
        for (const [offset, frequency] of notes) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const release = (): void => {
            oscillator.onended = null;
            try { oscillator.stop(); } catch { /* The voice may have already ended. */ }
            oscillator.disconnect();
            gain.disconnect();
            voices.delete(release);
          };
          voices.add(release);
          oscillator.onended = release;
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          const start = context.currentTime + offset;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.18);
        }
      } catch { stop(); }
    },
    stop,
    dispose: () => {
      disposed = true;
      stop();
      try { void context?.close().catch(() => undefined); } catch { /* Already closed. */ }
      context = null;
    },
  };
}
