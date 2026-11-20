import type { ChineseCheckersVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { moveAction, searchBestMove, searchBoard, searchMoves, searchSetup } from './chinesecheckers-search';

/** Plies and nodes of the synchronous move: enough to see a jump chain and the reply, cheap for the event loop. */
const QUICK_DEPTH = 2;
const QUICK_NODES = 4000;
const QUICK_TABLE_BITS = 12;

/**
 * Synchronous fallback: the worker's search cut to two plies and a few thousand nodes. It decides only when no pool
 * runs or a search fails, so it stays cheap.
 */
export function getChineseCheckersBotAction(visible: ChineseCheckersVisibleState, random: () => number): BotAction | null {
  const setup = searchSetup(visible);
  if (!setup) return null;
  const move = searchBestMove(searchBoard(visible.holes), setup.corner, {
    ...setup, expired: () => false, random, maxDepth: QUICK_DEPTH, maxNodes: QUICK_NODES, tableBits: QUICK_TABLE_BITS,
  });
  return move ? moveAction(move) : null;
}

/** The first legal move in hole order: the last resort when the strategies keep failing. */
export function chineseCheckersFirstLegalAction(visible: ChineseCheckersVisibleState): BotAction | null {
  const setup = searchSetup(visible);
  const [first] = setup ? searchMoves(searchBoard(visible.holes), setup.corner) : [];
  return first ? moveAction(first) : null;
}
