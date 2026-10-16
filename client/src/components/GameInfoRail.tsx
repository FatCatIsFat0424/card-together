import { isCompassSeat } from '@shared/rules/seats';
// ─── GameInfoRail: left info rail (contract, tricks, trick history, auction) ───

import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CONTRACT_BASE_TRICKS, TOTAL_TRICKS } from '@shared/constants';
import type { Seat } from '@shared/types';
import type { AuctionCall } from '../game-view';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { AuctionTable, BidLabel } from './AuctionTable';
import styles from './GameInfoRail.module.css';
import { TrickHistory } from '../games/bridge/TrickHistory';

function Pips({ count, target, team }: { count: number; target: number; team: 'ns' | 'ew' }): ReactNode {
  return <span className={styles.pips}>
    {Array.from({ length: target }, (_, i) => (
      <span key={i} className={`${styles.pip} ${i < count ? styles[team] : ''}`} />
    ))}
  </span>;
}

export function GameInfoRail(): ReactNode {
  const { t } = useI18nStore();
  const mySeat = useRoomStore((state) => ['N', 'E', 'S', 'W'].includes(state.mySeat ?? '') ? state.mySeat as Seat : null);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const { phase, bidding, dealerSeat, currentTurnSeat, contract, playing } = useGameStore(useShallow((state) => ({
    phase: state.phase,
    bidding: state.bidding,
    dealerSeat: state.dealerSeat,
    currentTurnSeat: state.currentTurnSeat,
    contract: state.contract,
    playing: state.playing,
  })));
  const seatLabel = (seat: Seat): string => t(`seat.${seat}`);
  const calls: readonly AuctionCall[] = bidding?.bids ?? [];

  const needed = contract ? contract.level + CONTRACT_BASE_TRICKS : 0;
  const declarerNS = contract?.declarer === 'N' || contract?.declarer === 'S';
  const targetNS = declarerNS ? needed : TOTAL_TRICKS + 1 - needed;
  const targetEW = declarerNS ? TOTAL_TRICKS + 1 - needed : needed;
  const declarerName = contract && roomInfo?.seats[contract.declarer].player?.nickname;

  return (
    <aside className={styles.rail}>
      <section className={styles.box}>
        <h2 className={styles.caption}>{t('game.contract')}</h2>
        {contract ? <>
          <div className={styles.contractMain}>
            <span className={styles.big}><BidLabel level={contract.level} suit={contract.suit} /></span>
            <span className={styles.meta}>
              <span className={styles.badge}>{t('table.declarer')}</span> {seatLabel(contract.declarer)}
              {declarerName && <> {declarerName}</>}
            </span>
          </div>
          <div className={styles.kv}>{t('table.needs', { n: String(needed) })}</div>
        </> : <div className={styles.kv}>
          {phase === 'bidding' && <span className={styles.status}>{t('table.biddingNow')}</span>}
          {dealerSeat && <span>{t('table.dealerIs', { seat: seatLabel(dealerSeat as Seat) })}</span>}
        </div>}
      </section>

      {contract && <section className={styles.box}>
        <h2 className={styles.caption}>{t('table.tricks')}</h2>
        <div className={styles.scoreRow}>
          <span className={`${styles.team} ${styles.nsText}`}>{t('table.teamNS')}</span>
          <Pips count={playing?.trickCountNS ?? 0} target={targetNS} team="ns" />
          <span className={`${styles.count} ${styles.nsText}`}>{playing?.trickCountNS ?? 0}</span>
        </div>
        <div className={styles.scoreRow}>
          <span className={`${styles.team} ${styles.ewText}`}>{t('table.teamEW')}</span>
          <Pips count={playing?.trickCountEW ?? 0} target={targetEW} team="ew" />
          <span className={`${styles.count} ${styles.ewText}`}>{playing?.trickCountEW ?? 0}</span>
        </div>
        <p className={styles.note}>
          {t('table.target', { team: t('table.teamNS'), n: String(targetNS) })} · {t('table.target', {
            team: t('table.teamEW'), n: String(targetEW) })}
        </p>
      </section>}

      <TrickHistory tricks={playing?.completedTricks ?? []} mySeat={mySeat} declarer={contract?.declarer ?? null}
        className={styles.box} summaryClassName={styles.caption} />

      <section className={`${styles.box} ${styles.auction}`}>
        <h2 className={styles.caption}>{t('table.auction')}</h2>
        <div className={styles.scroll}>
          <AuctionTable calls={calls} mySeat={mySeat}
            toAct={phase === 'bidding' && currentTurnSeat && isCompassSeat(currentTurnSeat) ? currentTurnSeat : null} />
        </div>
      </section>
    </aside>
  );
}
