// ─── BiddingPanel: bidding panel (pick a bid, then confirm) ───

import { useCallback, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { BidLevel, BidSuit, GameSeat } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { BidLabel } from './AuctionTable';
import {
  BID_LEVELS, BID_SUITS, currentCall, isBidHigher, isLevelAvailable, lowestAvailableLevel, recentCalls,
} from './bidding-choice';
import type { AuctionAction, PendingCall } from './bidding-choice';

import styles from './BiddingPanel.module.css';

const RECENT_CALLS = 4;

interface AuctionCallEntry<L extends number> {
  readonly seat: GameSeat;
  readonly action: AuctionAction<L>;
}

function CallLabel({ action }: { action: AuctionAction<number> }): ReactNode {
  const { t } = useI18nStore();
  return action.type === 'pass' ? <>{t('game.pass')}</> : <BidLabel level={action.level} suit={action.suit} />;
}

/** Last few calls; shown only where the auction table lives in a closed drawer. */
function RecentCalls({ bids }: { bids: readonly AuctionCallEntry<number>[] }): ReactNode {
  const { t } = useI18nStore();
  const calls = recentCalls(bids, RECENT_CALLS);
  if (calls.length === 0) return null;
  return <ol className={styles.recent} aria-label={t('bidding.recent')}>
    {calls.map((call, index) => <li key={`${bids.length}-${index}`} className={styles.recentCall}>
      <span className={styles.recentSeat}>{t(`seat.${call.seat}`)}</span>
      <span className={call.action.type === 'pass' ? styles.recentPass : undefined}>
        <CallLabel action={call.action} />
      </span>
    </li>)}
  </ol>;
}

/** Centre status while another seat is bidding; Bridge reads its calls from the store. */
export function BiddingWaiting({ seat, bids }: {
  seat: GameSeat | null;
  bids?: readonly AuctionCallEntry<number>[];
}): ReactNode {
  const { t } = useI18nStore();
  const storeBids = useGameStore((state) => state.bidding?.bids);
  return <div className={styles.waiting}>
    <div className={styles.waitingPill} role="status">
      {t('table.waitingBid', { seat: seat ? t(`seat.${seat}`) : '...' })}
    </div>
    <RecentCalls bids={bids ?? storeBids ?? []} />
  </div>;
}

interface AuctionPanelProps<L extends number> {
  levels: readonly L[];
  bids: readonly AuctionCallEntry<L>[];
  highestBid: { readonly level: L; readonly suit: BidSuit } | null;
  disabled?: boolean;
  /** Sends the call and reports a localized error, or null on success. */
  onSubmit: (action: AuctionAction<L>, done: (error: string | null) => void) => void;
}

/** Level-and-suit auction controls shared by Bridge (1–7) and Napoleon (9–16). */
export function AuctionPanel<L extends number>({
  levels, bids, highestBid, disabled = false, onSubmit,
}: AuctionPanelProps<L>): ReactNode {
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingCall<L> | null>(null);
  const [levelPick, setLevelPick] = useState<{ auctionLength: number; level: L } | null>(null);

  const auctionLength = bids.length;
  const choice = currentCall(pending, auctionLength, highestBid);
  const pickedLevel = levelPick?.auctionLength === auctionLength && isLevelAvailable(levelPick.level, highestBid)
    ? levelPick.level : null;
  const level = choice?.type === 'bid' ? choice.level : pickedLevel ?? lowestAvailableLevel(highestBid, levels);
  const blocked = disabled || sending;

  const submit = useCallback((action: AuctionAction<L>): void => {
    setError('');
    setSending(true);
    onSubmit(action, (failure) => {
      setSending(false);
      if (failure) setError(failure);
      else setPending(null);
    });
  }, [onSubmit]);

  const sameCall = (action: AuctionAction<L>): boolean => choice !== null && choice.type === action.type
    && (action.type === 'pass' || (choice.type === 'bid' && choice.level === action.level && choice.suit === action.suit));

  /** Second activation of the chosen call confirms it, matching two-step card play. */
  const choose = (action: AuctionAction<L>): void => {
    if (blocked) return;
    if (sameCall(action)) submit(action);
    else setPending({ auctionLength, action });
  };

  const pickLevel = (next: L): void => {
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
      <RecentCalls bids={bids} />
      <div className={styles.levels} role="group" aria-label={t('bidding.level')}
        style={levels.length !== BID_LEVELS.length ? { '--level-count': levels.length } as CSSProperties : undefined}>
        {levels.map((value) => (
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
      <p className={styles.hint} aria-live="polite">{choice && t('bidding.confirmHint')}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}

export function BiddingPanel({ disabled = false }: { disabled?: boolean }): ReactNode {
  const bidding = useGameStore((state) => state.bidding);
  const currentTurnSeat = useGameStore((state) => state.currentTurnSeat);
  const mySeat = useRoomStore((state) => state.mySeat);
  const { t } = useI18nStore();

  const submit = useCallback((action: AuctionAction<BidLevel>, done: (error: string | null) => void): void => {
    socket.timeout(10000).emit('game:bid', { bid: action }, (timeout, response) => {
      if (timeout) done(t('auth.connectionError'));
      else if (!response.success) done(response.error ?? t('common.error'));
      else done(null);
    });
  }, [t]);

  if (mySeat === null || mySeat !== currentTurnSeat) return null;
  return <AuctionPanel levels={BID_LEVELS} bids={bidding?.bids ?? []} highestBid={bidding?.highestBid ?? null}
    disabled={disabled} onSubmit={submit} />;
}
