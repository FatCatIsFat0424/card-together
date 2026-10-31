// ─── GameShell: table frame shared by all games (info rail + table + chat + abort vote) ───

import useMediaQuery from '@mui/material/useMediaQuery';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlayerVisibleGameState, GameSeat } from '@shared/types';
import type { TranslationKey } from '../i18n';
import {
  playBoardSound, playCardSound, playDiceRevealSound, playDiceRollSound, playOutSound, unlockCardSounds,
  disposeCardSounds,
} from '../audio/card-sound';
import { cardBackStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useChatStore } from '../stores/chat-store';
import { useChatMentionStore } from '../stores/chat-mention-store';
import { useChatMentionJump } from '../hooks/use-chat-mention-jump';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { useSeatName } from './seat-names';
import { ChatPanel } from '../components/ChatPanel';
import { Dock, DockCount } from '../components/Dock';
import { DESKTOP_SHELL_QUERY } from '../components/desktop-nav';
import { TableSeat } from '../components/TableSeat';
import { AppCheckbox } from '../components/AppCheckbox';
import { lastElimination, lastMove, matchSeats, seatLayout, tablePosition, usesCornerSlots } from '../game-view';
import type { TablePosition } from '../game-view';
import { AbortVoteBanner, AbortVoteButton } from './AbortVote';
import { SpectatorLeaveButton } from './SpectatorLeave';
import { EarlyLeaveButton } from './EarlyLeave';
import { useBoardMoveSound } from './board/board-move-sound';
import { ActionButton } from '../components/ActionButton';
import { AppIcon } from '../components/AppIcon';
import { IconButton } from '../components/IconButton';
import { RoomHeader } from '../components/RoomHeader';
import type { RoomHeaderStatus } from '../components/RoomHeader';
import { GameSpectators, SpectatorsTabLabel } from './GameSpectators';
import { VoiceButton, VoiceDockPanel } from '../components/VoiceControls';
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
import { AutoPlayBanner, TableTools, TableToolsDrawer } from './TableTools';
import { GameMenuLinks, useGameMenuUnread } from './GameMenuLinks';
import { RotateHint } from './RotateHint';
import { godViewSource, useReplayMode } from './replay-mode';
import { TableStoreScope } from './TableStoreScope';
import { gameUi } from './ui-registry';

/** Wide enough for the dock to sit beside the table; narrower desktop windows start with it collapsed. */
const DOCK_OPEN_QUERY = '(min-width: 1024px)';
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

/** Phones open the info and chat as sheets; the desktop shell docks them beside the table. */
const sheetsAreOverlays = (): boolean => matches(SHEET_QUERY);

/** The game tab holds the game's info with the chat below it. */
type TableDockTab = 'info' | 'spectators' | 'voice';

