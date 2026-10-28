// ─── InviteFriends: in-room popup list for inviting friends ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FriendEntry, FriendsData } from '@shared/types';
import { apiRequest } from '../api';
import { useInviteFriend } from '../hooks/use-invite-friend';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { PresenceAvatar } from './FriendCard';
import { friendActivityText } from './friend-activity-text';
import { friendGroups } from './lobby-friend-activity';
import styles from './InviteFriends.module.css';

export function InviteFriends(): ReactNode {
  const { locale, t } = useI18nStore();
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const { invited, error: inviteError, invite, clearError } = useInviteFriend();
  const error = loadError || inviteError;
  const groups = friendGroups(friends ?? []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiRequest<FriendsData>('/api/friends').then((result) => {
      if (!active) return;
      if (result.success) setFriends(result.friends);
      else setLoadError(result.error);
    });
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-invite-popover]')) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const row = (friend: FriendEntry): ReactNode => {
    const activity = friendActivityText(friend, locale);
    const here = friend.room?.code === roomCode;
    const sent = invited.has(friend.id);
    return <li key={friend.id} className={styles.row} data-offline={!friend.online || undefined}>
      <PresenceAvatar friend={friend} size="compact" />
      <span className={styles.name}><b>{friend.nickname}</b>{activity && <small>{activity.short}</small>}</span>
      {friend.online && !here && (sent
        ? <span className={styles.sent} role="status"><AppIcon name="check" />{t('invite.sent')}</span>
        // Friends busy in another room get the quieter button.
        : <Button className={styles.invite} variant={friend.room ? 'ghost' : 'primary'}
          aria-label={`${t('invite.send')} ${friend.nickname}`} onClick={() => invite(friend.id)}>{t('invite.send')}</Button>)}
    </li>;
  };

  return (
    <div className={styles.group} data-invite-popover>
      <IconButton icon="invite" label={t('invite.open')} aria-expanded={open} current={open}
        onClick={() => { clearError(); setOpen((current) => !current); }} />
      {open && <div className={styles.popover} role="dialog" aria-labelledby="invite-friends-title">
        <h2 id="invite-friends-title" className={styles.title}>{t('invite.open')}
          {invited.size > 0 && <small>{t('invite.invitedCount', { n: String(invited.size) })}</small>}</h2>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!friends && !error && <p className={styles.empty} role="status">{t('common.loading')}</p>}
        {friends?.length === 0 && <p className={styles.empty}>{t('invite.noFriends')}</p>}
        {groups.online.length > 0 && <>
          <h3 className={styles.section}>{t('friends.onlineGroup', { n: String(groups.online.length) })}</h3>
          <ul className={styles.list}>{groups.online.map(row)}</ul>
        </>}
        {groups.offline.length > 0 && <>
          <h3 className={styles.section}>{t('friends.offlineGroup', { n: String(groups.offline.length) })}</h3>
          <ul className={styles.list}>{groups.offline.map(row)}</ul>
        </>}
      </div>}
    </div>
  );
}
