import type { ReactNode } from 'react';
import Tooltip from '@mui/material/Tooltip';
import { GAME_COIN_REWARD } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './CoinBalance.module.css';

/** Gold coin count of the signed-in account, with the per-game reward as its hint. */
export function CoinBalance({ className }: { readonly className?: string }): ReactNode {
  const { t } = useI18nStore();
  const coins = useAccountStore((state) => state.account?.coins ?? 0);
  return <Tooltip title={t('shop.earn', { n: String(GAME_COIN_REWARD) })} describeChild arrow>
    <span className={`${styles.coins} ${className ?? ''}`} role="status" tabIndex={0}
      aria-label={t('coins.balance', { n: String(coins) })}>
      <AppIcon name="coins" /><span>{coins.toLocaleString()}</span>
    </span>
  </Tooltip>;
}
