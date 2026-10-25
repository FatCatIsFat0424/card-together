import type { AnyGameState, MatchReplay } from '@shared/types';

/** Matches started before recording existed, or with bots, have no replay. */
export function captureMatchReplay(game: AnyGameState): MatchReplay | undefined {
  if (!game.replayRecording) return undefined;
  const { initial, steps } = game.replayRecording;
  return structuredClone({ version: 1, gameType: game.gameType, startedAt: game.startedAt, initial, steps });
}
