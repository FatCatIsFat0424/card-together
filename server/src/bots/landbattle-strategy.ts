import type { LandBattleVisibleState } from '@shared/types';
import { LB_NODES, LB_PRESETS, lbCell, lbLegalMoves, lbRandomLayout } from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import { deployAction, landBattleDecision, moveAction, quickParams } from './landbattle-search';

/** Clock limit of the synchronous fallback move, which runs on the event loop. */
const QUICK_BUDGET_MS = 60;

function deploying(visible: LandBattleVisibleState): boolean {
  return visible.seats.includes(visible.mySeat) && visible.phase === 'deploying' && !visible.myLayout;
}

function onTurn(visible: LandBattleVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat && visible.seats.includes(visible.mySeat);
}

/**
 * Synchronous: the bot's own formation, then the worker's sampled search with a shallower tree, fewer worlds
 * and a short clock. Turns use the worker search when a pool runs; this fallback must stay cheap.
 */
export function getLandBattleBotAction(visible: LandBattleVisibleState, random: () => number): BotAction | null {
  if (!deploying(visible) && !onTurn(visible)) return null;
  const deadline = performance.now() + QUICK_BUDGET_MS;
  return landBattleDecision(visible, random, () => performance.now() >= deadline, quickParams())
    ?? landBattleFirstLegalAction(visible);
}

/** The first preset or the first legal move in board order: the last resort when the strategies keep failing. */
export function landBattleFirstLegalAction(visible: LandBattleVisibleState): BotAction | null {
  if (deploying(visible)) return deployAction(LB_PRESETS[0]);
  if (!onTurn(visible)) return null;
  const side = visible.seats.indexOf(visible.mySeat) === 0 ? 0 : 1;
  const board = new Array<{ side: LbSide; rank?: LbRank } | null>(LB_NODES).fill(null);
  for (const piece of visible.pieces) {
    const at = lbCell(piece.node);
    if (at !== null) board[at] = piece.side === side ? { side: piece.side, rank: piece.rank } : { side: piece.side };
  }
  const [first] = lbLegalMoves(board, side);
  return first ? moveAction(first) : null;
}

/** A human who missed the deployment deadline gets the same automatic deployment as the 自動布陣 button. */
export function autoDeployAction(visible: LandBattleVisibleState, random: () => number): BotAction | null {
  return deploying(visible) ? deployAction(lbRandomLayout(random)) : null;
}
