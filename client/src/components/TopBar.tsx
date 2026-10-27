// ─── TopBar: global top bar (navigation, game info, music, theme, locale) ───

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AnimationEvent, MouseEvent, ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { NavLink, useLocation } from 'react-router-dom';
import { apiRequest } from '../api';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useRoomStore } from '../stores/room-store';
import { useActiveIndicator } from '../hooks/use-active-indicator';
import { useExitPresence } from '../hooks/use-exit-presence';
import { useFriendsData } from '../hooks/use-friends-data';
import { useJoinSound } from '../hooks/use-join-sound';
import { useTurnSound } from '../hooks/use-turn-sound';
import { LanguageSwitch } from './LanguageSwitch';
import { MusicControl } from './MusicControl';
import { ThemeSwitch } from './ThemeSwitch';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import { CoinBalance } from './CoinBalance';
import { IconButton, IconLink, badgeText } from './IconButton';
import { RoomCodeButton } from './RoomCodeButton';
import { NotificationPanel } from './NotificationPanel';
import { nextReturnLocation, togglePageHref, togglePageOf } from './topbar-toggle-page';
import { messageUnreadCount, notificationUnreadCount, useSocialStore } from '../stores/social-store';
import { closeMessagesWindow } from '../stores/messages-window-store';
import { useShellStore } from '../stores/shell-store';
import styles from './TopBar.module.css';

type Popover = 'notifications' | 'menu' | 'music' | 'signOut';

