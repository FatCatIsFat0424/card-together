// ─── GameShell: table frame shared by all games (info rail + table + chat + abort vote) ───

import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PlayerVisibleGameState, GameSeat } from '@shared/types';
import type { TranslationKey } from '../i18n';
import { playCardSound, playOutSound, unlockCardSounds, disposeCardSounds } from '../audio/card-sound';
import { cardBackStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useChatStore } from '../stores/chat-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { useSeatName } from './seat-names';
import { ChatPanel } from '../components/ChatPanel';
import { TableSeat } from '../components/TableSeat';
import { AppCheckbox } from '../components/AppCheckbox';
import { lastElimination, lastMove, matchSeats, tablePosition } from '../game-view';
import type { TablePosition } from '../game-view';
import { AbortVoteBanner, AbortVoteButton } from './AbortVote';
import { SpectatorLeaveButton } from './SpectatorLeave';
import { EarlyLeaveButton } from './EarlyLeave';
import { AppIcon } from '../components/AppIcon';
import { IconButton } from '../components/IconButton';
import { VoiceButton } from '../components/VoiceControls';
import { RoomCodeButton } from '../components/RoomCodeButton';
import { GameRulesDialog } from '../components/GameRulesDialog';
import { matchRulesContext } from '../game-rules-context';
import styles from './GameShell.module.css';
import { useGamePresentation } from './use-game-presentation';
import { frameCue } from './frame-cue';
import { GamePresentation } from './GamePresentation';
import { RoundHistory } from './RoundHistory';
import { useMotionStore } from '../stores/motion-store';
import { useSheetFocus } from './use-sheet-focus';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { isSpectator } from './observer-view';
import { useTablePerspective } from './use-table-perspective';
import { useTablePerspectiveStore } from '../stores/table-perspective-store';
import { VictoryEffects } from '../cosmetics/victory-effects/VictoryEffects';
import { useStillArt } from '../cosmetics/art-layers/art-layers';
import { layeredShopArt } from '../cosmetics/art-layers/shop-art-layers';
import { CardBackArtContext } from '../cosmetics/art-layers/CardBackArt';
import { TableArt } from '../cosmetics/art-layers/TableArt';
import { AutoPlayBanner, GameActionBar } from './GameActionBar';
import { GameMenuLinks, useGameMenuUnread } from './GameMenuLinks';
import { RotateHint } from './RotateHint';
import { godViewSource, useReplayMode } from './replay-mode';
import { TableStoreScope } from './TableStoreScope';
import { gameUi } from './ui-registry';

const DESKTOP_QUERY = '(min-width: 1024px)';
const SHEET_QUERY = '(max-width: 767px), (max-height: 500px) and (min-width: 600px)';
const OUT_BANNER_MS = 3500;
// Keep the setting available in code while its UI is temporarily hidden.
const SHOW_REDUCED_MOTION_CONTROL = false;
/** The played card flies to the center from that seat's direction */
const FLY_FROM: Record<TablePosition, CSSProperties> = {
  topLeft: { '--fly-x': '-24vw', '--fly-y': '-28vh' } as CSSProperties,
  topRight: { '--fly-x': '24vw', '--fly-y': '-28vh' } as CSSProperties,
  bottomLeft: { '--fly-x': '-24vw', '--fly-y': '20vh' } as CSSProperties,
  bottomRight: { '--fly-x': '24vw', '--fly-y': '20vh' } as CSSProperties,
  bottom: { '--fly-x': '0px', '--fly-y': '28vh' } as CSSProperties,
  top: { '--fly-x': '0px', '--fly-y': '-28vh' } as CSSProperties,
  left: { '--fly-x': '-30vw', '--fly-y': '0px' } as CSSProperties,
  right: { '--fly-x': '30vw', '--fly-y': '0px' } as CSSProperties,
};

