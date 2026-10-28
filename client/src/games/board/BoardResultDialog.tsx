import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import type { BoardOutcome } from '@shared/rules/board/board-result';
import { useI18nStore } from '../../stores/i18n-store';
import { ResultDialog } from '../ResultDialog';
import type { ResultHistory } from '../ResultDialog';
import { useSeatName } from '../seat-names';
import { boardReasonLabel, boardResultTitle } from './board-result';
import styles from './BoardResultDialog.module.css';

/** End of a board match: who won, why, and how many moves it took; the board stays on its final position. */
export function BoardResultDialog({ outcome, viewer, moves, pending, error, disabled, onBack, history = null }: {
  readonly outcome: BoardOutcome;
  /** The viewer's own seat, or null for spectators. */
  readonly viewer: GameSeat | null;
  readonly moves: number;
  readonly pending: boolean;
  readonly error: string;
  readonly disabled?: boolean;
  readonly onBack: () => void;
  readonly history?: ResultHistory | null;
}): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const { title, tone } = boardResultTitle(outcome, viewer, seatName, t);
  return <ResultDialog title={title} tone={tone} pending={pending} error={error} disabled={disabled} onBack={onBack}
    history={history}>
    <p className={styles.reason}>{boardReasonLabel(outcome, t)}</p>
    <p className={styles.meta}>{t('board.resultMoves', { n: String(moves) })}</p>
  </ResultDialog>;
}
