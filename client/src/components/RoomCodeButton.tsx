import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './RoomCodeButton.module.css';

export function RoomCodeButton({ code, compact = false, className = '' }: {
  readonly code: string; readonly compact?: boolean; readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return <button type="button" className={`${styles.button} ${compact ? styles.compact : styles.panel} ${className}`} onClick={() => void copy()}
    aria-label={`${t('room.copyCode', { code })} ${code}`} title={t(copied ? 'room.copied' : 'room.copyCode', { code })}>
    {compact ? <><AppIcon name={copied ? 'check' : 'copy'} />{code}</> : <>
      <span className={styles.label}>{t('room.code')}</span>
      <span className={styles.code}>{code}</span><AppIcon name={copied ? 'check' : 'copy'} />
    </>}
  </button>;
}
