// ─── GameShell: table frame shared by all games (info rail + table + chat + abort vote) ───

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import type { PlayerVisibleGameState, Seat } from '@shared/types';
import type { TranslationKey } from '../i18n';
import { playCardSound, playOutSound, unlockCardSounds, disposeCardSounds } from '../audio/card-sound';
import { cardBackStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useChatStore } from '../stores/chat-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { ChatPanel } from '../components/ChatPanel';
import { TableSeat } from '../components/TableSeat';
import { lastElimination, lastMove, tablePosition } from '../game-view';
import type { TablePosition } from '../game-view';
import { AbortVoteBanner, AbortVoteButton } from './AbortVote';
import { SpectatorLeaveButton } from './SpectatorLeave';
import styles from './GameShell.module.css';
import { useGamePresentation } from './use-game-presentation';
import { GamePresentation } from './GamePresentation';
import { RoundHistory } from './RoundHistory';
import { useMotionStore } from '../stores/motion-store';
import { useSheetFocus } from './use-sheet-focus';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const DESKTOP_QUERY = '(min-width: 1024px)';
const SHEET_QUERY = '(max-width: 767px), (max-height: 500px) and (min-width: 600px)';
const OUT_BANNER_MS = 3500;
/** The played card flies to the center from that seat's direction */
const FLY_FROM: Record<TablePosition, CSSProperties> = {
  bottom: { '--fly-x': '0px', '--fly-y': '28vh' } as CSSProperties,
  top: { '--fly-x': '0px', '--fly-y': '-28vh' } as CSSProperties,
  left: { '--fly-x': '-30vw', '--fly-y': '0px' } as CSSProperties,
  right: { '--fly-x': '30vw', '--fly-y': '0px' } as CSSProperties,
};

function presentationSummary(
  game: PlayerVisibleGameState,
  t: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
  if (game.gameType === 'bridge') {
    if (game.phase === 'scoring' && game.result) return t(game.result.declarerTeamWins
      ? 'score.declarerWins' : 'score.defenderWins');
    return game.playing ? `${t('seat.N')} / ${t('seat.S')}: ${game.playing.trickCountNS} · ` +
      `${t('seat.E')} / ${t('seat.W')}: ${game.playing.trickCountEW}` : '';
  }
  if (game.gameType === 'redpoints' && game.result) {
    const { points, winners } = game.result;
    return t('presentation.redPointsWinners', {
      scores: winners.map((seat) => `${t(`seat.${seat}`)} ${points[seat]}`).join(' · '),
    });
  }
  if (game.gameType === 'sevens' && game.result) {
    const { penalties, winners } = game.result;
    return t('presentation.sevensWinners', {
      scores: winners.map((seat) => `${t(`seat.${seat}`)} ${penalties[seat]}`).join(' · '),
    });
  }
  if (game.gameType === 'chinesepoker' && game.result) {
    const { scores, winners } = game.result;
    return t('presentation.chinesePokerWinners', {
      scores: winners.map((seat) => `${t(`seat.${seat}`)} ${scores[seat] > 0 ? '+' : ''}${scores[seat]}`).join(' · '),
    });
  }
  if (game.gameType === 'blackjack' && game.result) {
    const { chips, winners } = game.result;
    return t('presentation.blackjackWinners', {
      scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
    });
  }
  if (game.gameType === 'holdem' && game.result) {
    const { chips, winners } = game.result;
    return t('presentation.holdemWinners', {
      scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
    });
  }
  return '';
}

