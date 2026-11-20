import type { GomokuVisibleState } from '@shared/types';
import { gmLegalMoves } from '@shared/rules/gomoku';
import type { BotAction } from './bot-decisions';
import {
  Position, QUICK_DEPTH, QUICK_NODES, chooseAction, chooseBySearch, choosingTurn, placeAction, placingTurn, searchBestMove,
  sideToPlace, swapOpeningStone,
} from './gomoku-search';

/**
 * Synchronous fallback: the same search as the worker with a small node budget. It decides only when no pool
 * runs or a search fails, so it must stay cheap for the event loop.
 */
export function getGomokuBotAction(visible: GomokuVisibleState, random: () => number): BotAction | null {
  const options = { maxDepth: QUICK_DEPTH, expired: () => false, maxNodes: QUICK_NODES, random };
  if (choosingTurn(visible)) return chooseBySearch(visible, options);
  if (!placingTurn(visible)) return null;
  const opening = swapOpeningStone(visible, options);
  if (opening !== null) return placeAction(opening);
  const choice = searchBestMove(new Position(visible.stones, visible.options.renju), sideToPlace(visible), visible.options.renju, options);
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
