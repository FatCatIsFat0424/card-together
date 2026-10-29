import type { ChineseCheckersVisibleState } from '@shared/types';
import { CC_TIP_DISTANCE, ccTarget } from '@shared/rules/chinesecheckers';
import type { BotAction } from './bot-decisions';
import { moveAction, searchBestMove, searchBoard, searchMoves, searchSetup } from './chinesecheckers-search';

/** Noise added to a move's rows gained, so equal-looking moves vary and a shorter one is sometimes played. */
const EASY_NOISE = 1.5;

/**
 * Easy: greedy on rows gained toward the target tip, with light randomness and no look-ahead. Also the move a
 * player gets after running out of time.
 */
export function easyChineseCheckersAction(visible: ChineseCheckersVisibleState, random: () => number): BotAction | null {
  const setup = searchSetup(visible);
  if (!setup) return null;
  const rows = CC_TIP_DISTANCE[ccTarget(setup.corner)];
  let best: { move: { from: number; to: number }; score: number } | null = null;
  for (const move of searchMoves(searchBoard(visible.holes), setup.corner)) {
    const score = rows[move.from] - rows[move.to] + random() * EASY_NOISE;
    if (!best || score > best.score) best = { move, score };
  }
  return best ? moveAction(best.move) : null;
}

/**
 * Hard, synchronous: the search's one-move evaluation (progress, stragglers, drift). The worker search adds
 * the look-ahead; this only serves seats that are not on a bot's own turn, so it stays cheap.
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
