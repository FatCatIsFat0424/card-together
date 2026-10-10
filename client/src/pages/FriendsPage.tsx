import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '@shared/constants';
import type { FriendEntry, FriendsData, PublicAccount } from '@shared/types/social';
import { apiRequest } from '../api';
import { socket } from '../socket';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import styles from './AccountPages.module.css';

function FriendIdentity({ person }: { person: PublicAccount }): ReactNode {
  return <PlayerLink player={person} showUsername size="medium" />;
}

export function FriendsPage(): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const [data, setData] = useState<FriendsData | null>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await apiRequest<FriendsData>('/api/friends');
    setLoading(false);
    if (result.success) setData(result);
    else setError(result.error);
  }, []);

  useEffect(() => {
    void refresh();
    const handleFocus = (): void => { void refresh(); };
    window.addEventListener('focus', handleFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => { window.removeEventListener('focus', handleFocus); window.clearInterval(interval); };
  }, [refresh]);

  const act = async (path: string, method: 'POST' | 'DELETE', body?: object): Promise<void> => {
    setBusy(true);
    setError('');
    setSent(false);
    const result = await apiRequest(path, method, body);
    if (result.success) {
      if (body) { setUsername(''); setSent(true); }
      setRemoveId(null);
      await refresh();
    } else setError(result.error);
    setBusy(false);
  };
  const add = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void act('/api/friends/requests', 'POST', { username: username.trim() });
  };

  const join = (friend: FriendEntry): void => {
    const roomCode = friend.hostedRoomCode;
    if (!roomCode || busy) return;
    const current = useRoomStore.getState().currentRoomCode;
    if (current === roomCode) { navigate(`/room/${roomCode}`); return; }
    if (current && !window.confirm(t('invite.confirmLeave', { code: roomCode }))) return;
    setBusy(true);
    setError('');
    setSent(false);
    socket.timeout(10000).emit('room:joinFriend', { accountId: friend.id, roomCode }, (timeout, result) => {
      setBusy(false);
      if (!timeout && result.success && result.room) navigate(`/room/${result.room.code}`);
      else {
        setError(timeout ? t('auth.connectionError') : result?.error ?? t('common.error'));
        void refresh();
      }
    });
  };

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{t('friends.title')}</h1>
      <p className={styles.subtitle}>{t('friends.description')}</p>
      <form className={styles.addForm} onSubmit={add}>
        <div className={styles.field}>
          <label htmlFor="friend-username">{t('friends.username')}</label>
          <input id="friend-username" autoCapitalize="none" spellCheck={false} value={username}
            onChange={(event) => setUsername(event.target.value)} required
            minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_PATTERN} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('common.loading') : t('friends.add')}
        </button>
        <button type="button" className="btn btn-outline" disabled={busy || loading}
          onClick={() => { setError(''); setLoading(true); void refresh(); }}>{t('common.refresh')}</button>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {sent && <p className={styles.success} role="status">{t('friends.sent')}</p>}
      {loading && <p role="status">{t('common.loading')}</p>}
      {data && <div className={`${styles.grid} ${styles.section}`}>
        <section className={`${styles.card} ${styles.wide}`}>
          <h2>{t('friends.accepted')} ({data.friends.length})</h2>
          {data.friends.length === 0 && <p className={styles.empty}>{t('friends.empty')}</p>}
          <ul className={styles.list}>{data.friends.map((person) => (
            <li key={person.id} className={styles.person}>
              <span className={styles.presence}>
                <FriendIdentity person={person} />
                {person.online && <span className={styles.onlineDot} role="img"
                  aria-label={t('friends.online')} title={t('friends.online')} />}
              </span>
              {removeId === person.id ? <div className={styles.actions}>
                <span>{t('friends.confirmRemove')}</span>
                <button className="btn btn-danger" disabled={busy}
                  onClick={() => void act(`/api/friends/${person.id}`, 'DELETE')}>
                  {t('friends.remove')}</button>
                <button className="btn btn-outline" disabled={busy}
                  onClick={() => setRemoveId(null)}>{t('common.cancel')}</button>
              </div> : <div className={styles.actions}>
                {person.hostedRoomCode && <button type="button" className="btn btn-primary" disabled={busy}
                  aria-label={t('friends.joinRoomLabel', { nickname: person.nickname })}
                  onClick={() => join(person)}>{t('friends.joinRoom')}</button>}
                <button className="btn btn-outline" disabled={busy}
                  onClick={() => setRemoveId(person.id)}>{t('friends.remove')}</button>
              </div>}
            </li>
          ))}</ul>
        </section>
        <section className={styles.card}>
          <h2>{t('friends.incoming')} ({data.incoming.length})</h2>
          {data.incoming.length === 0 && <p className={styles.empty}>{t('friends.noIncoming')}</p>}
          <ul className={styles.list}>{data.incoming.map((request) => (
            <li key={request.id} className={styles.person}>
              <FriendIdentity person={request.requester} />
              <div className={styles.actions}>
                <button className="btn btn-primary" disabled={busy}
                  onClick={() => void act(`/api/friends/requests/${request.id}/accept`, 'POST')}>
                  {t('friends.accept')}</button>
                <button className="btn btn-outline" disabled={busy}
                  onClick={() => void act(`/api/friends/requests/${request.id}`, 'DELETE')}>
                  {t('friends.decline')}</button>
              </div>
            </li>
          ))}</ul>
        </section>
        <section className={styles.card}>
          <h2>{t('friends.outgoing')} ({data.outgoing.length})</h2>
          {data.outgoing.length === 0 && <p className={styles.empty}>{t('friends.noOutgoing')}</p>}
          <ul className={styles.list}>{data.outgoing.map((request) => (
            <li key={request.id} className={styles.person}>
              <FriendIdentity person={request.recipient} />
              <button className="btn btn-outline" disabled={busy}
                onClick={() => void act(`/api/friends/requests/${request.id}`, 'DELETE')}>
                {t('friends.cancel')}</button>
            </li>
          ))}</ul>
        </section>
      </div>}
    </main>
  );
}
