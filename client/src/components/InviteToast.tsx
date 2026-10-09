// ─── InviteToast: global friend room-invite notification ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useInviteStore } from '../stores/invite-store';
import type { ReceivedInvite } from '../stores/invite-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { Avatar } from './Avatar';
import styles from './InviteToast.module.css';

export function InviteToast(): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const invites = useInviteStore((state) => state.invites);
  const dismiss = useInviteStore((state) => state.dismiss);
  const [error, setError] = useState('');

  useEffect(() => {
    const { receive } = useInviteStore.getState();
    socket.on('room:invited', receive);
    return () => { socket.off('room:invited', receive); };
  }, []);

  const fail = (timeout: Error | null, result?: { error?: string }): void =>
    setError(timeout ? t('auth.connectionError') : result?.error ?? t('common.error'));

  const join = (invite: ReceivedInvite): void => {
    const { roomCode } = invite;
    const current = useRoomStore.getState().currentRoomCode;
    if (current === roomCode) { dismiss(invite.id); navigate(`/room/${roomCode}`); return; }
    if (current && !window.confirm(t('invite.confirmLeave', { code: roomCode }))) return;
    dismiss(invite.id);
    setError('');
    const enter = (): void => {
      socket.timeout(10000).emit('room:join', { roomCode }, (timeout, result) => {
        if (!timeout && result.success) navigate(`/room/${roomCode}`);
        else fail(timeout, result);
      });
    };
    if (!current) { enter(); return; }
    socket.timeout(10000).emit('room:leave', (timeout, result) => {
      if (!timeout && result.success) enter();
      else fail(timeout, result);
    });
  };

  if (invites.length === 0 && !error) return null;
  return (
    <div className={styles.stack} aria-live="polite">
      {error && <p className={`${styles.toast} ${styles.error}`} role="alert">
        {error}
        <button type="button" className="btn btn-outline" onClick={() => setError('')}>
          {t('invite.ignore')}</button>
      </p>}
      {invites.map((invite) => (
        <div key={invite.id} className={styles.toast} role="status">
          <Avatar avatar={invite.from.avatar} image={invite.from.avatarImage}
            color={invite.from.color} size="small" />
          <span className={styles.message}>
            {t('invite.message', { nickname: invite.from.nickname, code: invite.roomCode })}</span>
          <div className={styles.actions}>
            <button type="button" className="btn btn-primary" onClick={() => join(invite)}>
              {t('invite.join')}</button>
            <button type="button" className="btn btn-outline" onClick={() => dismiss(invite.id)}>
              {t('invite.ignore')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
