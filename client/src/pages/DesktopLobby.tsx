import type { FormEvent, ReactNode } from 'react';
import type { FriendEntry, GameType } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import type { GameCategory } from '@shared/games/game-definition';
import { gamesInCategory, lobbyCategories } from '../games/registry';
import { GAME_BACKGROUNDS, GAME_CARD_ART } from '../game-backgrounds';
import { useI18nStore } from '../stores/i18n-store';
import { AndroidAppBanner } from '../components/AndroidAppBanner';
import { Button } from '../components/Button';
import { DailyRewards } from '../components/DailyRewards';
import { LOBBY_PANEL_ID, LOBBY_TAB_PREFIX } from '../components/desktop-nav';
import { LobbyFriends } from '../components/LobbyFriends';
import { PageHeader } from '../components/PageHeader';
import type { LobbyFriendsActivity } from '../components/LobbyFriends';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './DesktopLobby.module.css';

export interface DesktopLobbyProps {
  readonly accountId: string;
  readonly category: GameCategory;
  readonly selectedGame: GameType;
  readonly onCategoryChange: (category: GameCategory) => void;
  readonly onSelectGame: (game: GameType) => void;
  readonly onShowRules: (game: GameType) => void;
  readonly error: string;
  readonly inRoom: boolean;
  /** A room request is running or the connection is not ready. */
  readonly blocked: boolean;
  /** Creating and joining are unavailable (blocked, or the viewer is already in a room). */
  readonly roomLocked: boolean;
  readonly pending: 'create' | 'join' | null;
  readonly roomCode: string;
  readonly onRoomCodeChange: (code: string) => void;
  readonly onCreate: () => void;
  readonly onJoin: (event: FormEvent<HTMLFormElement>) => void;
  readonly friends: {
    readonly refreshToken: number;
    readonly activity: LobbyFriendsActivity;
    readonly onJoin: (friend: FriendEntry) => void;
  };
}

/**
 * Desktop and tablet lobby: a hero for the selected game and a card grid on the left, a social column on
 * the right (beside them from 1024px, below them on tablets).
 */
export function DesktopLobby(props: DesktopLobbyProps): ReactNode {
  const { t } = useI18nStore();
  const { selectedGame, category } = props;
  const playersLabel = (game: GameType): string => {
    const { minPlayers, maxPlayers } = gameDefinition(game).seats;
    return minPlayers === maxPlayers ? t('lobby.players', { n: String(minPlayers) })
      : t('lobby.playersRange', { min: String(minPlayers), max: String(maxPlayers) });
  };

  return <main className={styles.page}>
    <PageHeader title={t('rail.lobby')} titleHidden tabs={<Tabs label={t('lobby.categories')} idPrefix={LOBBY_TAB_PREFIX}
      controls={LOBBY_PANEL_ID} value={category} onChange={props.onCategoryChange}
      tabs={lobbyCategories().map((id) => ({ id, label: t(`lobby.category.${id}`) }))} />} />
    {props.error && <p className={styles.error} role="alert">{props.error}</p>}
    <AndroidAppBanner />
    <div className={styles.layout}>
      <section id={LOBBY_PANEL_ID} role="tabpanel" aria-labelledby={tabElementId(LOBBY_TAB_PREFIX, category)}
        className={styles.main}>
        <section id="lobby-selected-game" className={styles.hero} aria-labelledby="lobby-selected-game-title"
          data-in-room={props.inRoom ? true : undefined}>
          <img key={selectedGame} className={styles.heroArt} src={GAME_BACKGROUNDS[selectedGame]} alt="" width={1280}
            height={720} decoding="async" draggable={false} />
          <div className={styles.heroText}>
            <p className={styles.heroMeta}>{playersLabel(selectedGame)} · {t(`gameType.${selectedGame}Tag`)}</p>
            <h2 id="lobby-selected-game-title">{t(`gameType.${selectedGame}`)}</h2>
            <p className={styles.heroDescription}>{t(`gameType.${selectedGame}Desc`)}</p>
            <div className={styles.heroActions}>
              <Button variant="primary" className={styles.create} onClick={props.onCreate} disabled={props.roomLocked}>
                {props.pending === 'create' ? t('common.loading') : t('lobby.createRoom')}</Button>
              <form className={styles.join} onSubmit={props.onJoin}>
                <label className={styles.codeField}>
                  <input id="room-code-input" type="text" aria-label={t('room.code')} placeholder={t('lobby.roomCodePlaceholder')}
                    value={props.roomCode} onChange={(event) => props.onRoomCodeChange(event.target.value.toUpperCase())}
                    disabled={props.roomLocked} maxLength={6} required autoComplete="off"
                    autoCapitalize="characters" spellCheck={false} />
                  <Button type="submit" variant="text" size="small" disabled={props.roomLocked || !props.roomCode.trim()}>
                    {props.pending === 'join' ? t('common.loading') : t('lobby.join')}</Button>
                </label>
              </form>
              <Button variant="text" aria-haspopup="dialog" onClick={() => props.onShowRules(selectedGame)}>
                {t('lobby.rulesIntro')}</Button>
            </div>
          </div>
        </section>

        <div className={styles.cards} role="group" aria-label={t('gameType.choose')}>
          {gamesInCategory(category).map((game) => <button key={game} type="button"
            className={`${styles.card} ${selectedGame === game ? styles.selected : ''}`}
            aria-pressed={selectedGame === game} aria-controls="lobby-selected-game" disabled={props.pending !== null}
            onClick={() => props.onSelectGame(game)}>
            <img className={styles.art} src={GAME_CARD_ART[game]} alt="" width={480} height={270}
              loading="lazy" decoding="async" draggable={false} />
            <span className={styles.cardText}>
              <span className={styles.cardName}>{t(`gameType.${game}`)}</span>
              <span className={styles.cardMeta}>{playersLabel(game)} · {t(`gameType.${game}Tag`)}</span>
            </span>
          </button>)}
        </div>
      </section>

      <aside className={styles.social} aria-label={t('lobby.social')}>
        <LobbyFriends key={props.accountId} disabled={props.blocked} refreshToken={props.friends.refreshToken}
          onJoin={props.friends.onJoin} activity={props.friends.activity} />
        <DailyRewards key={props.accountId} layout="panel" />
      </aside>
    </div>
  </main>;
}
