import { useEffect, useRef } from 'react';
import type { BoardMoveRecord } from '@shared/rules/board/board-move';
import type { PlayerVisibleGameState } from '@shared/types';
import { playBoardSound } from '../../audio/card-sound';
import type { BoardSoundCue } from '../../audio/card-sound';
import { useGameStore } from '../../stores/game-store';
import { gameUi } from '../ui-registry';

/**
 * One snapshot can add a few records at once (a move followed by the opponent's automatic pass); a larger jump
 * is a restore or a replay seek, which stays silent.
 */
const MAX_NEW_RECORDS = 3;

/** Placements sound as `place`, captures as `capture`; passes touch nothing. */
export function defaultBoardMoveCue(move: BoardMoveRecord): BoardSoundCue | null {
  if (move.to === undefined) return null;
  return move.capture ? 'capture' : 'place';
}

function logOf(game: PlayerVisibleGameState): readonly unknown[] {
  const log = (game as { readonly log?: unknown }).log;
  return Array.isArray(log) ? log : [];
}

/**
 * The cue for the move(s) that appeared between two snapshots of the same game, or `null` when nothing new was
 * played, the log shrank, or it jumped (first snapshot, reconnect, new match, replay seek).
 */
export function newBoardMoveCue(
  previous: PlayerVisibleGameState | null, next: PlayerVisibleGameState | null,
): BoardSoundCue | null {
  if (!previous || !next || previous.gameType !== next.gameType) return null;
  const before = logOf(previous);
  const after = logOf(next);
  const added = after.length - before.length;
  if (added < 1 || added > MAX_NEW_RECORDS) return null;
  // The game's own function is typed by its log entries; the registry only knows the union.
  const pick = (gameUi(next.gameType).boardMoveCue ?? defaultBoardMoveCue) as
    (move: unknown, game: unknown) => BoardSoundCue | null;
  for (let index = after.length - 1; index >= before.length; index--) {
    const cue = pick(after[index], next);
    if (cue) return cue;
  }
  return null;
}

/** Plays the cue of each new move at a board table; the sound-effects setting is applied by `playBoardSound`. */
export function useBoardMoveSound(active: boolean): void {
  const visible = useGameStore((state) => state.visible);
  const previous = useRef<PlayerVisibleGameState | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = visible;
    if (!active) return;
    const cue = newBoardMoveCue(before, visible);
    if (cue) playBoardSound(cue);
  }, [visible, active]);
}