function presentationSummary(
  game: PlayerVisibleGameState,
  t: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
  return gameUi(game.gameType).presentation?.summary?.(game, t) ?? '';
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
  /** Keep an interactive centre prompt above the floating own-seat plate. */
  centreForeground?: boolean;
  /** Hand area below the table */
  hand: ReactNode;
  /** Full-screen overlay (settlement) */
  overlay?: ReactNode;
  /** Action panel layered over the table, e.g. the Bridge bidding controls. */
  panel?: ReactNode;
  /** Presentation effect layered over the whole table, above the seats. */
  tableEffect?: ReactNode;
  /** Keep the table centre in place of the current presentation frame's card. */
  centreVisible?: boolean;
  /** Hint for the player, such as what to pick next; shown beside the turn prompt above the hand */
  prompt?: ReactNode;
  /** Action error shown on the table */
  error?: string;
  /** Selectable seats (Ninety-Nine: choose the next player) */
  pickableSeats?: readonly GameSeat[];
  onPickSeat?: (seat: GameSeat) => void;
  turnReady?: boolean;
}


/** `wide` lifts the usual width cap for centres that size themselves to the table, such as the Sevens rows. */
function FittedCentre({ children, style, responsive, wide, foreground }: {
  children: ReactNode; style?: CSSProperties; responsive: boolean; wide: boolean; foreground?: boolean;
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

  return <div className={`${styles.tableCentre} ${responsive ? styles.responsiveCentre : ''} ${wide ? styles.wideCentre : ''} ${foreground ? styles.centreForeground : ''}`}
    ref={viewportRef} style={style} data-table-centre>
    <div className={styles.centreContent} ref={contentRef}>{children}</div>
  </div>;
}

export function GameShell({
  info, centre, centreForeground, hand, overlay, panel, tableEffect, centreVisible, prompt, error, pickableSeats, onPickSeat,
  turnReady,
}: GameShellProps): ReactNode {
  const presentation = useGamePresentation();
  // Playback has no seat, clocks, or room controls; personal playback has no chat either.
  const replay = useReplayMode();
  const chatVisible = !replay || replay.chat;
  const visibleGame = useGameStore((state) => state.visible);
  const centreLayout = visibleGame ? gameUi(visibleGame.gameType).centre : undefined;
  const HudInfo = visibleGame ? gameUi(visibleGame.gameType).hudInfo : undefined;
  const HudChip = visibleGame ? gameUi(visibleGame.gameType).hudChip : undefined;
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const setReducedMotion = useMotionStore((state) => state.setReducedMotion);
  const mySeat = useRoomStore((state) => state.mySeat);
  const account = useAccountStore((state) => state.account);
  const stillArt = useStillArt();
  const tableArt = stillArt ? null : layeredShopArt(account?.tableBackgroundStyle);
  const cardBackArt = stillArt ? null : layeredShopArt(account?.cardBackStyle);
  const tableStyle = tableBackgroundStyle(account, reducedMotion, !!tableArt);
  const messageCount = useChatStore((state) => state.messages.length);
  const room = useRoomStore((state) => state.roomInfo);
  const log = useGameStore((state) => state.bigTwo?.log ?? state.redPoints?.log ?? state.ninetyNine?.log
    ?? state.sevens?.log ?? state.chinesePoker?.log ?? state.liarsDeck?.log ?? state.blackjack?.log ?? state.holdem?.log
    ?? state.napoleon?.log ?? state.log);
  const ownedTurn = useGameStore((state) => mySeat !== null && state.currentTurnSeat === mySeat
    && (state.phase === 'bidding' || state.phase === 'playing'));
  const myTurn = (turnReady ?? ownedTurn) && !presentation.locked;
  const turnSeat = useGameStore((state) => state.phase === 'bidding' || state.phase === 'playing'
    ? state.currentTurnSeat : null);
  const move = lastMove(log);
  const out = lastElimination(log);
  const [outBanner, setOutBanner] = useState<{ seat: GameSeat; index: number } | null>(null);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const turnName = turnSeat ? seatName(turnSeat) : '';
  const turnAnnouncement = presentation.locked || !turnSeat ? ''
    : turnSeat === mySeat ? (myTurn ? t('table.yourTurn') : '') : t('table.turnOf', { name: turnName });
  // Chat is collapsed by default on tablet; on mobile it is a bottom drawer, closed by default
  const [chatOpen, setChatOpen] = useState(() => chatVisible && matches(DESKTOP_QUERY) && !matches(SHEET_QUERY));
  const [infoOpen, setInfoOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const settlementVisible = Boolean(overlay) && !presentation.locked;
  const rulesVisible = rulesOpen && !settlementVisible && visibleGame !== null;
  const [seenMessages, setSeenMessages] = useState(0);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const chatRailRef = useRef<HTMLElement>(null);
  useSheetFocus(infoOpen && !rulesVisible, infoPanelRef, infoButtonRef, infoIsOverlay);
  // Focusing the chat input would raise the phone keyboard; focus the sheet itself.
  useSheetFocus(chatOpen && !rulesVisible, chatRailRef, chatButtonRef, chatIsOverlay, 'panel');
  const bottomSeat = useTablePerspective();
  const selectSeat = useTablePerspectiveStore((state) => state.selectSeat);
  const watching = isSpectator(visibleGame);
  const observeSeat = (seat: GameSeat): void => {
    const restoreFocus = document.activeElement?.matches('[data-table-seat]');
    selectSeat(seat);
    if (restoreFocus) requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-table-seat="bottom"]')?.focus({ preventScroll: true });
    });
  };
  // Seats left empty in a Blackjack or Hold'em match get no plate.
  const tableSeats = matchSeats(visibleGame);
  const expandedTable = tableSeats.some((seat) => !['N', 'E', 'S', 'W'].includes(seat));
  // Empty cells go to their neighbours: with no side seats (six players) the top corner seats reach down beside
  // the centre, and with no opposite seat (five players) the centre rises between the top corner seats.
  const sidePositions = tableSeats.filter((seat) => seat !== bottomSeat)
    .map((seat) => tablePosition(seat, bottomSeat, tableSeats));
  const cornersSpan = expandedTable && !sidePositions.includes('left') && !sidePositions.includes('right');
  const centreUp = expandedTable && !sidePositions.includes('top');
  const unread = chatOpen ? 0 : Math.max(0, messageCount - seenMessages);
  // Phones hide the app bar during games, so this sheet becomes the menu for everything it held.
  const phoneMenu = useMediaQuery(SHEET_QUERY) && !replay;
  const menuUnread = useGameMenuUnread();
  const godView = useGodViewStore((state) => state.role);
  const godViewStore = useGodViewStore.useApi();
  const perspectiveStore = useTablePerspectiveStore.useApi();

  const replaying = replay !== null;
  useEffect(() => {
    const source = godViewSource(visibleGame, presentation.locked, replay);
    godViewStore.getState().update(source.visible, source.locked);
  }, [godViewStore, visibleGame, presentation.locked, replay]);
  useEffect(() => () => {
    godViewStore.getState().update(null, false);
    // Replay stores belong to one viewer and are discarded with it; keep its chosen viewpoint.
    if (!replaying) perspectiveStore.getState().reset();
  }, [godViewStore, perspectiveStore, replaying]);

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
    const cue = frameCue(visibleGame, frame);
    if (cue === 'card') playCardSound();
    else if (cue === 'soft') playCardSound(true);
    else if (cue === 'out') playOutSound();
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

  const openRules = (): void => {
    closeSheets();
    setRulesOpen(true);
  };

  // Settlement owns focus; a cleared match must not reopen its previous rules.
  if (rulesOpen && (settlementVisible || !visibleGame)) setRulesOpen(false);

  useEffect(() => {
    // Popovers above the sheets handle Escape first and mark it handled.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && !rulesVisible) closeSheets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheets, rulesVisible]);

  const shell = (
    <div data-game-shell data-reduced-motion={reducedMotion || undefined} className={`${styles.gameContainer} ${chatOpen ? '' : styles.chatCollapsed} ${infoOpen ? styles.infoOpen : ''} ${replay ? styles.replayMode : ''} ${chatVisible ? '' : styles.noChat}`}
      style={cardBackStyle(account, reducedMotion, !!cardBackArt)}>
      {(infoOpen || chatOpen) && <button type="button" className={styles.backdrop} tabIndex={-1}
        aria-label={t('table.close')} onClick={closeSheets} />}

      <div className={styles.infoPanel} id="game-info-panel" ref={infoPanelRef}>
        <div className={styles.sheetHeader}>
          <span>{t(phoneMenu ? 'topbar.menu' : 'table.info')}</span>
          <button type="button" className={styles.sheetClose} onClick={() => setInfoOpen(false)}
            aria-label={t('table.close')} title={t('table.close')}><AppIcon name="close" /></button>
        </div>
        {!replay && <>
          {room && <RoomCodeButton key={room.code} code={room.code} compact={phoneMenu} className={styles.menuRoomCode} />}
          <AbortVoteButton className={`${styles.abortRail} ${styles.menuExit}`} />
          <EarlyLeaveButton className={`${styles.abortRail} ${styles.menuExit}`} />
          <SpectatorLeaveButton className={styles.menuExit} />
        </>}
        {!replay && <GameActionBar className={styles.menuTools} />}
        {visibleGame && <button type="button" className={`btn btn-outline ${styles.rulesRailButton}`}
          aria-haspopup="dialog" onClick={openRules}>
          <AppIcon name="rules" /> {t('rules.open')}
        </button>}
        {SHOW_REDUCED_MOTION_CONTROL && <label className={styles.motionSetting}>
          <AppCheckbox checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)} />
          {t('table.reduceMotion')}
        </label>}
        <div className={styles.infoContent}>
          {info}
          {visibleGame && <RoundHistory game={visibleGame} />}
        </div>
        {phoneMenu && <GameMenuLinks />}
      </div>

      <main className={`${styles.centreColumn} ${tableStyle ? styles.customTable : ''} ${tableArt ? styles.layeredTable : ''}`} style={tableStyle}>
        {tableArt && <TableArt art={tableArt} />}
        <div className={`${styles.table} ${expandedTable ? styles.expandedTable : ''} ${cornersSpan ? styles.cornersSpan : ''} ${centreUp ? styles.centreUp : ''}`}
          data-card-table data-hud-info={HudInfo ? '' : undefined}
          data-expanded-table={expandedTable ? '' : undefined}>
          {!replay && <div className={styles.desktopVoice}><VoiceButton className={styles.hudButton} /></div>}
          <div className={styles.tableTools}>
            <IconButton className={`${styles.hudButton} ${styles.menuTool}`} icon={phoneMenu ? 'menu' : 'info'}
              label={t(phoneMenu ? 'topbar.menu' : 'table.info')} onClick={openInfo} ref={infoButtonRef}
              badge={phoneMenu ? menuUnread : undefined}
              aria-expanded={infoOpen} aria-controls="game-info-panel" />
            {visibleGame && <IconButton className={`${styles.hudButton} ${styles.rulesTool}`} icon="rules"
              label={t('rules.open')} onClick={openRules} aria-haspopup="dialog" />}
            {HudChip && <span className={styles.hudChip}><HudChip /></span>}
            <span className={styles.hudInfo}>{HudInfo && <HudInfo />}</span>
            {!replay && <VoiceButton className={`${styles.hudButton} ${styles.voiceTool}`} />}
            {chatVisible && <IconButton className={`${styles.hudButton} ${styles.chatFab}`} icon="chat"
              label={t('table.chatExpand')} onClick={openChat} ref={chatButtonRef}
              badge={unread} aria-expanded={chatOpen} />}
          </div>
          {tableSeats.filter((seat) => seat !== bottomSeat && tableSeats.includes(seat)).map((seat) => (
            <TableSeat key={seat} seat={seat} position={tablePosition(seat, bottomSeat, tableSeats)}
              onObserve={watching ? () => observeSeat(seat) : undefined}
              suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === seat ? presentation.frame.key : undefined
                : move?.seat === seat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(seat) ? () => onPickSeat(seat) : undefined} />
          ))}
          <FittedCentre foreground={centreForeground} responsive={Boolean(centreLayout?.responsive) && !presentation.frame}
            wide={Boolean(centreLayout?.wide)}
            style={move ? FLY_FROM[tablePosition(move.seat, bottomSeat, tableSeats)] : undefined}>
            {presentation.frame && visibleGame && !centreVisible ? (
              <GamePresentation key={presentation.frame.key} frame={presentation.frame}
                bottomSeat={bottomSeat} game={visibleGame}
                elapsedMs={Math.max(0, Date.now() - presentation.frameStartedAt)}
                summary={presentationSummary(visibleGame, t)} />
            ) : <div className={`${styles.centreBody} ${visibleGame?.presentation ? styles.settledCentre : ''}`}>{centre}</div>}
          </FittedCentre>
          {outBanner && <p key={outBanner.index} className={styles.outBanner} role="status">
            <AppIcon name="burst" /> {t('table.eliminated', { name: seatName(outBanner.seat) })}
          </p>}
          {panel && !presentation.locked && <div className={styles.actionPanel} inert={visibleGame?.autoPlay}>{panel}</div>}
          {!replay && <AbortVoteBanner />}
          {!replay && <AutoPlayBanner />}
          <RotateHint />
        </div>

        <div className={styles.handZone} data-hand-zone>
          <div className={styles.handHeader}>
            {tableSeats.includes(bottomSeat) && <TableSeat seat={bottomSeat} position="bottom" suppressTurn={presentation.locked}
              onObserve={watching ? () => observeSeat(bottomSeat) : undefined}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === bottomSeat ? presentation.frame.key : undefined
                : move?.seat === bottomSeat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(bottomSeat) ? () => onPickSeat(bottomSeat) : undefined} />}
          </div>
          <div className={styles.handStatus}>
            {godView && <p className={styles.godView} title={watching ? t('table.changePerspective') : undefined}>
              {t(godView === 'spectator' ? 'table.spectating' : 'table.godView')}
            </p>}
            {myTurn && <p className={styles.yourTurn}>{t('table.yourTurn')}</p>}
            {prompt && <p className={styles.handPrompt}>{prompt}</p>}
            {error && <p className={styles.actionError} role="alert">{error}</p>}
          </div>
          <div inert={visibleGame?.autoPlay}>{hand}</div>
        </div>
        {tableEffect}
      </main>

      {chatVisible && <aside className={styles.chatRail} ref={chatRailRef} tabIndex={-1} aria-label={t('chat.title')}>
        {!chatOpen && (
          <button type="button" className={styles.chatStrip} onClick={() => setChatOpen(true)}
            aria-label={t('table.chatExpand')} title={t('table.chatExpand')}>
            <AppIcon name="chat" />
            {unread > 0 && <span className={styles.unread}>{unread}</span>}
          </button>
        )}
        <div className={`${styles.chatBody} ${chatOpen ? '' : styles.hidden}`} inert={!chatOpen}>
          {/* Shared playback chats in the live room, not the recorded one. */}
          {replay ? <TableStoreScope stores={null}><ChatPanel onCollapse={collapseChat} /></TableStoreScope>
            : <ChatPanel onCollapse={collapseChat} />}
        </div>
      </aside>}

      <p className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {turnAnnouncement}
      </p>
      {!presentation.locked && overlay}
      {settlementVisible && visibleGame && room && <VictoryEffects game={visibleGame} room={room}
        bottomSeat={bottomSeat} seats={tableSeats} />}
      {rulesVisible && visibleGame && <GameRulesDialog gameType={visibleGame.gameType}
        context={matchRulesContext(visibleGame)} onClose={() => setRulesOpen(false)} />}
    </div>
  );
  return <CardBackArtContext value={cardBackArt}>{shell}</CardBackArtContext>;
}
