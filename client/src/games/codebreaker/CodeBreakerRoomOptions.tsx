import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { CB_VARIANTS, DEFAULT_CODEBREAKER_OPTIONS } from '@shared/rules/codebreaker';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

/** Digits (1A2B) or colours. */
export function CodeBreakerRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.codebreaker ?? DEFAULT_CODEBREAKER_OPTIONS;
  return <label className={styles.option} title={t('codebreaker.variantHint')}>
    <span>{t('codebreaker.variant')}</span>
    <Select size="small" className={styles.select} value={options.variant} disabled={disabled}
      inputProps={{ 'aria-label': t('codebreaker.variant'), 'aria-describedby': 'codebreaker-variant-hint' }}
      MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
      onChange={(event) => {
        const variant = CB_VARIANTS.find((value) => value === event.target.value);
        if (variant) setGameOptions({ gameType: 'codebreaker', options: { variant } });
      }}>
      {CB_VARIANTS.map((value) => <MenuItem key={value} value={value}>
        {t(value === 'digits' ? 'codebreaker.variantDigits' : 'codebreaker.variantColors')}</MenuItem>)}
    </Select>
    <span id="codebreaker-variant-hint" className={styles.srOnly}>{t('codebreaker.variantHint')}</span>
  </label>;
}
