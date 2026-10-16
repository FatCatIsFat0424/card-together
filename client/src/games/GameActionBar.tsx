import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { socket } from '../socket';
import { useGameStore } from '../stores/game-store';
import { useHandSortStore } from '../stores/hand-sort-store';
import { useI18nStore } from '../stores/i18n-store';
import { useConnectionReady } from './use-connection-ready';
import styles from './GameActionBar.module.css';

export function GameActionBar(): ReactNode {
  const game = useGameStore((state) => state.visible);
  const ready = useConnectionReady();
  const sorting = useHandSortStore();
  const { t } = useI18nStore();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  if (!game || game.observer || game.phase === 'scoring') return null;
  const automatic = game.autoPlay ?? false;
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
  return <aside className={styles.bar} aria-label={t('actions.label')}>
    <button type="button" className={styles.action} aria-pressed={automatic} disabled={!ready || pending}
      onClick={toggle} title={t(automatic ? 'actions.stopAutoPlay' : 'actions.autoPlay')}
      aria-label={t(automatic ? 'actions.stopAutoPlay' : 'actions.autoPlay')}>
      <span aria-hidden="true">{t('actions.autoShort')}</span>
    </button>
    {(['suit', 'rank'] as const).map((order) => <button key={order} type="button" className={styles.action}
      disabled={order === 'suit' && game.gameType === 'liarsdeck'} aria-pressed={sorting.gameType === game.gameType && sorting.order === order}
      onClick={() => sorting.sort(game.gameType, order)}
      title={t(order === 'suit' && game.gameType === 'liarsdeck' ? 'actions.sortUnavailable' : `actions.${order}`)} aria-label={t(`actions.${order}`)}>
      <span aria-hidden="true">{t(`actions.${order}Short`)}</span>
    </button>)}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </aside>;
}
