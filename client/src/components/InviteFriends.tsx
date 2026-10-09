// ─── InviteFriends: in-room popup list for inviting friends ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FriendEntry, FriendsData } from '@shared/types';
import { apiRequest } from '../api';
import { socket } from '../socket';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import styles from './InviteFriends.module.css';

const INVITED_MS = 15_000;

export function InviteFriends(): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiRequest<FriendsData>('/api/friends').then((result) => {
      if (!active) return;
      if (result.success) {
        setFriends([...result.friends].sort((first, second) => Number(second.online) - Number(first.online)));
      } else setError(result.error);
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

  const invite = (accountId: string): void => {
    setError('');
    socket.timeout(10000).emit('room:invite', { accountId }, (timeout, result) => {
      if (timeout || !result.success) {
        setError(timeout ? t('auth.connectionError') : result.error ?? t('common.error'));
        return;
      }
      setInvited((current) => new Set(current).add(accountId));
      setTimeout(() => setInvited((current) => {
        const next = new Set(current);
        next.delete(accountId);
        return next;
      }), INVITED_MS);
    });
  };

  return (
    <div className={styles.group} data-invite-popover>
      <button type="button" className="btn btn-outline touch-target" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}>{t('invite.open')}</button>
      {open && <div className={styles.popover}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!friends && !error && <p role="status">{t('common.loading')}</p>}
        {friends?.length === 0 && <p className={styles.empty}>{t('invite.noFriends')}</p>}
        <ul className={styles.list}>{friends?.map((friend) => (
          <li key={friend.id} className={`${styles.row} ${friend.online ? '' : styles.offline}`}>
            <Avatar avatar={friend.avatar} image={friend.avatarImage} color={friend.color} size="small" />
            <span className={styles.name}>{friend.nickname}
              {friend.inRoom && <span className={styles.note}>{t('invite.inRoom')}</span>}</span>
            <button type="button" className="btn btn-primary"
              disabled={!friend.online || invited.has(friend.id)} onClick={() => invite(friend.id)}>
              {!friend.online ? t('invite.offline')
                : invited.has(friend.id) ? t('invite.sent') : t('invite.send')}</button>
          </li>
        ))}</ul>
      </div>}
    </div>
  );
}
