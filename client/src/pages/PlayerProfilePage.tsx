import { useCallback, useEffect, useRef, useState } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FriendsData, MatchHistory, PublicAccount } from '@shared/types';
import { apiRequest } from '../api';
import { Nameplate } from '../components/Nameplate';
import { Avatar } from '../components/Avatar';
import { Button, buttonClassName } from '../components/Button';
import { MatchHistoryList } from '../components/MatchHistoryList';
import { historySummary, historySummaryItems } from '../match-history';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './PlayerProfilePage.module.css';

/** Desktop shell at full rail width: the header grows to a wide strip with inline statistics. */
const WIDE_QUERY = '(min-width: 1024px) and (min-height: 501px)';

function PlayerProfile({ accountId }: { accountId: string }): ReactNode {
  const { t, locale } = useI18nStore();
  const wide = useMediaQuery(WIDE_QUERY, { noSsr: true });
  const viewerId = useAccountStore((state) => state.account?.id);
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
        <Button variant="primary" onClick={() => void refresh()}>{t('common.retry')}</Button>
        <Link className={buttonClassName()} to="/friends">{t('nav.friends')}</Link>
      </div>
    </section>
  </main>;

  const isFriend = friends?.friends.some((friend) => friend.id === accountId) ?? false;
  const incoming = friends?.incoming.find((request) => request.requester.id === accountId);
  const outgoing = friends?.outgoing.find((request) => request.recipient.id === accountId);
  const disabled = busy || loading;
  const summary = history && history !== 'private'
    ? historySummaryItems(historySummary(history.matches, accountId), (key) => t(key), (type) => t(`gameType.${type}`), locale)
    : [];

  return <main className={styles.page}>
    <section className={styles.header}>
      <div className={styles.avatar}>
        <Avatar avatar={player.avatar} image={player.avatarImage} border={player.avatarBorder} color={player.color}
          size={wide ? 'large' : 'compact'} />
      </div>
      <div className={styles.name}>
        <h1 style={{ color: player.color }}>{player.nickname}</h1>
        <Nameplate id={player.nameplate} />
        <p className={styles.username}>@{player.username}</p>
      </div>
      {summary.length > 0 && <ul className={styles.summary} aria-label={t('history.statistics')}>
        {summary.map((item) => <li key={item.id}>
          <span className={styles.summaryLabel}>{item.label}</span> <strong>{item.value}</strong>
        </li>)}
      </ul>}
      <div className={styles.actions}>
        {isSelf ? <Link className={buttonClassName('primary')} to="/account">{t('player.edit')}</Link> : <>
          {friends && <>
            {(isFriend || incoming || outgoing) && <p className={styles.description}>{t(isFriend ? 'player.friends'
              : incoming ? 'player.incoming' : 'player.outgoing')}</p>}
            {isFriend ? confirmRemove ? <>
              <span className={styles.description}>{t('friends.confirmRemove')}</span>
              <Button variant="danger-text" disabled={disabled}
                onClick={() => void act(`/api/friends/${encodeURIComponent(accountId)}`, 'DELETE')}>
                {t('friends.remove')}</Button>
              <Button disabled={disabled}
                onClick={() => setConfirmRemove(false)}>{t('common.cancel')}</Button>
            </> : <Button disabled={disabled}
              onClick={() => setConfirmRemove(true)}>{t('friends.remove')}</Button>
            : incoming ? <>
              <Button variant="primary" disabled={disabled}
                onClick={() => void act(`/api/friends/requests/${incoming.id}/accept`, 'POST')}>
                {t('friends.accept')}</Button>
              <Button disabled={disabled}
                onClick={() => void act(`/api/friends/requests/${incoming.id}`, 'DELETE')}>
                {t('friends.decline')}</Button>
            </> : outgoing ? <Button disabled={disabled}
              onClick={() => void act(`/api/friends/requests/${outgoing.id}`, 'DELETE')}>
              {t('friends.cancel')}</Button>
            : <Button variant="primary" disabled={disabled}
              onClick={() => void act('/api/friends/requests', 'POST', { username: player.username })}>
              {t('friends.add')}</Button>}
          </>}
          <Link className={styles.friendsLink} to="/friends">{t('player.manageFriends')}</Link>
        </>}
      </div>
    </section>
    {friendError && <div className={styles.feedback}>
      <p className={styles.error} role="alert">{friendError}</p>
      <Button disabled={disabled} onClick={() => void refresh()}>{t('common.retry')}</Button>
    </div>}
    {updated && <p className={styles.success} role="status">{t('player.updated')}</p>}
    {history && <section className={styles.history}>
      {history === 'private' ? <p className={styles.description}>{t('history.private')}</p>
        : <MatchHistoryList matches={history.matches} players={history.players} accountId={accountId} />}
    </section>}
  </main>;
}

export function PlayerProfilePage(): ReactNode {
  const { accountId = '' } = useParams<{ accountId: string }>();
  return <PlayerProfile key={accountId} accountId={accountId} />;
}
