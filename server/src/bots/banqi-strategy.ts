import type { BanqiVisibleState } from '@shared/games/banqi/types';
import { bqCell, bqFlips, bqMoves, bqMovesFrom } from '@shared/rules/banqi';
import type { BotAction } from './bot-decisions';
import { QUICK_CHECKS, QUICK_DEPTH, banqiAction, banqiState, searchBanqi } from './banqi-search';
import type { Choice } from './banqi-search';

type Pick = Choice;

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

/**
 * Synchronous fallback: the same expectimax with a shallow depth and a small node budget, cheap enough for the
 * event loop when no worker pool decides.
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
