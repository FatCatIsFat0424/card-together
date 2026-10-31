import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { DEFAULT_GO_OPTIONS, GO_SIZES, goMaxHandicap } from '@shared/rules/go';
import type { GoOptions } from '@shared/rules/go';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

/** 0 (none) and 2 up to the largest handicap the board takes. */
export function goHandicapChoices(size: GoOptions['size']): number[] {
  return [0, ...Array.from({ length: goMaxHandicap(size) - 1 }, (_, index) => index + 2)];
}

/** Board size and handicap; a smaller board lowers a handicap it cannot take. */
export function GoRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.go ?? DEFAULT_GO_OPTIONS;
  const menu = { slotProps: { paper: { className: styles.menu } } };
  return <>
    <label className={styles.option} title={t('go.sizeHint')}>
      <span>{t('go.size')}</span>
      <Select size="small" className={styles.select} value={options.size} disabled={disabled}
        inputProps={{ 'aria-label': t('go.size'), 'aria-describedby': 'go-size-hint' }} MenuProps={menu}
        onChange={(event) => {
          const size = GO_SIZES.find((value) => value === event.target.value);
          if (size) {
            setGameOptions({ gameType: 'go', options: { size, handicap: Math.min(options.handicap, goMaxHandicap(size)) } });
          }
        }}>
        {GO_SIZES.map((value) => <MenuItem key={value} value={value}>{t('go.sizeValue', { n: String(value) })}</MenuItem>)}
      </Select>
      <span id="go-size-hint" className={styles.srOnly}>{t('go.sizeHint')}</span>
    </label>
    <label className={styles.option} title={t('go.handicapHint')}>
      <span>{t('go.handicap')}</span>
      <Select size="small" className={styles.select} value={options.handicap} disabled={disabled}
        inputProps={{ 'aria-label': t('go.handicap'), 'aria-describedby': 'go-handicap-hint' }} MenuProps={menu}
        onChange={(event) => {
          const handicap = goHandicapChoices(options.size).find((value) => value === event.target.value);
          if (handicap !== undefined) setGameOptions({ gameType: 'go', options: { ...options, handicap } });
        }}>
        {goHandicapChoices(options.size).map((value) => <MenuItem key={value} value={value}>
          {value === 0 ? t('go.handicapNone') : t('go.handicapStones', { n: String(value) })}</MenuItem>)}
      </Select>
      <span id="go-handicap-hint" className={styles.srOnly}>{t('go.handicapHint')}</span>
    </label>
  </>;
}