interface GameShellProps {
  /** Info rail content (dock tab on desktop, drawer on phones) */
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
  /** Selectable seat chosen so far */
  pickedSeat?: GameSeat | null;
  /** Accessible name of a selectable seat */
  pickLabel?: TranslationKey;
  turnReady?: boolean;
  /**
   * Board games draw their own seats, board, and controls (`BoardTable`): this replaces the seat ring,
   * the table centre, and the hand zone.
   */
  board?: ReactNode;
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
  info, centre, centreForeground, hand, overlay, panel, tableEffect, centreVisible, prompt, error, pickableSeats, onPickSeat, pickedSeat, pickLabel,
  turnReady, board,
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
    ?? state.sevens?.log ?? state.chinesePoker?.log ?? state.liarsDeck?.log ?? state.liarsDice?.log ?? state.blackjack?.log ?? state.holdem?.log
    ?? state.napoleon?.log ?? state.tenhalf?.log ?? state.doudizhu?.log ?? state.crazyEights?.log ?? state.stud?.log ?? state.reversi?.log ?? state.gomoku?.log ?? state.oldMaid?.log ?? state.goFish?.log ?? state.jungle?.log ?? state.xiangqi?.log ?? state.banqi?.log
    ?? state.chineseCheckers?.log ?? state.landbattle?.log ?? state.battleship?.log ?? state.log);
  const ownedTurn = useGameStore((state) => mySeat !== null && state.currentTurnSeat === mySeat
    && (state.phase === 'bidding' || state.phase === 'playing'));
  const myTurn = (turnReady ?? ownedTurn) && !presentation.locked;
  const turnSeat = useGameStore((state) => state.phase === 'bidding' || state.phase === 'playing'
    ? state.currentTurnSeat : null);
  const move = lastMove(log);
  const out = lastElimination(log);
  const [outBanner, setOutBanner] = useState<{ seat: GameSeat; index: number } | null>(null);
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const seatName = useSeatName();
  const turnName = turnSeat ? seatName(turnSeat) : '';
  const turnAnnouncement = presentation.locked || !turnSeat ? ''
    : turnSeat === mySeat ? (myTurn ? t('table.yourTurn') : '') : t('table.turnOf', { name: turnName });
  // The header pill names whose turn it is and lights up on the viewer's own.
  const headerStatus: RoomHeaderStatus | null = myTurn ? { text: t('table.yourTurn'), tone: 'turn' }
    : turnSeat && turnSeat !== mySeat ? { text: t('table.turnOf', { name: turnName }) } : null;
  const dockLayout = useMediaQuery(DESKTOP_SHELL_QUERY);
  // The game info leads: it carries the contract and auction that the bidding panel only summarizes.
  const [dockTab, setDockTab] = useState<TableDockTab>('info');
  const [dockOpen, setDockOpen] = useState(() => matches(DOCK_OPEN_QUERY));
  const dockToggleRef = useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = useRef(false);
  // On phones chat and info are bottom drawers, closed by default
  const [chatOpen, setChatOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const settlementVisible = Boolean(overlay) && !presentation.locked;
  const rulesVisible = rulesOpen && !settlementVisible && visibleGame !== null;
  const [seenMessages, setSeenMessages] = useState(0);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const infoPanelRef = useRef<HTMLDivElement>(null);
  const chatRailRef = useRef<HTMLElement>(null);
  useSheetFocus(infoOpen && !rulesVisible, infoPanelRef, infoButtonRef, sheetsAreOverlays);
  // Focusing the chat input would raise the phone keyboard; focus the sheet itself.
  useSheetFocus(chatOpen && !rulesVisible, chatRailRef, chatButtonRef, sheetsAreOverlays, 'panel');
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
  const layout = board ? null : seatLayout(tableSeats);
  const expandedTable = !board && usesCornerSlots(tableSeats);
  // Empty cells go to their neighbours: with no side seats (six players) the top corner seats reach down beside
  // the centre, and with no opposite seat (five players) the centre rises between the top corner seats.
  const sidePositions = tableSeats.filter((seat) => seat !== bottomSeat)
    .map((seat) => tablePosition(seat, bottomSeat, tableSeats));
  const cornersSpan = layout === 'ring' && !sidePositions.includes('left') && !sidePositions.includes('right');
  const centreUp = layout === 'ring' && !sidePositions.includes('top');
  const chatShown = dockLayout ? dockOpen && dockTab === 'info' : chatOpen;
  const unread = chatShown ? 0 : Math.max(0, messageCount - seenMessages);
  const mentionCount = useChatMentionStore((state) => chatVisible ? state.unreadIds.length : 0);
  const mentionLabel = mentionCount > 0 ? ` · ${t('chat.notifications.unread', { n: String(mentionCount) })}` : '';
  useChatMentionJump(useCallback(() => {
    if (!chatVisible) return;
    setInfoOpen(false);
    setDockTab('info');
    setDockOpen(true);
    setChatOpen(true);
  }, [chatVisible]));
  // Phones hide the app bar during games, so this sheet becomes the menu for everything it held.
  const sheetLayout = useMediaQuery(SHEET_QUERY);
  const phoneMenu = sheetLayout && !replay;
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
    if (board || visibleGame?.presentation || !move || move.index === heardMove.current) return;
    heardMove.current = move.index;
    playCardSound(move.pass);
  }, [move, visibleGame?.presentation, board]);
  useBoardMoveSound(!!board);

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
    else if (cue === 'diceRoll') playDiceRollSound();
    else if (cue === 'diceReveal') playDiceRevealSound();
    else if (cue) playBoardSound(cue);
  }, [presentation.frame, visibleGame]);

  const collapseChat = useCallback((): void => {
    setSeenMessages(messageCount);
    setChatOpen(false);
  }, [messageCount]);

  // Chat seen so far: leaving its tab or collapsing the dock marks everything up to now as read.
  const collapseDock = useCallback((): void => {
    if (dockOpen && dockTab === 'info') setSeenMessages(messageCount);
    setDockOpen(false);
  }, [dockOpen, dockTab, messageCount]);
  const changeDockTab = (tab: TableDockTab): void => {
    if (dockTab === 'info') setSeenMessages(messageCount);
    setDockTab(tab);
  };
  // The header's chat and voice buttons open the dock on their tab, or collapse it when it already shows it.
  const toggleDockTab = (tab: TableDockTab): void => {
    if (dockOpen && dockTab === 'info') setSeenMessages(messageCount);
    if (dockOpen && dockTab === tab) { setDockOpen(false); return; }
    setDockTab(tab);
    setDockOpen(true);
  };
  const collapseDockFromButton = (): void => {
    restoreToggleFocus.current = true;
    collapseDock();
  };
  useEffect(() => {
    if (dockOpen || !restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    dockToggleRef.current?.focus();
  }, [dockOpen]);

  // Collapse the drawers when the window becomes a phone, and the dock when it gets too narrow to sit beside the table
  useEffect(() => {
    const wide = window.matchMedia(DOCK_OPEN_QUERY);
    const sheets = window.matchMedia(SHEET_QUERY);
    const onChange = (): void => {
      if (sheets.matches) collapseChat();
      if (!wide.matches) collapseDock();
    };
    wide.addEventListener('change', onChange);
    sheets.addEventListener('change', onChange);
    return (): void => {
      wide.removeEventListener('change', onChange);
      sheets.removeEventListener('change', onChange);
    };
  }, [collapseChat, collapseDock]);

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

  const rulesButton = visibleGame && <button type="button" className={`btn btn-outline ${styles.rulesRailButton}`}
    aria-haspopup="dialog" onClick={openRules}>
    <AppIcon name="rules" /> {t('rules.open')}
  </button>;
  // The phone menu lists the header's controls in its order: room code, rules, voice, chat, then the exits.
  const sheetControls = <>
    {!replay && room && <RoomCodeButton key={room.code} code={room.code} compact={phoneMenu} className={styles.menuRoomCode} />}
    {rulesButton}
    {!replay && <VoiceButton labelled className={styles.menuAction} />}
    {!replay && <ActionButton icon="chat" text={t('chat.title')} badge={unread} mentionCount={mentionCount} className={styles.menuAction}
      label={(unread > 0 ? `${t('chat.title')} ${t('room.unread', { n: String(unread) })}` : t('chat.title')) + mentionLabel}
      onClick={openChat} />}
    {!replay && <>
      <AbortVoteButton className={styles.menuExit} />
      <EarlyLeaveButton className={styles.menuExit} />
      <SpectatorLeaveButton className={styles.menuExit} />
    </>}
  </>;
  const header =dockLayout && !replay && room && visibleGame && <RoomHeader className={styles.header}
    title={t(`gameType.${visibleGame.gameType}`)} code={room.code} status={headerStatus}
    onBack={() => navigate('/')} onRules={openRules}
    voice={<VoiceButton labelled dock={{ id: 'game-dock', open: dockOpen && dockTab === 'voice',
      onToggle: () => toggleDockTab('voice') }} />}
    chat={{ unread, mentions: mentionCount, expanded: chatShown, controls: 'game-dock', onToggle: () => toggleDockTab('info') }}
    actions={<>
      <AbortVoteButton appearance="header" />
      <EarlyLeaveButton appearance="header" />
      <SpectatorLeaveButton appearance="header" />
    </>} />;
  const motionSetting = SHOW_REDUCED_MOTION_CONTROL && <label className={styles.motionSetting}>
    <AppCheckbox checked={reducedMotion}
      onChange={(event) => setReducedMotion(event.target.checked)} />
    {t('table.reduceMotion')}
  </label>;
  const infoContent = <div className={styles.infoContent}>
    {info}
    {visibleGame && <RoundHistory game={visibleGame} />}
  </div>;
  // Shared playback chats in the live room, not the recorded one.
  const chatPanel = replay ? <TableStoreScope stores={null}><ChatPanel embedded captioned /></TableStoreScope>
    : <ChatPanel embedded captioned />;
  const dockTabs = [
    { id: 'info' as const, panel: <div className={styles.dockHome}>
      <div className={styles.dockInfo}>
        {/* Live tables open the rules from the header; playback has no header. */}
        {replay && rulesButton}
        {motionSetting}
        {infoContent}
      </div>
      {chatVisible && <div className={styles.dockChat}>{chatPanel}</div>}
    </div>,
    label: <>{t('table.gameTab')}{unread > 0 && <DockCount label={t('room.unread', { n: String(unread) })}>
      {unread > 99 ? '99+' : unread}</DockCount>}
      {mentionCount > 0 && <DockCount mention label={t('chat.notifications.unread', { n: String(mentionCount) })}>
        @{mentionCount > 99 ? '99+' : mentionCount}</DockCount>}</> },
    ...!replay ? [{ id: 'spectators' as const, panel: <GameSpectators layout="dock" />,
      label: <SpectatorsTabLabel /> }] : [],
    ...!replay ? [{ id: 'voice' as const, label: t('voice.title'), panel: <VoiceDockPanel className={styles.dockVoice} /> }] : [],
  ];
  const dockToggleLabel = unread > 0 ? `${t('dock.expand')} ${t('room.unread', { n: String(unread) })}` : t('dock.expand');

  const shell = (
    <div data-game-shell data-reduced-motion={reducedMotion || undefined}
      className={`${styles.gameContainer} ${dockLayout ? (dockOpen ? '' : styles.dockHidden) : `${chatOpen ? '' : styles.chatCollapsed} ${infoOpen ? styles.infoOpen : ''} ${chatVisible ? '' : styles.noChat}`} ${replay ? styles.replayMode : ''} ${header ? styles.withHeader : ''}`}
      style={cardBackStyle(account, reducedMotion, !!cardBackArt)}>
      {header}
      {!dockLayout && (infoOpen || chatOpen) && <button type="button" className={styles.backdrop} tabIndex={-1}
        aria-label={t('table.close')} onClick={closeSheets} />}

      {!dockLayout && <div className={styles.infoPanel} id="game-info-panel" ref={infoPanelRef}>
        <div className={styles.sheetHeader}>
          <span>{t(phoneMenu ? 'topbar.menu' : 'table.info')}</span>
          <button type="button" className={styles.sheetClose} onClick={() => setInfoOpen(false)}
            aria-label={t('table.close')} title={t('table.close')}><AppIcon name="close" /></button>
        </div>
        {sheetControls}
        {motionSetting}
        {infoContent}
        {!replay && <GameSpectators layout="sheet" />}
        {phoneMenu && <GameMenuLinks />}
      </div>}

      <main className={`${styles.centreColumn} ${tableStyle ? styles.customTable : ''} ${tableArt ? styles.layeredTable : ''}`} style={tableStyle}>
        {tableArt && <TableArt art={tableArt} />}
        <div className={`${styles.table} ${expandedTable ? styles.expandedTable : ''} ${cornersSpan ? styles.cornersSpan : ''} ${centreUp ? styles.centreUp : ''} ${layout === 'trio' ? styles.trioTable : ''} ${layout === 'facing' ? styles.facingTable : ''} ${board ? styles.boardMode : ''}`}
          data-card-table data-hud-info={HudInfo ? '' : undefined}
          data-expanded-table={expandedTable ? '' : undefined}>
          {dockLayout && !dockOpen && <IconButton className={`${styles.hudButton} ${styles.dockToggle}`}
            icon={chatVisible ? 'chat' : 'info'} label={dockToggleLabel + mentionLabel} badge={unread} mentionCount={mentionCount}
            onClick={() => { setDockTab('info'); setDockOpen(true); }} ref={dockToggleRef} aria-controls="game-dock" aria-expanded={false} />}
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
              label={t('table.chatExpand') + mentionLabel} onClick={openChat} ref={chatButtonRef}
              badge={unread} mentionCount={mentionCount} aria-expanded={chatOpen} />}
          </div>
          {board}
          {!board && tableSeats.filter((seat) => seat !== bottomSeat && tableSeats.includes(seat)).map((seat) => (
            <TableSeat key={seat} seat={seat} position={tablePosition(seat, bottomSeat, tableSeats)}
              onObserve={watching ? () => observeSeat(seat) : undefined}
              suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === seat ? presentation.frame.key : undefined
                : move?.seat === seat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(seat) ? () => onPickSeat(seat) : undefined}
              picked={pickedSeat === seat} pickLabel={pickLabel} />
          ))}
          {!board && <FittedCentre foreground={centreForeground} responsive={Boolean(centreLayout?.responsive) && !presentation.frame}
            wide={Boolean(centreLayout?.wide)}
            style={move ? FLY_FROM[tablePosition(move.seat, bottomSeat, tableSeats)] : undefined}>
            {presentation.frame && visibleGame && !centreVisible ? (
              <GamePresentation key={presentation.frame.key} frame={presentation.frame}
                bottomSeat={bottomSeat} game={visibleGame}
                elapsedMs={Math.max(0, Date.now() - presentation.frameStartedAt)}
                summary={presentationSummary(visibleGame, t)} />
            ) : <div className={`${styles.centreBody} ${visibleGame?.presentation ? styles.settledCentre : ''}`}>{centre}</div>}
          </FittedCentre>}
          {outBanner && <p key={outBanner.index} className={styles.outBanner} role="status">
            <AppIcon name="burst" /> {t('table.eliminated', { name: seatName(outBanner.seat) })}
          </p>}
          {panel && !presentation.locked && <div className={styles.actionPanel} inert={visibleGame?.autoPlay}>{panel}</div>}
          {!replay && <AbortVoteBanner />}
          {!replay && <AutoPlayBanner />}
          <RotateHint />
        </div>

        {!board && <div className={styles.handZone} data-hand-zone>
          <div className={styles.handHeader}>
            {tableSeats.includes(bottomSeat) && <TableSeat seat={bottomSeat} position="bottom" suppressTurn={presentation.locked}
              onObserve={watching ? () => observeSeat(bottomSeat) : undefined}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === bottomSeat ? presentation.frame.key : undefined
                : move?.seat === bottomSeat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(bottomSeat) ? () => onPickSeat(bottomSeat) : undefined}
              picked={pickedSeat === bottomSeat} pickLabel={pickLabel} />}
          </div>
          <div className={styles.handStatus}>
            {godView && <p className={styles.godView} title={watching ? t('table.changePerspective') : undefined}>
              {t(godView === 'spectator' ? 'table.spectating' : 'table.godView')}
            </p>}
            {myTurn && <p className={styles.yourTurn}>{t('table.yourTurn')}</p>}
            {prompt && <p className={styles.handPrompt}>{prompt}</p>}
            {error && <p className={styles.actionError} role="alert">{error}</p>}
          </div>
          {!replay && (sheetLayout ? <TableToolsDrawer /> : <TableTools />)}
          <div className={styles.handBody} inert={visibleGame?.autoPlay}>{hand}</div>
        </div>}
        {tableEffect}
      </main>

      {dockLayout ? <div className={styles.dock} inert={!dockOpen}>
        <Dock id="game-dock" label={t('table.dock')} value={dockTab} onChange={changeDockTab}
          onCollapse={collapseDockFromButton} tabs={dockTabs} />
      </div> : chatVisible && <aside className={styles.chatRail} ref={chatRailRef} tabIndex={-1} aria-label={t('chat.title')}>
        {!chatOpen && (
          <button type="button" className={styles.chatStrip} onClick={() => setChatOpen(true)}
            aria-label={t('table.chatExpand') + mentionLabel} title={t('table.chatExpand') + mentionLabel}>
            <AppIcon name="chat" />
            {unread > 0 && <span className={styles.unread}>{unread}</span>}
            {mentionCount > 0 && <span className={styles.unread}>@{mentionCount > 99 ? '99+' : mentionCount}</span>}
          </button>
        )}
        <div className={`${styles.chatBody} ${chatOpen ? '' : styles.hidden}`} inert={!chatOpen}>
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
