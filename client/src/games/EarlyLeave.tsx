import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import { AppIcon } from '../components/AppIcon';
import { Button } from '../components/Button';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { useConnectionReady } from './use-connection-ready';
import styles from './AbortVote.module.css';
import motionStyles from '../styles/dialog-motion.module.css';

export function EarlyLeaveButton({ iconOnly = false, className = '', buttonClassName = '' }: {
  readonly iconOnly?: boolean;
  readonly className?: string;
  readonly buttonClassName?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const navigate = useNavigate();
  const game = useGameStore((state) => state.visible);
  const ready = useConnectionReady();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = reducedMotion || systemReducedMotion;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const titleId = useId();
  if (!game || game.observer || game.phase === 'scoring') return null;

  const close = (): void => { if (!inFlight.current) setOpen(false); };
  const confirm = (): void => {
    if (!open || !ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('game:leaveEarly', (timeout, result) => {
      inFlight.current = false;
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!result?.success) setError(result?.error ?? t('common.error'));
      else {
        // Keep room membership so the player can return to the same seat.
        setOpen(false);
        navigate('/');
      }
    });
  };

  return <div className={`${styles.rail} ${className}`}>
    <button type="button" className={iconOnly ? buttonClassName : `btn btn-outline ${styles.railBtn}`}
      disabled={!ready || busy} aria-label={t('earlyLeave.button')} title={t('earlyLeave.button')}
      aria-haspopup="dialog" onClick={() => { setError(''); setOpen(true); }}>
      <AppIcon name="logout" />{!iconOnly && <> {t('earlyLeave.button')}</>}
    </button>
    <Dialog open={open} onClose={close}
      transitionDuration={{ enter: 0, exit: still ? 0 : 200 }}
      aria-labelledby={titleId} aria-describedby={`${titleId}-description`}
      slotProps={{ paper: { className: dialogPaperClass('narrow', open ? motionStyles.enter : motionStyles.exit, still && motionStyles.still) } }}>
      <div className={dialogParts.header}><h2 id={titleId} className={styles.dialogTitle}>{t('earlyLeave.confirmTitle')}</h2></div>
      <div className={dialogParts.body}>
        <p id={`${titleId}-description`}>{t('earlyLeave.confirmDescription')}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <div className={dialogParts.footer}>
        <Button autoFocus disabled={busy} onClick={close}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!ready || busy || !open} onClick={confirm}>
          {t('earlyLeave.confirm')}</Button>
      </div>
    </Dialog>
  </div>;
}
