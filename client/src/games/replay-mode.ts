import { createContext, useContext } from 'react';
import type { PlayerVisibleGameState, ReplaySnapshot } from '@shared/types';

/** A table rendered for match playback rather than a live game. */
export interface ReplayMode {
  /** Shared playback keeps the live room's chat beside the table. */
  readonly chat: boolean;
  /**
   * The snapshot before the step whose presentation is playing. Steps advance as soon as a
   * presentation ends, so hands shown by god view come from here instead of waiting for an
   * unlocked moment that continuous playback never has.
   */
  readonly before: ReplaySnapshot | null;
}

export const ReplayModeContext = createContext<ReplayMode | null>(null);

/** `null` at a live table. */
export function useReplayMode(): ReplayMode | null {
  return useContext(ReplayModeContext);
}

/**
 * What god view should show and whether to hold it. A live table holds the hands during a
 * presentation; a replay shows the hands from before the playing step instead, then the step's own.
 */
export function godViewSource(
  visible: PlayerVisibleGameState | null, locked: boolean, replay: ReplayMode | null,
): { readonly visible: PlayerVisibleGameState | null; readonly locked: boolean } {
  if (!replay) return { visible, locked };
  return { visible: locked && replay.before ? replay.before : visible, locked: false };
}
