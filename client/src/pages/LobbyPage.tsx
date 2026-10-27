import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { FriendEntry, GameType } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import type { GameCategory } from '@shared/games/game-definition';
import { socket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { useShellStore } from '../stores/shell-store';
import { notificationUnreadCount, useSocialStore } from '../stores/social-store';
import { gamesInCategory, lobbyCategories } from '../games/registry';
import { useConnectionReady } from '../games/use-connection-ready';
import { GAME_CARD_ART } from '../game-backgrounds';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { CoinBalance } from '../components/CoinBalance';
import { IconButton } from '../components/IconButton';
import { LobbyFriends } from '../components/LobbyFriends';
import { GameRulesDialog } from '../components/GameRulesDialog';
import { DailyRewards } from '../components/DailyRewards';
import { AndroidAppBanner } from '../components/AndroidAppBanner';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './LobbyPage.module.css';

const CATEGORY_PANEL_ID = 'lobby-games';
const TAB_PREFIX = 'lobby-category';
const DEFAULT_GAME: GameType = 'bridge';
const LANDSCAPE_QUERY = '(max-height: 500px) and (min-width: 600px)';

export function LobbyPage(): ReactNode {
  const navigate = useNavigate();
  const account = useAccountStore((state) => state.account);
  const currentRoomCode = useRoomStore((state) => state.currentRoomCode);
  const phase = useGameStore((state) => state.phase);
  const connectionReady = useConnectionReady();
  const { t } = useI18nStore();
  const landscapeLayout = useMediaQuery(LANDSCAPE_QUERY);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const notificationCount = useSocialStore(notificationUnreadCount);
  const requestNotifications = useShellStore((state) => state.requestNotifications);
  const [category, setCategory] = useState<GameCategory>(() => gameDefinition(DEFAULT_GAME).category);
  const [selectedGame, setSelectedGame] = useState<GameType>(DEFAULT_GAME);
  const [rulesGame, setRulesGame] = useState<GameType | null>(null);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  const [friendsRevision, setFriendsRevision] = useState(0);
  const blocked = pending !== null || !connectionReady;
  const roomPath = currentRoomCode ? `/${phase ? 'game' : 'room'}/${currentRoomCode}` : '/';
  const categories = lobbyCategories();

  const chooseCategory = (next: GameCategory): void => {
    setCategory(next);
    setSelectedGame(gamesInCategory(next)[0]);
  };

  const playersLabel = (gameType: GameType): string => {
    const { minPlayers, maxPlayers } = gameDefinition(gameType).seats;
    return minPlayers === maxPlayers ? t('lobby.players', { n: String(minPlayers) })
      : t('lobby.playersRange', { min: String(minPlayers), max: String(maxPlayers) });
  };

  const createRoom = (gameType: GameType): void => {
    if (blocked || currentRoomCode) return;
    setPending('create');
    setError('');
    socket.timeout(10000).emit('room:create', { gameType }, (timeout, result) => {
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

  if (!account) return null;
  const roomLocked = blocked || Boolean(currentRoomCode);
  return <main className={styles.page} data-reduced-motion={reducedMotion || undefined}>
    <header className={styles.bar}>
      {!landscapeLayout && <div className={styles.welcome}>
        <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="medium" />
        <h1>{t('lobby.welcome', { nickname: account.nickname })}</h1>
      </div>}
      <Tabs className={styles.tabs} label={t('lobby.categories')} idPrefix={TAB_PREFIX} controls={CATEGORY_PANEL_ID}
        value={category} onChange={chooseCategory}
        tabs={categories.map((id) => ({ id, label: t(`lobby.category.${id}`) }))} />
      <div className={styles.tools}>
        <DailyRewards key={account.id} />
        {landscapeLayout && <>
          <IconButton icon="notifications" label={t('social.notificationCount', { n: String(notificationCount) })}
            title={t('social.notifications')} badge={notificationCount} data-popover="notifications"
            data-popover-trigger="notifications" onClick={requestNotifications} />
          <CoinBalance className={styles.coins} />
        </>}
      </div>
    </header>

    {error && <p className={styles.error} role="alert">{error}</p>}
    <AndroidAppBanner />

    <div className={styles.layout}>
      <section id={CATEGORY_PANEL_ID} role="tabpanel" aria-labelledby={tabElementId(TAB_PREFIX, category)} className={styles.games}>
        <div className={styles.cards} role="group" aria-label={t('gameType.choose')}>
          {gamesInCategory(category).map((gameType) => <button key={gameType} type="button"
            className={`${styles.card} ${selectedGame === gameType ? styles.selected : ''}`}
            aria-pressed={selectedGame === gameType} aria-controls="lobby-selected-game" disabled={pending !== null}
            onClick={() => setSelectedGame(gameType)}>
            <img className={styles.art} src={GAME_CARD_ART[gameType]} alt="" width={480} height={270}
              loading="lazy" decoding="async" draggable={false} />
            <span className={styles.cardText}>
              <span className={styles.cardName}>{t(`gameType.${gameType}`)}</span>
              <span className={styles.cardMeta}>{playersLabel(gameType)} · {t(`gameType.${gameType}Tag`)}</span>
            </span>
          </button>)}
        </div>
      </section>

      <aside className={styles.sidebar}>
        <section id="lobby-selected-game" className={styles.actions} aria-labelledby="lobby-selected-game-title"
          data-in-room={currentRoomCode ? true : undefined}>
          <div className={styles.selectedInfo}>
            <h2 id="lobby-selected-game-title">{t(`gameType.${selectedGame}`)}</h2>
            <div className={styles.description}>
              <span title={t(`gameType.${selectedGame}Desc`)}>{t(`gameType.${selectedGame}Desc`)}</span>
              <Button variant="text" size="small" aria-haspopup="dialog" onClick={() => setRulesGame(selectedGame)}>
                {t('lobby.rulesIntro')}</Button>
            </div>
          </div>
          <form className={styles.join} onSubmit={joinRoom}>
            <label className={styles.codeField}>
              <input id="room-code-input" type="text" aria-label={t('room.code')} placeholder={t('lobby.roomCodePlaceholder')}
                value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                disabled={roomLocked} maxLength={6} required autoComplete="off"
                autoCapitalize="characters" spellCheck={false} />
              <Button type="submit" variant="text" size="small" disabled={roomLocked || !roomCodeInput.trim()}>
                {pending === 'join' ? t('common.loading') : t('lobby.join')}</Button>
            </label>
          </form>
          <Button variant="primary" className={styles.create} onClick={() => createRoom(selectedGame)} disabled={roomLocked}>
            {pending === 'create' ? t('common.loading') : t('lobby.createRoom')}</Button>
        </section>
        {!landscapeLayout && <LobbyFriends key={account.id} disabled={blocked} refreshToken={friendsRevision} onJoin={joinFriend} />}
      </aside>
    </div>
    {rulesGame && <GameRulesDialog gameType={rulesGame} onClose={() => setRulesGame(null)} />}
  </main>;
}
