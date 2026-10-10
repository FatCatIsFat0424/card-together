import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GAME_TYPES } from '@shared/constants';
import type { FriendEntry, GameType } from '@shared/types';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useConnectionReady } from '../games/use-connection-ready';
import type { AppIconName } from '../components/AppIcon';
import { Avatar } from '../components/Avatar';
import { AppIcon } from '../components/AppIcon';
import { LobbyFriends } from '../components/LobbyFriends';
import { LobbyBackground } from '../components/LobbyBackground';
import { GameRulesDialog } from '../components/GameRulesDialog';
import styles from './LobbyPage.module.css';

const GAME_ICONS: Record<GameType, string> = {
  bridge: '♠', bigtwo: '🃏', redpoints: '🔴', ninetynine: '💯', sevens: '7️⃣', chinesepoker: '🀄', liarsdeck: '🍺',
  blackjack: '🎰', holdem: '♦️',
};

const MATERIAL_GAME_ICONS: Partial<Record<GameType, AppIconName>> = {
  redpoints: 'circle', sevens: 'seven', liarsdeck: 'beer',
};

function GameIcon({ gameType }: { readonly gameType: GameType }): ReactNode {
  const icon = MATERIAL_GAME_ICONS[gameType];
  return <span className={styles.gameIcon} aria-hidden="true">{icon
    ? <AppIcon name={icon} className={gameType === 'redpoints' ? styles.redGameIcon : undefined} />
    : GAME_ICONS[gameType]}</span>;
}

