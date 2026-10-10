// ─── TableSeat: compact seat info plate (avatar, name, key numbers, status) and card tray ───

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { useShallow } from 'zustand/react/shallow';
import type { Card, GameClock, Seat } from '@shared/types';
import { rpCardPoints, rpScore } from '@shared/rules/redpoints';
import { cardImageUrl } from '../cards';
import type { TranslationKey } from '../i18n';
import { remainingCards } from '../game-view';
import type { TablePosition } from '../game-view';
import { liarsDeckView } from '../games/liarsdeck/liarsdeck-view';
import { useGamePresentation } from '../games/use-game-presentation';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { PlayerLink } from './PlayerLink';
import { latestSeatAction, seatStatus, showsAutoPlayed } from './seat-status';
import type { SeatStatus } from './seat-status';
import { TurnClock } from './TurnClock';
import styles from './TableSeat.module.css';

const MAX_BACKS = 6;
const MAX_PILE = 6;

/** Red Points score chip that opens every captured card, since narrow trays hide most of the pile. */
function CapturedPoints({ cards, owner }: { cards: readonly Card[]; owner: string }): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const points = rpScore([...cards]);

  const close = (refocus: boolean): void => {
    restoreFocus.current = refocus;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const button = buttonRef.current;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && (dialogRef.current?.contains(event.target)
        || button?.contains(event.target))) return;
      restoreFocus.current = false;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      if (restoreFocus.current) button?.focus({ preventScroll: true });
    };
  }, [open]);

  return <>
    <button ref={buttonRef} type="button" className={`${styles.chip} ${styles.points} touch-target`} aria-expanded={open}
      aria-haspopup="dialog" title={t('redpoints.showCaptured')}
      onClick={(event) => {
        event.stopPropagation();
        if (open) close(false);
        else setOpen(true);
      }}>
      {t('redpoints.points', { n: String(points) })}
    </button>
    {open && <div ref={dialogRef} className={styles.capturedPopover} role="dialog" aria-labelledby={titleId}
      tabIndex={-1} onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Close only this popover, not the drawers underneath.
        event.stopPropagation();
        close(true);
      }}>
      <div className={styles.capturedHeader}>
        <h2 id={titleId} className={styles.capturedTitle}>
          {t('redpoints.capturedBy', { name: owner, n: String(points) })}
        </h2>
        <button type="button" className={`${styles.capturedClose} touch-target`} onClick={() => close(true)}
          aria-label={t('table.close')} title={t('table.close')}>✕</button>
      </div>
      {cards.length === 0 ? <p className={styles.capturedEmpty}>{t('redpoints.noCaptured')}</p>
        : <ul className={styles.capturedCards}>{cards.map((card) => (
          <li key={`${card.suit}-${card.rank}`} className={rpCardPoints(card) > 0 ? undefined : styles.capturedPlain}>
            <img className={styles.capturedCard} src={cardImageUrl(card)} draggable={false}
              alt={`${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`} />
          </li>
        ))}</ul>}
    </div>}
  </>;
}

type ActiveTurn = NonNullable<GameClock['turn']>;

/**
 * Turn time drawn as CSS animations: the turn allowance drains first, then the reserve
 * (own seat only; players see no other reserve).
 * Timing is fixed when the turn first renders (the parent keys it by turn id), because
 * changing animation delays later would jump the running animation.
 */
function TurnBar({ turn, bankMs, serverNow, receivedAt }: {
  turn: ActiveTurn; bankMs: number; serverNow: number | undefined; receivedAt: number;
}): ReactNode {
  const [initial] = useState(() => ({ turn, bankMs, serverNow, receivedAt }));
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const now = Date.now();
    const projectedNow = initial.serverNow === undefined ? now
      : initial.serverNow + Math.max(0, now - initial.receivedAt);
    const startsIn = initial.turn.startsAt - projectedNow;
    bar.style.setProperty('--base-ms', `${initial.turn.baseRemainingMs}ms`);
    bar.style.setProperty('--base-delay', `${startsIn}ms`);
    bar.style.setProperty('--bank-ms', `${initial.bankMs}ms`);
    bar.style.setProperty('--bank-delay', `${startsIn + initial.turn.baseRemainingMs}ms`);
  }, [initial]);
  return <span ref={ref} className={styles.turnBar} aria-hidden="true">
    {initial.bankMs > 0 && <span className={styles.turnBank} />}
    <span className={styles.turnBase} />
  </span>;
}

