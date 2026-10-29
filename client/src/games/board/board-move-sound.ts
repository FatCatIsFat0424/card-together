import { useEffect, useRef } from 'react';
import type { BoardMoveRecord } from '@shared/rules/board/board-move';
import type { PlayerVisibleGameState } from '@shared/types';
import { playBoardSound } from '../../audio/card-sound';
import type { BoardSoundCue } from '../../audio/card-sound';
import { useGameStore } from '../../stores/game-store';
import { gameUi } from '../ui-registry';
import { newBoardRecords } from './board-effects';

/** Placements sound as `place`, captures as `capture`; passes touch nothing. */
export function defaultBoardMoveCue(move: BoardMoveRecord): BoardSoundCue | null {
  if (move.to === undefined) return null;
  return move.capture ? 'capture' : 'place';
}

/** The cue for the move(s) that appeared between two snapshots of the same game; see `newBoardRecords`. */
export function newBoardMoveCue(
  previous: PlayerVisibleGameState | null, next: PlayerVisibleGameState | null,
): BoardSoundCue | null {
  const records = newBoardRecords(previous, next);
  if (!records || !next) return null;
  // The game's own function is typed by its log entries; the registry only knows the union.
  const pick = (gameUi(next.gameType).boardMoveCue ?? defaultBoardMoveCue) as
    (move: unknown, game: unknown) => BoardSoundCue | null;
  for (const record of records) {
    const cue = pick(record, next);
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