/** A Hold'em award frame that knocks a seat out of the match. */
function eliminatesSeat(game: PlayerVisibleGameState | null, frame: PresentationFrame): boolean {
  if (game?.gameType !== 'holdem' || frame.kind !== 'award') return false;
  const index = frameLogIndex(frame);
  const entry = index === null ? undefined : game.log[index];
  return entry?.type === 'award' && entry.eliminated.length > 0;
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

/** The info rail is a column only on wide, tall screens; elsewhere it is an overlay sheet. */
const infoIsOverlay = (): boolean => !matches(DESKTOP_QUERY) || matches(SHEET_QUERY);
const chatIsOverlay = (): boolean => matches(SHEET_QUERY);

interface GameShellProps {
  /** Info rail content (left column on desktop, overlay on tablet, drawer on mobile) */
  info: ReactNode;
  /** Table center */
  centre: ReactNode;
  /** Hand area below the table */
  hand: ReactNode;
  /** Full-screen overlay (settlement) */
  overlay?: ReactNode;
  /** Action panel layered over the table, e.g. the Bridge bidding controls. */
  panel?: ReactNode;
  /** Action error shown on the table */
  error?: string;
  /** Selectable seats (Ninety-Nine: choose the next player) */
  pickableSeats?: readonly Seat[];
  onPickSeat?: (seat: Seat) => void;
  turnReady?: boolean;
}

function FittedCentre({ children, style, responsive }: {
  children: ReactNode; style?: CSSProperties; responsive: boolean;
}): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (responsive) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const fit = (): void => {
      const width = Math.max(content.offsetWidth, content.scrollWidth);
      const height = Math.max(content.offsetHeight, content.scrollHeight);
      const scale = width > 0 && height > 0
        ? Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height)
        : 1;
      content.style.setProperty('--centre-scale', String(scale));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    observer.observe(content);
    fit();
    return () => observer.disconnect();
  }, [responsive]);

  return <div className={`${styles.tableCentre} ${responsive ? styles.responsiveCentre : ''}`}
    ref={viewportRef} style={style} data-table-centre>
    <div className={styles.centreContent} ref={contentRef}>{children}</div>
  </div>;
}

