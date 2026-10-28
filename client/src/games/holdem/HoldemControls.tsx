import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HeBettingView } from '@shared/rules/holdem';
import type { GameSeat, HoldemAction } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { HandActions } from '../HandActions';
import { QUICK_SIZES, clampRaise, quickRaise, raiseKind } from './holdem-view';
import type { HoldemControls, RaiseControl } from './holdem-view';
import styles from './HoldemControls.module.css';

// Shared by Hold'em and Five-Card Stud: both bet with the same no-limit fold, check, call, and raise controls.

/** Presets, slider, amount field and confirm for a bet or raise, clamped to the legal street totals. */
function RaiseSheet({ table, seat, control, disabled, onRaise, onClose }: {
  table: HeBettingView; seat: GameSeat; control: RaiseControl; disabled: boolean; onRaise: (to: number) => void; onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const [draft, setDraft] = useState<string | null>(null);
  const [chosen, setChosen] = useState(control.min);
  const value = clampRaise(draft === null ? chosen : Number(draft), control);
  const choose = (to: number): void => {
    setDraft(null);
    setChosen(clampRaise(to, control));
  };
  const kind = raiseKind(value, control);
  const confirm = <Button variant="primary" className={kind === 'allIn' ? styles.allInButton : undefined}
    disabled={disabled} onClick={() => onRaise(value)}>
    {t(`holdem.confirm.${kind}`, { n: String(value) })}
  </Button>;
  const fixed = control.min === control.max;
  return <div className={styles.sheet} role="group" aria-label={t('holdem.raiseAmount')}
    onKeyDown={(event) => {
      if (event.key !== 'Escape') return;
      // Closing the sheet must not also close a menu or chat drawer underneath.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    {fixed ? <span className={styles.limits}>{t('holdem.raiseAllInOnly')}</span> : <>
      <div className={styles.quickRow} role="group" aria-label={t('holdem.raiseAmount')}>
        {QUICK_SIZES.map((size) => {
          const to = quickRaise(size, table, seat, control);
          return <Chip key={size} selected={to === value} disabled={disabled} onClick={() => choose(to)} title={String(to)}>
            {t(`holdem.quick.${size}`)}
          </Chip>;
        })}
      </div>
      <div className={styles.sliderRow}>
        <input type="range" className={styles.slider} min={control.min} max={control.max} step={1} value={value}
          aria-label={t('holdem.raiseAmount')} disabled={disabled} autoFocus
          onChange={(event) => choose(Number(event.target.value))} />
        <input type="number" className={styles.amountInput} min={control.min} max={control.max} step={1}
          inputMode="numeric" aria-label={t('holdem.raiseAmount')} disabled={disabled}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => choose(value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !disabled) {
              choose(value);
              onRaise(value);
            }
          }} />
      </div>
    </>}
    <div className={styles.sheetActions}>
      {!fixed && <span className={styles.limits}>{t('holdem.raiseRange', { min: String(control.min), max: String(control.max) })}</span>}
      <Button onClick={onClose}>{t('common.cancel')}</Button>
      {confirm}
    </div>
  </div>;
}

/** Fold, check or call, and raise as three pills; raising opens the sheet in their place. */
export function BettingControls({ table, seat, options, enabled, onAction }: {
  table: HeBettingView; seat: GameSeat; options: HoldemControls | null; enabled: boolean;
  onAction: (action: HoldemAction) => void;
}): ReactNode {
  const { t } = useI18nStore();
  const [raising, setRaising] = useState(false);
  const raiseButton = useRef<HTMLButtonElement>(null);
  const wasRaising = useRef(false);
  useEffect(() => {
    // Closing the sheet hands focus back to the pill that opened it.
    if (wasRaising.current && !raising) raiseButton.current?.focus({ preventScroll: true });
    wasRaising.current = raising;
  }, [raising]);
  const disabled = !enabled || !options;
  const callLabel = !options || options.check ? t('holdem.action.check')
    : t(options.callAllIn ? 'holdem.action.callAllIn' : 'holdem.action.call', { n: String(options.call) });
  if (raising && options?.raise) {
    return <HandActions className={styles.controls} layout="sheet">
      <RaiseSheet key={`${options.raise.min}-${options.raise.max}`} table={table} seat={seat} control={options.raise}
        disabled={disabled} onClose={() => setRaising(false)}
        onRaise={(to) => onAction({ type: 'raise', to })} />
    </HandActions>;
  }
  return <HandActions className={styles.controls} layout="row">
    <Button disabled={disabled} onClick={() => onAction({ type: 'fold' })}>{t('holdem.action.fold')}</Button>
    <Button variant={options?.raise ? 'ghost' : 'primary'} disabled={disabled}
      onClick={() => onAction(options?.check ? { type: 'check' } : { type: 'call' })}>{callLabel}</Button>
    {options?.raise && <Button ref={raiseButton} variant="primary" disabled={disabled} aria-haspopup="true"
      onClick={() => setRaising(true)}>{t(options.raise.bet ? 'holdem.tag.bet' : 'holdem.tag.raise')}</Button>}
  </HandActions>;
}
