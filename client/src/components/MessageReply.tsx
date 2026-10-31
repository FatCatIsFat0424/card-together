import type { ReactNode } from 'react';
import type { ReplyPreview } from '@shared/types/chat';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { AppCheckbox } from './AppCheckbox';
import { IconButton } from './IconButton';
import styles from './MessageReply.module.css';

export function ReplyQuote({ preview, onJump }: {
  readonly preview: ReplyPreview | undefined;
  readonly onJump: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  if (!preview) return <span className={styles.unavailable}>{t('reply.unavailable')}</span>;
  return <button type="button" className={styles.quote} onClick={onJump}
    aria-label={t('reply.jump', { name: preview.nickname })}>
    <AppIcon name="reply" /><b>{preview.nickname}</b>
    <span>{preview.kind === 'sticker' ? t('reply.sticker') : preview.content}</span>
  </button>;
}

export function ReplyAction({ onReply, disabled = false }: {
  readonly onReply: () => void; readonly disabled?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <IconButton icon="reply" label={t('reply.action')} className={styles.action}
    disabled={disabled} onClick={onReply} />;
}

export function ReplyComposer({ preview, onCancel, notify, onNotifyChange, disabled = false }: {
  readonly preview: ReplyPreview;
  readonly onCancel: () => void;
  readonly notify?: boolean;
  readonly onNotifyChange?: (notify: boolean) => void;
  readonly disabled?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.composer}>
    <div className={styles.context}>
      <span>{t('reply.to', { name: preview.nickname })}</span>
      <small>{preview.kind === 'sticker' ? t('reply.sticker') : preview.content}</small>
    </div>
    {onNotifyChange && <label className={styles.notify}>
      <AppCheckbox checked={notify} disabled={disabled} onChange={(_event, checked) => onNotifyChange(checked)} />
      <span>{t('reply.notify')}</span>
    </label>}
    <IconButton icon="close" label={t('reply.cancel')} onClick={onCancel} disabled={disabled} />
  </div>;
}
