import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import type { TimeControl } from '@shared/types';
import { isTimeControl, TIME_CONTROL_LIMITS } from '@shared/time-control';
import { useI18nStore } from '../stores/i18n-store';
import styles from './TimeControlSettings.module.css';

interface TimeControlSettingsProps {
  readonly value: TimeControl;
  readonly disabled: boolean;
  readonly onSave: (value: TimeControl) => void;
}

export function TimeControlSettings({ value, disabled, onSave }: TimeControlSettingsProps): ReactNode {
  const { t } = useI18nStore();
  const [base, setBase] = useState(String(value.baseSeconds));
  const [bank, setBank] = useState(String(value.bankSeconds));
  const [error, setError] = useState(false);
  const changed = Number(base) !== value.baseSeconds || Number(bank) !== value.bankSeconds;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (disabled) return;
    const settings = { baseSeconds: Number(base), bankSeconds: Number(bank) };
    if (!base.trim() || !bank.trim() || !isTimeControl(settings)) { setError(true); return; }
    setError(false);
    onSave(settings);
  };
  return <form className={styles.settings} onSubmit={submit}>
    <fieldset disabled={disabled} aria-describedby="time-control-hint">
      <legend>{t('clock.settings')}</legend>
      <div className={styles.fields}>
        <TextField label={t('clock.baseSetting')} type="number" size="small" variant="outlined"
          fullWidth required disabled={disabled} value={base} error={error}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: 'numeric', step: 1,
            min: TIME_CONTROL_LIMITS.baseSeconds.min, max: TIME_CONTROL_LIMITS.baseSeconds.max } }}
          onChange={(event) => { setBase(event.target.value); setError(false); }} />
        <TextField label={t('clock.bankSetting')} type="number" size="small" variant="outlined"
          fullWidth required disabled={disabled} value={bank} error={error}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { inputMode: 'numeric', step: 1,
            min: TIME_CONTROL_LIMITS.bankSeconds.min, max: TIME_CONTROL_LIMITS.bankSeconds.max } }}
          onChange={(event) => { setBank(event.target.value); setError(false); }} />
      </div>
      <button type="submit" className={`btn btn-outline ${styles.apply}`} disabled={disabled || !changed}>{t('clock.apply')}</button>
    </fieldset>
    <p id="time-control-hint" className={styles.hint}>{t('clock.settingsHint')}</p>
    {error && <p role="alert" className={styles.error}>{t('clock.invalidSettings')}</p>}
  </form>;
}
