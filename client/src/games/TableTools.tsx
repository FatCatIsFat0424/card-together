import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameType } from '@shared/types';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useHandSortStore } from '../stores/hand-sort-store';
import type { HandSort } from '../stores/hand-sort-store';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from '../components/AppIcon';
import { clientGame } from './registry';
import { useConnectionReady } from './use-connection-ready';
import { useHandArrangement } from './use-hand-sort';
import styles from './TableTools.module.css';

/** The phone drawer closes after this long without input, so it never stays over a seat. */
export const TOOLS_IDLE_MS = 3000;

interface AutoPlay {
  readonly automatic: boolean;
  readonly pending: boolean;
  readonly error: string;
  readonly toggle: () => void;
}

/** Server-backed auto-play switch; the tools and the banner share it. */
function useAutoPlay(): AutoPlay {
  const automatic = useGameStore((state) => state.visible?.autoPlay ?? false);
  const ready = useConnectionReady();
  const { t } = useI18nStore();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const toggle = (): void => {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError('');
    socket.timeout(10000).emit('game:autoPlay', { enabled: !automatic }, (timeout, response) => {
      inFlight.current = false;
      setPending(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!response?.success) setError(response?.error ?? t('common.error'));
    });
  };
  return { automatic, pending: pending || !ready, error, toggle };
}

/** Whether the viewer plays this match: spectators and settled tables have nothing to automate or sort. */
function usePlays(): boolean {
  return useGameStore((state) => Boolean(state.visible) && !state.visible?.observer && state.visible?.phase !== 'scoring');
}

/** Small card-face glyph that shows which way each sort reads: suits in order, or ranks from A down. */
function SortGlyph({ order }: { readonly order: HandSort }): ReactNode {
  return <span className={styles.glyph} aria-hidden="true">
    {order === 'suit' ? <>♠<span className={styles.red}>♥</span>♣<span className={styles.red}>♦</span></>
      : <>A<span className={styles.arrow}>›</span>2</>}
  </span>;
}

interface ToolsState {
  readonly gameType: GameType;
  readonly autoPlay: AutoPlay;
  readonly active: HandSort | null;
  readonly suitSortable: boolean;
  readonly sort: (order: HandSort) => void;
}

function useToolsState(): ToolsState | null {
  const gameType = useGameStore((state) => state.visible?.gameType ?? null);
  const plays = usePlays();
  const arrangement = useHandArrangement(gameType);
  const sort = useHandSortStore((state) => state.sort);
  const autoPlay = useAutoPlay();
  if (!plays || !gameType || !arrangement) return null;
  return {
    gameType,
    autoPlay,
    // A dragged arrangement highlights neither order.
    active: arrangement.manual ? null : arrangement.order,
    suitSortable: clientGame(gameType).handSort.bySuit,
    sort: (order) => sort(gameType, order),
  };
}

function SortButtons({ state, className }: { readonly state: ToolsState; readonly className: string }): ReactNode {
  const { t } = useI18nStore();
  return <>{(['suit', 'rank'] as const).map((order) => {
    const unavailable = order === 'suit' && !state.suitSortable;
    return <button key={order} type="button" className={className} aria-pressed={state.active === order}
      aria-label={t(`actions.${order}`)} title={unavailable ? t('actions.sortUnavailable') : t(`actions.${order}`)}
      disabled={unavailable || state.autoPlay.automatic} onClick={() => state.sort(order)}>
      <SortGlyph order={order} />{t(`actions.${order}Short`)}
    </button>;
  })}</>;
}

/** Desktop: a floating cluster beside the hand with the auto-play switch and the two sort orders. */
export function TableTools(): ReactNode {
  const state = useToolsState();
  const { t } = useI18nStore();
  if (!state) return null;
  const { automatic, pending, error, toggle } = state.autoPlay;
  return <section className={styles.cluster} aria-label={t('actions.label')} data-table-tools="cluster">
    <button type="button" role="switch" aria-checked={automatic} className={styles.autoPlay}
      disabled={pending} onClick={toggle}>
      <AppIcon name="robot" />
      <span className={styles.autoLabel}>{t(automatic ? 'actions.autoPlayOn' : 'actions.autoPlay')}</span>
      <span className={styles.switch} aria-hidden="true" />
    </button>
    <div className={styles.sort} role="group" aria-label={t('actions.sortLabel')}>
      <SortButtons state={state} className={styles.sortOption} />
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}

/**
 * Phones: an edge handle above the hand that slides out a strip of the same tools. It closes on an outside tap,
 * its close button, Escape, or after a few idle seconds; a dot on the handle marks auto-play while it is closed.
 */
export function TableToolsDrawer(): ReactNode {
  const state = useToolsState();
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLElement>(null);
  // Focus returns to the handle only when it was inside the strip, never after a tap elsewhere.
  const restoreFocus = useRef(false);
  const shown = open && state !== null;

  const close = useCallback((): void => {
    restoreFocus.current = Boolean(rootRef.current?.contains(document.activeElement));
    setOpen(false);
  }, []);

  useEffect(() => {
    if (shown) {
      stripRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    if (restoreFocus.current) handleRef.current?.focus({ preventScroll: true });
    restoreFocus.current = false;
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(close, TOOLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [shown, activity, close]);

  useEffect(() => {
    if (!shown) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shown, close]);

  if (!state) return null;
  const { automatic, pending, error, toggle } = state.autoPlay;
  const touch = (): void => setActivity((count) => count + 1);

  return <div ref={rootRef} className={styles.drawer} data-table-tools="drawer" onPointerDown={touch} onKeyDown={touch}>
    {shown ? <section ref={stripRef} className={styles.strip} aria-label={t('actions.label')}>
      <div className={styles.stripItems}>
        <button type="button" role="switch" aria-checked={automatic} aria-label={t('actions.autoPlay')}
          className={`${styles.stripButton} ${styles.stripAuto}`} disabled={pending} onClick={toggle}>
          <AppIcon name="robot" />{t(automatic ? 'actions.autoPlayOnShort' : 'actions.autoPlayOffShort')}
        </button>
        <SortButtons state={state} className={styles.stripButton} />
      </div>
      <button type="button" className={styles.stripClose} aria-label={t('actions.toolsClose')}
        title={t('actions.toolsClose')} onClick={close}>
        <AppIcon name="previousPage" />
      </button>
      {error && <p className={styles.stripError} role="alert">{error}</p>}
    </section> : <button ref={handleRef} type="button" className={styles.handle} aria-expanded={false}
      aria-label={automatic ? `${t('actions.toolsOpen')} · ${t('actions.autoPlaying')}` : t('actions.toolsOpen')}
      title={t('actions.toolsOpen')} onClick={() => setOpen(true)}>
      <AppIcon name="nextPage" />
      {automatic && <span className={styles.handleDot} aria-hidden="true" />}
    </button>}
  </div>;
}

/** Small notice while the computer plays for the viewer, with a way back. */
export function AutoPlayBanner(): ReactNode {
  const plays = usePlays();
  const { automatic, pending, toggle } = useAutoPlay();
  const { t } = useI18nStore();
  if (!plays || !automatic) return null;
  return <div className={styles.banner} role="status">
    <span>{t('actions.autoPlaying')}</span>
    <button type="button" className={styles.bannerStop} disabled={pending} onClick={toggle}>{t('actions.autoPlayOff')}</button>
  </div>;
}
