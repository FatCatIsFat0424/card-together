import { gameSeatValue, isCompassSeat, roomSeatInfo } from '@shared/rules/seats';
// ─── TableSeat: avatar-first seat (avatar, seat-framed name pill, key numbers, status) and card tray ───

import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { useShallow } from 'zustand/react/shallow';
import type { Card, GameClock, GameSeat } from '@shared/types';
import { rpCardPoints, rpScore } from '@shared/rules/redpoints';
import { useCardFaceUrl } from '../cosmetics/card-faces/use-card-face';
import { seatBackgroundStyle } from '../account-appearance';
import { SeatFrame, seatFrameHostClass } from '../cosmetics/seat-frames/SeatFrame';
import type { TranslationKey } from '../i18n';
import { latestCallIndex, remainingCards } from '../game-view';
import type { TablePosition } from '../game-view';
import { liarsDeckView } from '../games/liarsdeck/liarsdeck-view';
import { blackjackSeatOut, blackjackView } from '../games/blackjack/blackjack-view';
import { ChipIcon } from '../games/ChipIcon';
import { clientGame } from '../games/registry';
import { holdemBlindSeats, holdemView, seatState } from '../games/holdem/holdem-view';
import { BetStack } from '../games/holdem/HoldemCards';
import { useGamePresentation } from '../games/use-game-presentation';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useI18nStore } from '../stores/i18n-store';
import { seatLabel } from '../games/seat-names';
import { useRoomStore } from '../stores/room-store';
import { napoleonPresentedPoints, napoleonSeatLabels } from '../games/napoleon/napoleon-view';
import { ObservedCards, ObservedLiarCards, ObservedNapoleonCards } from './ObservedHand';
import { Avatar } from './Avatar';
import { latestSeatAction, seatStatus, showsAutoPlayed } from './seat-status';
import type { SeatStatus } from './seat-status';
import type { AppIconName } from './AppIcon';
import { TurnClock } from './TurnClock';
import { BidLabel } from './AuctionTable';
import { AppIcon } from './AppIcon';
import styles from './TableSeat.module.css';
import { CardBackArt } from '../cosmetics/art-layers/CardBackArt';

// Loaded on first open: the card fetches history and friends, which plates never need.
const PlayerCard = lazy(() => import('./PlayerCard').then((module) => ({ default: module.PlayerCard })));

const MAX_BACKS = 6;
const MAX_PILE = 6;

/** Opens a complete card pile without expanding the seat plate or overlapping the table. */
function CardPileDetails({ cards, owner, covered = false }: {
  cards: readonly Card[]; owner: string; covered?: boolean;
}): ReactNode {
  const cardImageUrl = useCardFaceUrl();
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
    <button ref={buttonRef} type="button" className={`${styles.stat} ${covered ? styles.covered : styles.points} touch-target`}
      aria-expanded={open} aria-haspopup="dialog"
      aria-label={covered ? t('sevens.showCovered', { name: owner }) : undefined}
      title={covered ? t('sevens.showCovered', { name: owner }) : t('redpoints.showCaptured')}
      onClick={(event) => {
        event.stopPropagation();
        if (open) close(false);
        else setOpen(true);
      }}>
      {t(covered ? 'sevens.covered' : 'redpoints.points', { n: String(covered ? cards.length : points) })}
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
          {t(covered ? 'sevens.coveredBy' : 'redpoints.capturedBy', { name: owner, n: String(points) })}
        </h2>
        <button type="button" className={`${styles.capturedClose} touch-target`} onClick={() => close(true)}
          aria-label={t('table.close')} title={t('table.close')}><AppIcon name="close" /></button>
      </div>
      {cards.length === 0 ? <p className={styles.capturedEmpty}>{t('redpoints.noCaptured')}</p>
        : <ul className={styles.capturedCards}>{cards.map((card) => (
          <li key={`${card.suit}-${card.rank}`} className={covered || rpCardPoints(card) > 0 ? undefined : styles.capturedPlain}>
            <img className={styles.capturedCard} src={cardImageUrl(card)} draggable={false}
              alt={`${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`} />
          </li>
        ))}</ul>}
    </div>}
  </>;
}

