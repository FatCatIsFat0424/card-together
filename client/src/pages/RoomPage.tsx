import { roomCanStart, roomSeatInfo } from '@shared/rules/seats';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EXPANDABLE_ROOM_GAMES, GAME_TYPES, MAX_ROOM_SEATS, MAX_SPECTATORS, SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import type {
  BlackjackOptions, GameType, NinetyNineOptions, PlayerInfo, RoomSeatTarget, Seat, SeatInfo, SevensOptions, TimeControl,
} from '@shared/types';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { DEFAULT_SEVENS_OPTIONS, SEVENS_SLAY_EFFECTS, sevensSlayEffect } from '@shared/sevens-options';
import { socket } from '../socket';
import { seatBackgroundStyle, tableBackgroundStyle } from '../account-appearance';
import { useAccountStore } from '../stores/account-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { useChatStore } from '../stores/chat-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import { ChatPanel } from '../components/ChatPanel';
import { InviteFriends } from '../components/InviteFriends';
import { TimeControlSettings } from '../components/TimeControlSettings';
import { AppCheckbox } from '../components/AppCheckbox';
import { useConnectionReady } from '../games/use-connection-ready';
import { AppIcon } from '../components/AppIcon';
import { GameRulesDialog } from '../components/GameRulesDialog';
import { roomRulesContext } from '../game-rules-context';
import styles from './RoomPage.module.css';
import botSeatBackground from '../assets/room-backgrounds/bot-seat.webp';
import { unreadCount } from './room-progress';
import { useRoomSeatDrag } from '../hooks/use-room-seat-drag';

const COPIED_MS = 2000;

interface RoomSeatCard {
  readonly key: string;
  readonly label: string;
  readonly info: SeatInfo;
  readonly seat?: Seat;
  readonly additionalIndex?: number;
}

