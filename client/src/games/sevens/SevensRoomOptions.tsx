import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { LEGACY_SEVENS_OPTIONS, SEVENS_SLAY_EFFECTS, sevensSlayEffect } from '@shared/sevens-options';
import { RoomOption } from '../../components/RoomOption';
import styles from '../../components/RoomSettings.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import type { RoomOptionsProps } from '../game-ui';

export function SevensRoomOptions({ gameOptions, disabled, setGameOptions }: RoomOptionsProps): ReactNode {
  const { t } = useI18nStore();
  const options = gameOptions?.sevens;
  return <>
    <RoomOption id="sevens-close-on-end-hint" label={t('sevens.closeOnEnd')}
      hint={t('sevens.closeOnEndHint')} checked={options?.closeOnEnd ?? false} disabled={disabled}
      onChange={(closeOnEnd) => setGameOptions({ gameType: 'sevens',
        options: { ...(options ?? LEGACY_SEVENS_OPTIONS), closeOnEnd } })} />
    {/* The effect only matters once Dragon Slaying is on, so it appears beside that option. */}
    {options?.closeOnEnd && <label className={styles.option} title={t('sevens.slayEffectHint')}>
      <span>{t('sevens.slayEffect')}</span>
      <Select size="small" className={styles.select} value={sevensSlayEffect(options)} disabled={disabled}
        inputProps={{ 'aria-label': t('sevens.slayEffect'), 'aria-describedby': 'sevens-slay-effect-hint' }}
        MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
        onChange={(event) => {
          const slayEffect = SEVENS_SLAY_EFFECTS.find((effect) => effect === event.target.value);
          if (slayEffect) setGameOptions({ gameType: 'sevens', options: { ...options, slayEffect } });
        }}>
        {SEVENS_SLAY_EFFECTS.map((effect) => <MenuItem key={effect} value={effect}>{t(`sevens.slayEffect.${effect}`)}</MenuItem>)}
      </Select>
      <span id="sevens-slay-effect-hint" className={styles.srOnly}>{t('sevens.slayEffectHint')}</span>
    </label>}
  </>;
}
