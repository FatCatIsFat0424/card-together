// ─── Board outcomes for the result dialog and the history list ───

import type { GameSeat } from '@shared/types';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import type { ResultSummary, Translate } from '../client-game';

export type BoardResultTone = 'win' | 'lose' | 'draw';

/** Title of the result dialog: from the viewer's side for players, the winner's name for spectators. */
export function boardResultTitle(
  outcome: BoardOutcome, viewer: GameSeat | null, name: (seat: GameSeat) => string, t: Translate,
): { readonly title: string; readonly tone: BoardResultTone } {
  if (outcome.winners.length === 0) return { title: t('board.resultDraw'), tone: 'draw' };
  if (viewer !== null && outcome.winners.includes(viewer)) return { title: t('board.resultWin'), tone: 'win' };
  if (viewer !== null) return { title: t('board.resultLose'), tone: 'lose' };
  return { title: t('board.resultWinner', { name: outcome.winners.map(name).join('、') }), tone: 'win' };
}

export function boardReasonLabel(outcome: BoardOutcome, t: Translate): string {
  return t(`board.reason.${outcome.reason}`);
}

/** History line for a board game (`ClientGame.result.summary`): winners and the reason, or the draw reason. */
export function boardResultSummary(outcome: BoardOutcome, t: Translate): ResultSummary {
  const reason = boardReasonLabel(outcome, t);
  return outcome.winners.length === 0
    ? { kind: 'text', text: `${t('board.resultDraw')} · ${reason}` }
    : { kind: 'winners', winners: outcome.winners, suffix: ` · ${reason}` };
}
