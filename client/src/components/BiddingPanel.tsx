// ─── BiddingPanel: bidding panel (pick a bid, then confirm) ───

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { BidAction, BidLevel, BidSuit, Seat } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { BidLabel } from './AuctionTable';
import {
  BID_LEVELS, BID_SUITS, currentCall, isBidHigher, isLevelAvailable, lowestAvailableLevel, recentCalls,
} from './bidding-choice';
import type { PendingCall } from './bidding-choice';

import styles from './BiddingPanel.module.css';

const RECENT_CALLS = 4;

function CallLabel({ action }: { action: BidAction }): ReactNode {
  const { t } = useI18nStore();
  return action.type === 'pass' ? <>{t('game.pass')}</> : <BidLabel level={action.level} suit={action.suit} />;
}

/** Last few calls; shown only where the auction table lives in a closed drawer. */
function RecentCalls(): ReactNode {
  const { t } = useI18nStore();
  const bids = useGameStore((state) => state.bidding?.bids);
  const calls = recentCalls(bids ?? [], RECENT_CALLS);
  if (calls.length === 0) return null;
  return <ol className={styles.recent} aria-label={t('bidding.recent')}>
    {calls.map((call, index) => <li key={`${bids?.length ?? 0}-${index}`} className={styles.recentCall}>
      <span className={styles.recentSeat}>{t(`seat.${call.seat}`)}</span>
      <span className={call.action.type === 'pass' ? styles.recentPass : undefined}>
        <CallLabel action={call.action} />
      </span>
    </li>)}
  </ol>;
}

/** Centre status while another seat is bidding. */
export function BiddingWaiting({ seat }: { seat: Seat | null }): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.waiting}>
    <div className={styles.waitingPill} role="status">
      {t('table.waitingBid', { seat: seat ? t(`seat.${seat}`) : '...' })}
    </div>
    <RecentCalls />
  </div>;
}

export function BiddingPanel({ disabled = false }: { disabled?: boolean }): ReactNode {
  const bidding = useGameStore((state) => state.bidding);
  const currentTurnSeat = useGameStore((state) => state.currentTurnSeat);
  const mySeat = useRoomStore((state) => state.mySeat);
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingCall | null>(null);
  const [levelPick, setLevelPick] = useState<{ auctionLength: number; level: BidLevel } | null>(null);

  const highestBid = bidding?.highestBid ?? null;
  const auctionLength = bidding?.bids.length ?? 0;
  const choice = currentCall(pending, auctionLength, highestBid);
  const pickedLevel = levelPick?.auctionLength === auctionLength && isLevelAvailable(levelPick.level, highestBid)
    ? levelPick.level : null;
  const level = choice?.type === 'bid' ? choice.level : pickedLevel ?? lowestAvailableLevel(highestBid);
  const blocked = disabled || sending;

  const submit = useCallback((action: BidAction): void => {
    setError('');
    setSending(true);
    socket.timeout(10000).emit('game:bid', { bid: action }, (timeout, response) => {
      setSending(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!response.success) setError(response.error ?? t('common.error'));
      else setPending(null);
    });
  }, [t]);

  if (mySeat === null || mySeat !== currentTurnSeat) return null;

  const sameCall = (action: BidAction): boolean => choice !== null && choice.type === action.type
    && (action.type === 'pass' || (choice.type === 'bid' && choice.level === action.level && choice.suit === action.suit));

  /** Second activation of the chosen call confirms it, matching two-step card play. */
  const choose = (action: BidAction): void => {
    if (blocked) return;
    if (sameCall(action)) submit(action);
    else setPending({ auctionLength, action });
  };

  const pickLevel = (next: BidLevel): void => {
    setLevelPick({ auctionLength, level: next });
    if (choice?.type === 'bid' && choice.level !== next) setPending(null);
  };

  return (
    <section className={styles.panel} aria-labelledby="bidding-panel-title">
      <div className={styles.header}>
        <span className={styles.title} id="bidding-panel-title">{t('table.yourBid')}</span>
        {highestBid && <span className={styles.highest}>
          {t('table.highest')} <BidLabel level={highestBid.level} suit={highestBid.suit} />
        </span>}
      </div>
      <RecentCalls />
      <div className={styles.levels} role="group" aria-label={t('bidding.level')}>
        {BID_LEVELS.map((value) => (
          <button key={value} type="button" className={styles.levelBtn}
            aria-pressed={level === value} disabled={blocked || !isLevelAvailable(value, highestBid)}
            onClick={() => pickLevel(value)}>
            {value}
          </button>
        ))}
      </div>
      <div className={styles.suits} role="group" aria-label={t('bidding.suit')}>
        {BID_SUITS.map((suit: BidSuit) => {
          const legal = level !== null && isBidHigher(level, suit, highestBid);
          const selected = choice?.type === 'bid' && choice.suit === suit;
          return (
            <button key={suit} type="button" className={styles.suitBtn} aria-pressed={selected}
              aria-label={level !== null ? `${level}${suit === 'nt' ? 'NT' : SUIT_SYMBOLS[suit]}` : undefined}
              disabled={blocked || !legal}
              onClick={() => level !== null && choose({ type: 'bid', level, suit })}>
              {level !== null ? <BidLabel level={level} suit={suit} /> : '—'}
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.passBtn} aria-pressed={choice?.type === 'pass'}
          disabled={blocked} onClick={() => choose({ type: 'pass' })}>
          {t('game.pass')}
        </button>
        <button type="button" className={styles.cancelBtn} disabled={blocked || !choice}
          onClick={() => setPending(null)}>
          {t('bidding.cancel')}
        </button>
        <button type="button" className={styles.confirmBtn} disabled={blocked || !choice}
          onClick={() => choice && submit(choice)}>
          {t('bidding.confirm')}{choice && <> <CallLabel action={choice} /></>}
        </button>
      </div>
      <p className={styles.hint} aria-live="polite">{choice ? t('bidding.confirmHint') : t('bidding.chooseHint')}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