export function LobbyPage(): ReactNode {
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const currentRoomCode = useRoomStore((state) => state.currentRoomCode);
  const phase = useGameStore((state) => state.phase);
  const connectionReady = useConnectionReady();
  const { t } = useI18nStore();
  const [selectedGame, setSelectedGame] = useState<GameType>('bridge');
  const [rulesGame, setRulesGame] = useState<GameType | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  const [friendsRevision, setFriendsRevision] = useState(0);
  const blocked = pending !== null || !connectionReady;
  const roomPath = currentRoomCode ? `/${phase ? 'game' : 'room'}/${currentRoomCode}` : '/';

  const createRoom = (): void => {
    if (blocked || currentRoomCode) return;
    setPending('create');
    setError('');
    socket.timeout(10000).emit('room:create', { gameType: selectedGame }, (timeout, result) => {
      setPending(null);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success && result.roomCode) navigate(`/room/${result.roomCode}`);
      else setError(result.error ?? t('common.error'));
    });
  };

  const joinRoom = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const code = roomCodeInput.trim().toUpperCase();
    if (!code || blocked || currentRoomCode) return;
    setPending('join');
    setError('');
    socket.timeout(10000).emit('room:join', { roomCode: code }, (timeout, result) => {
      setPending(null);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success && result.room) {
        navigate(`/${result.room.status === 'playing' ? 'game' : 'room'}/${result.room.code}`);
      } else setError(result.error ?? t('common.error'));
    });
  };

  const joinFriend = (friend: FriendEntry): void => {
    const code = friend.hostedRoomCode;
    if (!friend.online || !code || blocked) return;
    if (currentRoomCode === code) { navigate(roomPath); return; }
    if (currentRoomCode && !window.confirm(t('invite.confirmLeave', { code }))) return;
    setPending('join');
    setError('');
    socket.timeout(10000).emit('room:joinFriend', { accountId: friend.id, roomCode: code }, (timeout, result) => {
      setPending(null);
      if (!timeout && result.success && result.room) {
        navigate(`/${result.room.status === 'playing' ? 'game' : 'room'}/${result.room.code}`);
      } else {
        setError(timeout ? t('auth.connectionError') : result.error ?? t('common.error'));
        setFriendsRevision((revision) => revision + 1);
      }
    });
  };

  const renderJoinForm = (placement: 'mobile' | 'desktop'): ReactNode => {
    const inputId = `room-code-input-${placement}`;
    return <form onSubmit={joinRoom}>
      <label className={styles.srOnly} htmlFor={inputId}>{t('room.code')}</label>
      <div className={styles.joinRow}>
        <input id={inputId} type="text" placeholder={t('lobby.roomCodePlaceholder')}
          value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
          disabled={blocked || Boolean(currentRoomCode)} maxLength={6} required autoComplete="off"
          autoCapitalize="characters" spellCheck={false}
          aria-describedby={currentRoomCode ? 'lobby-current-room-hint' : undefined} />
        <button type="submit" className="btn btn-primary" disabled={blocked || Boolean(currentRoomCode) || !roomCodeInput.trim()}>
          {pending === 'join' ? t('common.loading') : t('lobby.join')}</button>
      </div>
    </form>;
  };

  if (!account) return null;
  return <main className={styles.page}>
    <LobbyBackground gameType={selectedGame} />
    <header className={styles.header}>
      <div className={styles.welcome}>
        <Avatar avatar={account.avatar} image={account.avatarImage} color={account.color} size="large" />
        <div className={styles.identity}>
          <p className={styles.eyebrow}>{t('nav.lobby')}</p>
          <h1>{t('lobby.welcome', { nickname: account.nickname })}</h1>
          <p className={styles.subtitle}>{t('lobby.description')}</p>
        </div>
      </div>
      <section className={`${styles.panel} ${styles.joinPanel} ${styles.mobileOnly}`} aria-labelledby="lobby-join-title">
        <h2 id="lobby-join-title">{t('lobby.joinRoom')}</h2>
        {renderJoinForm('mobile')}
      </section>
    </header>

    {currentRoomCode && <section className={styles.resume} aria-labelledby="lobby-current-room-title">
      <div>
        <h2 id="lobby-current-room-title">{t('lobby.currentRoom', { code: currentRoomCode })}</h2>
        <p id="lobby-current-room-hint">{t('lobby.currentRoomHint')}</p>
      </div>
      <Link className="btn btn-primary" to={roomPath}>{t('lobby.resume')}</Link>
    </section>}
    {error && <p className={styles.error} role="alert">{error}</p>}

    <div className={styles.layout}>
      <section className={styles.games} aria-label={t('gameType.choose')}>
        <div className={styles.mobileCreate}>
          <span aria-live="polite">{t(`gameType.${selectedGame}`)}</span>
          <button type="button" className="btn btn-primary" onClick={createRoom}
            disabled={blocked || Boolean(currentRoomCode)}
            aria-describedby={currentRoomCode ? 'lobby-current-room-hint' : 'lobby-create-hint'}>
            {pending === 'create' ? t('common.loading') : t('lobby.createRoom')}</button>
        </div>
        <div className={styles.gameChoices} role="group" aria-label={t('gameType.choose')}>
          {GAME_TYPES.map((gameType) => <button key={gameType} type="button"
            className={`${styles.gameChoice} ${selectedGame === gameType ? styles.selected : ''}`}
            aria-pressed={selectedGame === gameType} aria-controls="lobby-selected-game" disabled={pending !== null}
            onClick={() => setSelectedGame(gameType)}>
            <div className={styles.gameChoiceHeader}>
              <GameIcon gameType={gameType} />
              {selectedGame === gameType && <AppIcon name="check" className={styles.selectedIcon} />}
            </div>
            <span className={styles.gameName}>{t(`gameType.${gameType}`)}</span>
            <span className={styles.gameDesc}>{t(`gameType.${gameType}Desc`)}</span>
          </button>)}
        </div>
      </section>

      <aside className={styles.sidebar}>
        <section id="lobby-selected-game" className={styles.panel}
          aria-labelledby="lobby-create-title lobby-selected-game-title">
          <h2 id="lobby-create-title" className={styles.createTitle}>{t('lobby.createTitle')}</h2>
          <p className={`${styles.eyebrow} ${styles.mobileOnly}`}>{t('lobby.yourTable')}</p>
          <div className={styles.selectedHeading}>
            <GameIcon gameType={selectedGame} />
            <h3 id="lobby-selected-game-title">{t(`gameType.${selectedGame}`)}</h3>
            <button type="button" className={styles.rulesLink} aria-haspopup="dialog"
              onClick={() => setRulesGame(selectedGame)}>{t('lobby.rulesIntro')}</button>
          </div>
          <p className={`${styles.selectedDescription} ${styles.mobileOnly}`}>{t(`gameType.${selectedGame}Desc`)}</p>
          <p className={`${styles.seatCount} ${styles.mobileOnly}`}>{t('lobby.seats')}</p>
          <button type="button" className={`btn btn-primary ${styles.createButton} ${styles.desktopCreate}`} onClick={createRoom}
            disabled={blocked || Boolean(currentRoomCode)}
            aria-describedby={currentRoomCode ? 'lobby-current-room-hint' : undefined}>
            {pending === 'create' ? t('common.loading') : t('lobby.createRoom')}</button>
          <p id="lobby-create-hint" className={`${styles.hint} ${styles.mobileOnly}`}>{t('lobby.createHint')}</p>
          <hr className={styles.divider} aria-hidden="true" />
          <section className={styles.desktopJoin} aria-labelledby="lobby-desktop-join-title">
            <h2 id="lobby-desktop-join-title">{t('lobby.joinRoom')}</h2>
            {renderJoinForm('desktop')}
          </section>
        </section>
        <LobbyFriends key={account.id} disabled={blocked} refreshToken={friendsRevision} onJoin={joinFriend} />
      </aside>
    </div>
    {rulesGame && <GameRulesDialog gameType={rulesGame} onClose={() => setRulesGame(null)} />}
  </main>;
}
