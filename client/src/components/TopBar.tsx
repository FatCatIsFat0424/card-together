// ─── TopBar: global top bar (navigation, game info, voice, music, theme, locale) ───

import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { NavLink, useLocation } from 'react-router-dom';
import { GAME_COIN_REWARD } from '@shared/constants';
import { apiRequest } from '../api';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useRoomStore } from '../stores/room-store';
import { useVoiceStore } from '../stores/voice-store';
import { useTurnSound } from '../hooks/use-turn-sound';
import { LanguageSwitch } from './LanguageSwitch';
import { MusicControl } from './MusicControl';
import { ThemeSwitch } from './ThemeSwitch';
import { AppIcon } from './AppIcon';
import { NotificationPanel } from './NotificationPanel';
import { socialUnreadCount, useSocialStore } from '../stores/social-store';
import styles from './TopBar.module.css';

const VoicePanel = lazy(() => import('./VoicePanel')
  .then((module) => ({ default: module.VoicePanel })));

type Popover = 'notifications' | 'menu' | 'voice' | 'music' | 'signOut';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function RoomCodeButton(): ReactNode {
  const code = useRoomStore((state) => state.currentRoomCode);
  const { t } = useI18nStore();
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };
  return <button type="button" className={styles.roomCodeButton} onClick={() => void copy()}
    aria-label={t('room.copyCode', { code })} title={t(copied ? 'room.copied' : 'room.copyCode', { code })}>
    <AppIcon name={copied ? 'check' : 'copy'} />{code}
  </button>;
}

export function TopBar(): ReactNode {
  useTurnSound();
  const { t } = useI18nStore();
  const { pathname, search } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
  const notificationCount = useSocialStore(socialUnreadCount);
  const coins = useAccountStore((state) => state.account?.coins ?? 0);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const inActiveGame = useRoomStore((state) => state.roomInfo?.status === 'playing' && state.mySeat !== null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const voiceStatus = useVoiceStore((state) => state.status);
  const musicPlaying = useMusicStore((state) => state.playing);
  const [open, setOpen] = useState<Popover | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inGame = pathname.startsWith('/game/');
  const showLinks = Boolean(accountId);
  const showVoice = Boolean(accountId && roomCode);

  useEffect(() => { setOpen(null); }, [pathname, search]);

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

  const requestSignOut = (): void => {
    if (inActiveGame) {
      setError('');
      setConfirmSignOut(true);
      setOpen('signOut');
    } else void signOut();
  };

  const signOut = async (): Promise<void> => {
    setConfirmSignOut(false);
    setBusy(true);
    setError('');
    const result = await apiRequest('/api/auth/logout', 'POST');
    if (result.success) clearAccount();
    else { setError(result.error); setOpen('signOut'); }
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
      {showLinks && <nav className={styles.links}>{links}</nav>}
      {inGame && <RoomCodeButton />}
      <div className={styles.actions}>
        {accountId && <Tooltip title={t('shop.earn', { n: String(GAME_COIN_REWARD) })} describeChild arrow>
          <span className={styles.coinBalance} role="status" tabIndex={0}
            aria-label={t('coins.balance', { n: String(coins) })}>
            <AppIcon name="coins" /><span>{coins.toLocaleString()}</span>
          </span>
        </Tooltip>}
        {accountId && <div className={styles.group} data-popover="notifications">
          <button type="button" className={`${styles.iconBtn} touch-target`} onClick={() => toggle('notifications')}
            aria-expanded={open === 'notifications'} aria-controls="social-notifications"
            aria-label={t('social.notificationCount', { n: String(notificationCount) })} title={t('social.notifications')}>
            <AppIcon name="notifications" />
            {notificationCount > 0 && <span className={styles.badge} aria-hidden="true">{notificationCount > 99 ? '99+' : notificationCount}</span>}
          </button>
          {open === 'notifications' && <div id="social-notifications" className={styles.popover} data-popover-panel tabIndex={-1}>
            <NotificationPanel />
          </div>}
        </div>}
        {showVoice && <div className={styles.group} data-popover="voice">
          <button type="button" className={`${styles.iconBtn} touch-target`} onClick={() => toggle('voice')}
            aria-expanded={open === 'voice'} aria-label={t('topbar.voice')} title={t('topbar.voice')}>
            <AppIcon name="microphone" />
            {(voiceStatus === 'joined' || voiceStatus === 'joining') &&
              <span className={voiceStatus === 'joined' ? styles.dotJoined : styles.dotJoining} />}
          </button>
          <div className={`${styles.popover} ${open === 'voice' ? '' : styles.hidden}`} data-popover-panel tabIndex={-1}>
            <Suspense fallback={null}><VoicePanel /></Suspense>
          </div>
        </div>}
        <div className={styles.group} data-popover="music">
          <button type="button" className={`${styles.iconBtn} touch-target ${musicPlaying ? styles.iconActive : ''}`}
            onClick={() => toggle('music')} aria-expanded={open === 'music'}
            aria-label={t('topbar.music')} title={t('topbar.music')}>
            <AppIcon name="music" />
          </button>
          {open === 'music' && <div className={styles.popover} data-popover-panel tabIndex={-1}><MusicControl /></div>}
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
          {open === 'menu' && <div className={`${styles.popover} ${styles.menu}`} data-popover-panel tabIndex={-1}>
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
            aria-expanded={open === 'signOut' && confirmSignOut}
            aria-label={t('topbar.signOut')} title={t('topbar.signOut')}>
            <AppIcon name="logout" />
            <span className={styles.signOutLabel}>{t('topbar.signOut')}</span>
          </button>
          {open === 'signOut' && error && <p className={`${styles.popover} ${styles.error}`} role="alert">{error}</p>}
          {open === 'signOut' && !error && confirmSignOut && <div className={`${styles.popover} ${styles.confirm}`}
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
