import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FriendEntry } from '@shared/types';
import { useFriendsData } from '../hooks/use-friends-data';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from './PlayerLink';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { canEnterFriendRoom, friendAction } from './lobby-friend-activity';
import { friendActivityText } from './friend-activity-text';
import styles from './LobbyFriends.module.css';

/** Online friends appear in the lobby, those whose room is open to enter first, input order preserved otherwise. */
export function onlineLobbyFriends(friends: readonly FriendEntry[]): FriendEntry[] {
  return friends.filter((friend) => friend.online)
    .sort((a, b) => Number(canEnterFriendRoom(b)) - Number(canEnterFriendRoom(a)));
}

/** Desktop column extras: each row shows what the friend is doing and offers join or invite. */
export interface LobbyFriendsActivity {
  readonly viewerRoomCode: string | null;
  readonly invited: ReadonlySet<string>;
  readonly onInvite: (friend: FriendEntry) => void;
}

export function LobbyFriends({ disabled, refreshToken, onJoin, activity }: {
  readonly disabled: boolean; readonly refreshToken: number;
  readonly onJoin: (friend: FriendEntry) => void;
  readonly activity?: LobbyFriendsActivity;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const { data, error, loading, reload } = useFriendsData(true, refreshToken);
  const friends = onlineLobbyFriends(data?.friends ?? []);
  const statusOf = (friend: FriendEntry): string | undefined => friendActivityText(friend, locale)?.short;
  const joinButton = (friend: FriendEntry): ReactNode => {
    const spectate = !friend.room?.joinable;
    return <Button variant="ghost" size="small" disabled={disabled}
      aria-label={t(spectate ? 'friends.spectateLabel' : 'friends.joinRoomLabel', { nickname: friend.nickname })}
      onClick={() => onJoin(friend)}>{t(spectate ? 'friends.spectate' : 'lobby.join')}</Button>;
  };
  const friendActions = (friend: FriendEntry): ReactNode => {
    const action = friendAction(friend, activity?.viewerRoomCode ?? null);
    if (action === 'join' || action === 'spectate') return joinButton(friend);
    if (action !== 'invite') return null;
    const sent = activity?.invited.has(friend.id) ?? false;
    return <Button variant="ghost" size="small" disabled={disabled || sent}
      aria-label={`${t('invite.send')} ${friend.nickname}`}
      onClick={() => activity?.onInvite(friend)}>{t(sent ? 'invite.sent' : 'invite.send')}</Button>;
  };
  return <section className={`${styles.panel} ${activity ? styles.activity : ''}`} aria-labelledby="lobby-friends-title">
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
          {activity ? <PlayerLink player={friend} dense size="compact" showTitle={false} details={statusOf(friend)} />
            : <PlayerLink player={friend} showUsername />}
        </div>
        {activity ? friendActions(friend) : canEnterFriendRoom(friend) && joinButton(friend)}
      </li>)}
    </ul>}
    {data && data.incoming.length > 0 && <Link className={styles.requests} to="/friends">
      {t('lobby.friendRequests', { n: String(data.incoming.length) })}
    </Link>}
  </section>;
}
