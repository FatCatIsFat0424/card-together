import { isNumberedSeatGame, maxPlayers, roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Popover from '@mui/material/Popover';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { GAME_SEAT_ORDER, MAX_SPECTATORS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { EXPANDABLE_ROOM_GAMES, gameDefinition } from '@shared/games/registry';
import { HE_HANDS } from '@shared/rules/holdem';
import type {
  BlackjackOptions, BotDifficulty, GameSeat, NapoleonOptions, GameType, NinetyNineOptions, PlayerInfo, RoomInfo, RoomSeatTarget, Seat, SeatInfo, SevensOptions, TimeControl,
} from '@shared/types';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { socket } from '../socket';
import { roomErrorKey } from '../room-error-i18n';
import { roomReplayErrorKey, roomReplayMembers } from '../room-replay';
import { seatBackgroundStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { useChatStore } from '../stores/chat-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { seatLabel } from '../games/seat-names';
import { useMotionStore } from '../stores/motion-store';
import { RoomSpectators } from '../components/RoomSpectators';
import { Dock } from '../components/Dock';
import { ChatPanel } from '../components/ChatPanel';
import { InviteFriends } from '../components/InviteFriends';
import { RoomSettings } from '../components/RoomSettings';
import { AddSeatSlot, RoomSeat } from '../components/RoomSeat';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { useConnectionReady } from '../games/use-connection-ready';
import { AppIcon } from '../components/AppIcon';
import { GameRulesDialog } from '../components/GameRulesDialog';
import { roomRulesContext } from '../game-rules-context';
import { VoiceButton } from '../components/VoiceControls';
import styles from './RoomPage.module.css';
import botSeatBackground from '../assets/room-backgrounds/bot-seat.webp';
import { unreadCount } from './room-progress';
import { ovalPosition } from './room-oval';
import { useRoomSeatDrag } from '../hooks/use-room-seat-drag';
import { layeredShopArt } from '../cosmetics/art-layers/shop-art-layers';
import { TableArt } from '../cosmetics/art-layers/TableArt';

const COPIED_MS = 2000;

type RoomDockTab = 'chat' | 'spectators';
const RoomReplayPicker = lazy(() => import('../components/RoomReplayPicker')
  .then((module) => ({ default: module.RoomReplayPicker })));

interface RoomSeatCard {
  readonly key: string;
  readonly label: string;
  readonly info: SeatInfo;
  readonly seat?: Seat;
  readonly additionalIndex?: number;
  /** Seat a bot is added to or managed in */
  readonly gameSeat: GameSeat;
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
  const dockVisible = compactLayout ? chatOpen : dockOpen;
  const chatVisible = dockVisible && (compactLayout || dockTab === 'chat');
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const stillArt = reducedMotion || systemReducedMotion;
  const tableArt = stillArt ? null : layeredShopArt(account?.tableBackgroundStyle);
  const tableStyle = tableBackgroundStyle(account, stillArt, !!tableArt);
  const [enteredRoom, setEnteredRoom] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [replayPickerOpen, setReplayPickerOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [spectatorAnchor, setSpectatorAnchor] = useState<HTMLElement | null>(null);
  const [readyNotice, setReadyNotice] = useState<{ id: number; message: string } | null>(null);
  const messageCount = useChatStore((state) => state.messages.length);
  const [seenMessages, setSeenMessages] = useState(messageCount);
  const unread = unreadCount(messageCount, seenMessages, chatVisible);
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
    ? [...Object.values(roomInfo.seats), ...roomInfo.additionalSeats ?? []].some(({ player }) => !player) : false;
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
  const movePlayer = (player: PlayerInfo, target: RoomSeatTarget): void => {
    if (!canMovePlayers || !roomInfo) return;
    if (target.type === 'seat' && roomInfo.seats[target.seat].player?.id === player.id) return;
    if (target.type === 'additional' && roomInfo.additionalSeats?.[target.index]?.player?.id === player.id) return;
    if (target.type === 'spectator' && roomInfo.spectators?.some((entry) => entry.id === player.id)) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:movePlayer', { accountId: player.id, target }, handleResult);
  };
  const seatDrag = useRoomSeatDrag(canMovePlayers, movePlayer);

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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyCode = (code: string): void => {
    if (!navigator.clipboard) {
      setError(t('room.copyFailed'));
      return;
    }
    navigator.clipboard.writeText(code).then(() => setCopied(true), () => setError(t('room.copyFailed')));
  };
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
  const setSevensOptions = (options: SevensOptions): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setSevensOptions', options, handleResult);
  };
  const setNinetyNineOptions = (options: NinetyNineOptions): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setNinetyNineOptions', options, handleResult);
  };
  const setBlackjackOptions = (options: BlackjackOptions): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setBlackjackOptions', options, handleResult);
  };
  const setNapoleonOptions = (options: NapoleonOptions): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:setNapoleonOptions', options, handleResult);
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
  const seatCards: RoomSeatCard[] = [
    ...SEAT_ORDER_CLOCKWISE.map((seat) => ({ key: seat, label: seatLabel(t, roomInfo.gameType, seat),
      info: roomInfo.seats[seat], seat, gameSeat: seat })),
    ...additionalSeats.map((info, index) => ({ key: `additional-${index}`,
      label: isNumberedSeatGame(roomInfo.gameType) ? seatLabel(t, roomInfo.gameType, GAME_SEAT_ORDER[index + 4])
        : t('room.additionalSeat', { n: String(index + 5) }), info, additionalIndex: index,
      gameSeat: GAME_SEAT_ORDER[index + 4] })),
  ];
  const spectators = roomInfo.spectators ?? [];
  const expandableSeats = EXPANDABLE_ROOM_GAMES.includes(roomInfo.gameType);
  const canAddSeat = isHost && expandableSeats && seatCards.length < maxPlayers(roomInfo.gameType);
  const slotCount = seatCards.length + (canAddSeat ? 1 : 0);
  const firstSeat = Math.max(0, seatCards.findIndex(({ info }) => info.player?.id === playerId));
  const movingPlayer = seatDrag.drag?.player ?? seatDrag.selected;
  const canStart = roomCanStart(roomInfo);
  const startNow = isHost && canStart;
  const definition = gameDefinition(roomInfo.gameType).seats;
  const players = definition.minPlayers === definition.maxPlayers
    ? t('lobby.players', { n: String(definition.maxPlayers) })
    : t('lobby.playersRange', { min: String(definition.minPlayers), max: String(definition.maxPlayers) });
  const length = roomInfo.gameType === 'holdem' ? t('room.summaryHands', { n: String(HE_HANDS) })
    : t(`gameType.${roomInfo.gameType}Tag`);
  const timeControl = roomInfo.timeControl ?? DEFAULT_TIME_CONTROL;
  const handle = (player: PlayerInfo): ReactNode => canManagePlayers && !player.isBot &&
    <button key="move-player" type="button" className={styles.dragHandle} data-seat-drag-handle="true"
      disabled={blocked}
      aria-label={t('room.movePlayer', { nickname: player.nickname })}
      aria-pressed={movingPlayer?.id === player.id} title={t('room.dragHint')}
      onClick={() => seatDrag.select(player)}><AppIcon name="drag" /></button>;
  const spectatorList = (layout: 'popover' | 'dock'): ReactNode => <RoomSpectators layout={layout}
    spectators={spectators} hostId={roomInfo.hostId} playerId={playerId}
    seated={Boolean(mySeat || myAdditionalSeat >= 0)} canSpectate={canSpectate} canManage={canManagePlayers}
    isHost={isHost} blocked={blocked} pending={Boolean(pendingDisabled(!waiting))}
    onStandUp={() => { setSpectatorAnchor(null); standUp(); }} onKick={kick}
    onMove={(player) => { seatDrag.select(player); setSpectatorAnchor(null); }} />;
  const primary = startNow
    ? <Button variant="primary" onClick={start} disabled={blocked}
      data-pending-disabled={pendingDisabled()}>{t('room.start')}</Button>
    : <Button variant={isReady ? 'ghost' : 'success'} onClick={ready} disabled={blocked || !waiting}
      data-pending-disabled={pendingDisabled(!waiting)}>{t(isReady ? 'room.unready' : 'room.ready')}</Button>;

  return (
    <main data-reduced-motion={reducedMotion || undefined}
      className={`${styles.roomContainer} ${styles.roomLayout} ${dockVisible ? styles.chatOpen : ''} ${entering ? styles.entering : ''}`}>
      <header className={styles.bar}>
        <IconButton icon="previousPage" label={t('room.back')} onClick={() => navigate('/')} />
        <h1 className={styles.title}>{t(`gameType.${roomInfo.gameType}`)}</h1>
        {/* The code itself is the copy control. */}
        <button type="button" className={styles.codeChip} onClick={() => copyCode(roomInfo.code)}
          aria-label={`${t('room.copyCode')} ${roomInfo.code}`} title={t('room.copyCode')}>
          <span>{roomInfo.code}</span>
          {copied && <AppIcon name="check" />}
        </button>
        <span className={styles.srOnly} role="status">{copied ? t('room.copied') : ''}</span>
        <span className={styles.grow} />
        <IconButton icon="rules" label={t('rules.open')} aria-haspopup="dialog" onClick={() => setRulesOpen(true)} />
        <VoiceButton />
        <IconButton icon="chat" label={unread > 0 ? `${t('chat.title')} ${t('room.unread', { n: String(unread) })}` : t('chat.title')}
          ref={chatToggleRef} badge={unread} aria-expanded={chatVisible} aria-controls="room-chat" onClick={toggleChat} />
        <InviteFriends />
        <IconButton icon="more" label={t('room.more')} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)}
          onClick={(event) => setMenuAnchor(event.currentTarget)} />
        <Popover open={Boolean(menuAnchor)} anchorEl={menuAnchor} onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { className: styles.menu, role: 'menu', 'aria-label': t('room.more') } }}>
          {isHost && <Button variant="text" role="menuitem" onClick={() => { setMenuAnchor(null); setReplayPickerOpen(true); }}
            data-pending-disabled={pendingDisabled(!waiting)} disabled={blocked || !waiting}>{t('replay.sharedOpen')}</Button>}
          {startNow && isReady && <Button variant="text" role="menuitem" disabled={blocked}
            onClick={() => { setMenuAnchor(null); ready(); }}>{t('room.unready')}</Button>}
          <Button variant="danger-text" role="menuitem" onClick={() => { setMenuAnchor(null); leave(); }}
            disabled={blocked} data-pending-disabled={pendingDisabled()}>{t('room.leave')}</Button>
        </Popover>
      </header>
      <div ref={tableAreaRef} className={`${styles.tableArea} ${tableStyle ? styles.customTable : ''} ${tableArt ? styles.layeredTable : ''}`} style={tableStyle}
        aria-busy={busy}
        inert={compactLayout && chatOpen}
        onDragStart={(event) => { if (canMovePlayers) event.preventDefault(); }}
        onClickCapture={seatDrag.choose} onPointerMove={seatDrag.move} onPointerUp={seatDrag.finish}
        onPointerCancel={seatDrag.cancel}>
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
                moving={Boolean(player) && movingPlayer?.id === player?.id}
                dropTarget={seatDrag.drag?.targetKey === seatCard.key}
                removable={seatCard.additionalIndex !== undefined && seatCard.additionalIndex === additionalSeats.length - 1}
                handle={player ? handle(player) : null} onPointerDown={seatDrag.start}
                onSit={() => {
                  if (seatCard.seat) changeSeat(seatCard.seat);
                  else if (seatCard.additionalIndex !== undefined) changeAdditionalSeat(seatCard.additionalIndex);
                }}
                onAddBot={() => addBot(seatCard.gameSeat)} onRemoveSeat={removeSeat} onKick={kick}
                onDifficulty={(difficulty) => setBotDifficulty(seatCard.gameSeat, difficulty)}
                onRemoveBot={() => removeBot(seatCard.gameSeat)} />;
            })}
            {canAddSeat && <AddSeatSlot position={ovalPosition(seatCards.length, firstSeat, slotCount)}
              disabled={blocked || !waiting} pending={Boolean(pendingDisabled(!waiting))} onAdd={addSeat} />}
          </div>
          <div className={styles.summary}>
            <strong>{players} · {length}</strong>
            <span>{t('room.summaryTime', { base: String(timeControl.baseSeconds), bank: String(timeControl.bankSeconds) })}</span>
            <button type="button" className={styles.settingsLink} aria-haspopup="dialog"
              aria-expanded={Boolean(settingsAnchor)} onClick={(event) => setSettingsAnchor(event.currentTarget)}>
              <AppIcon name="settings" />{t('room.settings')}
            </button>
          </div>
          {seatDrag.selected && <p className={styles.moveHint} role="status">
            {t('room.placePlayer', { nickname: seatDrag.selected.nickname })}</p>}
        </div>
        <footer className={styles.footer} onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setEnteredRoom(roomInfo.code);
        }}>
          <button type="button" className={`${styles.spectatorEntry} ${seatDrag.drag?.targetKey === 'spectator' ? styles.dropTarget : ''}`}
            data-room-drop="spectator" aria-haspopup={compactLayout ? 'dialog' : undefined}
            aria-controls={compactLayout ? undefined : 'room-dock'}
            aria-expanded={compactLayout ? Boolean(spectatorAnchor) : dockOpen && dockTab === 'spectators'}
            onClick={(event) => openSpectators(event.currentTarget)}>
            {movingPlayer ? t('room.dropSpectator')
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
          setShuffleSeats={setShuffleSeats} setSevensOptions={setSevensOptions}
          setNinetyNineOptions={setNinetyNineOptions} setBlackjackOptions={setBlackjackOptions}
          setNapoleonOptions={setNapoleonOptions} />
      </Popover>
      <Popover open={Boolean(spectatorAnchor)} anchorEl={spectatorAnchor} onClose={() => setSpectatorAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { className: styles.popover, role: 'dialog', 'aria-labelledby': 'room-spectators-label' } }}>
        {spectatorList('popover')}
      </Popover>
      {seatDrag.drag && <div className={styles.dragPreview} aria-hidden="true"
        style={{ left: seatDrag.drag.x, top: seatDrag.drag.y }}>{seatDrag.drag.player.nickname}</div>}
      <div className={styles.chat} id="room-chat" inert={!dockVisible}>
        {compactLayout ? <ChatPanel onCollapse={collapseChat} /> : <Dock id="room-dock" label={t('room.dock')}
          value={dockTab} onChange={changeDockTab} onCollapse={collapseChat} tabs={[
            { id: 'chat', label: <>{t('chat.title')}{unread > 0 && <span className={styles.tabCount}
              aria-label={t('room.unread', { n: String(unread) })}>{unread > 99 ? '99+' : unread}</span>}</>,
            panel: <ChatPanel embedded /> },
            { id: 'spectators', label: <>{t('room.spectatorsTab')}<span className={styles.tabCount}>{spectators.length}</span></>,
              panel: spectatorList('dock') },
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
