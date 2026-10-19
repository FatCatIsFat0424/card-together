// ─── RotateHint: suggests landscape on portrait phones, where browsers cannot lock the orientation ───

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { AppIcon } from '../components/AppIcon';
import { useI18nStore } from '../stores/i18n-store';
import { readPreference, writePreference } from '../utils/preference-storage';
import styles from './RotateHint.module.css';

const DISMISSED_PREFERENCE = 'rotateHintDismissed';
/** The tip covers part of a crowded portrait table, so it steps aside on its own. */
const VISIBLE_MS = 8000;

export function RotateHint(): ReactNode {
  const { t } = useI18nStore();
  const portraitPhone = useMediaQuery('(max-width: 767px) and (orientation: portrait) and (pointer: coarse)');
  const [dismissed, setDismissed] = useState(() => readPreference(DISMISSED_PREFERENCE) === 'true');
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!portraitPhone || dismissed) return undefined;
    const timer = window.setTimeout(() => setExpired(true), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [portraitPhone, dismissed]);
  if (!portraitPhone || dismissed || expired) return null;
  const dismiss = (): void => {
    writePreference(DISMISSED_PREFERENCE, 'true');
    setDismissed(true);
  };
  return <p className={styles.hint} role="status">
    <span>{t('table.rotateHint')}</span>
    <button type="button" className={styles.dismiss} onClick={dismiss} aria-label={t('table.rotateDismiss')}
      title={t('table.rotateDismiss')}><AppIcon name="close" /></button>
  </p>;
}
