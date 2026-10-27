import { createRoundBuilder } from './round-builder';
import type { HistoryInput, HistoryRound } from './round-builder';
import { clientGame } from './registry';

export type { HistoryAction, HistoryInput, HistoryRound } from './round-builder';

/**
 * Rebuild history from the full public log, including after reconnects. Games without a round list
 * (Bridge and Napoleon list their tricks in their own panels, Chinese Poker shows its showdown in
 * the result) have no rounds here.
 */
export function deriveRoundHistory(game: HistoryInput): HistoryRound[] {
  const builder = createRoundBuilder();
  clientGame(game.gameType).roundHistory?.derive(game, builder);
  const open = builder.current();
  if (game.phase === 'scoring' && open) open.complete = true;
  return builder.rounds;
}

/** The game as it stood after its first `end` log entries, for histories that follow a presentation. */
export function gameAtLogEnd<T extends HistoryInput>(game: T, end: number): T {
  return { ...game, log: game.log.slice(0, end) };
}
