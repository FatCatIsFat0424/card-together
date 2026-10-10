// ─── TopBar: global top bar (navigation, game info, voice, music, theme, locale) ───

import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SUIT_SYMBOLS } from '@shared/constants';
import { rpScore } from '@shared/rules/redpoints';
import { NN_MAX } from '@shared/rules/ninetynine';
import { BJ_HANDS } from '@shared/rules/blackjack';
import { HE_HANDS } from '@shared/rules/holdem';
import type { BidLevel, BidSuit, Seat } from '@shared/types';
import { apiRequest } from '../api';
import { clearAccount, useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMusicStore } from '../stores/music-store';
import { useRoomStore } from '../stores/room-store';
import { useVoiceStore } from '../stores/voice-store';
import { useTurnSound } from '../hooks/use-turn-sound';
import { LanguageSwitch } from './LanguageSwitch';
import { MusicControl } from './MusicControl';
import { ThemeSwitch } from './ThemeSwitch';
import { joinNames } from '../games/seat-names';
import { useGamePresentation } from '../games/use-game-presentation';
import { blackjackHandNumber, blackjackView } from '../games/blackjack/blackjack-view';
import { holdemView } from '../games/holdem/holdem-view';
import { AppIcon } from './AppIcon';
import styles from './TopBar.module.css';

const VoicePanel = lazy(() => import('./VoicePanel')
  .then((module) => ({ default: module.VoicePanel })));

type Popover = 'menu' | 'voice' | 'music' | 'signOut';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function BidLabel({ level, suit }: { level: BidLevel; suit: BidSuit }): ReactNode {
  if (suit === 'nt') return <>{level}NT</>;
  const red = suit === 'hearts' || suit === 'diamonds';
  return <>{level}<span className={red ? styles.suitRed : undefined}>{SUIT_SYMBOLS[suit]}</span></>;
}

