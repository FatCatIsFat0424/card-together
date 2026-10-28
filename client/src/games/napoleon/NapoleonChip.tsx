// ─── NapoleonChip: contract, Napoleon, the secretary once public, and side progress on the table toolbar ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { BidLabel } from '../../components/AuctionTable';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { seatLabel } from '../seat-names';
import { useGamePresentation } from '../use-game-presentation';
import { napoleonChip } from '../trick-chip';
import { napoleonCardText } from './napoleon-view';
import styles from '../TrickChip.module.css';

export function NapoleonChip(): ReactNode {
  const { t } = useI18nStore();
  const game = useGameStore((state) => state.napoleon);
  const { frame } = useGamePresentation();
  const chip = game ? napoleonChip(game, frame) : null;
  if (!chip) return null;
  const seat = (value: GameSeat): string => seatLabel(t, 'napoleon', value, true);
  const jokerName = (joker: 'big' | 'small'): string => t(`napoleon.joker.${joker}`);
  const { progress } = chip;
  const count = (value: number | null, target: number): string => `${value ?? '–'}/${target}`;
  return <span className={styles.chip} role="group" aria-label={t('napoleon.contractChip')}>
    <span className={styles.row}>
      {chip.bidding && <span className={styles.muted}>{t(chip.bid ? 'table.highest' : 'table.biddingNow')}</span>}
      {chip.bid && <span className={styles.contract}><BidLabel level={chip.bid.level} suit={chip.bid.suit} /></span>}
      {chip.napoleon && <span className={styles.role}>
        <span className={styles.muted}>{t('napoleon.napoleonShort')}</span> {seat(chip.napoleon)}
      </span>}
      {chip.secretary ? <span className={styles.role}>
        <span className={styles.muted}>{t('napoleon.secretaryShort')}</span> {seat(chip.secretary)}
      </span> : chip.secretaryCard && <span className={styles.role}>
        <span className={styles.muted}>{t('napoleon.secretaryShort')}</span>{' '}
        {napoleonCardText(chip.secretaryCard, jokerName)}
      </span>}
    </span>
    {progress && <span className={`${styles.row} ${styles.progress}`}>
      <span className={progress.napoleon === null ? styles.pending : undefined}>
        {t('napoleon.napoleonSide')} <span className={styles.count}>{count(progress.napoleon, progress.napoleonTarget)}</span>
      </span>
      <span className={progress.defenders === null ? styles.pending : undefined}>
        {t('napoleon.defenders')} <span className={styles.count}>
          {count(progress.defenders, progress.defenderTarget)}{progress.pendingDiscards && progress.defenders !== null ? '+' : ''}
        </span>
      </span>
    </span>}
  </span>;
}
