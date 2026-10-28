// ─── Parts of the Hold'em table that Five-Card Stud shares: the pot list and the final standings ───

import type { ReactNode } from 'react';
import type { HoldemMatchResult } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { AppIcon } from '../../components/AppIcon';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { useResultRoundHistory } from '../RoundHistory';
import { joinNames, useSeatName } from '../seat-names';
import { ChipAmount } from './HoldemCards';
import { usePotLabel } from './HoldemFrame';
import { potLines, potTotal, rankHoldem, signedChips } from './holdem-view';
import type { BettingTableView } from './holdem-view';
import styles from './HoldemTable.module.css';

const toneClass = (value: number): string | undefined => value > 0 ? styles.gain : value < 0 ? styles.loss : undefined;


export function PotList({ view }: { view: BettingTableView }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const potLabel = usePotLabel();
  const lines = potLines(view);
  const total = view.award ? lines.reduce((sum, line) => sum + line.amount, 0) : potTotal(view);
  return <div className={styles.pots}>
    <strong className={styles.potTotal}>{t('holdem.pot')} <ChipAmount amount={total} /></strong>
    {(lines.length > 1 || view.award) && <ul className={styles.potLines}>{lines.map((line, index) => <li key={index}>
      {potLabel(line, index, lines.length)} <ChipAmount amount={line.amount} />
      {line.winners.length > 0 && !line.returned && <> → {line.winners.map(seatName).join(' · ')}</>}
    </li>)}</ul>}
  </div>;
}

export function MatchResultOverlay({ result, pending, error, disabled, onBack }: {
  result: Pick<HoldemMatchResult, 'seats' | 'chips' | 'winners' | 'eliminationOrder' | 'hands'>; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const history = useResultRoundHistory(useGameStore((state) => state.visible));
  const seatName = useSeatName();
  return <ResultDialog history={history} title={t('holdem.winner', { names: joinNames(result.winners.map(seatName), locale) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('holdem.rank')}</th><th>{t('holdem.player')}</th>
        <th>{t('holdem.chipsColumn')}</th><th>{t('holdem.net')}</th>
      </tr></thead>
      <tbody>{rankHoldem(result).map((row) => (
        <tr key={row.seat} className={row.winner ? resultStyles.winnerRow : ''}>
          <td>{t('holdem.place', { n: String(row.place) })}</td>
          <td>{row.winner && <><AppIcon name="trophy" /> </>}{seatName(row.seat)}</td>
          <td>{row.eliminated ? t('holdem.out') : row.chips}</td>
          <td className={toneClass(row.net)}>{signedChips(row.net)}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('holdem.handsPlayed', { n: String(result.hands) })}</p>
  </ResultDialog>;
}