function GameChips(): ReactNode {
  const { locale, t } = useI18nStore();
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const bidding = useGameStore((state) => state.bidding);
  const contract = useGameStore((state) => state.contract);
  const playing = useGameStore((state) => state.playing);
  const gameType = useGameStore((state) => state.gameType);
  const bigTwoResult = useGameStore((state) => state.bigTwo?.result ?? null);
  const mySeat = useRoomStore((state) => state.mySeat);
  const redPointsResult = useGameStore((state) => state.redPoints?.result ?? null);
  const myRedPoints = useGameStore((state) =>
    state.redPoints && mySeat ? rpScore(state.redPoints.captured[mySeat]) : null);
  const ninetyNineTotal = useGameStore((state) => state.ninetyNine?.total ?? null);
  const ninetyNineWinner = useGameStore((state) => state.ninetyNine?.result?.winnerSeat ?? null);
  // Results stay hidden until the final presentation has shown them on the table.
  const { locked, frame } = useGamePresentation();
  const sevensResult = useGameStore((state) => state.sevens?.result ?? null);
  const chinesePokerResult = useGameStore((state) => state.chinesePoker?.result ?? null);
  const liarsDeckWinner = useGameStore((state) => state.liarsDeck?.result?.winnerSeat ?? null);
  const liarsDeckFace = useGameStore((state) => state.liarsDeck?.phase === 'playing' ? state.liarsDeck.tableFace : null);
  const blackjack = useGameStore((state) => state.blackjack);
  const blackjackHand = blackjack && blackjack.phase !== 'scoring' ? blackjackHandNumber(blackjackView(blackjack, frame)) : 0;
  const blackjackResult = blackjack?.result ?? null;
  const holdem = useGameStore((state) => state.holdem);
  // The hand and blinds follow the presentation so the next hand's blinds appear with its deal.
  const holdemShown = holdem && holdem.phase !== 'scoring' ? holdemView(holdem, frame) : null;
  const holdemResult = holdem?.result ?? null;
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const seatLabel = (seat: Seat): string => t(`seat.${seat}`);
  return <div className={styles.chips}>
    {roomCode && <span className={`${styles.chip} ${styles.roomChip}`} title={t('topbar.room')}>{roomCode}</span>}
    {gameType && gameType !== 'bridge' ? <>
      <span className={styles.chip}>{t(`gameType.${gameType}`)}</span>
      {bigTwoResult && <span className={styles.chip}>
        <AppIcon name="trophy" /> {seats?.[bigTwoResult.winnerSeat].player?.nickname ?? seatLabel(bigTwoResult.winnerSeat)}
        {mySeat && <> · {t('bigtwo.myPenalty', { n: String(bigTwoResult.scores[mySeat]) })}</>}
      </span>}
      {redPointsResult && <span className={styles.chip}>
        <AppIcon name="trophy" /> {joinNames(redPointsResult.winners.map((seat) => seats?.[seat].player?.nickname ?? seatLabel(seat)), locale)}
      </span>}
      {myRedPoints !== null && <span className={styles.chip}>
        {t('redpoints.myPoints', { n: String(myRedPoints) })}
      </span>}
      {ninetyNineTotal !== null && <span className={styles.chip} title={t('ninetynine.total')}>
        {ninetyNineTotal} / {NN_MAX}
      </span>}
      {sevensResult && !locked && <span className={styles.chip}>
        <AppIcon name="trophy" /> {joinNames(sevensResult.winners.map((seat) => seats?.[seat].player?.nickname ?? seatLabel(seat)), locale)}
        {mySeat && <> · {t('sevens.myPenalty', { n: String(sevensResult.penalties[mySeat]) })}</>}
      </span>}
      {chinesePokerResult && !locked && <span className={styles.chip}>
        <AppIcon name="trophy" /> {joinNames(chinesePokerResult.winners.map((seat) => seats?.[seat].player?.nickname ?? seatLabel(seat)), locale)}
        {mySeat && <> · {t('chinesepoker.myScore', {
          n: `${chinesePokerResult.scores[mySeat] > 0 ? '+' : ''}${chinesePokerResult.scores[mySeat]}` })}</>}
      </span>}
      {liarsDeckFace && !locked && <span className={styles.chip} title={t('liarsdeck.tableCard')}>
        {t('liarsdeck.tableCard')} {t(`liarsdeck.face.${liarsDeckFace}`)}
      </span>}
      {liarsDeckWinner && !locked && <span className={styles.chip}>
        <AppIcon name="trophy" /> {seats?.[liarsDeckWinner].player?.nickname ?? seatLabel(liarsDeckWinner)}
      </span>}
      {blackjackHand > 0 && <span className={styles.chip}>
        {t('blackjack.handOf', { n: String(blackjackHand), total: String(BJ_HANDS) })}
      </span>}
      {blackjackResult && !locked && <span className={styles.chip}>
        <AppIcon name="trophy" /> {joinNames(blackjackResult.winners.map((seat) => seats?.[seat].player?.nickname ?? seatLabel(seat)), locale)}
        {mySeat && <> · {t('blackjack.myChips', { n: String(blackjackResult.chips[mySeat]) })}</>}
      </span>}
      {holdemShown && holdemShown.hand > 0 && <span className={styles.chip}>
        {t('holdem.handOf', { n: String(holdemShown.hand), total: String(HE_HANDS) })} ·
        {' '}{t('holdem.blinds', { sb: String(holdemShown.smallBlind), bb: String(holdemShown.bigBlind) })}
      </span>}
      {holdemResult && !locked && <span className={styles.chip}>
        <AppIcon name="trophy" /> {joinNames(holdemResult.winners.map((seat) => seats?.[seat].player?.nickname ?? seatLabel(seat)), locale)}
        {mySeat && <> · {t('holdem.myChips', { n: String(holdemResult.chips[mySeat]) })}</>}
      </span>}
      {ninetyNineWinner && <span className={styles.chip}>
        <AppIcon name="trophy" /> {seats?.[ninetyNineWinner].player?.nickname ?? seatLabel(ninetyNineWinner)}
      </span>}
    </>
      : contract ? <span className={styles.chip} title={t('topbar.contract')}>
      <BidLabel level={contract.level} suit={contract.suit} /> · {seatLabel(contract.declarer)}
    </span> : bidding && <span className={styles.chip}>
      {t('game.bidding')}
      {bidding.highestBid && <> <BidLabel level={bidding.highestBid.level} suit={bidding.highestBid.suit} /></>}
    </span>}
    {playing && <span className={styles.chip} title={t('topbar.tricks')}>
      NS {playing.trickCountNS} · EW {playing.trickCountEW}
    </span>}
  </div>;
}

export function TopBar(): ReactNode {
  useTurnSound();
  const { t } = useI18nStore();
  const { pathname } = useLocation();
  const accountId = useAccountStore((state) => state.account?.id);
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

  useEffect(() => { setOpen(null); }, [pathname]);

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
    <NavLink to={`/players/${encodeURIComponent(accountId)}`}>{t('player.myProfile')}</NavLink>
    <NavLink to="/account">{t('nav.account')}</NavLink>
  </>;

  return (
    <header className={styles.bar}>
      <NavLink to="/" className={styles.brand}>
        <span aria-hidden="true">♠</span><span className={inGame ? styles.brandTextGame : undefined}> Card Together</span>
      </NavLink>
      {showLinks && <nav className={styles.links}>{links}</nav>}
      {inGame && <GameChips />}
      <div className={styles.actions}>
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