export function RoomPage(): ReactNode {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const tableStyle = tableBackgroundStyle(account);
  const playerId = usePlayerStore((state) => state.playerId);
  const roomInfo = useRoomStore((state) => state.roomInfo);
  const mySeat = useRoomStore((state) => state.mySeat);
  const phase = useGameStore((state) => state.phase);
  const { t } = useI18nStore();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [readyNotice, setReadyNotice] = useState<{ id: number; message: string } | null>(null);
  const messageCount = useChatStore((state) => state.messages.length);
  const [seenMessages, setSeenMessages] = useState(messageCount);
  const unread = unreadCount(messageCount, seenMessages, chatOpen);
  const attemptedRoom = useRef<string | null>(null);
  const hadRoom = useRef(false);
  const leaving = useRef(false);
  const myAdditionalSeat = roomInfo?.additionalSeats?.findIndex((entry) => entry.player?.id === playerId) ?? -1;
  const connectionReady = useConnectionReady();
  const blocked = busy || !connectionReady;
  const isReady = mySeat ? (roomInfo ? roomSeatInfo(roomInfo, mySeat)?.isReady : false) ?? false : false;
  const isHost = Boolean(playerId) && roomInfo?.hostId === playerId;
  const hasEmptySeat = roomInfo ? Object.values(roomInfo.seats).some(({ player }) => !player) : false;
  const canMovePlayers = isHost && !blocked && roomInfo?.status === 'waiting';
  const handleResult = (timeout: Error | null, result?: { success: boolean; error?: string }): void => {
    setBusy(false);
    if (timeout) setError(t('auth.connectionError'));
    else if (!result?.success) setError(result?.error ?? t('common.error'));
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

  useEffect(() => {
    if (leaving.current) return;
    if (!roomCode) { navigate('/', { replace: true }); return; }
    if (roomInfo) {
      hadRoom.current = true;
      attemptedRoom.current = roomInfo.code;
      if (phase) navigate(`/game/${roomInfo.code}`, { replace: true });
      else if (roomInfo.code !== roomCode) navigate(`/room/${roomInfo.code}`, { replace: true });
    } else if (attemptedRoom.current !== roomCode) {
      attemptedRoom.current = roomCode;
      socket.timeout(10000).emit('room:join', { roomCode }, (timeout, result) => {
        if (timeout) setError(t('auth.connectionError'));
        else if (!result.success) setError(result.error ?? t('common.error'));
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
    setChatOpen((open) => !open);
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
        message: timeout ? t('auth.connectionError') : result?.error ?? t('common.error'),
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
  const addBot = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:addBot', { seat }, handleResult);
  };
  const removeBot = (seat: Seat): void => {
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:removeBot', { seat }, handleResult);
  };
  const kick = (player: PlayerInfo): void => {
    if (!window.confirm(t('room.kickConfirm', { nickname: player.nickname }))) return;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('room:kick', { accountId: player.id }, handleResult);
  };
  const standUp = (): void => {
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
  const seatCards: RoomSeatCard[] = [
    ...SEAT_ORDER_CLOCKWISE.map((seat) => ({ key: seat, label: t(`seat.${seat}`), info: roomInfo.seats[seat], seat })),
    ...additionalSeats.map((info, index) => ({ key: `additional-${index}`,
      label: t('room.additionalSeat', { n: String(index + 5) }), info, additionalIndex: index })),
  ];
  const spectators = roomInfo.spectators ?? [];
  const expandableSeats = EXPANDABLE_ROOM_GAMES.includes(roomInfo.gameType);
  const movingPlayer = seatDrag.drag?.player ?? seatDrag.selected;
  const dragHandle = (player: PlayerInfo): ReactNode => canMovePlayers && !player.isBot &&
    <button type="button" className={styles.dragHandle} data-seat-drag-handle="true"
      aria-label={t('room.movePlayer', { nickname: player.nickname })}
      aria-pressed={movingPlayer?.id === player.id} title={t('room.dragHint')}
      onClick={() => seatDrag.select(player)}><AppIcon name="drag" /></button>;
  const addSeatButton = isHost && expandableSeats
    && seatCards.length < MAX_ROOM_SEATS && <button type="button"
      className={`${styles.seatSlot} ${styles.addSeatSlot}`}
      disabled={blocked || roomInfo.status !== 'waiting'}
      aria-label={t('room.addSeat')} title={t('room.addSeat')} onClick={addSeat}>
      <AppIcon name="add" />
    </button>;

  return (
    <main className={`${styles.roomContainer} ${styles.roomLayout} ${chatOpen ? styles.chatOpen : ''}`}>
      <div className={styles.roomHeader}>
        <div className={styles.codeBlock}>
          <span className={styles.roomCodeLabel}>{t('room.code')}</span>
          {/* The code itself is the copy control, so the action reads as part of the code. */}
          <button type="button" className={`touch-target ${styles.codePill}`} onClick={() => copyCode(roomInfo.code)}
            aria-label={`${t('room.copyCode')} ${roomInfo.code}`} title={t('room.copyCode')}>
            <span className={styles.roomCode}>{roomInfo.code}</span>
            <span className={`${styles.copyState} ${copied ? styles.copiedState : ''}`} aria-hidden="true">
              {copied ? <><AppIcon name="check" /><span className={styles.copyText}>{t('room.copied')}</span></> : <AppIcon name="copy" />}
            </span>
          </button>
          <span className={styles.srOnly} role="status">{copied ? t('room.copied') : ''}</span>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.ruleOption}>
            <AppCheckbox checked={roomInfo.shuffleSeats ?? false}
              disabled={!isHost || blocked || roomInfo.status !== 'waiting'}
              onChange={(event) => setShuffleSeats(event.target.checked)} />
            {t('room.shuffleSeats')}
          </label>
          <TimeControlSettings
            key={`${roomInfo.code}:${roomInfo.hostId}:${roomInfo.timeControl?.baseSeconds}:${roomInfo.timeControl?.bankSeconds}`}
            value={roomInfo.timeControl ?? DEFAULT_TIME_CONTROL}
            disabled={!isHost || blocked || roomInfo.status !== 'waiting'} onSave={setTimeControl} />
          <button type="button" className={`btn btn-outline touch-target ${styles.chatToggle}`}
            aria-pressed={chatOpen} aria-controls="room-chat" onClick={toggleChat}>
            <AppIcon name="chat" /> {t('chat.title')}
            {unread > 0 && <span className={styles.unread} aria-label={t('room.unread', { n: String(unread) })}>
              {unread}</span>}
          </button>
          <InviteFriends />
          <button type="button" className="btn btn-outline touch-target" onClick={leave} disabled={blocked}>{t('room.leave')}</button>
        </div>
        <div className={styles.gameTypeRow}>
          <div className={styles.gameTypePicker}>
            <span className={styles.gameTypeLabel} id="room-game-label">{t('gameType.label')}</span>
            <div className={styles.segmented} role="radiogroup" aria-labelledby="room-game-label"
              title={isHost ? undefined : t('room.hostOnly')}>
              {GAME_TYPES.map((gameType) => (
                <button key={gameType} type="button" role="radio" aria-checked={roomInfo.gameType === gameType}
                  className={roomInfo.gameType === gameType ? styles.segmentActive : styles.segment}
                  disabled={!isHost || blocked || roomInfo.gameType === gameType}
                  onClick={() => setGameType(gameType)}>
                  {t(`gameType.${gameType}`)}
                </button>
              ))}
            </div>
          </div>
          {/* Rule options sit beside the game they modify; the hint moves to a tooltip to save a row. */}
          {roomInfo.gameType === 'sevens' && <label className={styles.ruleOption} title={t('sevens.closeOnEndHint')}>
            <AppCheckbox checked={roomInfo.sevensOptions?.closeOnEnd ?? false}
              disabled={!isHost || blocked || roomInfo.status !== 'waiting'}
              slotProps={{ input: { 'aria-describedby': 'sevens-close-on-end-hint' } }}
              onChange={(event) => setSevensOptions({
                ...(roomInfo.sevensOptions ?? DEFAULT_SEVENS_OPTIONS), closeOnEnd: event.target.checked,
              })} />
            {t('sevens.closeOnEnd')}
            <span id="sevens-close-on-end-hint" className={styles.srOnly}>{t('sevens.closeOnEndHint')}</span>
          </label>}
          {/* The effect only matters once Dragon Slaying is on, so it appears beside that option. */}
          {roomInfo.gameType === 'sevens' && roomInfo.sevensOptions?.closeOnEnd
            && <label className={styles.ruleOption} title={t('sevens.slayEffectHint')}>
              {t('sevens.slayEffect')}
              <select className={styles.ruleSelect} value={sevensSlayEffect(roomInfo.sevensOptions)}
                disabled={!isHost || blocked || roomInfo.status !== 'waiting'}
                aria-describedby="sevens-slay-effect-hint"
                onChange={(event) => {
                  const slayEffect = SEVENS_SLAY_EFFECTS.find((effect) => effect === event.target.value);
                  if (slayEffect && roomInfo.sevensOptions) setSevensOptions({ ...roomInfo.sevensOptions, slayEffect });
                }}>
                {SEVENS_SLAY_EFFECTS.map((effect) => (
                  <option key={effect} value={effect}>{t(`sevens.slayEffect.${effect}`)}</option>
                ))}
              </select>
              <span id="sevens-slay-effect-hint" className={styles.srOnly}>{t('sevens.slayEffectHint')}</span>
            </label>}
          {roomInfo.gameType === 'ninetynine' && <label className={styles.ruleOption} title={t('ninetynine.twoDecksHint')}>
            <input type="checkbox" checked={roomInfo.ninetyNineOptions?.twoDecks ?? false}
              disabled={!isHost || blocked || roomInfo.status !== 'waiting'}
              aria-describedby="ninetynine-two-decks-hint"
              onChange={(event) => setNinetyNineOptions({ twoDecks: event.target.checked })} />
            {t('ninetynine.twoDecks')}
            <span id="ninetynine-two-decks-hint" className={styles.srOnly}>{t('ninetynine.twoDecksHint')}</span>
          </label>}
          {roomInfo.gameType === 'blackjack' && <label className={styles.ruleOption} title={t('blackjack.playerDealerHint')}>
            <input type="checkbox" checked={roomInfo.blackjackOptions?.playerDealer ?? false}
              disabled={!isHost || blocked || roomInfo.status !== 'waiting'}
              aria-describedby="blackjack-player-dealer-hint"
              onChange={(event) => setBlackjackOptions({ playerDealer: event.target.checked })} />
            {t('blackjack.playerDealer')}
            <span id="blackjack-player-dealer-hint" className={styles.srOnly}>{t('blackjack.playerDealerHint')}</span>
          </label>}
          <button type="button" className="btn btn-outline touch-target" aria-haspopup="dialog"
            onClick={() => setRulesOpen(true)}>
            <AppIcon name="rules" /> {t('rules.open')}
          </button>
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={`${styles.tableArea} ${tableStyle ? styles.customTable : ''}`} style={tableStyle}
        onClickCapture={seatDrag.choose} onPointerMove={seatDrag.move} onPointerUp={seatDrag.finish}
        onPointerCancel={seatDrag.cancel}>
      <div className={styles.seatStrip}>
      <div className={`${styles.seatLayout} ${expandableSeats ? styles.expandedSeats : ''}`}>
        {seatCards.map((seatCard) => {
          const seatInfo = seatCard.info;
          const player = seatInfo.player;
          const seatStyle = player?.isBot
            ? { '--seat-image': `url("${botSeatBackground}")` } as CSSProperties
            : seatBackgroundStyle(player);
          const sit = (): void => {
            if (seatCard.seat) changeSeat(seatCard.seat);
            else if (seatCard.additionalIndex !== undefined) changeAdditionalSeat(seatCard.additionalIndex);
          };
          const className = [styles.seatSlot,
            player ? styles.seatSlotOccupied : '',
            canMovePlayers && player && !player.isBot ? styles.draggableSeat : '',
            movingPlayer?.id === player?.id && player ? styles.movingSeat : '',
            seatDrag.drag?.targetKey === seatCard.key ? styles.dropTarget : '',
            player?.id === playerId ? styles.seatSlotMine : ''].filter(Boolean).join(' ');
          if (player) return (
            <div key={seatCard.key} className={`${className} ${seatStyle ? styles.customSeat : ''}`} style={seatStyle}
              data-room-drop={seatCard.key} onPointerDown={(event) => seatDrag.start(event, player)}>
              <div className={styles.seatLabel}>{seatCard.label}</div>
              {dragHandle(player)}
              <PlayerLink player={player} size="medium" />
              <div className={styles.seatStatus}>
                {player.id === roomInfo.hostId &&
                  <span className={styles.hostBadge} title={t('room.host')}>👑 {t('room.host')}</span>}
                {player.id === playerId && <span>{t('common.me')}</span>}
                <span className={seatInfo.isReady ? styles.seatReadyBadge : styles.seatNotReadyBadge}>
                  {t(player.isBot ? 'room.botReady' : seatInfo.isReady ? 'room.ready.status' : 'room.seatTaken')}</span>
              </div>
              {isHost && player.isBot && seatCard.seat && <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                disabled={blocked} onClick={() => { if (seatCard.seat) removeBot(seatCard.seat); }}>{t('room.removeBot')}</button>}
              {isHost && !player.isBot && player.id !== playerId && roomInfo.status === 'waiting' &&
                <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                  disabled={blocked} onClick={() => kick(player)}>{t('room.kick')}</button>}
            </div>
          );
          return (
            <div key={seatCard.key} className={`${className} ${styles.emptySlot}`} data-room-drop={seatCard.key}>
              <button type="button" disabled={blocked || roomInfo.status !== 'waiting'} className={styles.seatChoice}
                onClick={sit}>
                <span className={styles.seatLabel}>{seatCard.label}</span>
                <AppIcon name="person" className={styles.emptyIcon} />
                <span className={styles.seatEmpty}>{t('room.seatEmpty')}</span>
              </button>
              {isHost && seatCard.seat && <button type="button" className={`btn btn-outline touch-target ${styles.botAction}`}
                disabled={blocked} onClick={() => { if (seatCard.seat) addBot(seatCard.seat); }}>{t('room.addBot')}</button>}
              {isHost && seatCard.additionalIndex === additionalSeats.length - 1 && <button type="button"
                className={styles.removeSeatButton} disabled={blocked || roomInfo.status !== 'waiting'}
                aria-label={t('room.removeSeat')} title={t('room.removeSeat')} onClick={removeSeat}>
                <AppIcon name="close" />
              </button>}
            </div>
          );
        })}
        {addSeatButton}
      </div>
      </div>
      <section className={`${styles.spectators} ${seatDrag.drag?.targetKey === 'spectator' ? styles.dropTarget : ''}`}
        data-room-drop="spectator" aria-labelledby="room-spectators-label">
        <span className={styles.spectatorsLabel} id="room-spectators-label">
          {t('room.spectators', { n: String(spectators.length), max: String(MAX_SPECTATORS) })}
        </span>
        {movingPlayer && <button type="button" className="btn btn-outline" onClick={() => {
          movePlayer(movingPlayer, { type: 'spectator' }); seatDrag.cancel();
        }}>{t('room.dropSpectator')}</button>}
        {spectators.length === 0 ? <span className={styles.spectatorsEmpty}>{t('room.noSpectators')}</span>
          : <ul className={styles.spectatorList}>{spectators.map((spectator) => (
            <li key={spectator.id} className={`${styles.spectator} ${movingPlayer?.id === spectator.id ? styles.movingSeat : ''}`}
              onPointerDown={(event) => seatDrag.start(event, spectator)}>
              {dragHandle(spectator)}
              <PlayerLink player={spectator} size="small" />
              {spectator.id === roomInfo.hostId && <span className={styles.hostBadge} title={t('room.host')}>👑</span>}
              {spectator.id === playerId && <span>{t('common.me')}</span>}
              {isHost && spectator.id !== playerId && <button type="button"
                className={`btn btn-outline touch-target ${styles.botAction}`} disabled={blocked}
                onClick={() => kick(spectator)}>{t('room.kick')}</button>}
            </li>
          ))}</ul>}
        {seatDrag.selected && <p className={styles.moveHint} role="status">{t('room.placePlayer', { nickname: seatDrag.selected.nickname })}</p>}
      </section>
      <div className={styles.roomFooter}>
        {(mySeat || myAdditionalSeat >= 0) && <button type="button" className="btn btn-outline" onClick={standUp}
          disabled={blocked || roomInfo.status !== 'waiting'}>{t('room.standUp')}</button>}
        {isHost && <button type="button" className="btn btn-outline" onClick={fillBots}
          disabled={blocked || !hasEmptySeat}>{t('room.fillBots')}</button>}
        <button className={`btn ${isReady ? 'btn-danger' : 'btn-success'}`}
          onClick={ready} disabled={blocked || roomInfo.status !== 'waiting'}>{t(isReady ? 'room.unready' : 'room.ready')}</button>
        {isHost && <button type="button" className="btn btn-primary" onClick={start}
          disabled={blocked || !roomCanStart(roomInfo)}>{t('room.start')}</button>}
      </div>
      </div>
      {seatDrag.drag && <div className={styles.dragPreview} aria-hidden="true"
        style={{ left: seatDrag.drag.x, top: seatDrag.drag.y }}>{seatDrag.drag.player.nickname}</div>}
      <div className={styles.chat} id="room-chat"><ChatPanel /></div>
      <Snackbar key={readyNotice?.id} open={readyNotice !== null} autoHideDuration={5000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        onClose={(_, reason) => { if (reason !== 'clickaway') setReadyNotice(null); }}>
        <Alert severity="warning" variant="filled" closeText={t('table.close')}
          onClose={() => setReadyNotice(null)} sx={{ width: '100%' }}>
          {readyNotice?.message}
        </Alert>
      </Snackbar>
      {rulesOpen && <GameRulesDialog gameType={roomInfo.gameType} context={roomRulesContext(roomInfo)}
        onClose={() => setRulesOpen(false)} />}
    </main>
  );
}