/**
 * Overlapping cards that always fit their tray: each card but the last sits in a slot that
 * shrinks before the row could overflow, so narrow seats overlap more instead of clipping.
 */
function CardTray({ count, render }: { count: number; render: (index: number) => ReactNode }): ReactNode {
  return <div className={styles.tray} style={{ '--tray-cards': count } as CSSProperties} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <span key={index} className={styles.cardSlot}>{render(index)}</span>)}
  </div>;
}

const STATUS_ICON: Record<SeatStatus, string> = {
  busted: '💥', locked: '🔒', thinking: '', autoPlayed: '⏱', arranged: '✓',
};
const STATUS_LABEL: Record<SeatStatus, TranslationKey> = {
  busted: 'ninetynine.busted',
  locked: 'bigtwo.locked',
  thinking: 'seat.thinking',
  autoPlayed: 'seat.autoPlayed',
  arranged: 'chinesepoker.arranged',
};

interface TableSeatProps {
  seat: Seat;
  position: TablePosition;
  /** Selectable seat (Ninety-Nine: choose the next player) */
  onPick?: () => void;
  /** Card this seat just played (a change replays the flash) */
  moveKey?: number | string;
  suppressTurn?: boolean;
}

export function TableSeat({ seat, position, onPick, moveKey, suppressTurn }: TableSeatProps): ReactNode {
  const { t } = useI18nStore();
  const player = useRoomStore((state) => state.roomInfo?.seats[seat].player ?? null);
  const isMe = useRoomStore((state) => state.mySeat === seat);
  const {
    phase, turn, declarer, dealer, playing, bigTwoCards, redPointsCards, ninetyNineCards, locked, captured, busted,
    sevensCards, sevensCovered, chinesePokerCards, arranging, arranged, autoArranged,
  } = useGameStore(useShallow((state) => ({
    sevensCards: state.sevens?.handCounts[seat] ?? null,
    sevensCovered: state.sevens?.coveredCounts[seat] ?? null,
    chinesePokerCards: state.chinesePoker ? state.chinesePoker.phase === 'arranging' ? 13 : 0 : null,
    arranging: state.chinesePoker?.phase === 'arranging' && !state.chinesePoker.submitted[seat],
    arranged: state.chinesePoker?.phase === 'arranging' && state.chinesePoker.submitted[seat],
    autoArranged: state.chinesePoker?.autoArranged.includes(seat) ?? false,
    ninetyNineCards: state.ninetyNine?.handCounts[seat] ?? null,
    busted: state.ninetyNine?.eliminated.includes(seat) ?? false,
    phase: state.phase,
    turn: state.currentTurnSeat === seat,
    declarer: state.contract?.declarer === seat,
    dealer: state.dealerSeat === seat,
    playing: state.playing,
    bigTwoCards: state.bigTwo?.handCounts[seat] ?? null,
    redPointsCards: state.redPoints?.handCounts[seat] ?? null,
    locked: state.bigTwo?.phase === 'playing' && state.bigTwo.lockedSeats.includes(seat),
    captured: state.redPoints?.captured[seat] ?? null,
  })));
  const liarsDeck = useGameStore((state) => state.liarsDeck);
  const { frame } = useGamePresentation();
  // Liar's Deck seats follow the presentation so a trigger pull is not revealed before its suspense ends.
  const liars = liarsDeck && liarsDeckView(liarsDeck, frame);
  const dead = liars?.eliminated.includes(seat) ?? false;
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const lastActionAt = useGameStore((state) => latestSeatAction(state.visible?.log ?? [], seat));
  const active = !suppressTurn && turn && (phase === 'bidding' || phase === 'playing');
  const status = seatStatus({
    busted: busted || dead,
    locked,
    thinking: (active || arranging) && Boolean(player?.isBot),
    autoPlayed: autoArranged || showsAutoPlayed(clock, seat, lastActionAt),
    arranged,
  });
  const cards = bigTwoCards ?? redPointsCards ?? ninetyNineCards ?? sevensCards ?? chinesePokerCards
    ?? liars?.handCounts[seat] ?? remainingCards(seat, playing);
  const name = player?.nickname ?? t(`seat.${seat}`);
  const bottom = position === 'bottom';
  const redCards = captured?.filter((card) => rpCardPoints(card) > 0).slice(-MAX_PILE) ?? [];
  const clockTurn = active && clock?.turn?.seat === seat ? clock.turn : null;
  // Red Points shows captured red cards instead of card backs; the hand size stays a chip.
  const tray = captured ? redCards.length > 0 && <CardTray count={redCards.length} render={(index) => (
    <img className={styles.pileCard} src={cardImageUrl(redCards[index])} alt="" draggable={false} />
  )} /> : !bottom && cards > 0 && <CardTray count={Math.min(cards, MAX_BACKS)}
    render={() => <span className={styles.back} />} />;

  return (
    <div data-table-seat={position}
      className={`${styles.seat} ${styles[position]} ${active ? styles.turn : ''} ${busted || dead ? styles.out : ''} ${onPick ? styles.pickable : ''}`}
      role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} onClick={onPick}
      aria-label={onPick ? t('seat.pickNext', { name }) : undefined}
      onKeyDown={onPick ? (event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        // Space would otherwise scroll; Enter must not also activate a focused child.
        event.preventDefault();
        onPick();
      } : undefined}>
      <div className={styles.plate} data-seat-plate>
        <div className={styles.name}>
          {player ? <PlayerLink player={player} size="medium" />
            : <><span className={styles.emptyAvatar} aria-hidden="true" /><span className={styles.empty}>—</span></>}
          {isMe && <span className={styles.meTag}>{t('seat.meTag')}</span>}
        </div>
        <span className={styles.seatBadge} title={t(`seat.${seat}`)}>
          <span aria-hidden="true">{t(`seat.short.${seat}`)}</span>
          <span className={styles.srOnly}>{t(`seat.${seat}`)}</span>
        </span>
        <div className={styles.chips}>
          {captured && <CapturedPoints cards={captured} owner={name} />}
          {!bottom && cards > 0 && <span className={`${styles.chip} ${bigTwoCards !== null ? styles.bigCount : ''}`}>
            {t('table.cards', { n: String(cards) })}
          </span>}
          {sevensCovered !== null && sevensCovered > 0 && <span className={styles.chip}>
            {t('sevens.covered', { n: String(sevensCovered) })}
          </span>}
          {liars && <span className={`${styles.chip} ${liars.shots[seat] >= 4 ? styles.danger : ''}`}
            title={t('liarsdeck.shotsTitle', { n: String(liars.shots[seat]) })}>
            {t('liarsdeck.shots', { n: String(liars.shots[seat]) })}
          </span>}
          {declarer && <span className={`${styles.chip} ${styles.declarer}`}>{t('table.declarer')}</span>}
          {dealer && phase === 'bidding' && <span className={styles.chip}>{t('table.dealer')}</span>}
          <TurnClock seat={seat} showBank={isMe} />
        </div>
        {status && <span className={`${styles.status} ${styles[status]}`}
          title={status === 'autoPlayed' ? t('clock.autoPlayed') : undefined}>
          {STATUS_ICON[status] && <span className={styles.statusIcon} aria-hidden="true">
            {dead && status === 'busted' ? '💀' : STATUS_ICON[status]} </span>}
          {t(dead && status === 'busted' ? 'liarsdeck.dead' : STATUS_LABEL[status])}
        </span>}
        {active && <span className={styles.srOnly}>{isMe ? t('table.yourTurn') : t('table.turn')}</span>}
        {clockTurn && clock && <TurnBar key={clockTurn.id} turn={clockTurn} bankMs={isMe ? clock.bankRemainingMs[seat] : 0}
          serverNow={clock.serverNow} receivedAt={receivedAt} />}
        {moveKey !== undefined && <span key={moveKey} className={styles.moved} aria-hidden="true" />}
      </div>
      {tray}
    </div>
  );
}
