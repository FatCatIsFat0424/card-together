import type { ReactNode } from 'react';
import { AppCheckbox } from './AppCheckbox';
import styles from './RoomSettings.module.css';

/** One labelled switch row; the whole row toggles, and the hint stays readable to screen readers. */
export function RoomOption({ id, label, hint, checked, disabled, onChange }: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactNode {
  return <label className={styles.option} title={hint}>
    <span>{label}</span>
    <AppCheckbox checked={checked} disabled={disabled} slotProps={{ input: { 'aria-describedby': id } }}
      onChange={(event) => onChange(event.target.checked)} />
    <span id={id} className={styles.srOnly}>{hint}</span>
  </label>;
}
