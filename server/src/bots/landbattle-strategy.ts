import type { LandBattleVisibleState } from '@shared/types';
import {
  LB_NODES, LB_PRESETS, LB_RANKS, lbBattle, lbCell, lbDestinations, lbIsCamp, lbLegalMoves, lbMobile, lbRandomLayout,
} from '@shared/rules/landbattle';
import type { LbMove, LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from './bot-decisions';
import { landBattleKnowledge, movementKnowledge } from './landbattle-knowledge';
import type { LbBotCell, LbKnowledge } from './landbattle-knowledge';
import { LB_VALUE, attackBonus, deployAction, lbRoadDistance, moveAction, templateLayout } from './landbattle-search';

/** Score noise of the easy bot, in material points. */
const EASY_NOISE = 14;

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

/** What losing the flag is worth against material. */
const FLAG_VALUE = 5_000;

/** Chance that an opponent piece attacking an own `rank` removes it (a trade counts half). */
function attackChance(knowledge: LbKnowledge, token: number, rank: LbRank): number {
  const odds = knowledge.odds.get(token);
  if (!odds) return 0;
  let chance = 0;
  for (const other of LB_RANKS) {
    if (!lbMobile(other) || odds[other] <= 0) continue;
    const outcome = lbBattle(other, rank);
    if (outcome === 'win') chance += odds[other];
    else if (outcome === 'tie') chance += odds[other] / 2;
  }
  return chance;
}

/** Expected loss of an own `rank` standing on `at`, from every opponent piece that could attack it next. */
function exposure(knowledge: LbKnowledge, board: readonly (LbBotCell | null)[], at: number, rank: LbRank): number {
  if (at < 0 || lbIsCamp(at)) return 0;
  let safe = 1;
  for (let from = 0; from < LB_NODES; from++) {
    const cell = board[from];
    if (cell && cell.side !== knowledge.side && lbDestinations(board, from).some((option) => option.to === at)) {
      safe *= 1 - attackChance(knowledge, cell.token, rank);
    }
  }
  return (1 - safe) * (rank === 'flag' ? FLAG_VALUE : LB_VALUE[rank]);
}

/** Material-scale danger of opponent pieces closing in on the own flag, by road distance (direct attacks aside). */
const APPROACH: readonly number[] = [0, 0, 40, 10];

/** Expected loss at the own flag: direct attacks plus pieces two or three stations away. */
function flagDanger(knowledge: LbKnowledge, board: readonly (LbBotCell | null)[], flag: number): number {
  if (flag < 0) return 0;
  let danger = exposure(knowledge, board, flag, 'flag');
  for (let at = 0; at < LB_NODES; at++) {
    const cell = board[at];
    const odds = cell && cell.side !== knowledge.side ? knowledge.odds.get(cell.token) : undefined;
    const distance = lbRoadDistance(at, flag);
    if (odds && distance < APPROACH.length) danger += APPROACH[distance] * (1 - odds.mine - odds.flag);
  }
  return danger;
}

/** Probability the own piece wins the battle on `move.to` and stands there afterwards. */
function survives(knowledge: LbKnowledge, move: LbMove, rank: LbRank): number {
  const target = knowledge.board[move.to];
  const odds = target && knowledge.odds.get(target.token);
  if (!odds) return 1;
  return LB_RANKS.reduce((sum, other) => sum + (other !== 'flag' && lbBattle(rank, other) === 'win' ? odds[other] : 0), 0);
}

/**
 * The expected score plus what the move does to danger: an own piece left where a likely stronger piece can
 * reach it, and any opening toward the own flag, count against it; escaping or removing a threat counts for.
 */
export function carefulScore(knowledge: LbKnowledge, move: LbMove, flag: number): number {
  const rank = knowledge.board[move.from]!.rank!;
  const kept = survives(knowledge, move, rank);
  const won = [...knowledge.board];
  won[move.from] = null;
  won[move.to] = knowledge.board[move.from];
  const lost = [...knowledge.board];
  lost[move.from] = null;
  const before = exposure(knowledge, knowledge.board, move.from, rank) + flagDanger(knowledge, knowledge.board, flag);
  const flagAfter = kept * flagDanger(knowledge, won, flag) + (kept < 1 ? (1 - kept) * flagDanger(knowledge, lost, flag) : 0);
  const after = kept * exposure(knowledge, won, move.to, rank) + flagAfter;
  return expectedScore(knowledge, move) - 0.7 * (after - before);
}

function bestMove(
  knowledge: LbKnowledge, random: () => number, noise: number, careful: boolean, quietMoves: number,
): LbMove | null {
  const flag = knowledge.board.findIndex((cell) => cell?.side === knowledge.side && cell.rank === 'flag');
  let best: { move: LbMove; score: number } | null = null;
  for (const move of lbLegalMoves(knowledge.board, knowledge.side)) {
    const bonus = careful && knowledge.board[move.to] ? attackBonus(knowledge.board[move.from]!.rank!, quietMoves) : 0;
    const score = (careful ? carefulScore(knowledge, move, flag) : expectedScore(knowledge, move)) + bonus + random() * noise;
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
  const move = knowledge && bestMove(knowledge, random, EASY_NOISE, false, visible.quietMoves);
  return move ? moveAction(move) : landBattleFirstLegalAction(visible);
}

/**
 * Hard, synchronous: a template deployment, then the one-ply careful score with full inference from public
 * battle outcomes. Bot turns use the worker search instead; this serves only seats that are not on a bot's
 * own turn, so it must stay cheap.
 */
export function getLandBattleBotAction(visible: LandBattleVisibleState, random: () => number): BotAction | null {
  if (deployingSide(visible) !== null) return deployAction(templateLayout(random));
  if (!onTurn(visible)) return null;
  const knowledge = landBattleKnowledge(visible);
  const move = knowledge && bestMove(knowledge, random, 0.01, true, visible.quietMoves);
  return move ? moveAction(move) : landBattleFirstLegalAction(visible);
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
