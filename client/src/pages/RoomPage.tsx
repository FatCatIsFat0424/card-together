import { isNumberedSeatGame, maxPlayers, roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Popover from '@mui/material/Popover';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GAME_SEAT_ORDER, MAX_SPECTATORS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { EXPANDABLE_ROOM_GAMES, gameDefinition, gameTimeControl } from '@shared/games/registry';
import type {
  BotDifficulty, GameOptionsPayload, GameSeat, GameType, PlayerInfo, RoomInfo, RoomSeatTarget, Seat, TimeControl,
} from '@shared/types';
import type { TranslationKey } from '../i18n';
import { socket } from '../socket';
import { roomErrorKey } from '../room-error-i18n';
import { roomReplayErrorKey, roomReplayMembers } from '../room-replay';
import { GAME_CARD_ART } from '../game-backgrounds';
import { seatBackgroundStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { useChatStore } from '../stores/chat-store';
import { useChatMentionStore } from '../stores/chat-mention-store';
import { useChatMentionJump } from '../hooks/use-chat-mention-jump';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { seatLabel } from '../games/seat-names';
import { useMotionStore } from '../stores/motion-store';
import { RoomSpectators } from '../components/RoomSpectators';
import { Dock, DockCount } from '../components/Dock';
import { ChatPanel } from '../components/ChatPanel';
import { InviteFriends } from '../components/InviteFriends';
import { RoomSettings } from '../components/RoomSettings';
import { RoomSummaryCard } from '../components/RoomSummaryCard';
import { AddSeatSlot, RoomSeat, SeatDragPreview } from '../components/RoomSeat';
import type { SeatDropView } from '../components/RoomSeat';
import { PlayerMoveMenu } from '../components/PlayerMoveMenu';
import { Button } from '../components/Button';
import { ActionButton } from '../components/ActionButton';
import { useConnectionReady } from '../games/use-connection-ready';
import { GameRulesDialog } from '../components/GameRulesDialog';
import { roomRulesContext } from '../game-rules-context';
import { VoiceButton, VoiceDockPanel } from '../components/VoiceControls';
import { RoomHeader } from '../components/RoomHeader';
import styles from './RoomPage.module.css';
import botSeatBackground from '../assets/room-backgrounds/bot-seat.webp';
import { unreadCount } from './room-progress';
import { ovalPosition } from './room-oval';
import { roomOptionChips, roomSummaryStatus, roomTimeChips, summaryDots } from './room-summary';
import { moveOptions, roomSeatCards, seatDropOutcome, spectatorDropOutcome } from './room-moves';
import type { DropAction, DropOutcome, MoveOption } from './room-moves';
import { readPreference, writePreference } from '../utils/preference-storage';
import { useRoomSeatDrag } from '../hooks/use-room-seat-drag';
import { layeredShopArt } from '../cosmetics/art-layers/shop-art-layers';
import { TableArt } from '../cosmetics/art-layers/TableArt';

type RoomDockTab = 'chat' | 'spectators' | 'voice';
const RoomReplayPicker = lazy(() => import('../components/RoomReplayPicker')
  .then((module) => ({ default: module.RoomReplayPicker })));

const DRAG_HINT_KEY = 'room.dragHint';
type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

/** Name of a move destination, as the seat cards and the move menu show it. */
function seatTargetLabel(t: Translate, gameType: GameType, target: RoomSeatTarget): string {
  if (target.type === 'spectator') return t('room.moveToSpectators');
  if (target.type === 'seat') return seatLabel(t, gameType, target.seat);
  return additionalSeatLabel(t, gameType, target.index);
}

function additionalSeatLabel(t: Translate, gameType: GameType, index: number): string {
  return isNumberedSeatGame(gameType) ? seatLabel(t, gameType, GAME_SEAT_ORDER[index + 4])
    : t('room.additionalSeat', { n: String(index + 5) });
}

export function RoomPage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const playerId = usePlayerStore((state) => state.playerId);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [dockTab, setDockTab] = useState<RoomDockTab>('chat');
  const chatToggleRef = useRef<HTMLButtonElement>(null);
  const compactLayout = useMediaQuery('(max-width: 1023px), (max-height: 700px)');
  const touchInput = useMediaQuery('(hover: none)');
  const dockVisible = compactLayout ? chatOpen : dockOpen;
  const chatVisible = dockVisible && (compactLayout || dockTab === 'chat');
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const stillArt = reducedMotion || systemReducedMotion;
  const tableArt = stillArt ? null : layeredShopArt(account?.tableBackgroundStyle);
  const tableStyle = tableBackgroundStyle(account, stillArt, !!tableArt);
  const [enteredRoom, setEnteredRoom] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [dragHintDone, setDragHintDone] = useState(() => readPreference(DRAG_HINT_KEY) === 'done');
  const [moved, setMoved] = useState('');
  const [replayPickerOpen, setReplayPickerOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [spectatorAnchor, setSpectatorAnchor] = useState<HTMLElement | null>(null);
  const [readyNotice, setReadyNotice] = useState<{ id: number; message: string } | null>(null);
  const messageCount = useChatStore((state) => state.messages.length);
  const [seenMessages, setSeenMessages] = useState(messageCount);
  const unread = unreadCount(messageCount, seenMessages, chatVisible);
  const mentionCount = useChatMentionStore((state) => state.unreadIds.length);
  useChatMentionJump(useCallback(() => {
    setDockTab('chat');
    setDockOpen(true);
    setChatOpen(true);
  }, []));
  const attemptedRoom = useRef<string | null>(null);
  const hadRoom = useRef(false);
  const leaving = useRef(false);
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const previousSeats = useRef<RoomInfo | null>(roomInfo);
  const myAdditionalSeat = roomInfo?.additionalSeats?.findIndex((entry) => entry.player?.id === playerId) ?? -1;
  const connectionReady = useConnectionReady();
  const blocked = busy || !connectionReady;
  const isReady = mySeat ? (roomInfo ? roomSeatInfo(roomInfo, mySeat)?.isReady : false) ?? false : false;
  const isHost = Boolean(playerId) && roomInfo?.hostId === playerId;
  const hasEmptySeat = roomInfo
    ? roomSeatCards(roomInfo, () => '').some(({ info }) => !info.player) : false;
  const canManagePlayers = isHost && connectionReady && roomInfo?.status === 'waiting';
  const canMovePlayers = canManagePlayers && !blocked;
  const canSpectate = Boolean(mySeat || myAdditionalSeat >= 0) && !blocked && roomInfo?.status === 'waiting';
  const pendingDisabled = (unavailable = false): true | undefined =>
    busy && connectionReady && !unavailable ? true : undefined;
  const handleResult = (timeout: Error | null, result?: { success: boolean; error?: string }): void => {
    setBusy(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!result?.success) setError(t(roomReplayErrorKey(result?.error)));
  };
  const targetLabel = (gameType: GameType, target: RoomSeatTarget): string => seatTargetLabel(t, gameType, target);
  const movePlayer = (player: PlayerInfo, target: RoomSeatTarget): void => {
    if (!canMovePlayers || !roomInfo) return;
    if (target.type === 'seat' && roomInfo.seats[target.seat].player?.id === player.id) return;
    if (target.type === 'additional' && roomInfo.additionalSeats?.[target.index]?.player?.id === player.id) return;
    if (target.type === 'spectator' && roomInfo.spectators?.some((entry) => entry.id === player.id)) return;
    setBusy(true);
    setError('');
    setMoved('');
    socket.timeout(10000).emit('room:movePlayer', { accountId: player.id, target }, (timeout, result) => {
      handleResult(timeout, result);
      if (timeout || !result?.success) return;
      setMoved(t('room.moved', { nickname: player.nickname, place: targetLabel(roomInfo.gameType, target) }));
      setDragHintDone(true);
      writePreference(DRAG_HINT_KEY, 'done');
    });
  };
  // A compact layout lists spectators in a popover; it closes on pick-up so the seats are free to drop on.
  const seatDrag = useRoomSeatDrag(canMovePlayers, movePlayer, () => setSpectatorAnchor(null));

  useLayoutEffect(() => {
    const previous = previousSeats.current;
    previousSeats.current = roomInfo;
    if (!roomInfo || previous?.code !== roomInfo.code || roomInfo.status !== 'waiting' || stillArt) return;

    const arrivals = [
      ...SEAT_ORDER_CLOCKWISE.map((seat) => ({ key: seat, before: previous.seats[seat], after: roomInfo.seats[seat] })),
      ...(roomInfo.additionalSeats ?? []).map((after, index) => ({
        key: `additional-${index}`, before: previous.additionalSeats?.[index], after,
      })),
    ];
    const animations: Animation[] = [];
    const reveal: Keyframe[] = [
      { opacity: 0, transform: 'translateY(8px) scale(0.96)', offset: 0 },
      { opacity: 1, transform: 'translateY(0) scale(1.02)', offset: 0.65 },
      { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 },
    ];
    for (const { key, before, after } of arrivals) {
      if (before?.player || !after.player || after.player.isBot) continue;
      const card = tableAreaRef.current?.querySelector<HTMLElement>(`[data-room-drop="${key}"] > :first-child`);
      if (card) animations.push(card.animate(reveal, { duration: 300, easing: 'ease-out' }));
    }
    return () => { animations.forEach((animation) => animation.cancel()); };
  }, [roomInfo, stillArt]);

  useEffect(() => {
    if (leaving.current) return;
    if (!roomCode) { navigate('/', { replace: true }); return; }
    if (roomInfo) {
      hadRoom.current = true;
      attemptedRoom.current = roomInfo.code;
      if (phase) navigate(`/game/${roomInfo.code}`, { replace: true });
      else if (roomInfo.status === 'replaying') navigate(`/room/${roomInfo.code}/replay`, { replace: true });
      else if (roomInfo.code !== roomCode) navigate(`/room/${roomInfo.code}`, { replace: true });
    } else if (attemptedRoom.current !== roomCode) {
      attemptedRoom.current = roomCode;
      socket.timeout(10000).emit('room:join', { roomCode }, (timeout, result) => {
        if (timeout) setError(t('auth.connectionError'));
        else if (!result.success) setError(t(roomErrorKey(result.error)));
      });
    } else if (hadRoom.current) {
      navigate('/', { replace: true });
    }
  }, [roomCode, roomInfo, phase, navigate, t]);

  const toggleChat = (): void => {
    setSeenMessages(messageCount);
    if (compactLayout) setChatOpen((open) => !open);
    else if (dockOpen && dockTab === 'chat') setDockOpen(false);
    else { setDockTab('chat'); setDockOpen(true); }
  };
  const collapseChat = (): void => {
    setSeenMessages(messageCount);
    if (compactLayout) setChatOpen(false);
    else setDockOpen(false);
    chatToggleRef.current?.focus();
  };
  const changeDockTab = (tab: RoomDockTab): void => {
    setSeenMessages(messageCount);
    setDockTab(tab);
  };
  // With a dock the call panel is its tab; the compact layout keeps the voice popover.
  const toggleVoiceTab = (): void => {
    setSeenMessages(messageCount);
    if (dockOpen && dockTab === 'voice') setDockOpen(false);
    else { setDockTab('voice'); setDockOpen(true); }
  };
  // The popover is the compact layout's spectator list; with a dock the list is its tab.
  const openSpectators = (button: HTMLElement): void => {
    if (compactLayout) { setSpectatorAnchor(button); return; }
    setDockTab('spectators');
    setDockOpen(true);
  };

  const changeSeat = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:changeSeat', { seat }, handleResult);
  };
  const changeAdditionalSeat = (index: number): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:changeAdditionalSeat', { index }, handleResult);
  };
  const addSeat = (): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:addSeat', handleResult);
  };
  const removeSeat = (): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:removeSeat', handleResult);
  };
  const start = (): void => {
    if (blocked || !roomInfo || !roomCanStart(roomInfo) || !isHost) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:start', handleResult);
  };
  const startReplay = (subjectId: string, matchId: string): void => {
    if (blocked || !isHost) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:replay:start', { subjectId, matchId }, (timeout, result) => {
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      // The subject's account is the only player this request looks up.
      else if (!result.success) setError(t(result.error === 'Player not found.' ? 'replay.sharedErrorNotFound' : roomReplayErrorKey(result.error)));
      else setReplayPickerOpen(false);
    });
  };
  const setShuffleSeats = (enabled: boolean): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setShuffleSeats', { enabled }, handleResult);
  };
  const ready = (): void => {
    if (blocked || !roomInfo) return;
    if (!mySeat && myAdditionalSeat < 0) {
      setReadyNotice({ id: Date.now(), message: t('room.spectatorHint') });
      return;
    }
    setBusy(true);
    setError('');
    setReadyNotice(null);
    socket.timeout(10000).emit(isReady ? 'room:unready' : 'room:ready', (timeout, result) => {
      setBusy(false);
      if (timeout || !result?.success) setReadyNotice({ id: Date.now(),
        message: timeout ? t('auth.connectionError') : t(roomErrorKey(result?.error)),
      });
    });
  };
  const setGameType = (gameType: GameType): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setGameType', { gameType }, handleResult);
  };
  const setTimeControl = (settings: TimeControl): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setTimeControl', settings, handleResult);
  };
  const setGameOptions = (payload: GameOptionsPayload): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setGameOptions', payload, handleResult);
  };
  const addBot = (seat: GameSeat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:addBot', { seat }, handleResult);
  };
  const removeBot = (seat: GameSeat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:removeBot', { seat }, handleResult);
  };
  const setBotDifficulty = (seat: GameSeat, difficulty: BotDifficulty): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setBotDifficulty', { seat, difficulty }, handleResult);
  };
  const kick = (player: PlayerInfo): void => {
    if (!window.confirm(t('room.kickConfirm', { nickname: player.nickname }))) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:kick', { accountId: player.id }, handleResult);
  };
  const standUp = (): void => {
    if (!canSpectate) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:standUp', handleResult);
  };
  const fillBots = (): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:fillBots', handleResult);
  };
  const leave = (): void => {
    leaving.current = true;
    setBusy(true);
    socket.timeout(10000).emit('room:leave', (timeout, result) => {
      handleResult(timeout, result);
      if (!timeout && result.success) {
        // Clear the room before navigating so the lobby does not redirect back to it.
        useRoomStore.getState().leaveRoom();
        navigate('/');
      }
      else leaving.current = false;
    });
  };

  if (!roomInfo || !roomCode) return <main className={styles.roomContainer}>
    <p role={error ? 'alert' : 'status'}>{error || t('common.loading')}</p>
    {error && <Link to="/">{t('nav.lobby')}</Link>}
  </main>;

  const additionalSeats = roomInfo.additionalSeats ?? [];
  const entering = enteredRoom !== roomInfo.code && !stillArt;
  const waiting = roomInfo.status === 'waiting';
  const seatCards = roomSeatCards(roomInfo, (seat, additionalIndex) => additionalIndex === undefined
    ? seatLabel(t, roomInfo.gameType, seat) : additionalSeatLabel(t, roomInfo.gameType, additionalIndex));
  const spectators = roomInfo.spectators ?? [];
  const expandableSeats = EXPANDABLE_ROOM_GAMES.includes(roomInfo.gameType);
  const canAddSeat = isHost && expandableSeats && seatCards.length < maxPlayers(roomInfo.gameType);
  const slotCount = seatCards.length + (canAddSeat ? 1 : 0);
  const firstSeat = Math.max(0, seatCards.findIndex(({ info }) => info.player?.id === playerId));
  const dragging = seatDrag.drag;
  const actionLabels: Record<DropAction, string> = {
    move: t('room.dropMove'), swap: t('room.dropSwap'), sit: t('room.dropSit'), spectate: t('room.dropSpectate'),
  };
  const dropView = (key: string, outcome: DropOutcome): SeatDropView | null => {
    if (!dragging || outcome.state === 'origin') return null;
    if (outcome.state === 'unavailable') return { state: 'unavailable', label: t('room.dropBotBlocked') };
    return dragging.targetKey === key
      ? { state: 'hover', label: outcome.action ? actionLabels[outcome.action] : null }
      : { state: 'available', label: null };
  };
  const spectatorDrop = dragging ? dropView('spectator', spectatorDropOutcome(dragging.source)) : null;
  const dragBar = ((): string | null => {
    if (!dragging) return null;
    const cancel = t(touchInput ? 'room.dragCancelTouch' : 'room.dragCancelPointer');
    const key = dragging.targetKey;
    const card = seatCards.find((entry) => entry.key === key);
    let action: string;
    if (key === 'spectator') action = t('room.dragBarSpectate');
    else if (card) {
      const outcome = seatDropOutcome(dragging.source, card.info.player, card.info.player?.id === dragging.player.id);
      if (outcome.state === 'unavailable') action = t('room.dragBarBlocked');
      else if (outcome.action === 'swap') {
        action = t('room.dragBarSwap', { name: card.info.player?.nickname ?? card.label });
      } else if (outcome.action === 'sit') action = t('room.dragBarSit', { seat: card.label });
      else if (outcome.action === 'move') action = t('room.dragBarMove', { seat: card.label });
      else action = t('room.dragBarIdle');
    } else action = t('room.dragBarIdle');
    return `${action} · ${cancel}`;
  })();
  const canStart = roomCanStart(roomInfo);
  const definition = gameDefinition(roomInfo.gameType).seats;
  const players = definition.minPlayers === definition.maxPlayers
    ? t('lobby.players', { n: String(definition.maxPlayers) })
    : t('lobby.playersRange', { min: String(definition.minPlayers), max: String(definition.maxPlayers) });
  const matchHands = gameDefinition(roomInfo.gameType).matchHands;
  const timeControl = roomInfo.timeControl ?? gameTimeControl(roomInfo.gameType);
  const summary = roomSummaryStatus(roomInfo, seatCards, { isHost,
    seatReady: seatCards.find((card) => card.info.player?.id === playerId)?.info.isReady ?? null });
  const memberMenu = (player: PlayerInfo, variant: 'seat' | 'row'): ReactNode => isHost && waiting && !player.isBot &&
    <PlayerMoveMenu key="move-menu" variant={variant} player={player} spectatorCount={spectators.length}
      options={moveOptions(seatCards, spectators, player, MAX_SPECTATORS)} disabled={blocked}
      onKick={player.id === playerId ? undefined : () => kick(player)}
      onMove={(option: MoveOption) => movePlayer(player, option.target)} />;
  const spectatorList = (layout: 'popover' | 'dock'): ReactNode => <RoomSpectators layout={layout}
    spectators={spectators} hostId={roomInfo.hostId} playerId={playerId}
    seated={Boolean(mySeat || myAdditionalSeat >= 0)} canSpectate={canSpectate} canManage={canManagePlayers}
    isHost={isHost} blocked={blocked} pending={Boolean(pendingDisabled(!waiting))}
    onStandUp={() => { setSpectatorAnchor(null); standUp(); }} onKick={kick}
    draggingId={dragging?.source === 'spectator' ? dragging.player.id : null}
    holdingId={seatDrag.holding} renderMenu={(player) => memberMenu(player, 'row')}
    onDragStart={(event, player) => seatDrag.start(event, player, 'spectator')} />;
  const primary = isHost
    ? <Button variant="primary" onClick={start} disabled={blocked || !canStart}
      data-pending-disabled={pendingDisabled(!canStart)}>{t('room.start')}</Button>
    : <Button variant={isReady ? 'ghost' : 'success'} onClick={ready} disabled={blocked || !waiting}
      data-pending-disabled={pendingDisabled(!waiting)}>{t(isReady ? 'room.unready' : 'room.ready')}</Button>;

  return (
    <main data-reduced-motion={reducedMotion || undefined}
      className={`${styles.roomContainer} ${styles.roomLayout} ${dockVisible ? styles.chatOpen : ''} ${entering ? styles.entering : ''}`}>
      <RoomHeader className={styles.bar} title={t(`gameType.${roomInfo.gameType}`)} code={roomInfo.code}
        status={waiting ? { text: t('room.headerWaiting', {
          n: String(summary.seated), max: String(seatCards.length) }) } : null}
        onBack={() => navigate('/')} onRules={() => setRulesOpen(true)}
        onCopyFailed={() => setError(t('room.copyFailed'))}
        voice={<VoiceButton labelled dock={compactLayout ? undefined
          : { id: 'room-dock', open: dockOpen && dockTab === 'voice', onToggle: toggleVoiceTab }} />}
        chat={{ unread, mentions: mentionCount, expanded: chatVisible, controls: 'room-chat', onToggle: toggleChat }} chatRef={chatToggleRef}
        actions={<>
          <InviteFriends labelled />
          {isHost && <ActionButton icon="replay" text={t('replay.sharedOpen')} onClick={() => setReplayPickerOpen(true)}
            data-pending-disabled={pendingDisabled(!waiting)} disabled={blocked || !waiting} />}
          <ActionButton icon="logout" text={t('room.leave')} danger onClick={leave} disabled={blocked}
            data-pending-disabled={pendingDisabled()} />
        </>} />
      <div ref={tableAreaRef} className={`${styles.tableArea} ${dragging ? styles.dragging : ''} ${tableStyle ? styles.customTable : ''} ${tableArt ? styles.layeredTable : ''}`} style={tableStyle}
        aria-busy={busy}
        inert={compactLayout && chatOpen}
        onDragStart={(event) => { if (canMovePlayers) event.preventDefault(); }}>
        {tableArt && <TableArt art={tableArt} />}
        <div className={styles.stage}>
          <div className={styles.oval} aria-hidden="true" />
          <div className={styles.seats}>
            {seatCards.map((seatCard, index) => {
              const player = seatCard.info.player;
              const art = player?.isBot ? { '--seat-image': `url("${botSeatBackground}")` } as CSSProperties
                : seatBackgroundStyle(player, stillArt);
              return <RoomSeat key={seatCard.key} seatKey={seatCard.key} label={seatCard.label}
                shortLabel={seatLabel(t, roomInfo.gameType, seatCard.gameSeat, true)} info={seatCard.info}
                position={ovalPosition(index, firstSeat, slotCount)} art={art}
                hostId={roomInfo.hostId} playerId={playerId} isHost={isHost} waiting={waiting}
                blocked={blocked} pending={Boolean(pendingDisabled())}
                draggable={canManagePlayers && Boolean(player) && !player?.isBot}
                moving={Boolean(player) && dragging?.player.id === player?.id}
                holding={Boolean(player) && seatDrag.holding === player?.id}
                drop={dragging ? dropView(seatCard.key, seatDropOutcome(dragging.source, player ?? null,
                  Boolean(player) && player?.id === dragging.player.id)) : null}
                removable={seatCard.additionalIndex !== undefined && seatCard.additionalIndex === additionalSeats.length - 1}
                menu={player ? memberMenu(player, 'seat') : null}
                onPointerDown={(event, member) => seatDrag.start(event, member, 'seat')}
                onSit={() => {
                  if (seatCard.seat) changeSeat(seatCard.seat);
                  else if (seatCard.additionalIndex !== undefined) changeAdditionalSeat(seatCard.additionalIndex);
                }}
                onAddBot={() => addBot(seatCard.gameSeat)} onRemoveSeat={removeSeat}
                onDifficulty={(difficulty) => setBotDifficulty(seatCard.gameSeat, difficulty)}
                onRemoveBot={() => removeBot(seatCard.gameSeat)} />;
            })}
            {canAddSeat && <AddSeatSlot position={ovalPosition(seatCards.length, firstSeat, slotCount)}
              disabled={blocked || !waiting} pending={Boolean(pendingDisabled(!waiting))} onAdd={addSeat} />}
          </div>
          <div className={`${styles.summary} ${seatCards.length > 2 ? styles.summaryWide : ''}`}>
            <RoomSummaryCard name={t(`gameType.${roomInfo.gameType}`)} category={t(`gameType.${roomInfo.gameType}Tag`)}
              players={matchHands === undefined ? players : `${players} · ${t('room.summaryHands', { n: String(matchHands) })}`}
              art={GAME_CARD_ART[roomInfo.gameType]}
              dots={summaryDots(summary.seated, seatCards.length, definition.minPlayers)}
              seatedText={t('room.summarySeated', { n: String(summary.seated), max: String(seatCards.length) })}
              statusText={t(summary.tagKey, { n: String(summary.count) })} tone={summary.stage}
              hint={t(summary.hintKey)}
              timeChips={roomTimeChips(timeControl).map((chip) => t(chip.label, chip.params))}
              optionChips={roomOptionChips(roomInfo, roomRulesContext(roomInfo)).map((chip) => t(chip.label))}
              settingsLabel={t(isHost ? 'room.settings' : 'room.viewSettings')} settingsEditable={isHost}
              settingsOpen={Boolean(settingsAnchor)}
              note={canManagePlayers && !dragHintDone && !dragging
                ? t(touchInput ? 'room.dragHostHintTouch' : 'room.dragHostHint') : undefined}
              onOpenSettings={(event) => setSettingsAnchor(event.currentTarget)} />
          </div>
          {dragBar && <p className={styles.dragBar} role="status">{dragBar}</p>}
        </div>
        <footer className={styles.footer} onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setEnteredRoom(roomInfo.code);
        }}>
          <button type="button" className={styles.spectatorEntry} data-drop={spectatorDrop?.state}
            data-room-drop="spectator" aria-haspopup={compactLayout ? 'dialog' : undefined}
            aria-controls={compactLayout ? undefined : 'room-dock'}
            aria-expanded={compactLayout ? Boolean(spectatorAnchor) : dockOpen && dockTab === 'spectators'}
            onClick={(event) => openSpectators(event.currentTarget)}>
            {dragging?.source === 'seat' ? t('room.dropSpectate')
              : t('room.spectatorsShort', { n: String(spectators.length), max: String(MAX_SPECTATORS) })}
          </button>
          <span className={styles.grow} />
          {isHost && <Button variant="ghost" onClick={fillBots} aria-label={t('room.fillBots')}
            data-pending-disabled={pendingDisabled(!hasEmptySeat)}
            disabled={blocked || !hasEmptySeat}>{t('room.fillBotsShort')}</Button>}
          {primary}
        </footer>
      </div>
      <Popover open={Boolean(settingsAnchor)} anchorEl={settingsAnchor} onClose={() => setSettingsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { className: styles.popover, id: 'room-game-settings', role: 'dialog', 'aria-label': t('room.settings') } }}>
        <RoomSettings room={roomInfo} isHost={isHost} editable={Boolean(isHost && !blocked && waiting)}
          pending={Boolean(pendingDisabled())} setGameType={setGameType} setTimeControl={setTimeControl}
          setShuffleSeats={setShuffleSeats} setGameOptions={setGameOptions} />
      </Popover>
      <Popover open={Boolean(spectatorAnchor)} anchorEl={spectatorAnchor} onClose={() => setSpectatorAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        keepMounted={compactLayout} sx={{ pointerEvents: dragging ? 'none' : undefined }} slotProps={{ paper: { className: styles.popover, role: 'dialog', 'aria-labelledby': 'room-spectators-label' } }}>
        {spectatorList('popover')}
      </Popover>
      {dragging && <SeatDragPreview player={dragging.player} x={dragging.x} y={dragging.y} />}
      <span className={styles.srOnly} role="status">{moved}</span>
      <div className={styles.chat} id="room-chat" inert={!dockVisible}>
        {compactLayout ? <ChatPanel onCollapse={collapseChat} /> : <Dock id="room-dock" label={t('room.dock')}
          value={dockTab} onChange={changeDockTab} onCollapse={collapseChat} tabs={[
            { id: 'chat', label: <>{t('chat.title')}{unread > 0 && <DockCount
              label={t('room.unread', { n: String(unread) })}>{unread > 99 ? '99+' : unread}</DockCount>}
              {mentionCount > 0 && <DockCount mention label={t('chat.notifications.unread', { n: String(mentionCount) })}>
                @{mentionCount > 99 ? '99+' : mentionCount}</DockCount>}</>,
            panel: <ChatPanel embedded /> },
            { id: 'spectators', label: <>{t('room.spectatorsTab')}<DockCount>{spectators.length}</DockCount></>,
              panel: spectatorList('dock') },
            { id: 'voice', label: t('voice.title'), panel: <VoiceDockPanel className={styles.dockVoice} /> },
          ]} />}
      </div>
      <Snackbar key={error ? `error:${error}` : readyNotice?.id} open={Boolean(error) || readyNotice !== null} autoHideDuration={5000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        onClose={(_, reason) => { if (reason !== 'clickaway') { setError(''); setReadyNotice(null); } }}>
        <Alert severity={error ? 'error' : 'warning'} variant="filled" closeText={t('table.close')}
          onClose={() => { setError(''); setReadyNotice(null); }} sx={{ width: '100%' }}>
          {error || readyNotice?.message}
        </Alert>
      </Snackbar>
      {replayPickerOpen && isHost && playerId && <Suspense fallback={null}>
        <RoomReplayPicker members={roomReplayMembers(roomInfo)} selfId={playerId}
          busy={blocked} onWatch={startReplay} onClose={() => setReplayPickerOpen(false)} />
      </Suspense>}
      {rulesOpen && <GameRulesDialog browseGames gameType={roomInfo.gameType} context={roomRulesContext(roomInfo)}
        onClose={() => setRulesOpen(false)} />}
    </main>
  );
}
