import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FriendEntry } from '@shared/types';
import { useFriendsData } from '../hooks/use-friends-data';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from './PlayerLink';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './LobbyFriends.module.css';

/** Online friends appear in the lobby, with hosts first and input order preserved otherwise. */
export function onlineLobbyFriends(friends: readonly FriendEntry[]): FriendEntry[] {
  return friends.filter((friend) => friend.online)
    .sort((a, b) => Number(Boolean(b.hostedRoomCode)) - Number(Boolean(a.hostedRoomCode)));
}

export function LobbyFriends({ disabled, refreshToken, onJoin }: {
  readonly disabled: boolean; readonly refreshToken: number;
  readonly onJoin: (friend: FriendEntry) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const { data, error, loading, reload } = useFriendsData(true, refreshToken);
  const friends = onlineLobbyFriends(data?.friends ?? []);
  return <section className={styles.panel} aria-labelledby="lobby-friends-title">
    <div className={styles.heading}>
      <div className={styles.title}>
        <h2 id="lobby-friends-title">{t('lobby.onlineFriends')}</h2>
        {data && <span className={styles.count}>{friends.length}</span>}
      </div>
      <div className={styles.actions}>
        <Link to="/friends">{t('player.manageFriends')}</Link>
        <IconButton icon="refresh" label={t('common.refresh')} disabled={loading} onClick={reload} />
      </div>
    </div>
    {loading && <p className={styles.message} role="status">{t('common.loading')}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {data && !loading && data.friends.length > 0 && friends.length === 0 && <p className={styles.message}>
      {t('lobby.noOnlineFriends')}
    </p>}
    {data && !loading && friends.length > 0 && <ul className={styles.list}>
      {friends.map((friend) => <li key={friend.id} className={styles.friend}>
        <div className={styles.friendIdentity} title={friend.nickname}>
          <PlayerLink player={friend} showUsername />
        </div>
        {friend.hostedRoomCode && <Button variant="ghost" size="small" disabled={disabled}
          aria-label={t('friends.joinRoomLabel', { nickname: friend.nickname })}
          onClick={() => onJoin(friend)}>{t('lobby.join')}</Button>}
      </li>)}
    </ul>}
    {data && data.incoming.length > 0 && <Link className={styles.requests} to="/friends">
      {t('lobby.friendRequests', { n: String(data.incoming.length) })}
    </Link>}
  </section>;
}
