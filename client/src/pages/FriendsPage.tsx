import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '@shared/constants';
import type { FriendEntry, FriendsData, PublicAccount } from '@shared/types/social';
import { apiRequest } from '../api';
import { socket } from '../socket';
import { useSocialStore } from '../stores/social-store';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import { DESKTOP_SHELL_QUERY } from '../components/desktop-nav';
import { friendAction } from '../components/lobby-friend-activity';
import { useInviteFriend } from '../hooks/use-invite-friend';
import { IconButton } from '../components/IconButton';
import { FriendStatus } from '../components/FriendStatus';
import { Button, buttonClassName } from '../components/Button';
import { OverflowMenu } from '../components/OverflowMenu';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './AccountPages.module.css';
import tabStyles from './FriendsPage.module.css';

const FRIEND_TABS = ['accepted', 'outgoing', 'incoming'] as const;
type FriendTab = typeof FRIEND_TABS[number];

/** Desktop and tablet shells show people as cards; phones keep two-line rows. */
function FriendIdentity({ person, status, card }: {
  person: PublicAccount; status?: ReactNode; card: boolean;
}): ReactNode {
  return <span className={tabStyles.identity}>
    {card ? <PlayerLink player={person} showUsername showTitle={false} size="medium" />
      : <PlayerLink player={person} showUsername showTitle={false} size="row" dense details={status} />}
  </span>;
}

