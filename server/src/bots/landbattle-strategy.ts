import type { LandBattleVisibleState } from '@shared/types';
import { LB_NODES, LB_PRESETS, lbCell, lbLegalMoves, lbRandomLayout } from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import { landBattleKnowledge } from './landbattle-knowledge';
import { deployAction, moveAction, recentMoves, searchMoves, templateLayout } from './landbattle-search';

/** Sampled worlds and clock limit of the synchronous fallback move, which runs on the event loop. */
const QUICK_SAMPLES = 24;
const QUICK_BUDGET_MS = 60;

/** The seat's side while it still owes a deployment, otherwise null. */
function deployingSide(visible: LandBattleVisibleState): LbSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'deploying' || visible.myLayout ? null : side === 0 ? 0 : 1;
}

function onTurn(visible: LandBattleVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat && visible.seats.includes(visible.mySeat);
}

/**
 * Synchronous: a template deployment, then the worker's sampled search with only a few worlds and a short
 * clock. Turns use the worker search when a pool runs; this fallback must stay cheap for the event loop.
 */
export function getLandBattleBotAction(visible: LandBattleVisibleState, random: () => number): BotAction | null {
  if (deployingSide(visible) !== null) return deployAction(templateLayout(random));
  if (!onTurn(visible)) return null;
  const knowledge = landBattleKnowledge(visible);
  const deadline = performance.now() + QUICK_BUDGET_MS;
  const found = knowledge && searchMoves(
    knowledge, random, () => performance.now() >= deadline, QUICK_SAMPLES, visible.quietMoves, recentMoves(visible),
  );
  return found ? moveAction(found.move) : landBattleFirstLegalAction(visible);
}

/** The first preset or the first legal move in board order: the last resort when the strategies keep failing. */
export function landBattleFirstLegalAction(visible: LandBattleVisibleState): BotAction | null {
  if (deployingSide(visible) !== null) return deployAction(LB_PRESETS[0]);
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
  return deployingSide(visible) === null ? null : deployAction(lbRandomLayout(random));
}
