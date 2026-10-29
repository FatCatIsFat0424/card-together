import { TRICK_HOLD_MS } from '../games/bridge/trick-presentation';
import type { TurnSound } from './turn-sound';

export interface TurnSoundSnapshot {
  room: string | null;
  turn: string | null;
  completedTricks: number;
  /** Wait before an owned turn's cue, so it follows the move sound that delivered the turn. */
  delayMs: number;
  enabled: boolean;
}

export interface TurnSoundController {
  update: (snapshot: TurnSoundSnapshot) => void;
  dispose: () => void;
}

export function createTurnSoundController(audio: TurnSound): TurnSoundController {
  let previous: TurnSoundSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    update: (next) => {
      if (disposed) return;
      const changed = previous?.room !== next.room || previous?.turn !== next.turn;
      const hold = previous?.room === next.room &&
        next.completedTricks > previous.completedTricks;
      previous = next;
      if (!next.enabled || !next.turn || changed) {
        cancel();
        audio.stop();
      }
      if (!changed || !next.turn || !next.enabled || !audio.ready()) return;
      // Consume transitions even while audio is locked; unlocking never replays stale turns.
      const wait = hold ? TRICK_HOLD_MS : next.delayMs;
      if (wait > 0) timer = setTimeout(() => { timer = null; audio.play(); }, wait);
      else audio.play();
    },
    dispose: () => { disposed = true; cancel(); audio.dispose(); },
  };
}
