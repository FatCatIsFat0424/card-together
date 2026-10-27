import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { IconButton } from './IconButton';
import styles from './OverflowMenu.module.css';

export interface OverflowItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

/** The "more" menu that holds a row's secondary actions so the row keeps at most two visible buttons. */
export function OverflowMenu({ label, items, disabled = false }: {
  readonly label: string;
  readonly items: readonly OverflowItem[];
  readonly disabled?: boolean;
}): ReactNode {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <>
    <IconButton icon="more" label={label} disabled={disabled} aria-haspopup="menu"
      aria-expanded={anchor ? true : undefined} aria-controls={anchor ? id : undefined}
      onClick={(event) => setAnchor(event.currentTarget)} />
    <Menu id={id} open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}
      disableScrollLock slotProps={{ paper: { className: styles.menu } }}>
      {items.map((item) => <MenuItem key={item.label} disabled={item.disabled}
        className={item.danger ? styles.danger : undefined}
        onClick={() => { setAnchor(null); item.onSelect(); }}>{item.label}</MenuItem>)}
    </Menu>
  </>;
}
