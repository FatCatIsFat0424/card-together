import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
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
  return <details className={styles.settings}>
    <summary>{t('clock.settings')} · {value.baseSeconds} + {value.bankSeconds}</summary>
    <form className={styles.panel} onSubmit={submit}>
    <fieldset disabled={disabled} aria-describedby="time-control-hint">
      <legend>{t('clock.settings')}</legend>
      <div className={styles.fields}>
        <label>{t('clock.baseSetting')}
          <input type="number" inputMode="numeric" step="1" required
            min={TIME_CONTROL_LIMITS.baseSeconds.min} max={TIME_CONTROL_LIMITS.baseSeconds.max}
            value={base} onChange={(event) => setBase(event.target.value)} />
        </label>
        <span className={styles.plus} aria-hidden="true">+</span>
        <label>{t('clock.bankSetting')}
          <input type="number" inputMode="numeric" step="1" required
            min={TIME_CONTROL_LIMITS.bankSeconds.min} max={TIME_CONTROL_LIMITS.bankSeconds.max}
            value={bank} onChange={(event) => setBank(event.target.value)} />
        </label>
        <button type="submit" className="btn btn-outline" disabled={!changed}>{t('clock.apply')}</button>
      </div>
    </fieldset>
    <p id="time-control-hint" className={styles.hint}>{t('clock.settingsHint')}</p>
    {error && <p role="alert" className={styles.error}>{t('clock.invalidSettings')}</p>}
    </form>
  </details>;
}
