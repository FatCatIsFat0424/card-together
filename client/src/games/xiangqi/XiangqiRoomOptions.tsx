import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { XQ_HANDICAPS, XQ_HANDICAP_SIDES } from '@shared/rules/xiangqi';
import { DEFAULT_XIANGQI_OPTIONS } from '@shared/xiangqi-options';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

/** 讓子: the handicap and, once one is chosen, the colour that gives it. */
export function XiangqiRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.xiangqi ?? DEFAULT_XIANGQI_OPTIONS;
  const menu = { slotProps: { paper: { className: styles.menu } } };
  return <>
    <label className={styles.option} title={t('xiangqi.handicapHint')}>
      <span>{t('xiangqi.handicap')}</span>
      <Select size="small" className={styles.select} value={options.handicap} disabled={disabled}
        inputProps={{ 'aria-label': t('xiangqi.handicap'), 'aria-describedby': 'xiangqi-handicap-hint' }} MenuProps={menu}
        onChange={(event) => {
          const handicap = XQ_HANDICAPS.find((value) => value === event.target.value);
          if (handicap) setGameOptions({ gameType: 'xiangqi', options: { ...options, handicap } });
        }}>
        {XQ_HANDICAPS.map((value) => <MenuItem key={value} value={value}>{t(`xiangqi.handicap.${value}`)}</MenuItem>)}
      </Select>
      <span id="xiangqi-handicap-hint" className={styles.srOnly}>{t('xiangqi.handicapHint')}</span>
    </label>
    {options.handicap !== 'none' && <label className={styles.option} title={t('xiangqi.handicapSideHint')}>
      <span>{t('xiangqi.handicapSide')}</span>
      <Select size="small" className={styles.select} value={options.handicapSide} disabled={disabled}
        inputProps={{ 'aria-label': t('xiangqi.handicapSide'), 'aria-describedby': 'xiangqi-handicap-side-hint' }}
        MenuProps={menu}
        onChange={(event) => {
          const handicapSide = XQ_HANDICAP_SIDES.find((value) => value === event.target.value);
          if (handicapSide) setGameOptions({ gameType: 'xiangqi', options: { ...options, handicapSide } });
        }}>
        {XQ_HANDICAP_SIDES.map((value) => <MenuItem key={value} value={value}>
          {t(value === 'red' ? 'xiangqi.redSide' : 'xiangqi.blackSide')}</MenuItem>)}
      </Select>
      <span id="xiangqi-handicap-side-hint" className={styles.srOnly}>{t('xiangqi.handicapSideHint')}</span>
    </label>}
  </>;
}