type ActiveTurn = NonNullable<GameClock['turn']>;

/**
 * Turn time as a ring around the avatar, drawn with compositor animations: the turn allowance drains
 * first, then the reserve (own seat only; players see no other reserve). Each half of the ring is a
 * semicircular arc that rotates out of its clipped half, so only `transform` and `opacity` change.
 * Timing is fixed when the turn first renders (the parent keys it by turn id), because
 * changing animation delays later would jump the running animation.
 */
const ARC_START = 'rotate(45deg)';
const ARC_END = 'rotate(-135deg)';

function TurnRing({ turn, bankMs, serverNow, receivedAt }: {
  turn: ActiveTurn; bankMs: number; serverNow: number | undefined; receivedAt: number;
}): ReactNode {
  const [initial] = useState(() => ({ turn, bankMs, serverNow, receivedAt }));
  const ref = useRef<HTMLSpanElement>(null);
  const bankLeft = useRef<HTMLSpanElement>(null);
  const bankRight = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const ring = ref.current;
    if (!ring) return;
    const now = Date.now();
    const projectedNow = initial.serverNow === undefined ? now
      : initial.serverNow + Math.max(0, now - initial.receivedAt);
    const startsIn = initial.turn.startsAt - projectedNow;
    const baseMs = initial.turn.baseRemainingMs;
    ring.style.setProperty('--base-ms', `${baseMs}ms`);
    ring.style.setProperty('--base-delay', `${startsIn}ms`);
    const left = bankLeft.current;
    const right = bankRight.current;
    // Reduced motion hides the ring; an animation nobody can see would run on the main thread.
    if (!left || !right || typeof left.animate !== 'function' || getComputedStyle(ring).display === 'none') return;
    // The reserve stays hidden until the allowance runs out, then drains over the two halves in turn.
    // An invisible element waiting to appear could not run on the compositor, so opacity switches with the keyframes.
    const total = baseMs + initial.bankMs;
    const split = baseMs / total;
    const middle = split + (1 - split) / 2;
    const options = { duration: total, delay: startsIn, fill: 'both' } as const;
    const animations = [
      left.animate([
        { offset: 0, opacity: 0, transform: ARC_START },
        { offset: split, opacity: 0, transform: ARC_START },
        { offset: split, opacity: 1, transform: ARC_START },
        { offset: middle, opacity: 1, transform: ARC_END },
        { offset: 1, opacity: 1, transform: ARC_END },
      ], options),
      right.animate([
        { offset: 0, opacity: 0, transform: ARC_START },
        { offset: split, opacity: 0, transform: ARC_START },
        { offset: split, opacity: 1, transform: ARC_START },
        { offset: middle, opacity: 1, transform: ARC_START },
        { offset: 1, opacity: 1, transform: ARC_END },
      ], options),
    ];
    return () => animations.forEach((animation) => animation.cancel());
  }, [initial]);
  return <span ref={ref} className={styles.timer} aria-hidden="true">
    <span className={`${styles.half} ${styles.leftHalf}`}><span className={`${styles.arc} ${styles.baseArc}`} /></span>
    <span className={`${styles.half} ${styles.rightHalf}`}><span className={`${styles.arc} ${styles.baseArc}`} /></span>
    {initial.bankMs > 0 && <>
      <span className={`${styles.half} ${styles.leftHalf}`}>
        <span ref={bankLeft} className={`${styles.arc} ${styles.bankArc}`} /></span>
      <span className={`${styles.half} ${styles.rightHalf}`}>
        <span ref={bankRight} className={`${styles.arc} ${styles.bankArc}`} /></span>
    </>}
  </span>;
}

