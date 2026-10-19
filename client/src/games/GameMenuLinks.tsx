// ─── GameMenuLinks: app navigation, music, and notifications inside the phone game menu ───

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '../components/AppIcon';
import { MusicControl } from '../components/MusicControl';
import { NotificationPanel } from '../components/NotificationPanel';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { messageUnreadCount, notificationUnreadCount, useSocialStore } from '../stores/social-store';
import styles from './GameMenuLinks.module.css';

/** Unread items the hidden app bar would otherwise badge; the game menu button shows their sum. */
export function useGameMenuUnread(): number {
  const notifications = useSocialStore(notificationUnreadCount);
  const messages = useSocialStore(messageUnreadCount);
  return notifications + messages;
}

export function GameMenuLinks({ className = '' }: { readonly className?: string }): ReactNode {
  const { t } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const notificationCount = useSocialStore(notificationUnreadCount);
  const messageCount = useSocialStore(messageUnreadCount);
  if (!accountId) return null;
  const badge = (count: number): ReactNode => count > 0
    && <span className={styles.badge}>{count > 99 ? '99+' : count}</span>;
  return <div className={`${styles.menu} ${className}`}>
    <details className={styles.section}>
      <summary><AppIcon name="notifications" />{t('social.notifications')}{badge(notificationCount)}</summary>
      <NotificationPanel />
    </details>
    <details className={styles.section}>
      <summary><AppIcon name="music" />{t('topbar.music')}</summary>
      <MusicControl />
    </details>
    <nav className={styles.links} aria-label={t('topbar.menu')}>
      <Link to="/messages"><AppIcon name="chat" />{t('messages.title')}{badge(messageCount)}</Link>
      <Link to="/achievements"><AppIcon name="trophy" />{t('achievements.title')}</Link>
      <Link to="/"><AppIcon name="home" />{t('nav.lobby')}</Link>
      <Link to="/friends"><AppIcon name="friends" />{t('nav.friends')}</Link>
      <Link to="/shop"><AppIcon name="shop" />{t('nav.shop')}</Link>
      <Link to={`/players/${encodeURIComponent(accountId)}`}><AppIcon name="person" />{t('player.myProfile')}</Link>
    </nav>
  </div>;
}
