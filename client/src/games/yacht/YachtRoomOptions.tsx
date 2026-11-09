import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { DEFAULT_YACHT_OPTIONS, YACHT_MODES } from '@shared/rules/yacht';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

/** Whether players roll one at a time or all at once in each round. */
export function YachtRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.yacht ?? DEFAULT_YACHT_OPTIONS;
  return <label className={styles.option} title={t('yacht.modeHint')}>
    <span>{t('yacht.mode')}</span>
    <Select size="small" className={styles.select} value={options.mode} disabled={disabled}
      inputProps={{ 'aria-label': t('yacht.mode'), 'aria-describedby': 'yacht-mode-hint' }}
      MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
      onChange={(event) => {
        const mode = YACHT_MODES.find((value) => value === event.target.value);
        if (mode) setGameOptions({ gameType: 'yacht', options: { mode } });
      }}>
      {YACHT_MODES.map((value) => <MenuItem key={value} value={value}>
        {t(value === 'turns' ? 'yacht.modeTurns' : 'yacht.modeSimultaneous')}</MenuItem>)}
    </Select>
    <span id="yacht-mode-hint" className={styles.srOnly}>{t('yacht.modeHint')}</span>
  </label>;
}
