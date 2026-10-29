import type { ReactNode } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { DDZ_MAX_REDEALS } from '@shared/rules/doudizhu';
import type { GameSeat } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { signed } from './doudizhu-view';
import styles from './DouDizhuFrame.module.css';

/** Detail under a Dou Dizhu deal, redeal, landlord, or settlement frame. */
export function DouDizhuFrame({ frame, name }: { frame: PresentationFrame; name: (seat: GameSeat) => string }): ReactNode {
  const { t } = useI18nStore();
  const game = useGameStore((state) => state.doudizhu);
  const index = frameLogIndex(frame);
  const entry = game && index !== null ? game.log[index] : undefined;
  if (!game || !entry) return null;
  if (entry.type === 'deal') {
    return <div className={styles.notice}>
      <strong>{t('doudizhu.deal', { n: String(entry.deal), total: String(game.totalDeals) })}</strong>
      <span>{t('doudizhu.openingBid', { name: name(entry.firstCaller) })}</span>
    </div>;
  }
  if (entry.type === 'landlord') {
    return <div className={styles.notice}>
      <strong>{t('doudizhu.base', { n: String(entry.base) })}</strong>
      {entry.forced && <span>{t('doudizhu.forcedNotice', { name: name(entry.seat) })}</span>}
    </div>;
  }
  if (entry.type === 'redeal') {
    return <div className={styles.notice}>
      <span>{t('doudizhu.redealNotice', { n: String(redealsAt(game.log.slice(0, (index ?? 0) + 1))), max: String(DDZ_MAX_REDEALS) })}</span>
    </div>;
  }
  if (entry.type === 'deal_end') {
    return <div className={styles.notice}>
      <strong>{t(entry.landlordWins ? 'doudizhu.landlordWins' : 'doudizhu.farmersWin')} · {t('doudizhu.multiplier', { n: String(entry.multiplier) })}</strong>
      {(entry.spring || entry.antiSpring) && <span>{t(entry.spring ? 'doudizhu.spring' : 'doudizhu.antiSpring')}</span>}
      <ul className={styles.scores}>{game.seats.map((seat) => <li key={seat} className={entry.scores[seat] > 0 ? styles.gain : styles.loss}>
        <span>{name(seat)}{seat === entry.landlord ? ` · ${t('doudizhu.landlord')}` : ''}</span>
        <strong>{signed(entry.scores[seat])}</strong>
      </li>)}</ul>
    </div>;
  }
  return null;
}

function redealsAt(log: readonly { readonly type: string }[]): number {
  let count = 0;
  for (let i = log.length - 1; i >= 0 && log[i].type !== 'deal_end'; i--) if (log[i].type === 'redeal') count += 1;
  return count;
}
