// ─── TopBar: global top bar (navigation, game info, music, theme, locale) ───

import { useEffect, useState } from 'react';
import type { AnimationEvent, ReactNode } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { GAME_COIN_REWARD } from '@shared/constants';
import { apiRequest } from '../api';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useRoomStore } from '../stores/room-store';
import { useActiveIndicator } from '../hooks/use-active-indicator';
import { useExitPresence } from '../hooks/use-exit-presence';
import { useJoinSound } from '../hooks/use-join-sound';
import { useTurnSound } from '../hooks/use-turn-sound';
import { LanguageSwitch } from './LanguageSwitch';
import { MusicControl } from './MusicControl';
import { ThemeSwitch } from './ThemeSwitch';
import { AppIcon } from './AppIcon';
import { RoomCodeButton } from './RoomCodeButton';
import { NotificationPanel } from './NotificationPanel';
import { nextReturnLocation, togglePageHref, togglePageOf } from './topbar-toggle-page';
import { messageUnreadCount, notificationUnreadCount, useSocialStore } from '../stores/social-store';
import { closeMessagesWindow } from '../stores/messages-window-store';
import styles from './TopBar.module.css';

type Popover = 'notifications' | 'menu' | 'music' | 'signOut';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TopBar(): ReactNode {
  useTurnSound();
  useJoinSound();
  const { t } = useI18nStore();
  const { pathname, search } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
  const notificationCount = useSocialStore(notificationUnreadCount);
  const messageCount = useSocialStore(messageUnreadCount);
  const coins = useAccountStore((state) => state.account?.coins ?? 0);
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
    const group = document.querySelector(`[data-popover="${open}"]`);
    const groupTrigger = group?.querySelector<HTMLElement>('button');
    const trigger = open === 'signOut' && !groupTrigger?.getClientRects().length
      ? document.querySelector<HTMLElement>('[data-popover="menu"] > button') : groupTrigger;
    const panel = group?.querySelector<HTMLElement>('[data-popover-panel]');
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

  // Closed panels stay mounted, inert, until their exit animation ends.
  const panelProps = (popover: Popover, className: string): {
    className: string; inert?: boolean; onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
  } => ({
    className: `${className} ${exiting === popover ? styles.popoverExit : ''}`,
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
    <NavLink to="/" end>{t('nav.lobby')}</NavLink>
    <NavLink to="/friends">{t('nav.friends')}</NavLink>
    <NavLink to="/shop">{t('nav.shop')}</NavLink>
    <NavLink to={`/players/${encodeURIComponent(accountId)}`}>{t('player.myProfile')}</NavLink>
    <NavLink to="/account">{t('nav.account')}</NavLink>
  </>;

  return (
    <header className={styles.bar}>
      <NavLink to="/" className={styles.brand}>
        <span aria-hidden="true">♠</span><span className={inGame ? styles.brandTextGame : undefined}> Card Together</span>
      </NavLink>
      {showLinks && <nav ref={navRef} className={styles.links}>
        <span ref={navIndicatorRef} className={styles.linkIndicator} aria-hidden="true" />
        {links}
      </nav>}
      {inGame && roomCode && <RoomCodeButton key={roomCode} code={roomCode} compact />}
      <div className={styles.actions}>
        {accountId && <Tooltip title={t('shop.earn', { n: String(GAME_COIN_REWARD) })} describeChild arrow>
          <span className={styles.coinBalance} role="status" tabIndex={0}
            aria-label={t('coins.balance', { n: String(coins) })}>
            <AppIcon name="coins" /><span>{coins.toLocaleString()}</span>
          </span>
        </Tooltip>}
        {accountId && <Link to={togglePageHref('achievements', togglePage, returnTo)}
          className={`${styles.iconBtn} touch-target ${togglePage === 'achievements' ? styles.iconCurrent : ''}`}
          aria-current={togglePage === 'achievements' ? 'page' : undefined}
          aria-label={t('achievements.title')} title={t('achievements.title')} onClick={() => setOpen(null)}>
          <AppIcon name="trophy" />
        </Link>}
        {accountId && <div className={styles.group} data-popover="notifications">
          <button type="button" className={`${styles.iconBtn} touch-target`} onClick={() => toggle('notifications')}
            aria-expanded={open === 'notifications'} aria-controls="social-notifications"
            aria-label={t('social.notificationCount', { n: String(notificationCount) })} title={t('social.notifications')}>
            <AppIcon name="notifications" />
            {notificationCount > 0 && <span className={styles.badge} aria-hidden="true">{notificationCount > 99 ? '99+' : notificationCount}</span>}
          </button>
          {shown('notifications') && <div id="social-notifications" {...panelProps('notifications', styles.popover)}
            data-popover-panel tabIndex={-1}>
            <NotificationPanel />
          </div>}
        </div>}
        {accountId && <Link to={togglePageHref('messages', togglePage, returnTo)}
          className={`${styles.iconBtn} touch-target ${togglePage === 'messages' ? styles.iconCurrent : ''}`}
          aria-current={togglePage === 'messages' ? 'page' : undefined}
          aria-label={messageCount > 0 ? t('messages.unreadCount', { n: String(messageCount) }) : t('messages.title')}
          title={t('messages.title')} onClick={(event) => {
            setOpen(null);
            if (togglePage === 'messages') closeMessagesWindow(event, returnTo);
          }}>
          <AppIcon name="chat" />
          {messageCount > 0 && <span className={styles.badge} aria-hidden="true">{messageCount > 99 ? '99+' : messageCount}</span>}
        </Link>}
        <div className={styles.group} data-popover="music">
          <button type="button" className={`${styles.iconBtn} touch-target ${musicPlaying ? styles.iconActive : ''}`}
            onClick={() => toggle('music')} aria-expanded={open === 'music'}
            aria-label={t('topbar.music')} title={t('topbar.music')}>
            <AppIcon name="music" />
          </button>
          {shown('music') && <div {...panelProps('music', styles.popover)} data-popover-panel tabIndex={-1}>
            <MusicControl />
          </div>}
        </div>
        <div className={styles.prefs}>
          <ThemeSwitch />
          <LanguageSwitch />
        </div>
        <div className={`${styles.group} ${styles.menuGroup}`} data-popover="menu">
          <button type="button" className={`${styles.iconBtn} touch-target`} onClick={() => toggle('menu')}
            aria-expanded={open === 'menu'} aria-label={t('topbar.menu')} title={t('topbar.menu')}>
            <AppIcon name="menu" />
          </button>
          {shown('menu') && <div {...panelProps('menu', `${styles.popover} ${styles.menu}`)} data-popover-panel tabIndex={-1}>
            {showLinks && <nav className={styles.menuLinks}>{links}</nav>}
            <ThemeSwitch />
            <LanguageSwitch />
            {accountId && <button type="button" className={styles.menuSignOut} onClick={requestSignOut} disabled={busy}>
              <AppIcon name="logout" /> {t('topbar.signOut')}
            </button>}
          </div>}
        </div>
        {accountId && <div className={styles.group} data-popover="signOut">
          <button type="button" className={`${styles.iconBtn} ${styles.signOutBtn} touch-target`} onClick={requestSignOut} disabled={busy}
            aria-expanded={open === 'signOut' && confirmSignOut && !error}
            aria-label={t('topbar.signOut')} title={t('topbar.signOut')}>
            <AppIcon name="logout" />
            <span className={styles.signOutLabel}>{t('topbar.signOut')}</span>
          </button>
          {shown('signOut') && error && <p {...panelProps('signOut', `${styles.popover} ${styles.error}`)} role="alert">
            {error}
          </p>}
          {shown('signOut') && !error && confirmSignOut && <div {...panelProps('signOut', `${styles.popover} ${styles.confirm}`)}
            data-popover-panel tabIndex={-1} role="alertdialog" aria-labelledby="sign-out-confirm">
            <p id="sign-out-confirm">{t('topbar.signOutConfirm')}</p>
            <div className={styles.confirmActions}>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(null)}>{t('topbar.cancel')}</button>
              <button type="button" className="btn btn-danger" onClick={() => void signOut()}>{t('topbar.signOut')}</button>
            </div>
          </div>}
        </div>}
      </div>
    </header>
  );
}
