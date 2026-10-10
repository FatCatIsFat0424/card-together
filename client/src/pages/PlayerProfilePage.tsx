import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FriendsData, MatchHistory, PublicAccount } from '@shared/types';
import { apiRequest } from '../api';
import { Avatar } from '../components/Avatar';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './PlayerProfilePage.module.css';

function PlayerProfile({ accountId }: { accountId: string }): ReactNode {
  const { t } = useI18nStore();
  const viewerId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const phase = useGameStore((state) => state.phase);
  const isSelf = viewerId === accountId;
  const [player, setPlayer] = useState<PublicAccount | null>(null);
  const [history, setHistory] = useState<MatchHistory | 'private' | null>(null);
  const [friends, setFriends] = useState<FriendsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [friendError, setFriendError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const active = useRef(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const version = ++requestVersion.current;
    setLoading(true);
    setProfileError('');
    setFriendError('');
    const [profileResult, friendResult, historyResult] = await Promise.all([
      apiRequest<{ account: PublicAccount }>(`/api/players/${encodeURIComponent(accountId)}`),
      isSelf ? Promise.resolve(null) : apiRequest<FriendsData>('/api/friends'),
      apiRequest<MatchHistory>(`/api/players/${encodeURIComponent(accountId)}/history`),
    ]);
    if (!active.current || version !== requestVersion.current) return;
    setLoading(false);
    setHistory(historyResult.success ? historyResult : historyResult.status === 403 ? 'private' : null);
    if (profileResult.success) {
      setPlayer(profileResult.account);
      setNotFound(false);
    } else {
      setPlayer(null);
      setNotFound(profileResult.status === 404);
      setProfileError(profileResult.error);
    }
    if (friendResult?.success) setFriends(friendResult);
    else if (friendResult) { setFriends(null); setFriendError(friendResult.error); }
  }, [accountId, isSelf]);

  useEffect(() => {
    active.current = true;
    void refresh();
    const handleFocus = (): void => { void refresh(); };
    window.addEventListener('focus', handleFocus);
    return () => {
      active.current = false;
      requestVersion.current += 1;
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh]);

  const act = async (path: string, method: 'POST' | 'DELETE', body?: object): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFriendError('');
    setUpdated(false);
    const result = await apiRequest(path, method, body);
    if (!active.current) return;
    if (result.success) {
      setUpdated(true);
      setConfirmRemove(false);
      await refresh();
    } else {
      setFriendError(result.error);
    }
    if (active.current) setBusy(false);
  };

  if (loading && !player) return <main className={styles.page}>
    <p className={styles.status} role="status">{t('common.loading')}</p>
  </main>;

  if (!player) return <main className={styles.page}>
    <section className={styles.card}>
      <h1>{t('player.title')}</h1>
      <p className={styles.error} role="alert">{notFound ? t('player.notFound') : profileError}</p>
      <div className={styles.actions}>
        <button className="btn btn-primary" onClick={() => void refresh()}>{t('common.retry')}</button>
        <Link className="btn btn-outline" to="/friends">{t('nav.friends')}</Link>
      </div>
    </section>
  </main>;

  const isFriend = friends?.friends.some((friend) => friend.id === accountId) ?? false;
  const incoming = friends?.incoming.find((request) => request.requester.id === accountId);
  const outgoing = friends?.outgoing.find((request) => request.recipient.id === accountId);
  const disabled = busy || loading;

  return <main className={styles.page}>
    <p className={styles.eyebrow}>{t('player.title')}</p>
    <div className={styles.layout}>
      <section className={`${styles.card} ${styles.profile}`}>
        <div className={styles.identity}>
          <Avatar avatar={player.avatar} image={player.avatarImage} color={player.color} size="large" />
          <div className={styles.name}>
            <h1 style={{ color: player.color }}>{player.nickname}</h1>
            <p className={styles.username}>@{player.username}</p>
          </div>
        </div>
        {isSelf ? <div className={styles.actions}>
          <Link className="btn btn-primary" to="/account">{t('player.edit')}</Link>
        </div> : <>
          {friends && <>
            <p className={styles.description}>{t(isFriend ? 'player.friends'
              : incoming ? 'player.incoming' : outgoing ? 'player.outgoing' : 'player.connect')}</p>
            <div className={styles.actions}>
              {isFriend ? confirmRemove ? <>
                <span>{t('friends.confirmRemove')}</span>
                <button className="btn btn-danger" disabled={disabled}
                  onClick={() => void act(`/api/friends/${encodeURIComponent(accountId)}`, 'DELETE')}>
                  {t('friends.remove')}</button>
                <button className="btn btn-outline" disabled={disabled}
                  onClick={() => setConfirmRemove(false)}>{t('common.cancel')}</button>
              </> : <button className="btn btn-outline" disabled={disabled}
                onClick={() => setConfirmRemove(true)}>{t('friends.remove')}</button>
              : incoming ? <>
                <button className="btn btn-primary" disabled={disabled}
                  onClick={() => void act(`/api/friends/requests/${incoming.id}/accept`, 'POST')}>
                  {t('friends.accept')}</button>
                <button className="btn btn-outline" disabled={disabled}
                  onClick={() => void act(`/api/friends/requests/${incoming.id}`, 'DELETE')}>
                  {t('friends.decline')}</button>
              </> : outgoing ? <button className="btn btn-outline" disabled={disabled}
                onClick={() => void act(`/api/friends/requests/${outgoing.id}`, 'DELETE')}>
                {t('friends.cancel')}</button>
              : <button className="btn btn-primary" disabled={disabled}
                onClick={() => void act('/api/friends/requests', 'POST', { username: player.username })}>
                {t('friends.add')}</button>}
            </div>
          </>}
          {friendError && <div className={styles.feedback}>
            <p className={styles.error} role="alert">{friendError}</p>
            <button className="btn btn-outline" disabled={disabled}
              onClick={() => void refresh()}>{t('common.retry')}</button>
          </div>}
          {updated && <p className={styles.success} role="status">{t('player.updated')}</p>}
          <Link className={styles.friendsLink} to="/friends">{t('player.manageFriends')}</Link>
        </>}
      </section>
      {history && <section className={`${styles.card} ${styles.history}`}>
        {history === 'private' ? <p className={styles.description}>{t('history.private')}</p>
          : <MatchHistoryList matches={history.matches} players={history.players} accountId={accountId} />}
      </section>}
    </div>
    {roomCode && <div className={styles.footer}>
      <Link className="btn btn-outline" to={`/${phase ? 'game' : 'room'}/${roomCode}`}>
        {t('lobby.resume')} · {roomCode}</Link>
    </div>}
  </main>;
}

export function PlayerProfilePage(): ReactNode {
  const { accountId = '' } = useParams<{ accountId: string }>();
  return <PlayerProfile key={accountId} accountId={accountId} />;
}
