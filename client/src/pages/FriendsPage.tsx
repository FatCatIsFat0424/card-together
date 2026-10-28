import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '@shared/constants';
import type { FriendEntry, FriendPlayStats, FriendsData, PublicAccount } from '@shared/types/social';
import { apiRequest } from '../api';
import { socket } from '../socket';
import { useSocialStore } from '../stores/social-store';
import { useAccountStore } from '../stores/account-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { PlayerLink } from '../components/PlayerLink';
import { DESKTOP_SHELL_QUERY } from '../components/desktop-nav';
import { friendAction, friendGroups } from '../components/lobby-friend-activity';
import type { FriendAction } from '../components/lobby-friend-activity';
import { useInviteFriend } from '../hooks/use-invite-friend';
import { IconButton } from '../components/IconButton';
import { Button } from '../components/Button';
import { FriendCard } from '../components/FriendCard';
import { Tabs, tabElementId } from '../components/Tabs';
import styles from './AccountPages.module.css';
import tabStyles from './FriendsPage.module.css';

const FRIEND_TABS = ['accepted', 'outgoing', 'incoming'] as const;
type FriendTab = typeof FRIEND_TABS[number];

/** Desktop and tablet shells show requests as cards; phones keep two-line rows. */
function FriendIdentity({ person, card }: { person: PublicAccount; card: boolean }): ReactNode {
  return <span className={tabStyles.identity}>
    {card ? <PlayerLink player={person} showUsername showTitle={false} size="medium" />
      : <PlayerLink player={person} showUsername showTitle={false} size="row" dense />}
  </span>;
}

export function FriendsPage(): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const accountId = useAccountStore((state) => state.account?.id);
  const conversations = useSocialStore((state) => state.conversations);
  const viewerRoomCode = useRoomStore((state) => state.currentRoomCode);
  const card = useMediaQuery(DESKTOP_SHELL_QUERY, { noSsr: true });
  const { invited, error: inviteError, invite, clearError } = useInviteFriend();
  const [data, setData] = useState<FriendsData | null>(null);
  const [stats, setStats] = useState<Record<string, FriendPlayStats>>({});
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

  // Shared play changes slowly, so it loads with the page and when the friend list changes size.
  const friendCount = data?.friends.length;
  useEffect(() => {
    if (friendCount === undefined || friendCount === 0) return;
    let active = true;
    void apiRequest<{ stats: Record<string, FriendPlayStats> }>('/api/friends/stats').then((result) => {
      if (active && result.success && useAccountStore.getState().account?.id === accountId) setStats(result.stats);
    });
    return () => { active = false; };
  }, [accountId, friendCount]);

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

  /** Joins a waiting room or spectates a running one; the server checks the room is still the friend's. */
  const join = (friend: FriendEntry): void => {
    const roomCode = friend.room?.code;
    if (!roomCode || busy) return;
    const current = useRoomStore.getState().currentRoomCode;
    if (current === roomCode) { navigate(`/room/${roomCode}`); return; }
    if (current && !window.confirm(t('invite.confirmLeave', { code: roomCode }))) return;
    setBusy(true);
    setError('');
    setSent(false);
    socket.timeout(10000).emit('room:joinFriend', { accountId: friend.id, roomCode }, (timeout, result) => {
      setBusy(false);
      if (!timeout && result.success && result.room) {
        navigate(`/${result.room.status === 'playing' ? 'game' : 'room'}/${result.room.code}`);
      } else {
        setError(timeout ? t('auth.connectionError') : result?.error ?? t('common.error'));
        void refresh();
      }
    });
  };

  if (searchParams.get('tab') === 'messages') return <Navigate to="/messages" replace />;

  const counts = { accepted: data?.friends.length,
    outgoing: data?.outgoing.length, incoming: data?.incoming.length };

  const shownError = error || inviteError;
  const onAction = (person: FriendEntry, action: FriendAction): void => {
    if (action === 'invite') invite(person.id);
    else join(person);
  };
  const groups = friendGroups(data?.friends ?? []);
  const friendList = (people: readonly FriendEntry[]): ReactNode => <ul className={tabStyles.friendList}>
    {people.map((person) => <FriendCard key={person.id} friend={person} stats={stats[person.id]} compact={!card}
      unread={conversations.find((conversation) => conversation.account.id === person.id)?.unreadCount ?? 0}
      action={friendAction(person, viewerRoomCode)} invited={invited.has(person.id)} busy={busy}
      confirming={removeId === person.id} onAction={(action) => onAction(person, action)}
      onRemove={() => setRemoveId(person.id)} onCancelRemove={() => setRemoveId(null)}
      onConfirmRemove={() => void act(`/api/friends/${person.id}`, 'DELETE')} />)}
  </ul>;
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
          {/* Phone rows keep one grid, online first, so the short screen holds more friends. */}
          {!card && friendList([...groups.online, ...groups.offline])}
          {card && groups.online.length > 0 && <section aria-labelledby="friends-online">
            <h2 id="friends-online" className={tabStyles.groupHeading}>{t('friends.onlineGroup', { n: String(groups.online.length) })}</h2>
            {friendList(groups.online)}
          </section>}
          {card && groups.offline.length > 0 && <section aria-labelledby="friends-offline">
            <h2 id="friends-offline" className={tabStyles.groupHeading}>{t('friends.offlineGroup', { n: String(groups.offline.length) })}</h2>
            {friendList(groups.offline)}
          </section>}
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
