import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useHandSortStore } from '../stores/hand-sort-store';
import { useI18nStore } from '../stores/i18n-store';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { clientGame } from './registry';
import { useConnectionReady } from './use-connection-ready';
import styles from './GameActionBar.module.css';

interface AutoPlay {
  readonly automatic: boolean;
  readonly pending: boolean;
  readonly error: string;
  readonly toggle: () => void;
}

/** Server-backed auto-play switch; the menu and the banner share it. */
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

/** Table menu section: computer auto-play and hand sorting. */
export function GameActionBar({ className = '' }: { readonly className?: string }): ReactNode {
  const gameType = useGameStore((state) => state.visible?.gameType);
  const plays = usePlays();
  const sorting = useHandSortStore();
  const { automatic, pending, error, toggle } = useAutoPlay();
  const { t } = useI18nStore();
  if (!plays || !gameType) return null;
  const suitSortable = clientGame(gameType).handSort.bySuit;
  return <section className={`${styles.tools} ${className}`} aria-label={t('actions.label')}>
    <Button size="small" variant={automatic ? 'primary' : 'ghost'} aria-pressed={automatic} disabled={pending}
      onClick={toggle}>
      {t(automatic ? 'actions.stopAutoPlay' : 'actions.autoPlay')}
    </Button>
    <div className={styles.sort} role="group" aria-label={t('actions.sortLabel')}>
      {(['suit', 'rank'] as const).map((order) => <Chip key={order}
        selected={sorting.gameType === gameType && sorting.order === order}
        disabled={order === 'suit' && !suitSortable}
        title={order === 'suit' && !suitSortable ? t('actions.sortUnavailable') : undefined}
        onClick={() => sorting.sort(gameType, order)}>{t(`actions.${order}`)}</Chip>)}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
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
