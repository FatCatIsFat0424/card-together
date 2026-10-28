import type { ReactNode } from 'react';
import type { DiceFace } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { Die } from './Dice';
import { diceThemeVars, useDiceTheme } from './dice-theme';
import { sortDice } from './liarsdice-view';
import styles from './ObservedDice.module.css';

/** Another seat's dice shown face up in god view, small enough to sit under the seat plate. */
export function ObservedDice({ dice, owner }: { dice: readonly DiceFace[]; owner: string }): ReactNode {
  const { t } = useI18nStore();
  const theme = useDiceTheme();
  return <div className={styles.row} style={diceThemeVars(theme)} role="group" aria-label={t('table.observedHand', { name: owner })}>
    {sortDice(dice).map((value, index) => <Die key={index} value={value} />)}
  </div>;
}
