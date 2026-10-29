import type { LandBattleVisibleState } from '@shared/types';
import { LB_NODES, LB_PRESETS, LB_RANKS, lbBattle, lbCell, lbIsCamp, lbLegalMoves, lbRandomLayout } from '@shared/rules/landbattle';
import type { LbMove, LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import { landBattleKnowledge, movementKnowledge } from './landbattle-knowledge';
import type { LbKnowledge } from './landbattle-knowledge';
import { LB_VALUE, deployAction, moveAction, recentMoves, searchMoves, templateLayout } from './landbattle-search';

/** Score noise of the easy bot, in material points. */
const EASY_NOISE = 14;

/** What capturing the flag is worth against material. */
const FLAG_VALUE = 5_000;

/** Sampled worlds and clock limit of the synchronous hard move, which runs on the event loop. */
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

const advance = (side: LbSide, index: number): number => (side === 0 ? 11 - Math.floor(index / 5) : Math.floor(index / 5)) / 11;

/**
 * One-ply expected score of a move from the estimated identity odds: what a battle wins or loses on
 * average, plus a little for advancing and for reaching a camp.
 */
export function expectedScore(knowledge: LbKnowledge, move: LbMove): number {
  const rank = knowledge.board[move.from]!.rank!;
  const target = knowledge.board[move.to];
  const positional = (advance(knowledge.side, move.to) - advance(knowledge.side, move.from)) * (rank === 'engineer' ? 3 : 6)
    + (lbIsCamp(move.to) ? 3 : 0) - (lbIsCamp(move.from) ? 2 : 0);
  const odds = target && knowledge.odds.get(target.token);
  if (!odds) return positional;
  let expected = 0;
  for (const other of LB_RANKS) {
    const chance = odds[other];
    if (chance <= 0) continue;
    if (other === 'flag') {
      expected += chance * FLAG_VALUE;
      continue;
    }
    const outcome = lbBattle(rank, other);
    const gain = outcome === 'win' ? LB_VALUE[other] : outcome === 'lose' ? -LB_VALUE[rank] : LB_VALUE[other] - LB_VALUE[rank];
    expected += chance * gain;
  }
  return expected + positional;
}

function bestMove(knowledge: LbKnowledge, random: () => number): LbMove | null {
  let best: { move: LbMove; score: number } | null = null;
  for (const move of lbLegalMoves(knowledge.board, knowledge.side)) {
    const score = expectedScore(knowledge, move) + random() * EASY_NOISE;
    if (!best || score > best.score) best = { move, score };
  }
  return best?.move ?? null;
}

/**
 * Easy: a random legal deployment; in play, a one-ply guess that only knows what movement shows (a piece
 * that moved is no mine or flag), with plenty of noise. Also the move a player gets after running out of time.
 */
export function easyLandBattleAction(visible: LandBattleVisibleState, random: () => number): BotAction | null {
  if (deployingSide(visible) !== null) return deployAction(lbRandomLayout(random));
  if (!onTurn(visible)) return null;
  const knowledge = movementKnowledge(visible);
  const move = knowledge && bestMove(knowledge, random);
  return move ? moveAction(move) : landBattleFirstLegalAction(visible);
}

/**
 * Hard, synchronous: a template deployment, then the worker's sampled search with only a few worlds and a
 * short clock. Bot turns use the worker search instead; this serves only seats that are not on a bot's own
 * turn, so it must stay cheap.
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