export function GameShell({
  info, centre, hand, overlay, panel, error, pickableSeats, onPickSeat, turnReady,
}: GameShellProps): ReactNode {
  const presentation = useGamePresentation();
  const visibleGame = useGameStore((state) => state.visible);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const setReducedMotion = useMotionStore((state) => state.setReducedMotion);
  const mySeat = useRoomStore((state) => state.mySeat);
  const account = useAccountStore((state) => state.account);
  const tableStyle = tableBackgroundStyle(account);
  const messageCount = useChatStore((state) => state.messages.length);
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const log = useGameStore((state) => state.bigTwo?.log ?? state.redPoints?.log ?? state.ninetyNine?.log
    ?? state.sevens?.log ?? state.chinesePoker?.log ?? state.liarsDeck?.log ?? state.blackjack?.log ?? state.holdem?.log ?? state.log);
  const ownedTurn = useGameStore((state) => mySeat !== null && state.currentTurnSeat === mySeat
    && (state.phase === 'bidding' || state.phase === 'playing'));
  const myTurn = (turnReady ?? ownedTurn) && !presentation.locked;
  const turnSeat = useGameStore((state) => state.phase === 'bidding' || state.phase === 'playing'
    ? state.currentTurnSeat : null);
  const move = lastMove(log);
  const out = lastElimination(log);
  const [outBanner, setOutBanner] = useState<{ seat: Seat; index: number } | null>(null);
  const { t } = useI18nStore();
  const turnName = turnSeat ? seats?.[turnSeat].player?.nickname ?? t(`seat.${turnSeat}`) : '';
  const turnAnnouncement = presentation.locked || !turnSeat ? ''
    : turnSeat === mySeat ? (myTurn ? t('table.yourTurn') : '') : t('table.turnOf', { name: turnName });
  // Chat is collapsed by default on tablet; on mobile it is a bottom drawer, closed by default
  const [chatOpen, setChatOpen] = useState(() => matches(DESKTOP_QUERY) && !matches(SHEET_QUERY));
  const [infoOpen, setInfoOpen] = useState(false);
  const [seenMessages, setSeenMessages] = useState(0);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const chatRailRef = useRef<HTMLElement>(null);
  useSheetFocus(infoOpen, infoPanelRef, infoButtonRef, infoIsOverlay);
  // Focusing the chat input would raise the phone keyboard; focus the sheet itself.
  useSheetFocus(chatOpen, chatRailRef, chatButtonRef, chatIsOverlay, 'panel');
  const bottomSeat: Seat = mySeat ?? 'S';
  const unread = chatOpen ? 0 : Math.max(0, messageCount - seenMessages);
  const godView = useGodViewStore((state) => state.role);

  useEffect(() => {
    useGodViewStore.getState().update(visibleGame, presentation.locked);
  }, [visibleGame, presentation.locked]);
  useEffect(() => () => useGodViewStore.getState().update(null, false), []);

  // Play sounds only for actions after joining the table, not for the existing log on join or reconnect
  const heardMove = useRef(move?.index);
  useEffect(() => {
    if (visibleGame?.presentation || !move || move.index === heardMove.current) return;
    heardMove.current = move.index;
    playCardSound(move.pass);
  }, [move, visibleGame?.presentation]);

  useEffect(() => {
    const unlock = (event: Event): void => { if (event.isTrusted) unlockCardSounds(); };
    for (const event of AUDIO_UNLOCK_EVENTS) window.addEventListener(event, unlock);
    return () => {
      for (const event of AUDIO_UNLOCK_EVENTS) window.removeEventListener(event, unlock);
      disposeCardSounds();
    };
  }, []);

  // Trigger by log index. The hide timer lives in a ref: an effect cleanup on a later
  // dependency change would otherwise cancel it and leave the banner up, which reduced
  // motion (no fade-out animation) makes permanent.
  const heardOut = useRef(out?.index);
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outIndex = out?.index;
  const outSeat = out?.seat;
  useEffect(() => {
    if (visibleGame?.presentation || outIndex === undefined || !outSeat || outIndex === heardOut.current) return;
    heardOut.current = outIndex;
    playOutSound();
    setOutBanner({ seat: outSeat, index: outIndex });
    if (outTimer.current) clearTimeout(outTimer.current);
    outTimer.current = setTimeout(() => {
      outTimer.current = null;
      setOutBanner(null);
    }, OUT_BANNER_MS);
  }, [outIndex, outSeat, visibleGame?.presentation]);
  useEffect(() => () => {
    if (outTimer.current) clearTimeout(outTimer.current);
  }, []);

  const heardFrame = useRef(presentation.frame?.key);
  useEffect(() => {
    const frame = presentation.frame;
    if (!frame || heardFrame.current === frame.key) return;
    heardFrame.current = frame.key;
    if (frame.kind === 'play' || frame.kind === 'capture') playCardSound();
    else if (frame.kind === 'pass' || frame.kind === 'cover') playCardSound(true);
    else if (frame.kind === 'reveal' || frame.kind === 'challenge') playCardSound();
    else if (frame.kind === 'hit' || frame.kind === 'double' || frame.kind === 'split'
      || frame.kind === 'dealerReveal' || frame.kind === 'dealerHit') playCardSound();
    else if ((frame.kind === 'deal' && visibleGame?.gameType === 'holdem') || frame.kind === 'street'
      || frame.kind === 'showdown') playCardSound();
    else if (frame.kind === 'fold' || frame.kind === 'check') playCardSound(true);
    else if (frame.kind === 'eliminated' || frame.survived === false || eliminatesSeat(visibleGame, frame)) playOutSound();
  }, [presentation.frame, visibleGame]);

  const collapseChat = useCallback((): void => {
    setSeenMessages(messageCount);
    setChatOpen(false);
  }, [messageCount]);

  // Collapse chat below desktop width so the mobile view is not covered by the chat drawer on entry
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sheets = window.matchMedia(SHEET_QUERY);
    const onChange = (): void => { if (!query.matches || sheets.matches) collapseChat(); };
    query.addEventListener('change', onChange);
    sheets.addEventListener('change', onChange);
    return (): void => {
      query.removeEventListener('change', onChange);
      sheets.removeEventListener('change', onChange);
    };
  }, [collapseChat]);

  // Only one drawer is open at a time on mobile
  const openInfo = (): void => {
    if (matches(SHEET_QUERY) && chatOpen) collapseChat();
    setInfoOpen((open) => !open);
  };

  const openChat = (): void => {
    setInfoOpen(false);
    setChatOpen(true);
  };

  const closeSheets = useCallback((): void => {
    setInfoOpen(false);
    if (matches(SHEET_QUERY)) collapseChat();
  }, [collapseChat]);

  useEffect(() => {
    // Popovers above the sheets handle Escape first and mark it handled.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeSheets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheets]);

  return (
    <div data-reduced-motion={reducedMotion || undefined} className={`${styles.gameContainer} ${chatOpen ? '' : styles.chatCollapsed} ${infoOpen ? styles.infoOpen : ''}`}
      style={cardBackStyle(account)}>
      {(infoOpen || chatOpen) && <button type="button" className={styles.backdrop} tabIndex={-1}
        aria-label={t('table.close')} onClick={closeSheets} />}

      <div className={styles.infoPanel} id="game-info-panel" ref={infoPanelRef}>
        <div className={styles.sheetHeader}>
          <span>{t('table.info')}</span>
          <button type="button" className={styles.sheetClose} onClick={() => setInfoOpen(false)}
            aria-label={t('table.close')} title={t('table.close')}>✕</button>
        </div>
        <AbortVoteButton />
        <SpectatorLeaveButton />
        <label className={styles.motionSetting}>
          <input type="checkbox" checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)} />
          {t('table.reduceMotion')}
        </label>
        <div className={styles.infoContent}>
          {info}
          {visibleGame && <RoundHistory game={visibleGame} />}
        </div>
      </div>

      <main className={`${styles.centreColumn} ${tableStyle ? styles.customTable : ''}`} style={tableStyle}>
        <div className={styles.table} data-card-table>
          <div className={styles.tableTools}>
            <button type="button" className={styles.toolBtn} onClick={openInfo} ref={infoButtonRef}
              aria-label={t('table.info')} title={t('table.info')}
              aria-expanded={infoOpen} aria-controls="game-info-panel">
              <span aria-hidden="true">📋</span>
            </button>
            <button type="button" className={`${styles.toolBtn} ${styles.chatFab}`} onClick={openChat} ref={chatButtonRef}
              aria-label={t('table.chatExpand')} title={t('table.chatExpand')} aria-expanded={chatOpen}>
              <span aria-hidden="true">💬</span>
              {unread > 0 && <span className={`${styles.unread} ${styles.fabBadge}`}>{unread}</span>}
            </button>
          </div>
          {SEATS.filter((seat) => seat !== bottomSeat).map((seat) => (
            <TableSeat key={seat} seat={seat} position={tablePosition(seat, bottomSeat)}
              suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === seat ? presentation.frame.key : undefined
                : move?.seat === seat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(seat) ? () => onPickSeat(seat) : undefined} />
          ))}
          <FittedCentre responsive={visibleGame?.gameType === 'redpoints' && !presentation.frame}
            style={move ? FLY_FROM[tablePosition(move.seat, bottomSeat)] : undefined}>
            {presentation.frame && visibleGame ? (
              <GamePresentation key={presentation.frame.key} frame={presentation.frame}
                bottomSeat={bottomSeat} gameType={visibleGame.gameType}
                elapsedMs={Math.max(0, Date.now() - presentation.frameStartedAt)}
                summary={presentationSummary(visibleGame, t)} />
            ) : <div className={`${styles.centreBody} ${visibleGame?.presentation ? styles.settledCentre : ''}`}>{centre}</div>}
          </FittedCentre>
          {outBanner && <p key={outBanner.index} className={styles.outBanner} role="status">
            {t('table.eliminated', { name: seats?.[outBanner.seat].player?.nickname ?? t(`seat.${outBanner.seat}`) })}
          </p>}
          {panel && !presentation.locked && <div className={styles.actionPanel}>{panel}</div>}
          <AbortVoteBanner />
        </div>

        <div className={`${styles.handZone} ${myTurn ? styles.handMyTurn : ''}`} data-hand-zone>
          <div className={styles.handHeader}>
            <TableSeat seat={bottomSeat} position="bottom" suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === bottomSeat ? presentation.frame.key : undefined
                : move?.seat === bottomSeat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(bottomSeat) ? () => onPickSeat(bottomSeat) : undefined} />
          </div>
          <div className={styles.handStatus}>
            {godView && <p className={styles.godView}>{t(godView === 'spectator' ? 'table.spectating' : 'table.godView')}</p>}
            {myTurn && <p className={styles.yourTurn}>{t('table.yourTurn')}</p>}
            {error && <p className={styles.actionError} role="alert">{error}</p>}
          </div>
          {hand}
        </div>
      </main>

      <aside className={styles.chatRail} ref={chatRailRef} tabIndex={-1} aria-label={t('chat.title')}>
        {!chatOpen && (
          <button type="button" className={styles.chatStrip} onClick={() => setChatOpen(true)}
            aria-label={t('table.chatExpand')} title={t('table.chatExpand')}>
            <span aria-hidden="true">💬</span>
            {unread > 0 && <span className={styles.unread}>{unread}</span>}
          </button>
        )}
        <div className={chatOpen ? styles.chatBody : styles.hidden}>
          <ChatPanel onCollapse={collapseChat} />
        </div>
      </aside>

      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {turnAnnouncement}
      </p>
      {!presentation.locked && overlay}
    </div>
  );
}
