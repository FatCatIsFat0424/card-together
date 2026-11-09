import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { DEFAULT_DOMINOES_OPTIONS, DOMINOES_TARGETS } from '@shared/dominoes-options';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

/** The match target score: 50, 100, or 150 points. */
export function DominoesRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.dominoes ?? DEFAULT_DOMINOES_OPTIONS;
  return <label className={styles.option} title={t('dominoes.targetScoreHint')}>
    <span>{t('dominoes.targetScore')}</span>
    <Select size="small" className={styles.select} value={options.targetScore} disabled={disabled}
      inputProps={{ 'aria-label': t('dominoes.targetScore'), 'aria-describedby': 'dominoes-target-hint' }}
      MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
      onChange={(event) => {
        const targetScore = DOMINOES_TARGETS.find((value) => value === event.target.value);
        if (targetScore) setGameOptions({ gameType: 'dominoes', options: { targetScore } });
      }}>
      {DOMINOES_TARGETS.map((value) => <MenuItem key={value} value={value}>{t(`dominoes.target.${value}`)}</MenuItem>)}
    </Select>
    <span id="dominoes-target-hint" className={styles.srOnly}>{t('dominoes.targetScoreHint')}</span>
  </label>;
}
