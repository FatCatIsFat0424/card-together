import type { BanqiVisibleState } from '@shared/games/banqi/types';
import { bqApplyMove, bqCell, bqFlips, bqMoves, bqMovesFrom, bqOpposite, bqRank } from '@shared/rules/banqi';
import type { BqMove } from '@shared/rules/banqi';
import type { BotAction } from './bot-decisions';
import { QUICK_CHECKS, QUICK_DEPTH, banqiAction, banqiState, searchBanqi } from './banqi-search';
import type { Choice } from './banqi-search';

/** Material by rank used to pick the juiciest safe capture. */
const VICTIM_VALUE: readonly number[] = [100, 60, 40, 30, 20, 35, 12];

type Pick = Choice;

const choose = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)];

/** Every action the seat has now, from its own view; empty when it is not their turn. */
function legalPicks(visible: BanqiVisibleState): Pick[] {
  const view = banqiState(visible);
  if (!view) return [];
  const { colour, rules } = view;
  if (colour === null) return bqFlips(visible.board).map((cell): Pick => ({ kind: 'flip', cell }));
  if (visible.chain !== null) {
    const from = bqCell(visible.chain);
    return [...(from === null ? [] : bqMovesFrom(visible.board, from, rules, true)).map((move): Pick => ({ kind: 'move', move })),
      { kind: 'stop' }];
  }
  return [...bqMoves(visible.board, colour, rules).map((move): Pick => ({ kind: 'move', move })),
    ...bqFlips(visible.board).map((cell): Pick => ({ kind: 'flip', cell }))];
}

/** A capture is safe when no face-up enemy piece can take the capturer on its new cell. */
function isSafeCapture(visible: BanqiVisibleState, move: BqMove): boolean {
  const view = banqiState(visible);
  if (!view || view.colour === null) return false;
  const after = bqApplyMove(visible.board, move).board;
  return !bqMoves(after, bqOpposite(view.colour), view.rules).some((reply) => reply.capture && reply.to === move.to);
}

/**
 * Easy: take a safe capture when there is one (the most valuable victim), otherwise flip, step, or attack a
 * face-down piece at random; a blind attack is never a known capture, so it counts with the flips.
 * Also the action a player gets after running out of time.
 */
export function easyBanqiAction(visible: BanqiVisibleState, random: () => number): BotAction | null {
  const picks = legalPicks(visible);
  if (picks.length === 0) return null;
  const captures = picks.filter((pick): pick is Extract<Pick, { kind: 'move' }> => pick.kind === 'move' && pick.move.capture);
  const safe = captures.filter((pick) => isSafeCapture(visible, pick.move));
  if (safe.length > 0) {
    const worth = (pick: Extract<Pick, { kind: 'move' }>): number => VICTIM_VALUE[bqRank(visible.board[pick.move.to])];
    const top = Math.max(...safe.map(worth));
    return banqiAction(choose(safe.filter((pick) => worth(pick) === top), random));
  }
  // Inside a chain the only other choice is to stop.
  if (visible.chain !== null) return banqiAction({ kind: 'stop' });
  const quiet = picks.filter((pick) => pick.kind === 'flip' || (pick.kind === 'move' && !pick.move.capture));
  return banqiAction(choose(quiet.length > 0 ? quiet : picks, random));
}

/**
 * Hard, synchronous: the same expectimax with a shallow depth and a small node budget. In a search game this
 * only serves seats that are not on a bot's own turn, so it must stay cheap.
 */
export function getBanqiBotAction(visible: BanqiVisibleState, random: () => number): BotAction | null {
  let checks = 0;
  return searchBanqi(visible, { maxDepth: QUICK_DEPTH, expired: () => ++checks > QUICK_CHECKS, random });
}

/** The first legal action: the last resort when the strategies keep failing. */
export function banqiFirstLegalAction(visible: BanqiVisibleState): BotAction | null {
  const picks = legalPicks(visible);
  const first = picks.find((pick) => pick.kind !== 'stop') ?? picks[0];
  return first ? banqiAction(first) : null;
}
