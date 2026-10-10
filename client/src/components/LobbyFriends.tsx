import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FriendEntry, FriendsData } from '@shared/types';
import { apiRequest } from '../api';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from './PlayerLink';
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
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let requestVersion = 0;
    const refresh = async (): Promise<void> => {
      const version = ++requestVersion;
      const result = await apiRequest<FriendsData>('/api/friends');
      if (!active || version !== requestVersion) return;
      setLoading(false);
      if (result.success) { setData(result); setError(''); }
      else { setData(null); setError(result.error); }
    };
    const onFocus = (): void => { void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [revision, refreshToken]);

  const friends = onlineLobbyFriends(data?.friends ?? []);
  return <section className={styles.panel} aria-labelledby="lobby-friends-title">
    <div className={styles.heading}>
      <h2 id="lobby-friends-title">{t('lobby.onlineFriends')}</h2>
      {data && <span className={styles.count}>{friends.length}</span>}
    </div>
    <p className={styles.hint}>{t('lobby.friendsHint')}</p>
    {loading && <p className={styles.message} role="status">{t('common.loading')}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {data && !loading && friends.length === 0 && <p className={styles.message}>
      {t(data.friends.length === 0 ? 'lobby.noFriends' : 'lobby.noOnlineFriends')}
    </p>}
    {data && !loading && friends.length > 0 && <ul className={styles.list}>
      {friends.map((friend) => <li key={friend.id} className={styles.friend}>
        <div className={styles.friendIdentity}>
          <PlayerLink player={friend} showUsername />
          <p className={styles.status}><span className={styles.onlineDot} aria-hidden="true" />
            {friend.hostedRoomCode ? t('lobby.hosting', { code: friend.hostedRoomCode })
              : t(friend.inRoom ? 'lobby.friendInRoom' : 'friends.online')}
          </p>
        </div>
        {friend.hostedRoomCode && <button type="button" className={`btn btn-outline ${styles.joinButton}`}
          disabled={disabled} aria-label={t('friends.joinRoomLabel', { nickname: friend.nickname })}
          onClick={() => onJoin(friend)}>{t('lobby.join')}</button>}
      </li>)}
    </ul>}
    {data && data.incoming.length > 0 && <Link className={styles.requests} to="/friends">
      {t('lobby.friendRequests', { n: String(data.incoming.length) })}
    </Link>}
    <div className={styles.actions}>
      <Link to="/friends">{t('player.manageFriends')}</Link>
      <button type="button" className="btn btn-outline" disabled={loading} onClick={() => {
        setLoading(true); setError(''); setRevision((value) => value + 1);
      }}>{t('common.refresh')}</button>
    </div>
  </section>;
}
