import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { badgeText } from './IconButton';
import { RAIL_ITEMS, currentRailItem, railItemPath } from './desktop-nav';
import type { RailItem, RailItemId } from './desktop-nav';
import { closeMessagesWindow } from '../stores/messages-window-store';
import { togglePageHref, togglePageOf } from './topbar-toggle-page';
import styles from './DesktopRail.module.css';

export interface DesktopRailProps {
  readonly pathname: string;
  readonly accountId: string;
  /** Where the messages and achievements pages lead back to. */
  readonly returnTo: string;
  readonly onlineFriends: number;
  readonly messageCount: number;
  /** The viewer's room or game; adds a leading "Table" item that returns to it. */
  readonly tableHref?: string | null;
  /** Coin balance, notifications, music and the account menu under the bottom divider. */
  readonly footer: ReactNode;
  /** Called when a link is used, so open rail panels close. */
  readonly onNavigate: () => void;
}

/** Fixed left navigation: an icon with a 12px label per destination; tablets keep the icons only. */
export function DesktopRail({
  pathname, accountId, returnTo, onlineFriends, messageCount, tableHref = null, footer, onNavigate,
}: DesktopRailProps): ReactNode {
  const { t } = useI18nStore();
  const current = currentRailItem(pathname, accountId);
  const togglePage = togglePageOf(pathname);

  const hrefOf = (id: RailItemId): string => id === 'messages' || id === 'achievements'
    ? togglePageHref(id, togglePage, returnTo) : railItemPath(id, accountId);

  const labelOf = (item: RailItem): string => {
    const name = t(item.label);
    if (item.id === 'messages') return messageCount > 0 ? t('messages.unreadCount', { n: String(messageCount) }) : t('messages.title');
    if (item.id === 'friends' && onlineFriends > 0) return t('nav.friendsOnline', { n: String(onlineFriends) });
    return name;
  };

  const onClick = (item: RailItem) => (event: MouseEvent<HTMLAnchorElement>): void => {
    onNavigate();
    if (item.id === 'messages' && togglePage === 'messages') closeMessagesWindow(event, returnTo);
  };

  const badge = (id: RailItemId): ReactNode => {
    if (id === 'friends' && onlineFriends > 0) return <span className={`${styles.dot} ${styles.online}`} aria-hidden="true" />;
    const text = id === 'messages' ? badgeText(messageCount) : null;
    return text && <span className={styles.count} aria-hidden="true">{text}</span>;
  };

  return <nav className={styles.rail} aria-label={t('rail.label')} data-desktop-shell>
    <Link to="/" className={styles.brand} aria-label="Card Together" onClick={onNavigate}><span aria-hidden="true">♠</span></Link>
    {tableHref && <Link to={tableHref} title={t('rail.table')} className={`${styles.item} ${styles.table}`}
      aria-label={t('rail.table')} aria-current={current === 'table' ? 'page' : undefined} onClick={onNavigate}>
      <span className={styles.glyph}><AppIcon name="table" /></span>
      <span className={styles.label} aria-hidden="true">{t('rail.table')}</span>
    </Link>}
    {RAIL_ITEMS.map((item) => <Link key={item.id} to={hrefOf(item.id)} title={t(item.label)}
      className={styles.item} aria-label={labelOf(item)}
      aria-current={current === item.id ? 'page' : undefined} onClick={onClick(item)}>
      <span className={styles.glyph}><AppIcon name={item.icon} />{badge(item.id)}</span>
      <span className={styles.label} aria-hidden="true">{t(item.label)}</span>
    </Link>)}
    <div className={styles.footer}>{footer}</div>
  </nav>;
}