export function FriendsPage(): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = useAccountStore((state) => state.account?.id);
  const conversations = useSocialStore((state) => state.conversations);
  const viewerInRoom = useRoomStore((state) => state.currentRoomCode) !== null;
  const card = useMediaQuery(DESKTOP_SHELL_QUERY, { noSsr: true });
  const { invited, error: inviteError, invite, clearError } = useInviteFriend();
  const [data, setData] = useState<FriendsData | null>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const activeTab: FriendTab = FRIEND_TABS.find((tab) => tab === searchParams.get('tab')) ?? 'accepted';
  const setActiveTab = (tab: FriendTab): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const refresh = useCallback(async (): Promise<void> => {
    const result = await apiRequest<FriendsData>('/api/friends');
    if (useAccountStore.getState().account?.id !== accountId) return;
    setLoading(false);
    if (result.success) setData(result);
    else setError(result.error);
  }, [accountId]);

  useEffect(() => {
    void refresh();
    const handleFocus = (): void => { void refresh(); };
    window.addEventListener('focus', handleFocus);
    socket.on('social:changed', handleFocus);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => { socket.off('social:changed', handleFocus); window.removeEventListener('focus', handleFocus); window.clearInterval(interval); };
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

  if (searchParams.get('tab') === 'messages') return <Navigate to="/messages" replace />;

  const counts = { accepted: data?.friends.length,
    outgoing: data?.outgoing.length, incoming: data?.incoming.length };

  const shownError = error || inviteError;
  const action = (person: FriendEntry): ReactNode => {
    const kind = friendAction(person, viewerInRoom);
    if (kind === 'join') return <Button size={card ? 'regular' : 'small'} variant="primary" disabled={busy}
      aria-label={t('friends.joinRoomLabel', { nickname: person.nickname })}
      onClick={() => join(person)}>{t('friends.joinRoom')}</Button>;
    if (kind !== 'invite') return null;
    const sent = invited.has(person.id);
    return <Button size={card ? 'regular' : 'small'} disabled={busy || sent}
      aria-label={`${t('invite.send')} ${person.nickname}`}
      onClick={() => invite(person.id)}>{t(sent ? 'invite.sent' : 'invite.send')}</Button>;
  };
  const pill = card ? 'regular' : 'small';

  return (
    <main className={`${styles.page} ${tabStyles.page}`}>
      <h1 className={tabStyles.srOnly}>{t('friends.title')}</h1>
      <div className={tabStyles.bar}>
        <Tabs<FriendTab> idPrefix="friends" controls="friends-panel" label={t('nav.friends')} value={activeTab}
          className={tabStyles.tabs} onChange={setActiveTab}
          tabs={FRIEND_TABS.map((tab) => ({ id: tab, label: <>{t(`friends.${tab}`)}
            {counts[tab] !== undefined && <span className={tabStyles.count}>{counts[tab]}</span>}</> }))} />
        <form className={tabStyles.addForm} onSubmit={add}>
          <label htmlFor="friend-username" className={tabStyles.srOnly}>{t('friends.username')}</label>
          <input id="friend-username" autoCapitalize="none" spellCheck={false} value={username}
            placeholder={t('friends.username')}
            onChange={(event) => setUsername(event.target.value)} required
            minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_PATTERN} />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('common.loading') : t('friends.add')}
          </Button>
          <IconButton icon="refresh" label={t('common.refresh')} disabled={busy || loading}
            onClick={() => { setError(''); clearError(); setLoading(true); void refresh(); }} />
        </form>
      </div>
      {shownError && <p className={styles.error} role="alert">{shownError}</p>}
      {sent && <p className={styles.success} role="status">{t('friends.sent')}</p>}
      {loading && <p role="status">{t('common.loading')}</p>}
      <div id="friends-panel" role="tabpanel" aria-labelledby={tabElementId('friends', activeTab)} className={tabStyles.panel}>
        {data && <section id="friends-panel-accepted" hidden={activeTab !== 'accepted'}>
          {data.friends.length === 0 && <p className={styles.empty}>{t('friends.empty')}</p>}
          <ul className={tabStyles.list}>{data.friends.map((person) => {
            const unread = conversations.find((conversation) => conversation.account.id === person.id)?.unreadCount ?? 0;
            const confirming = removeId === person.id;
            return (
              <li key={person.id} className={tabStyles.person} data-confirming={confirming || undefined}>
                <FriendIdentity person={person} card={card} status={<FriendStatus friend={person} />} />
                {!confirming && <div className={tabStyles.menu}>
                  <OverflowMenu label={t('friends.moreFor', { nickname: person.nickname })} disabled={busy}
                    items={[{ label: t('friends.remove'), danger: true, onSelect: () => setRemoveId(person.id) }]} />
                </div>}
                {card && <div className={tabStyles.status}><FriendStatus friend={person} /></div>}
                {confirming ? <div className={tabStyles.confirm}>
                  <span>{t('friends.confirmRemove')}</span>
                  <Button size="small" variant="danger-text" disabled={busy}
                    onClick={() => void act(`/api/friends/${person.id}`, 'DELETE')}>
                    {t('friends.remove')}</Button>
                  <Button size="small" disabled={busy} onClick={() => setRemoveId(null)}>{t('common.cancel')}</Button>
                </div> : <div className={tabStyles.actions}>
                  <Link className={buttonClassName('ghost', pill)} to={`/messages/${encodeURIComponent(person.id)}`}
                    aria-label={t('messages.openFor', { nickname: person.nickname })}>
                    {t('messages.open')}
                    {unread > 0 && <span className={tabStyles.count}
                      aria-label={t('social.unread', { n: String(unread) })}>{unread}</span>}
                  </Link>
                  {action(person)}
                </div>}
              </li>
            );
          })}</ul>
        </section>}
        {data && <><section id="friends-panel-incoming" hidden={activeTab !== 'incoming'}>
          {data.incoming.length === 0 && <p className={styles.empty}>{t('friends.noIncoming')}</p>}
          <ul className={tabStyles.list}>{data.incoming.map((request) => (
            <li key={request.id} className={`${tabStyles.person} ${tabStyles.request}`}>
              <FriendIdentity person={request.requester} card={card} />
              <div className={tabStyles.actions}>
                <Button size={pill} variant="primary" disabled={busy}
                  onClick={() => void act(`/api/friends/requests/${request.id}/accept`, 'POST')}>
                  {t('friends.accept')}</Button>
                <Button size={pill} disabled={busy}
                  onClick={() => void act(`/api/friends/requests/${request.id}`, 'DELETE')}>
                  {t('friends.decline')}</Button>
              </div>
            </li>
          ))}</ul>
        </section>
        <section id="friends-panel-outgoing" hidden={activeTab !== 'outgoing'}>
          {data.outgoing.length === 0 && <p className={styles.empty}>{t('friends.noOutgoing')}</p>}
          <ul className={tabStyles.list}>{data.outgoing.map((request) => (
            <li key={request.id} className={`${tabStyles.person} ${tabStyles.request}`}>
              <FriendIdentity person={request.recipient} card={card} />
              <div className={tabStyles.actions}>
                <Button size={pill} disabled={busy}
                  onClick={() => void act(`/api/friends/requests/${request.id}`, 'DELETE')}>
                  {t('friends.cancel')}</Button>
              </div>
            </li>
          ))}</ul>
        </section></>}
      </div>
    </main>
  );
}