/**
 * Overlapping cards that always fit their tray: each card but the last sits in a slot that
 * shrinks before the row could overflow, so narrow seats overlap more instead of clipping.
 */
function CardTray({ count, kind, render }: {
  count: number; kind: 'backs' | 'captured'; render: (index: number) => ReactNode;
}): ReactNode {
  return <div className={styles.tray} style={{ '--tray-cards': count } as CSSProperties} aria-hidden="true" data-seat-tray={kind}>
    {Array.from({ length: count }, (_, index) => <span key={index} className={styles.cardSlot}>{render(index)}</span>)}
  </div>;
}

const STATUS_ICON: Record<SeatStatus, AppIconName | ''> = {
  busted: 'burst', locked: 'lock', thinking: '', autoPlayed: 'timer', arranged: 'check',
};
const STATUS_LABEL: Record<SeatStatus, TranslationKey> = {
  busted: 'ninetynine.busted',
  locked: 'bigtwo.locked',
  thinking: 'seat.thinking',
  autoPlayed: 'seat.autoPlayed',
  arranged: 'chinesepoker.arranged',
};

interface TableSeatProps {
  seat: GameSeat;
  position: TablePosition;
  /** Selectable seat (Ninety-Nine: choose the next player) */
  onPick?: () => void;
  onObserve?: () => void;
  /** Card this seat just played (a change replays the flash) */
  moveKey?: number | string;
  suppressTurn?: boolean;
}

interface RoleLabel {
  readonly key: string;
  readonly label: string;
  readonly tone: string;
  readonly title?: string;
}