/** The short landscape layout, where the top bar becomes a slim icon rail. */
const RAIL_QUERY = '(max-height: 500px) and (min-width: 600px)';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TopBar(): ReactNode {
  useTurnSound();
  useJoinSound();
  const { t } = useI18nStore();
  const { pathname, search } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
  const notificationCount = useSocialStore(notificationUnreadCount);
  const messageCount = useSocialStore(messageUnreadCount);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const inActiveGame = useRoomStore((state) => state.roomInfo?.status === 'playing' && state.mySeat !== null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const musicPlaying = useMusicStore((state) => state.playing);
  const [open, setOpen] = useState<Popover | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const here = `${pathname}${search}`;
  const [lastLocation, setLastLocation] = useState(here);
  const [returnTo, setReturnTo] = useState(() => nextReturnLocation('/', pathname, search));
  const { exiting, finishExit } = useExitPresence(open);
  const { containerRef: navRef, indicatorRef: navIndicatorRef } =
    useActiveIndicator<HTMLElement, HTMLSpanElement>('a[aria-current="page"]', pathname);
  const railLayout = useMediaQuery(RAIL_QUERY);
  const { data: friendsData } = useFriendsData(railLayout && Boolean(accountId));
  const onlineFriends = friendsData?.friends.filter((friend) => friend.online).length ?? 0;
  const notificationsRequest = useShellStore((state) => state.notificationsRequest);
  const handledRequest = useRef(notificationsRequest);
  const togglePage = togglePageOf(pathname);
  const inGame = pathname.startsWith('/game/');
  const showLinks = Boolean(accountId);

  if (lastLocation !== here) {
    setLastLocation(here);
    setReturnTo((previous) => nextReturnLocation(previous, pathname, search));
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-popover]')) setOpen(null);
    };
    // The trigger that is on screen gets focus back; the menu stands in when the rail hides the others.
    const triggers = [...document.querySelectorAll<HTMLElement>(
      `[data-popover-trigger="${open}"], [data-popover-trigger="menu"]`)];
    const trigger = triggers.find((element) => element.dataset.popoverTrigger === open && element.getClientRects().length)
      ?? triggers.find((element) => element.getClientRects().length);
    const panel = document.querySelector<HTMLElement>(`[data-popover-panel="${open}"]`);
    if (panel) (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Only the topmost layer closes; the game sheets below ignore a handled Escape.
      event.preventDefault();
      setOpen(null);
      trigger?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (popover: Popover): void => setOpen((current) => current === popover ? null : popover);

  const shown = (popover: Popover): boolean => open === popover || exiting === popover;

  const toggleFromPage = useEffectEvent((): void => {
    if (handledRequest.current === notificationsRequest) return;
    handledRequest.current = notificationsRequest;
    toggle('notifications');
  });
  useEffect(() => { toggleFromPage(); }, [notificationsRequest]);

  // Closed panels stay mounted, inert, until their exit animation ends.
  const panelProps = (popover: Popover, className: string): {
    className: string; inert?: boolean; 'data-popover-panel': Popover;
    onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
  } => ({
    className: `${className} ${exiting === popover ? styles.popoverExit : ''}`,
    'data-popover-panel': popover,
    inert: exiting === popover || undefined,
    onAnimationEnd: (event) => { if (event.target === event.currentTarget) finishExit(popover); },
  });

  const requestSignOut = (): void => {
    setConfirmSignOut(inActiveGame);
    if (inActiveGame) {
      setError('');
      setOpen('signOut');
    } else void signOut();
  };

  const signOut = async (): Promise<void> => {
    // Close the confirmation through its exit animation while the request runs.
    setOpen((current) => current === 'signOut' ? null : current);
    setBusy(true);
    setError('');
    const result = await apiRequest('/api/auth/logout', 'POST');
    if (result.success) {
      setConfirmSignOut(false);
      clearAccount();
    } else {
      setError(result.error);
      setOpen('signOut');
    }
    setBusy(false);
  };

  const links = accountId && <>
    <NavLink to="/" end data-rail-duplicate>{t('nav.lobby')}</NavLink>
    <NavLink to="/friends" data-rail-duplicate>{t('nav.friends')}</NavLink>
    <NavLink to="/shop" data-rail-duplicate>{t('nav.shop')}</NavLink>
    <NavLink to={`/players/${encodeURIComponent(accountId)}`}>{t('player.myProfile')}</NavLink>
    <NavLink to="/account">{t('nav.account')}</NavLink>
  </>;

  const notificationLabel = t('social.notificationCount', { n: String(notificationCount) });
  const messageLabel = messageCount > 0 ? t('messages.unreadCount', { n: String(messageCount) }) : t('messages.title');
  const onMessagesClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    setOpen(null);
    if (togglePage === 'messages') closeMessagesWindow(event, returnTo);
  };

  return (
    <header className={styles.bar}>
      <NavLink to="/" className={styles.brand} tabIndex={railLayout ? -1 : undefined} aria-hidden={railLayout || undefined}>
        <span aria-hidden="true">♠</span><span className={inGame ? styles.brandTextGame : undefined}> Card Together</span>
      </NavLink>
      {showLinks && <nav ref={navRef} className={styles.links}>
        <span ref={navIndicatorRef} className={styles.linkIndicator} aria-hidden="true" />
        {links}
      </nav>}
      {inGame && roomCode && <RoomCodeButton key={roomCode} code={roomCode} compact className={styles.barRoomCode} />}
      <div className={styles.actions}>
        {accountId && <IconLink to="/" icon="home" label={t('nav.lobby')} className={`${styles.railOnly} ${styles.railHome}`}
          current={pathname === '/'} />}
        {accountId && <IconLink to="/friends" icon="friends" className={`${styles.railOnly} ${styles.railFriends}`}
          label={onlineFriends > 0 ? t('nav.friendsOnline', { n: String(onlineFriends) }) : t('nav.friends')}
          badge={onlineFriends > 0 ? 'dot' : undefined} badgeTone="success" current={pathname.startsWith('/friends')} />}
        {accountId && <CoinBalance className={styles.coinBalance} />}
        {accountId && <IconLink to={togglePageHref('achievements', togglePage, returnTo)} icon="trophy"
          className={styles.railAchievements} label={t('achievements.title')} current={togglePage === 'achievements'}
          onClick={() => setOpen(null)} />}
        {accountId && <div className={styles.group} data-popover="notifications">
          <IconButton icon="notifications" label={notificationLabel} title={t('social.notifications')}
            className={styles.hiddenInRail} badge={notificationCount} aria-expanded={open === 'notifications'}
            aria-controls="social-notifications" data-popover-trigger="notifications"
            onClick={() => toggle('notifications')} />
          {shown('notifications') && <div id="social-notifications" {...panelProps('notifications', styles.popover)} tabIndex={-1}>
            <NotificationPanel />
          </div>}
        </div>}
        {accountId && <IconLink to={togglePageHref('messages', togglePage, returnTo)} icon="chat"
          className={styles.railMessages} label={messageLabel} current={togglePage === 'messages'}
          badge={messageCount} onClick={onMessagesClick} />}
        {accountId && <IconLink to="/shop" icon="shop" label={t('nav.shop')} className={`${styles.railOnly} ${styles.railShop}`}
          current={pathname.startsWith('/shop')} />}
        <div className={styles.group} data-popover="music">
          <IconButton icon="music" label={t('topbar.music')} className={`${styles.hiddenInRail} ${musicPlaying ? styles.active : ''}`}
            aria-expanded={open === 'music'} data-popover-trigger="music" onClick={() => toggle('music')} />
          {shown('music') && <div {...panelProps('music', styles.popover)} tabIndex={-1}>
            <MusicControl />
          </div>}
        </div>
        <div className={styles.prefs}>
          <ThemeSwitch />
          <LanguageSwitch />
        </div>
        <div className={`${styles.group} ${styles.menuGroup}`} data-popover="menu">
          <IconButton icon={railLayout ? 'person' : 'menu'} label={t('topbar.menu')} aria-expanded={open === 'menu'}
            data-popover-trigger="menu" onClick={() => toggle('menu')} />
          {shown('menu') && <div {...panelProps('menu', `${styles.popover} ${styles.menu}`)} tabIndex={-1}>
            {inGame && roomCode && <RoomCodeButton key={roomCode} code={roomCode} compact className={styles.menuRoomCode} />}
            {accountId && <div className={styles.menuRailItems}>
              <CoinBalance />
              <button type="button" className={styles.menuRow} onClick={() => toggle('notifications')}>
                <AppIcon name="notifications" />{t('social.notifications')}
                {notificationCount > 0 && <span className={styles.menuCount} aria-label={notificationLabel}>{badgeText(notificationCount)}</span>}
              </button>
              <button type="button" className={`${styles.menuRow} ${musicPlaying ? styles.active : ''}`} onClick={() => toggle('music')}>
                <AppIcon name="music" />{t('topbar.music')}
              </button>
            </div>}
            {showLinks && <nav className={styles.menuLinks}>{links}</nav>}
            <div className={styles.menuPrefs}>
              <ThemeSwitch />
              <LanguageSwitch />
            </div>
            {accountId && <Button variant="danger-text" className={styles.menuSignOut} onClick={requestSignOut} disabled={busy}
              icon="logout">{t('topbar.signOut')}</Button>}
          </div>}
        </div>
        {accountId && <div className={styles.group} data-popover="signOut">
          <Button variant="text" size="small" icon="logout" className={styles.signOutBtn} onClick={requestSignOut} disabled={busy}
            aria-expanded={open === 'signOut' && confirmSignOut && !error} data-popover-trigger="signOut"
            title={t('topbar.signOut')}>{t('topbar.signOut')}</Button>
          {shown('signOut') && error && <p {...panelProps('signOut', `${styles.popover} ${styles.error}`)} role="alert">
            {error}
          </p>}
          {shown('signOut') && !error && confirmSignOut && <div {...panelProps('signOut', `${styles.popover} ${styles.confirm}`)}
            tabIndex={-1} role="alertdialog" aria-labelledby="sign-out-confirm">
            <p id="sign-out-confirm">{t('topbar.signOutConfirm')}</p>
            <div className={styles.confirmActions}>
              <Button onClick={() => setOpen(null)}>{t('topbar.cancel')}</Button>
              <Button variant="primary" onClick={() => void signOut()}>{t('topbar.signOut')}</Button>
            </div>
          </div>}
        </div>}
      </div>
    </header>
  );
}
