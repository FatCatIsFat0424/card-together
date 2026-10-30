import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './AccountMenuLinks.module.css';

export function AccountMenuLinks({ accountId }: { readonly accountId: string }): ReactNode {
  const { t } = useI18nStore();
  return <>
    <NavLink className={styles.entry} to={`/players/${encodeURIComponent(accountId)}`}>
      <AppIcon name="person" />
      <span className={styles.copy}><strong>{t('player.myProfile')}</strong><small>{t('accountMenu.profileHint')}</small></span>
      <AppIcon name="nextPage" className={styles.chevron} />
    </NavLink>
    <NavLink className={styles.entry} to="/account">
      <AppIcon name="settings" />
      <span className={styles.copy}><strong>{t('nav.account')}</strong><small>{t('accountMenu.settingsHint')}</small></span>
      <AppIcon name="nextPage" className={styles.chevron} />
    </NavLink>
  </>;
}
