import type { ChineseCheckersVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { moveAction, searchBestMove, searchBoard, searchMoves, searchSetup } from './chinesecheckers-search';

/**
 * Synchronous fallback: the search's one-move evaluation (progress, stragglers, drift). The worker search adds
 * the look-ahead; this decides only when no pool runs or a search fails, so it stays cheap.
 */
export function getChineseCheckersBotAction(visible: ChineseCheckersVisibleState, random: () => number): BotAction | null {
  const setup = searchSetup(visible);
  if (!setup) return null;
  const move = searchBestMove(searchBoard(visible.holes), setup.corner, {
    ...setup, expired: () => true, random, depth: 1,
  });
  return move ? moveAction(move) : null;
}

/** The first legal move in hole order: the last resort when the strategies keep failing. */
export function chineseCheckersFirstLegalAction(visible: ChineseCheckersVisibleState): BotAction | null {
  const setup = searchSetup(visible);
  const [first] = setup ? searchMoves(searchBoard(visible.holes), setup.corner) : [];
  return first ? moveAction(first) : null;
}
