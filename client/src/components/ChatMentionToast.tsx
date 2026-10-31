import type { ReactNode } from 'react';
import Snackbar from '@mui/material/Snackbar';
import { useNavigate } from 'react-router-dom';
import { useChatMentionStore } from '../stores/chat-mention-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './ChatMentionToast.module.css';

export function ChatMentionToast(): ReactNode {
  const notice = useChatMentionStore((state) => state.notice);
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const dismiss = (): void => {
    if (notice) useChatMentionStore.getState().dismissNotice(notice.id);
  };
  const view = (): void => {
    if (!notice) return;
    const room = useRoomStore.getState().roomInfo;
    if (!room) { dismiss(); return; }
    useChatMentionStore.getState().requestJump(notice.id);
    navigate(room.replay ? `/room/${room.code}/replay`
      : room.status === 'playing' ? `/game/${room.code}` : `/room/${room.code}`);
  };
  return <Snackbar key={notice?.id ?? 'none'} open={notice !== null} autoHideDuration={6000}
    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    onClose={(_event, reason) => { if (reason !== 'clickaway') dismiss(); }}>
    <div className={styles.toast} role="status">
      <div className={styles.body}>
        <strong>{notice && t('chat.notifications.notice', { nickname: notice.sender.nickname })}</strong>
        <p>{notice?.content}</p>
      </div>
      <Button size="small" onClick={view}>{t('chat.notifications.view')}</Button>
      <IconButton icon="close" label={t('chat.notifications.dismiss')} onClick={dismiss} />
    </div>
  </Snackbar>;
}
