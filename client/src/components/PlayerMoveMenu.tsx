import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { MAX_SPECTATORS } from '@shared/constants';
import type { PlayerInfo } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import type { MoveOption } from '../pages/room-moves';
import { AppIcon } from './AppIcon';
import styles from './PlayerMoveMenu.module.css';

export interface PlayerMoveMenuProps {
  readonly player: PlayerInfo;
  readonly options: readonly MoveOption[];
  readonly spectatorCount: number;
  /** Present when the host may also remove this member. */
  readonly onKick?: () => void;
  readonly disabled: boolean;
  readonly onMove: (option: MoveOption) => void;
  /** `seat` is the small corner button of a seat card; `row` fills a list row's end. */
  readonly variant: 'seat' | 'row';
}

/**
 * The keyboard and screen-reader way to rearrange members: a "..." button whose first entry lists every
 * destination, marking the ones that swap. Dragging stays the quick way.
 */
export function PlayerMoveMenu({ player, options, spectatorCount, onKick, disabled, onMove, variant }: PlayerMoveMenuProps): ReactNode {
  const { t } = useI18nStore();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [listing, setListing] = useState(false);
  const open = (button: HTMLElement): void => {
    // With nothing else to offer, the list is the menu.
    setListing(!onKick);
    setAnchor(button);
  };
  const close = (): void => setAnchor(null);
  const label = t('room.playerActions', { nickname: player.nickname });
  return <>
    <button type="button" data-no-drag className={`${styles.trigger} ${variant === 'seat' ? styles.seat : styles.row}`}
      aria-label={label} title={label} aria-haspopup="menu" aria-expanded={anchor ? true : undefined}
      aria-controls={anchor ? id : undefined} disabled={disabled} onClick={(event) => open(event.currentTarget)}>
      <AppIcon name="more" />
    </button>
    <Menu id={id} open={anchor !== null} anchorEl={anchor} onClose={close} disableScrollLock
      slotProps={{ paper: { className: styles.menu } }}>
      {listing ? [
        <li key="title" role="presentation" className={styles.title}>
          {t('room.moveMenuTitle', { nickname: player.nickname })}</li>,
        ...options.map((option) => <MenuItem key={option.key} disabled={option.disabled}
          onClick={() => { close(); onMove(option); }}>
          <AppIcon name={option.label === null ? 'spectate' : option.occupant ? 'swap' : 'add'} className={styles.itemIcon} />
          <span className={styles.itemName}>
            {option.label === null ? t('room.moveToSpectators') : option.occupant
              ? `${option.label} · ${option.occupant.nickname}` : `${option.label} · ${t('room.seatEmpty')}`}
          </span>
          {option.label === null
            ? <span className={styles.tag}>{option.disabled ? t('room.moveSpectatorsFull') : `${spectatorCount}/${MAX_SPECTATORS}`}</span>
            : option.outcome.action === 'swap' && <span className={styles.tag}>{t('room.moveSwapTag')}</span>}
        </MenuItem>),
      ] : [
        <MenuItem key="move" onClick={() => setListing(true)}>
          <AppIcon name="swap" className={styles.itemIcon} /><span className={styles.itemName}>{t('room.moveTo')}</span>
        </MenuItem>,
        onKick && <MenuItem key="kick" className={styles.danger} onClick={() => { close(); onKick(); }}>
          <AppIcon name="close" className={styles.itemIcon} /><span className={styles.itemName}>{t('room.kick')}</span>
        </MenuItem>,
      ]}
    </Menu>
  </>;
}
