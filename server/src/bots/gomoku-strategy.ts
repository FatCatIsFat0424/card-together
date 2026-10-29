import type { GomokuVisibleState } from '@shared/types';
import { gmLegalMoves } from '@shared/rules/gomoku';
import type { BotAction } from './bot-decisions';
import {
  Position, QUICK_DEPTH, QUICK_NODES, chooseAction, chooseBySearch, choosingTurn, placeAction, placingTurn, searchBestMove,
  sideToPlace,
} from './gomoku-search';

/** Relative noise on a move's pattern score, so near-equal moves vary and a slightly worse one is sometimes played. */
const EASY_NOISE = 0.35;

/** Chance that the easy bot plays one of its better few moves at random, which can miss a block. */
const EASY_SLIP = 0.18;

/** Moves the easy bot weighs. */
const EASY_BREADTH = 12;

/** Easy: pattern score with randomness. Also the move a player gets after running out of time. */
export function easyGomokuAction(visible: GomokuVisibleState, random: () => number): BotAction | null {
  if (choosingTurn(visible)) {
    // Take black when the three opening stones favour it, with enough noise to be unpredictable.
    return chooseAction(new Position(visible.stones).score + (random() - 0.5) * 20 > 0);
  }
  if (!placingTurn(visible)) return null;
  const side = sideToPlace(visible);
  const renju = visible.options.renju;
  const position = new Position(visible.stones);
  // A winning stone is always taken.
  const [win] = position.winningCells(side, renju);
  if (win !== undefined) return placeAction(win);
  const moves = position.candidates(side, renju, EASY_BREADTH);
  if (moves.length === 0) return null;
  if (random() < EASY_SLIP) return placeAction(moves[Math.floor(random() * Math.min(moves.length, 6))]);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = position.heuristic(move, side) * (1 - EASY_NOISE + 2 * EASY_NOISE * random());
    if (score > bestScore) {
      best = move;
      bestScore = score;
    }
  }
  return placeAction(best);
}

/**
 * Hard, synchronous: the same search as the worker with a small node budget. In a search game this only serves
 * seats that are not on a bot's own turn, so it must stay cheap.
 */
export function getGomokuBotAction(visible: GomokuVisibleState, random: () => number): BotAction | null {
  const options = { maxDepth: QUICK_DEPTH, expired: () => false, maxNodes: QUICK_NODES, random };
  if (choosingTurn(visible)) return chooseBySearch(visible, options);
  if (!placingTurn(visible)) return null;
  const choice = searchBestMove(new Position(visible.stones), sideToPlace(visible), visible.options.renju, options);
  return choice === null ? null : placeAction(choice.index);
}

/** The legal point nearest the centre: the last resort when the strategies keep failing. */
export function gomokuFirstLegalAction(visible: GomokuVisibleState): BotAction | null {
  if (choosingTurn(visible)) return chooseAction(false);
  if (!placingTurn(visible)) return null;
  const distance = (index: number): number => Math.max(Math.abs((index % 15) - 7), Math.abs(Math.floor(index / 15) - 7));
  const [first] = gmLegalMoves(visible.stones, sideToPlace(visible), visible.options.renju)
    .sort((a, b) => distance(a) - distance(b) || a - b);
  return first === undefined ? null : placeAction(first);
}
