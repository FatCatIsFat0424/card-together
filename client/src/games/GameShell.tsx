// ─── GameShell：所有遊戲共用的牌桌外框（資訊欄 + 牌桌 + 聊天欄 + 投票終止） ───

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PlayerVisibleGameState, Seat } from '@shared/types';
import type { TranslationKey } from '../i18n';
import { playCardSound, playOutSound, unlockCardSounds, disposeCardSounds } from '../audio/card-sound';
import { mediaUrl } from '../media';
import { useAccountStore } from '../stores/account-store';
import { useGameStore } from '../stores/game-store';
import { useChatStore } from '../stores/chat-store';
import { useRoomStore } from '../stores/room-store';
import { useI18nStore } from '../stores/i18n-store';
import { ChatPanel } from '../components/ChatPanel';
import { TurnClock } from '../components/TurnClock';
import { TableSeat } from '../components/TableSeat';
import { lastElimination, lastMove, tablePosition } from '../game-view';
import type { TablePosition } from '../game-view';
import { AbortVoteBanner, AbortVoteButton } from './AbortVote';
import styles from './GameShell.module.css';
import { useGamePresentation } from './use-game-presentation';
import { GamePresentation } from './GamePresentation';
import { RoundHistory } from './RoundHistory';
import { useMotionStore } from '../stores/motion-store';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const DESKTOP_QUERY = '(min-width: 1024px)';
const SHEET_QUERY = '(max-width: 767px), (max-height: 500px) and (min-width: 600px)';
const OUT_BANNER_MS = 3500;
/** 出牌從該座位方向飛入中央 */
const FLY_FROM: Record<TablePosition, CSSProperties> = {
  bottom: { '--fly-x': '0px', '--fly-y': '28vh' } as CSSProperties,
  top: { '--fly-x': '0px', '--fly-y': '-28vh' } as CSSProperties,
  left: { '--fly-x': '-30vw', '--fly-y': '0px' } as CSSProperties,
  right: { '--fly-x': '30vw', '--fly-y': '0px' } as CSSProperties,
};

function presentationSummary(
  game: PlayerVisibleGameState, locale: 'zh-TW' | 'en',
  t: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
  if (game.gameType === 'bridge') {
    if (game.phase === 'scoring' && game.result) return t(game.result.declarerTeamWins
      ? 'score.declarerWins' : 'score.defenderWins');
    return game.playing ? `${t('seat.N')} / ${t('seat.S')}: ${game.playing.trickCountNS} · ` +
      `${t('seat.E')} / ${t('seat.W')}: ${game.playing.trickCountEW}` : '';
  }
  if (game.gameType === 'redpoints' && game.result) {
    return game.result.winners.map((seat) => `${t(`seat.${seat}`)} ${game.result?.points[seat]}`)
      .join(' · ') + (locale === 'zh-TW' ? ' 分獲勝' : ' points — winner');
  }
  return '';
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

interface GameShellProps {
  /** 資訊欄內容（桌機左欄、平板浮層、手機抽屜） */
  info: ReactNode;
  /** 牌桌中央 */
  centre: ReactNode;
  /** 牌桌下方手牌區 */
  hand: ReactNode;
  /** 全畫面浮層（結算） */
  overlay?: ReactNode;
  /** 牌桌上的動作錯誤 */
  error?: string;
  /** 可點選的座位（99：指定下一位） */
  pickableSeats?: readonly Seat[];
  onPickSeat?: (seat: Seat) => void;
  turnReady?: boolean;
}

function FittedCentre({ children, style, responsive }: {
  children: ReactNode; style?: CSSProperties; responsive: boolean;
}): ReactNode {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (responsive) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const fit = (): void => {
      const width = Math.max(content.offsetWidth, content.scrollWidth);
      const height = Math.max(content.offsetHeight, content.scrollHeight);
      const scale = width > 0 && height > 0
        ? Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height)
        : 1;
      content.style.setProperty('--centre-scale', String(scale));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    observer.observe(content);
    fit();
    return () => observer.disconnect();
  }, [responsive]);

  return <div className={`${styles.tableCentre} ${responsive ? styles.responsiveCentre : ''}`}
    ref={viewportRef} style={style} data-table-centre>
    <div className={styles.centreContent} ref={contentRef}>{children}</div>
  </div>;
}