export function TableSeat({ seat, position, onPick, onObserve, moveKey, suppressTurn }: TableSeatProps): ReactNode {
  const cardImageUrl = useCardFaceUrl();
  const { t } = useI18nStore();
  const player = useRoomStore((state) => state.roomInfo ? roomSeatInfo(state.roomInfo, seat)?.player ?? null : null);
  const isMe = useRoomStore((state) => state.mySeat === seat);
  const [cardAnchor, setCardAnchor] = useState<HTMLElement | null>(null);
  const {
    phase, turn, declarer, dealer, playing, bigTwoCards, redPointsCards, ninetyNineCards, locked, captured, busted,
    sevensCards, sevensCovered, chinesePokerCards, arranging, arranged, autoArranged, blackjackCards, holdemCards,
    napoleonCards,
  } = useGameStore(useShallow((state) => ({
    sevensCards: gameSeatValue(state.sevens?.handCounts, seat) ?? null,
    // Blackjack hands are drawn face up on the table, so the plate shows no card backs.
    blackjackCards: state.blackjack ? 0 : null,
    // Hold'em hole cards are drawn on the felt, so the plate shows no card backs either.
    holdemCards: state.holdem ? 0 : null,
    napoleonCards: state.napoleon ? gameSeatValue(state.napoleon.handCounts, seat) ?? 0 : null,
    sevensCovered: gameSeatValue(state.sevens?.coveredCounts, seat) ?? null,
    chinesePokerCards: state.chinesePoker ? state.chinesePoker.phase === 'arranging' ? 13 : 0 : null,
    arranging: state.chinesePoker?.phase === 'arranging' && !gameSeatValue(state.chinesePoker.submitted, seat),
    arranged: state.chinesePoker?.phase === 'arranging' && gameSeatValue(state.chinesePoker.submitted, seat),
    autoArranged: (isCompassSeat(seat) && state.chinesePoker?.autoArranged.includes(seat)) ?? false,
    ninetyNineCards: gameSeatValue(state.ninetyNine?.handCounts, seat) ?? null,
    busted: state.ninetyNine?.eliminated.includes(seat) ?? false,
    phase: state.phase,
    turn: state.currentTurnSeat === seat,
    declarer: state.contract?.declarer === seat,
    dealer: state.dealerSeat === seat,
    playing: state.playing,
    bigTwoCards: gameSeatValue(state.bigTwo?.handCounts, seat) ?? null,
    redPointsCards: gameSeatValue(state.redPoints?.handCounts, seat) ?? null,
    locked: state.bigTwo?.phase === 'playing' && isCompassSeat(seat) && state.bigTwo.lockedSeats.includes(seat),
    captured: gameSeatValue(state.redPoints?.captured, seat) ?? null,
  })));
  const liarsDeck = useGameStore((state) => state.liarsDeck);
  const { frame } = useGamePresentation();
  // Liar's Deck seats follow the presentation so a trigger pull is not revealed before its suspense ends.
  const liars = liarsDeck && liarsDeckView(liarsDeck, frame);
  const dead = (isCompassSeat(seat) && liars?.eliminated.includes(seat)) ?? false;
  const blackjack = useGameStore((state) => state.blackjack);
  // Blackjack chips follow the presentation so a settlement is not paid out before its frame.
  const bj = blackjack && blackjackView(blackjack, frame);
  const sittingOut = bj ? blackjackSeatOut(bj, seat) : false;
  const bettingOpen = Boolean(bj?.betting && blackjack?.betDeadline !== null && !sittingOut);
  const betPlaced = bettingOpen && Boolean(blackjack?.betPlaced[seat]);
  const holdem = useGameStore((state) => state.holdem);
  // Hold'em chips and seat states follow the presentation so a pot is not paid out before its frame.
  const he = holdem && holdemView(holdem, frame);
  const heState = he ? seatState(he, seat) : null;
  const heBlinds = he ? holdemBlindSeats(he) : null;
  const heOut = heState === 'out';
  // The own stake sits beside the hole cards instead (see the Hold'em hand zone).
  const heBet = he && !isMe && heState !== 'waiting' && heState !== 'out' ? he.streetBets[seat] ?? 0 : 0;
  const heLocked = heState === 'folded' || heState === 'allIn';
  const observedCards = useGodViewStore((state) => state.hands?.[seat]);
  const observedLiars = useGodViewStore((state) => state.liarHands?.[seat]);
  const observedNapoleon = useGodViewStore((state) => state.napoleonHands?.[seat]);
  const napoleon = useGameStore((state) => state.napoleon);
  const gameType = useGameStore((state) => state.visible?.gameType);
  // Napoleon roles and won points follow the presentation, so a secretary is not unmasked early.
  const napoleonLabels = napoleon && napoleonSeatLabels(napoleon, frame);
  const napoleonPoints = napoleon && (napoleon.phase === 'playing' || napoleon.phase === 'scoring')
    ? napoleonPresentedPoints(napoleon, frame)[seat] ?? 0 : null;
  const napoleonReviewed = napoleon?.phase === 'reviewing' && napoleon.contract?.napoleon !== seat
    && napoleon.reviewed.includes(seat);
  const observedCovered = useGodViewStore((state) => state.role === 'spectator' ? state.covered?.[seat] : undefined);
  const clock = useGameStore((state) => state.visible?.clock);
  const leftEarly = useGameStore((state) => state.visible?.earlyLeaveSeats?.includes(seat) ?? false);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const lastActionAt = useGameStore((state) => latestSeatAction(state.visible?.log ?? [], seat));
  // Bridge: each seat's latest call sits beside its name while the auction runs.
  const callIndex = useGameStore((state) => {
    const bids = state.phase === 'bidding' ? state.bidding?.bids ?? state.napoleon?.bidding?.bids : undefined;
    return bids ? latestCallIndex(bids, seat) : -1;
  });
  const call = useGameStore((state) => (callIndex >= 0
    ? (state.bidding?.bids ?? state.napoleon?.bidding?.bids)?.[callIndex]?.action ?? null : null));
  // The opposite hand sits beside its plate so the top row stays short and the centre grows.
  const handBeside = position === 'top' && gameType !== undefined && clientGame(gameType).handBeside;
  const active = !suppressTurn && turn && (phase === 'bidding' || phase === 'playing');
  const autoPlayed = autoArranged || showsAutoPlayed(clock, seat, lastActionAt);
  const status = seatStatus({
    busted: busted || dead || heOut,
    locked: locked || heLocked,
    thinking: (active || arranging || (bettingOpen && !betPlaced)) && Boolean(player?.isBot),
    autoPlayed,
    arranged: arranged || betPlaced || napoleonReviewed,
  });
  const cards = bigTwoCards ?? redPointsCards ?? ninetyNineCards ?? sevensCards ?? chinesePokerCards
    ?? gameSeatValue(liars?.handCounts, seat) ?? blackjackCards ?? holdemCards ?? napoleonCards
    ?? remainingCards(seat, playing);
  // A Hold'em fold outranks a timeout in the status slot, so a timed-out fold keeps the timeout icon.
  const heStatusLabel: TranslationKey | null = heOut && status === 'busted' ? 'holdem.out'
    : heLocked && status === 'locked' ? heState === 'folded' ? 'holdem.folded' : 'holdem.allIn' : null;
  // Lasting states (folded, out, busted) dim the whole seat instead of adding a badge on top of it.
  const dimmed = busted || dead || sittingOut || heOut || heState === 'folded';
  const statusText = heStatusLabel ?? (dead && status === 'busted' ? 'liarsdeck.dead'
    : bj && status === 'arranged' ? 'blackjack.betPlaced'
      : napoleonReviewed && status === 'arranged' ? 'napoleon.reviewed' : status ? STATUS_LABEL[status] : null);
  // The turn ring already shows that a bot is thinking, so that status stays a screen-reader label only.
  const statusChip = status && status !== 'thinking' && !(dimmed && (status === 'busted' || status === 'locked')) ? status : null;
  // A fold that came from a timeout keeps a quiet timer mark on the dimmed seat.
  const timedOutFold = heState === 'folded' && autoPlayed && statusChip === null;
  const statusIcon = statusChip ? STATUS_ICON[statusChip] : '';
  const seatName = seatLabel(t, gameType, seat);
  const name = player?.nickname ?? seatName;
  const bottom = position === 'bottom';
  const select = onObserve ?? onPick;
  const redCards = captured?.filter((card) => rpCardPoints(card) > 0).slice(-MAX_PILE) ?? [];
  const clockTurn = active && clock?.turn?.seat === seat ? clock.turn : null;
  const frameClass = seatFrameHostClass(player?.seatFrame);
  // God view shows the hand face up instead of card backs; Blackjack and Hold'em draw it on the felt.
  const observed = bottom || cards === 0 ? null
    : liarsDeck && observedLiars?.length ? <ObservedLiarCards cards={observedLiars} owner={name}
      tableFace={liarsDeck.tableFace} />
      : napoleon && observedNapoleon?.length ? <ObservedNapoleonCards cards={observedNapoleon} owner={name}
        trump={napoleon.contract?.suit ?? null} />
        : observedCards?.length ? <ObservedCards cards={observedCards} owner={name} /> : null;
  // Red Points shows captured red cards instead of card backs; the hand size stays a chip.
  const tray = captured ? redCards.length > 0 && <CardTray count={redCards.length} kind="captured" render={(index) => (
    <img className={styles.pileCard} src={cardImageUrl(redCards[index])} alt="" draggable={false} />
  )} /> : !bottom && cards > 0 && !observed && <CardTray count={Math.min(cards, MAX_BACKS)} kind="backs"
    render={() => <span className={styles.back}><CardBackArt /></span>} />;

  const roleLabels = [
    declarer && { key: 'declarer', label: t('table.declarer'), tone: styles.gold },
    dealer && phase === 'bidding' && { key: 'dealer', label: t('table.dealer'), tone: styles.light },
    bj?.currentDealer === seat && { key: 'bjDealer', label: t('blackjack.dealerTag'), tone: styles.gold },
    heBlinds?.button === seat && { key: 'button', label: t('holdem.button'), tone: styles.gold, title: t('holdem.buttonTitle') },
    heBlinds?.small === seat && { key: 'sb', label: t('holdem.sb'), tone: styles.light, title: t('holdem.sbTitle') },
    heBlinds?.big === seat && { key: 'bb', label: t('holdem.bb'), tone: styles.light, title: t('holdem.bbTitle') },
    napoleonLabels?.napoleon === seat && { key: 'napoleon', label: t('napoleon.napoleonShort'), tone: styles.napoleonRole, title: t('napoleon.napoleon') },
    napoleonLabels?.secretary === seat && { key: 'secretary', label: t('napoleon.secretaryShort'), tone: styles.secretaryRole, title: t('napoleon.secretary') },
  ].filter((role): role is RoleLabel => role !== false);
  // A single character fits a badge on the avatar's corner; longer labels join the stats line.
  const cornerRoles = roleLabels.filter((role) => [...role.label].length === 1);
  const lineRoles = roleLabels.filter((role) => [...role.label].length > 1);
  // An animated picture behind every seat would repaint the table each frame, so seats show its still frame.
  const seatArt = seatBackgroundStyle(player, true);
  const seatDirection = seatLabel(t, gameType, seat, true);

  const avatarBox = <span className={styles.avatarBox} data-seat-avatar>
    {player ? <Avatar avatar={player.avatar} image={player.avatarImage} border={player.avatarBorder}
      color={player.color} size="compact" /> : <span className={styles.emptyAvatar} aria-hidden="true" />}
    <span className={`${styles.ring} ${clockTurn ? styles.timed : ''}`} aria-hidden="true" />
    {clockTurn && clock && <TurnRing key={clockTurn.id} turn={clockTurn} bankMs={isMe ? clock.bankRemainingMs[seat] ?? 0 : 0}
      serverNow={clock.serverNow} receivedAt={receivedAt} />}
    <span className={`${styles.corner} ${styles.direction}`} title={seatName}>
      <span aria-hidden="true">{seatDirection}</span>
      <span className={styles.srOnly}>{seatName}</span>
    </span>
    {cornerRoles.length > 0 && <span className={`${styles.corner} ${styles.roles}`}>
      {cornerRoles.map((role) => <span key={role.key} className={`${styles.glyph} ${role.tone}`} title={role.title}>
        {role.label}</span>)}
    </span>}
    {moveKey !== undefined && <span key={moveKey} className={styles.moved} aria-hidden="true" />}
  </span>;
  const namePill = <span className={styles.namePill}>
    <SeatFrame frame={player?.seatFrame} turn={Boolean(active)} />
    <span className={styles.nickname}>{player ? player.nickname : '—'}</span>
  </span>;
  const identity = <>{avatarBox}{namePill}{isMe && <span className={styles.srOnly}>{t('seat.meTag')}</span>}</>;
  const statusLine = statusChip ? <span className={`${styles.statusChip} ${styles[statusChip]}`}
    title={statusChip === 'autoPlayed' ? t('clock.autoPlayed') : undefined}>
    {statusIcon && <AppIcon name={statusIcon} />}{statusText && t(statusText)}
  </span> : timedOutFold && <span className={`${styles.statusChip} ${styles.autoPlayed}`} title={t('clock.autoPlayed')}>
    <AppIcon name="timer" />
  </span>;

  return (
    <div data-table-seat={position}
      className={`${styles.seat} ${styles[position]} ${handBeside ? styles.handBeside : ''} ${active ? styles.turn : ''} ${isMe ? styles.mine : ''} ${frameClass ? `${styles.framed} ${frameClass}` : ''} ${dimmed ? styles.out : ''} ${onObserve ? styles.observable : onPick ? styles.pickable : ''}`}
      role={select ? 'button' : undefined} tabIndex={select ? 0 : undefined} onClick={select}
      aria-label={onObserve ? t('table.observePlayer', { name }) : onPick ? t('seat.pickNext', { name }) : undefined}
      title={onObserve ? t('table.observePlayer', { name }) : undefined}
      onKeyDown={select ? (event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        // Space would otherwise scroll; Enter must not also activate a focused child.
        event.preventDefault();
        select();
      } : undefined}>
      <div className={`${styles.plate} ${seatArt ? styles.hasArt : ''}`} style={seatArt} data-seat-plate>
        {player && !select
          ? <button type="button" className={styles.identity} aria-haspopup="dialog"
            aria-label={t('playerCard.open', { nickname: player.nickname })}
            onClick={(event) => setCardAnchor(event.currentTarget)}>{identity}</button>
          : <div className={styles.identity}>{identity}</div>}
        <div className={styles.stats}>
          {captured && <CardPileDetails cards={captured} owner={name} />}
          {!bottom && cards > 0 && <span className={`${styles.stat} ${bigTwoCards !== null ? styles.bigCount : ''}`}>
            {t('table.cards', { n: String(cards) })}
          </span>}
          {sevensCovered !== null && (observedCovered?.length
            ? <CardPileDetails cards={observedCovered} owner={name} covered />
            : sevensCovered > 0 && <span className={styles.stat}>
              {t('sevens.covered', { n: String(sevensCovered) })}
            </span>)}
          {liars && <span className={`${styles.stat} ${(gameSeatValue(liars.shots, seat) ?? 0) >= 4 ? styles.danger : ''}`}
            title={t('liarsdeck.shotsTitle', { n: String((gameSeatValue(liars.shots, seat) ?? 0)) })}>
            {t('liarsdeck.shots', { n: String((gameSeatValue(liars.shots, seat) ?? 0)) })}
          </span>}
          {bj && <span className={`${styles.stat} ${styles.chips}`} title={t('blackjack.chipsTitle', { n: String(bj.chips[seat]) })}>
            <ChipIcon />{bj.chips[seat]}
          </span>}
          {he && <span className={`${styles.stat} ${styles.chips}`} title={t('holdem.chipsTitle', { n: String(he.chips[seat]) })}>
            <ChipIcon />{he.chips[seat]}
          </span>}
          {napoleonPoints !== null && <span className={styles.stat}
            title={t('napoleon.pointsTitle', { n: String(napoleonPoints) })}>
            {t('napoleon.pointsChip', { n: String(napoleonPoints) })}
          </span>}
          {lineRoles.map((role) => <span key={role.key} className={`${styles.stat} ${role.tone}`} title={role.title}>
            {role.label}</span>)}
          {call && <span key={callIndex} className={`${styles.stat} ${styles.call} ${call.type === 'pass' ? styles.callPass : ''}`}
            title={t('table.lastCall')}>
            {call.type === 'pass' ? t('game.pass') : <BidLabel level={call.level} suit={call.suit} />}
          </span>}
          <TurnClock seat={seat} showBank={isMe} />
          {leftEarly && <span className={`${styles.statusChip} ${styles.earlyLeave}`} title={t('actions.autoPlay')}>
            {t('earlyLeave.button')}</span>}
          {statusLine}
        </div>
        {(dimmed || status === 'thinking') && statusText && <span className={styles.srOnly}>{t(statusText)}</span>}
        {heBet > 0 && <span className={styles.bet}><BetStack amount={heBet} title={t('holdem.betTitle', { n: String(heBet) })} /></span>}
        {sittingOut && <span className={styles.srOnly}>{t('blackjack.sittingOut')}</span>}
        {active && <span className={styles.srOnly}>{isMe ? t('table.yourTurn') : t('table.turn')}</span>}
      </div>
      {tray}
      {observed}
      {cardAnchor && player && gameType && <Suspense fallback={null}>
        <PlayerCard player={player} gameType={gameType} anchor={cardAnchor} onClose={() => setCardAnchor(null)} />
      </Suspense>}
    </div>
  );
}
