// ─── InviteFriends: in-room popup list for inviting friends ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FriendEntry, FriendsData } from '@shared/types';
import { apiRequest } from '../api';
import { useInviteFriend } from '../hooks/use-invite-friend';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './InviteFriends.module.css';

export function InviteFriends(): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const { invited, error: inviteError, invite, clearError } = useInviteFriend();
  const error = loadError || inviteError;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void apiRequest<FriendsData>('/api/friends').then((result) => {
      if (!active) return;
      if (result.success) {
        setFriends([...result.friends].sort((first, second) => Number(second.online) - Number(first.online)));
      } else setLoadError(result.error);
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

  return (
    <div className={styles.group} data-invite-popover>
      <IconButton icon="personAdd" label={t('invite.open')} aria-expanded={open}
        onClick={() => { clearError(); setOpen((current) => !current); }} />
      {open && <div className={styles.popover}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!friends && !error && <p role="status">{t('common.loading')}</p>}
        {friends?.length === 0 && <p className={styles.empty}>{t('invite.noFriends')}</p>}
        <ul className={styles.list}>{friends?.map((friend) => (
          <li key={friend.id} className={`${styles.row} ${friend.online ? '' : styles.offline}`}>
            <Avatar avatar={friend.avatar} image={friend.avatarImage} border={friend.avatarBorder} color={friend.color} size="small" />
            <span className={styles.name}>{friend.nickname}
              {friend.inRoom && <span className={styles.note}>{t('invite.inRoom')}</span>}</span>
            <Button size="small" variant={friend.online && !invited.has(friend.id) ? 'primary' : 'ghost'}
              disabled={!friend.online || invited.has(friend.id)} onClick={() => invite(friend.id)}>
              {!friend.online ? t('invite.offline')
                : invited.has(friend.id) ? t('invite.sent') : t('invite.send')}</Button>
          </li>
        ))}</ul>
      </div>}
    </div>
  );
}