export function GameShell({
  info, centre, hand, overlay, error, pickableSeats, onPickSeat, turnReady,
}: GameShellProps): ReactNode {
  const presentation = useGamePresentation();
  const visibleGame = useGameStore((state) => state.visible);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const setReducedMotion = useMotionStore((state) => state.setReducedMotion);
  const locale = useI18nStore((state) => state.locale);
  const mySeat = useRoomStore((state) => state.mySeat);
  const tableBackground = useAccountStore((state) => state.account?.tableBackground);
  const messageCount = useChatStore((state) => state.messages.length);
  const seats = useRoomStore((state) => state.roomInfo?.seats);
  const log = useGameStore((state) => state.bigTwo?.log ?? state.redPoints?.log ?? state.ninetyNine?.log ?? state.log);
  const ownedTurn = useGameStore((state) => mySeat !== null && state.currentTurnSeat === mySeat
    && (state.phase === 'bidding' || state.phase === 'playing'));
  const myTurn = (turnReady ?? ownedTurn) && !presentation.locked;
  const move = lastMove(log);
  const out = lastElimination(log);
  const [outBanner, setOutBanner] = useState<{ seat: Seat; index: number } | null>(null);
  const { t } = useI18nStore();
  // 平板預設收合聊天；手機為底部抽屜，預設關閉
  const [chatOpen, setChatOpen] = useState(() => matches(DESKTOP_QUERY) && !matches(SHEET_QUERY));
  const [infoOpen, setInfoOpen] = useState(false);
  const [seenMessages, setSeenMessages] = useState(0);
  const bottomSeat: Seat = mySeat ?? 'S';
  const unread = chatOpen ? 0 : Math.max(0, messageCount - seenMessages);

  // 只對進桌後的新動作出聲；進桌／重連時的既有紀錄不響
  const heardMove = useRef(move?.index);
  useEffect(() => {
    if (visibleGame?.presentation || !move || move.index === heardMove.current) return;
    heardMove.current = move.index;
    playCardSound(move.pass);
  }, [move, visibleGame?.presentation]);

  useEffect(() => {
    const unlock = (event: Event): void => { if (event.isTrusted) unlockCardSounds(); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      disposeCardSounds();
    };
  }, []);

  // 依 index 觸發；out 每次 render 都是新物件，不能當依賴（否則計時器會被清掉）
  const heardOut = useRef(out?.index);
  const outIndex = out?.index;
  const outSeat = out?.seat;
  useEffect(() => {
    if (visibleGame?.presentation || outIndex === undefined || !outSeat || outIndex === heardOut.current) return;
    heardOut.current = outIndex;
    playOutSound();
    setOutBanner({ seat: outSeat, index: outIndex });
    const timer = setTimeout(() => setOutBanner(null), OUT_BANNER_MS);
    return () => clearTimeout(timer);
  }, [outIndex, outSeat, visibleGame?.presentation]);

  const heardFrame = useRef(presentation.frame?.key);
  useEffect(() => {
    const frame = presentation.frame;
    if (!frame || heardFrame.current === frame.key) return;
    heardFrame.current = frame.key;
    if (frame.kind === 'play' || frame.kind === 'capture') playCardSound();
    else if (frame.kind === 'pass') playCardSound(true);
    else if (frame.kind === 'eliminated') playOutSound();
  }, [presentation.frame]);

  const collapseChat = useCallback((): void => {
    setSeenMessages(messageCount);
    setChatOpen(false);
  }, [messageCount]);

  // 縮到桌機寬度以下時收起聊天，避免手機版一進來就被聊天抽屜蓋住
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sheets = window.matchMedia(SHEET_QUERY);
    const onChange = (): void => { if (!query.matches || sheets.matches) collapseChat(); };
    query.addEventListener('change', onChange);
    sheets.addEventListener('change', onChange);
    return (): void => {
      query.removeEventListener('change', onChange);
      sheets.removeEventListener('change', onChange);
    };
  }, [collapseChat]);

  // 手機一次只開一個抽屜
  const openInfo = (): void => {
    if (matches(SHEET_QUERY) && chatOpen) collapseChat();
    setInfoOpen((open) => !open);
  };

  const openChat = (): void => {
    setInfoOpen(false);
    setChatOpen(true);
  };

  const closeSheets = useCallback((): void => {
    setInfoOpen(false);
    if (matches(SHEET_QUERY)) collapseChat();
  }, [collapseChat]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSheets();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSheets]);

  return (
    <div data-reduced-motion={reducedMotion || undefined} className={`${styles.gameContainer} ${chatOpen ? '' : styles.chatCollapsed} ${infoOpen ? styles.infoOpen : ''}`}>
      {(infoOpen || chatOpen) && <button type="button" className={styles.backdrop} tabIndex={-1}
        aria-label={t('table.close')} onClick={closeSheets} />}

      <div className={styles.infoPanel} id="game-info-panel">
        <div className={styles.sheetHeader}>
          <span>{t('table.info')}</span>
          <button type="button" className={styles.sheetClose} onClick={() => setInfoOpen(false)}
            aria-label={t('table.close')} title={t('table.close')}>✕</button>
        </div>
        <AbortVoteButton />
        <label className={styles.motionSetting}>
          <input type="checkbox" checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)} />
          {locale === 'zh-TW' ? '減少動畫' : 'Reduce motion'}
        </label>
        <div className={styles.infoContent}>
          {info}
          {visibleGame && <RoundHistory game={visibleGame} />}
        </div>
      </div>

      <main className={`${styles.centreColumn} ${tableBackground ? styles.customTable : ''}`}
        style={tableBackground
          ? { '--table-image': `url("${mediaUrl(tableBackground)}")` } as CSSProperties : undefined}>
        <div className={styles.table} data-card-table>
          <div className={styles.tableTools}>
            <button type="button" className={styles.toolBtn} onClick={openInfo}
              aria-label={t('table.info')} title={t('table.info')}
              aria-expanded={infoOpen} aria-controls="game-info-panel">
              <span aria-hidden="true">📋</span>
            </button>
            <button type="button" className={`${styles.toolBtn} ${styles.chatFab}`} onClick={openChat}
              aria-label={t('table.chatExpand')} title={t('table.chatExpand')} aria-expanded={chatOpen}>
              <span aria-hidden="true">💬</span>
              {unread > 0 && <span className={`${styles.unread} ${styles.fabBadge}`}>{unread}</span>}
            </button>
          </div>
          {SEATS.filter((seat) => seat !== bottomSeat).map((seat) => (
            <TableSeat key={seat} seat={seat} position={tablePosition(seat, bottomSeat)}
              suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === seat ? presentation.frame.key : undefined
                : move?.seat === seat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(seat) ? () => onPickSeat(seat) : undefined} />
          ))}
          <FittedCentre responsive={visibleGame?.gameType === 'redpoints' && !presentation.frame}
            style={move ? FLY_FROM[tablePosition(move.seat, bottomSeat)] : undefined}>
            {presentation.frame && visibleGame ? (
              <GamePresentation key={presentation.frame.key} frame={presentation.frame}
                bottomSeat={bottomSeat} gameType={visibleGame.gameType}
                elapsedMs={Math.max(0, Date.now() - presentation.frameStartedAt)}
                summary={presentationSummary(visibleGame, locale, t)} />
            ) : <div className={`${styles.centreBody} ${visibleGame?.presentation ? styles.settledCentre : ''}`}>{centre}</div>}
          </FittedCentre>
          {outBanner && <p key={outBanner.index} className={styles.outBanner} role="status">
            {t('table.eliminated', { name: seats?.[outBanner.seat].player?.nickname ?? t(`seat.${outBanner.seat}`) })}
          </p>}
          <AbortVoteBanner />
        </div>

        <div className={`${styles.handZone} ${myTurn ? styles.handMyTurn : ''}`} data-hand-zone>
          <div className={styles.handHeader}>
            <TableSeat seat={bottomSeat} position="bottom" hideClock suppressTurn={presentation.locked}
              moveKey={visibleGame?.presentation
                ? presentation.frame?.seat === bottomSeat ? presentation.frame.key : undefined
                : move?.seat === bottomSeat ? move.index : undefined}
              onPick={onPickSeat && pickableSeats?.includes(bottomSeat) ? () => onPickSeat(bottomSeat) : undefined} />
            {mySeat && <TurnClock seat={mySeat} compact />}
          </div>
          <div className={styles.handStatus}>
            {myTurn && <p className={styles.yourTurn} role="status">{t('table.yourTurn')}</p>}
            {error && <p className={styles.actionError} role="alert">{error}</p>}
          </div>
          {hand}
        </div>
      </main>

      <aside className={styles.chatRail}>
        {!chatOpen && (
          <button type="button" className={styles.chatStrip} onClick={() => setChatOpen(true)}
            aria-label={t('table.chatExpand')} title={t('table.chatExpand')}>
            <span aria-hidden="true">💬</span>
            {unread > 0 && <span className={styles.unread}>{unread}</span>}
          </button>
        )}
        <div className={chatOpen ? styles.chatBody : styles.hidden}>
          <ChatPanel onCollapse={collapseChat} />
        </div>
      </aside>

      {!presentation.locked && overlay}
    </div>
  );
}
