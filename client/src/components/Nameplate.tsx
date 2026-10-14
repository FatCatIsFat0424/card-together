import type { ReactNode } from 'react';
import type { NameplateId } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import styles from './Nameplate.module.css';

interface NameplateProps {
  readonly id: NameplateId | null | undefined;
}

/** Cosmetic titles never imply a verified rank or earned achievement. */
export function Nameplate({ id }: NameplateProps): ReactNode {
  const { t } = useI18nStore();
  if (!id) return null;
  return <span data-nameplate={id} className={`${styles.title} ${styles[id]}`}>
    <span className={styles.mark} aria-hidden="true">{id === 'nameplate-aurora' ? '✧' : id === 'nameplate-tide' ? '≈' : '❀'}</span>
    {t(`shop.title.${id}`)}
  </span>;
}
