// ─── DesktopShell: the left rail and slim top bar used on desktop and tablet widths; tables keep only the rail ───

import type { AnimationEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { lobbyCategories } from '../games/registry';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useShellStore } from '../stores/shell-store';
import { notificationUnreadCount, messageUnreadCount, useSocialStore } from '../stores/social-store';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { CoinBalance } from './CoinBalance';
import { DesktopRail } from './DesktopRail';
import { IconButton } from './IconButton';
import { LanguageSwitch } from './LanguageSwitch';
import { MusicControl } from './MusicControl';
import { NotificationPanel } from './NotificationPanel';
import { Tabs } from './Tabs';
import { ThemeSwitch } from './ThemeSwitch';
import { LOBBY_PANEL_ID, LOBBY_TAB_PREFIX, activeLobbyCategory } from './desktop-nav';
import popoverStyles from './TopBar.module.css';
import styles from './DesktopShell.module.css';

const PANEL = `${popoverStyles.popover} ${styles.panel}`;

export type ShellPopover = 'notifications' | 'menu' | 'music' | 'signOut';

export interface ShellPanelProps {
  readonly className: string;
  readonly inert?: boolean;
  readonly 'data-popover-panel': ShellPopover;
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

/** Popover plumbing owned by the top bar: one open panel at a time, with exit animations. */
export interface ShellPopovers {
  readonly open: ShellPopover | null;
  readonly toggle: (popover: ShellPopover) => void;
  readonly close: () => void;
  readonly shown: (popover: ShellPopover) => boolean;
  readonly panelProps: (popover: ShellPopover, className: string) => ShellPanelProps;
}

export interface ShellSignOut {
  readonly request: () => void;
  readonly run: () => void;
  readonly busy: boolean;
  readonly error: string;
  /** Ask before signing out of a running game. */
  readonly confirm: boolean;
}

export interface DesktopShellProps {
  readonly pathname: string;
  readonly accountId: string;
  readonly returnTo: string;
  readonly onlineFriends: number;
  readonly popovers: ShellPopovers;
  readonly signOut: ShellSignOut;
  /** Table pages drop the top bar; notifications, music and the account menu move to the rail's bottom. */
  readonly tableRoute?: boolean;
  /** Link back to the viewer's room or game while they are in one */
  readonly tableHref?: string | null;
}

export function DesktopShell({
  pathname, accountId, returnTo, onlineFriends, popovers, signOut, tableRoute = false, tableHref = null,
}: DesktopShellProps): ReactNode {
  const { t } = useI18nStore();
  const account = useAccountStore((state) => state.account);
  const notificationCount = useSocialStore(notificationUnreadCount);
  const messageCount = useSocialStore(messageUnreadCount);
  const musicPlaying = useMusicStore((state) => state.playing);
  const storedCategory = useShellStore((state) => state.lobbyCategory);
  const setCategory = useShellStore((state) => state.setLobbyCategory);
  const setHeaderSlot = useShellStore((state) => state.setHeaderSlot);
  const { open, toggle, shown, panelProps, close } = popovers;
  const categories = lobbyCategories();
  const notificationLabel = t('social.notificationCount', { n: String(notificationCount) });
  // Rail panels open beside the rail's bottom instead of under the top bar.
  const panel = tableRoute ? `${PANEL} ${styles.railPanel}` : PANEL;

  const notifications = <div className={popoverStyles.group} data-popover="notifications">
    <IconButton icon="notifications" label={notificationLabel} title={t('social.notifications')}
      badge={notificationCount} aria-expanded={open === 'notifications'} aria-controls="social-notifications"
      data-popover-trigger="notifications" onClick={() => toggle('notifications')} />
    {shown('notifications') && <div id="social-notifications"
      {...panelProps('notifications', panel)} tabIndex={-1}>
      <NotificationPanel />
    </div>}
  </div>;
  const music = <div className={popoverStyles.group} data-popover="music">
    <IconButton icon="music" label={t('topbar.music')} className={musicPlaying ? styles.playing : undefined}
      aria-expanded={open === 'music'} data-popover-trigger="music" onClick={() => toggle('music')} />
    {shown('music') && <div {...panelProps('music', panel)} tabIndex={-1}>
      <MusicControl />
    </div>}
  </div>;
  const avatar = account && <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder}
    color={account.color} size="small" />;
  const menu = <div className={popoverStyles.group} data-popover="menu">
    <button type="button" className={styles.avatarButton} aria-label={t('topbar.accountMenu')}
      title={account?.nickname} aria-haspopup="menu" aria-expanded={open === 'menu'}
      data-popover-trigger="menu" onClick={() => toggle('menu')}>
      {avatar}
    </button>
    {shown('menu') && <div {...panelProps('menu', `${panel} ${styles.menu}`)} tabIndex={-1}>
      {/* Without the top bar, the coin balance leads the menu under the name. */}
      {account && (tableRoute ? <div className={styles.menuIdentity}>
        {avatar}
        <div className={styles.menuIdentityText}>
          <p className={styles.menuName}>{account.nickname}</p>
          <CoinBalance />
        </div>
      </div> : <p className={styles.menuName}>{account.nickname}</p>)}
      <nav className={styles.menuLinks}>
        <Link to={`/players/${encodeURIComponent(accountId)}`}>{t('player.myProfile')}</Link>
        <Link to="/account">{t('nav.account')}</Link>
      </nav>
      <div className={styles.menuPrefs}>
        <ThemeSwitch />
        <LanguageSwitch />
      </div>
      <Button variant="danger-text" className={styles.menuSignOut} onClick={signOut.request} disabled={signOut.busy}
        icon="logout">{t('topbar.signOut')}</Button>
    </div>}
  </div>;
  const signOutConfirm = <div className={popoverStyles.group} data-popover="signOut">
    {shown('signOut') && signOut.error && <p {...panelProps('signOut', `${panel} ${popoverStyles.error}`)}
      role="alert">{signOut.error}</p>}
    {shown('signOut') && !signOut.error && signOut.confirm && <div
      {...panelProps('signOut', `${panel} ${popoverStyles.confirm}`)}
      tabIndex={-1} role="alertdialog" aria-labelledby="sign-out-confirm">
      <p id="sign-out-confirm">{t('topbar.signOutConfirm')}</p>
      <div className={popoverStyles.confirmActions}>
        <Button onClick={close}>{t('topbar.cancel')}</Button>
        <Button variant="primary" onClick={signOut.run}>{t('topbar.signOut')}</Button>
      </div>
    </div>}
  </div>;

  const rail = <DesktopRail pathname={pathname} accountId={accountId} returnTo={returnTo} onlineFriends={onlineFriends}
    messageCount={messageCount} tableHref={tableHref} onNavigate={close}
    footer={tableRoute ? <>{notifications}{music}{menu}{signOutConfirm}</> : undefined} />;
  if (tableRoute) return rail;

  return <>
    {rail}
    <header className={styles.bar} data-desktop-shell>
      <div className={styles.lead}>
        {pathname === '/' && <Tabs className={styles.tabs} label={t('lobby.categories')} idPrefix={LOBBY_TAB_PREFIX}
          controls={LOBBY_PANEL_ID} value={activeLobbyCategory(storedCategory)} onChange={setCategory}
          tabs={categories.map((id) => ({ id, label: t(`lobby.category.${id}`) }))} />}
        {/* Pages place their title, tabs and summary here through `PageHeader`. */}
        <div className={styles.slot} ref={setHeaderSlot} />
      </div>
      <div className={styles.actions}>
        {notifications}
        {music}
        <CoinBalance className={styles.coins} />
        {menu}
        {signOutConfirm}
      </div>
    </header>
  </>;
}
