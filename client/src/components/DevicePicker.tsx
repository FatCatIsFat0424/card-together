import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { AppIcon } from './AppIcon';
import styles from './DevicePicker.module.css';

export interface DeviceOption {
  readonly value: string;
  readonly label: string;
}

/** A dark 40px picker whose small label sits inside the frame; it replaces the browser's grey select. */
export function DevicePicker({ label, options, value, disabled = false, describedBy, onChange }: {
  readonly label: string;
  readonly options: readonly DeviceOption[];
  readonly value: string;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <>
    <button type="button" className={styles.picker} disabled={disabled} aria-haspopup="listbox"
      aria-expanded={anchor ? true : undefined} aria-controls={anchor ? id : undefined}
      aria-describedby={describedBy} onClick={(event) => setAnchor(event.currentTarget)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{selected?.label}</span>
      <AppIcon name="nextPage" className={styles.chevron} />
    </button>
    <Menu id={id} open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} disableScrollLock
      slotProps={{
        paper: { className: styles.menu, style: { minWidth: anchor?.offsetWidth } },
        list: { role: 'listbox', 'aria-label': label },
      }}>
      {options.map((option) => <MenuItem key={option.value} role="option" selected={option.value === selected?.value}
        aria-selected={option.value === selected?.value}
        onClick={() => { setAnchor(null); onChange(option.value); }}>
        <span className={styles.check}>{option.value === selected?.value && <AppIcon name="check" />}</span>
        <span className={styles.optionLabel}>{option.label}</span>
      </MenuItem>)}
    </Menu>
  </>;
}
