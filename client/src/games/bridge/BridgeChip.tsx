// ─── BridgeChip: contract, declarer and each side's tricks toward its target, always visible on the table toolbar ───

import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BidLabel } from '../../components/AuctionTable';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useRoomStore } from '../../stores/room-store';
import { seatLabel } from '../seat-names';
import { bridgeChip } from '../trick-chip';
import { TrickBar } from '../TrickBar';
import styles from '../TrickChip.module.css';

export function BridgeChip(): ReactNode {
  const { t } = useI18nStore();
  const mySeat = useRoomStore((state) => state.mySeat);
  const input = useGameStore(useShallow((state) => ({
    phase: state.phase,
    contract: state.contract,
    highestBid: state.bidding?.highestBid ?? null,
    ns: state.playing?.trickCountNS ?? null,
    ew: state.playing?.trickCountEW ?? null,
  })));
  const { ns, ew, ...rest } = input;
  const chip = bridgeChip({ ...rest, tricks: ns === null || ew === null ? null : { ns, ew }, mySeat });
  if (!chip) return null;
  const sideLabel = { ours: t('table.teamUs'), theirs: t('table.teamThem'), ns: t('table.teamNS'), ew: t('table.teamEW') };
  return <span className={styles.chip} role="group" aria-label={t('table.contractChip')}>
    <span className={styles.row}>
      {chip.bidding && <span className={styles.muted}>{t(chip.bid ? 'table.highest' : 'table.biddingNow')}</span>}
      {chip.bid && <span className={styles.contract}><BidLabel level={chip.bid.level} suit={chip.bid.suit} /></span>}
      {chip.declarer && <span className={styles.role}>
        <span className={styles.muted}>{t('table.declarer')}</span> {seatLabel(t, 'bridge', chip.declarer)}
      </span>}
    </span>
    {chip.sides.length > 0 && <span className={styles.bars} data-trick-bars>
      {chip.sides.map((side) => <TrickBar key={side.team} label={sideLabel[side.team]} count={side.tricks}
        target={side.target} tone={side.team === 'ours' || side.team === 'ns' ? 'ours' : 'theirs'} />)}
    </span>}
  </span>;
}
