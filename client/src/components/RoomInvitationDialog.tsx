import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { APP_BASE_PATH } from '../deployment';
import { copyRoomInvitation, roomInvitationUrl, shareRoomInvitation } from '../room-invitation';
import type { InvitationShareResult } from '../room-invitation';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './RoomInvitationDialog.module.css';

export function RoomInvitationDialog({ code, onClose }: {
  readonly code: string; readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InvitationShareResult | null>(null);
  const url = roomInvitationUrl(window.location.origin, APP_BASE_PATH, code);
  if (!url) return null;

  const send = async (share: boolean): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult(null);
    try {
      const outcome = await (share
        ? shareRoomInvitation(url, t('room.invitation.shareTitle', { code }), navigator)
        : copyRoomInvitation(url, navigator));
      setResult(outcome);
      if (outcome === 'manual') {
        input.current?.focus();
        input.current?.select();
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <Dialog open onClose={onClose} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    slotProps={{ paper: { className: dialogPaperClass('narrow') } }}>
    <DialogTitle component="div" id={`${id}-header`} className={dialogParts.header}>
      <h2 id={`${id}-title`} className={styles.title}>{t('room.invitation.open')}</h2>
      <IconButton icon="close" label={t('table.close')} onClick={onClose} />
    </DialogTitle>
    <DialogContent className={`${dialogParts.body} ${styles.content}`}>
      <p id={`${id}-description`}>{t('room.invitation.description')}</p>
      <label htmlFor={`${id}-url`}>{t('room.invitation.url')}</label>
      <input ref={input} id={`${id}-url`} type="text" readOnly value={url} dir="ltr"
        onFocus={(event) => event.currentTarget.select()} onClick={(event) => event.currentTarget.select()}
        aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className={styles.hint}>{t('room.invitation.manualHint')}</p>
      <p className={styles.status} role="status" aria-atomic="true">
        {result && result !== 'cancelled' ? t(`room.invitation.${result}`) : ''}
      </p>
    </DialogContent>
    <div className={dialogParts.footer}>
      {typeof navigator.share === 'function' && <Button icon="share" disabled={busy} onClick={() => void send(true)}>
        {t('room.invitation.share')}
      </Button>}
      <Button icon="copy" variant="primary" disabled={busy} onClick={() => void send(false)}>
        {t('room.invitation.copy')}
      </Button>
    </div>
  </Dialog>;
}
