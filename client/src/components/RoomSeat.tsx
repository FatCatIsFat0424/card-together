import { useId, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Select from '@mui/material/Select';
import { Link } from 'react-router-dom';
import { BOT_DIFFICULTIES, isBotDifficulty } from '@shared/bot-difficulty';
import { isSeatReady } from '@shared/rules/seats';
import type { BotDifficulty, PlayerInfo, SeatInfo } from '@shared/types';
import { SeatFrame, seatFrameHostClass } from '../cosmetics/seat-frames/SeatFrame';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import styles from './RoomSeat.module.css';

export interface RoomSeatProps {
  /** `data-room-drop` key: a compass seat, `additional-n`, or `spectator`. */
  readonly seatKey: string;
  /** Full seat name for assistive technology; `shortLabel` is the corner badge. */
  readonly label: string;
  readonly shortLabel: string;
  readonly info: SeatInfo;
  /** Position on the oval as a unit vector, applied with CSS variables. */
  readonly position: CSSProperties;
  /** Waiting-room card art behind the avatar. */
  readonly art?: CSSProperties;
  readonly hostId: string;
  readonly playerId: string | null;
  /** The viewer is the host. */
  readonly isHost: boolean;
  /** The room is still waiting. */
  readonly waiting: boolean;
  /** Offline or a request in flight: input is locked. */
  readonly blocked: boolean;
  /** A request is in flight: keep the enabled look. */
  readonly pending: boolean;
  /** The host may drag this player. */
  readonly draggable: boolean;
  readonly moving: boolean;
  readonly dropTarget: boolean;
  /** The last additional seat can be removed while empty. */
  readonly removable: boolean;
  readonly handle: ReactNode;
  readonly onPointerDown: (event: PointerEvent<HTMLElement>, player: PlayerInfo) => void;
  readonly onSit: () => void;
  readonly onAddBot: () => void;
  readonly onRemoveSeat: () => void;
  readonly onKick: (player: PlayerInfo) => void;
  readonly onDifficulty: (difficulty: BotDifficulty) => void;
  readonly onRemoveBot: () => void;
}

const CROWN = <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="M2 12.5 1 4.5l3.6 3L8 2.5l3.4 5 3.6-3-1 8z" fill="currentColor" />
  <rect x="2" y="13.5" width="12" height="1.5" rx=".75" fill="currentColor" />
</svg>;

/** What the host can do with an empty seat. */
export function EmptySeatActions({ removable, onSit, onAddBot, onRemoveSeat }: {
  readonly removable: boolean;
  readonly onSit: () => void;
  readonly onAddBot: () => void;
  readonly onRemoveSeat: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <>
    <Button variant="text" role="menuitem" onClick={onSit}>{t('room.sit')}</Button>
    <Button variant="text" role="menuitem" onClick={onAddBot}>{t('room.addBot')}</Button>
    {removable && <Button variant="danger-text" role="menuitem" onClick={onRemoveSeat}>{t('room.removeSeat')}</Button>}
  </>;
}

function EmptySeat(props: RoomSeatProps): ReactNode {
  const { t } = useI18nStore();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const menuId = useId();
  const locked = props.blocked || !props.waiting;
  const label = t('room.emptySeatFor', { seat: props.label });
  const pending = props.pending && props.waiting || undefined;
  // Only the host has a choice between sitting and adding a bot.
  const choose = props.isHost;
  return <div className={`${styles.seat} ${styles.empty} ${props.dropTarget ? styles.dropTarget : ''}`}
    style={props.position} data-room-drop={props.seatKey}>
    <button type="button" className={styles.emptyButton} disabled={locked} data-pending-disabled={pending}
      aria-label={label} aria-haspopup={choose ? 'menu' : undefined} aria-expanded={choose ? Boolean(anchor) : undefined}
      aria-controls={anchor ? menuId : undefined}
      onClick={(event) => { if (choose) setAnchor(event.currentTarget); else props.onSit(); }}>
      <span className={styles.plus} aria-hidden="true"><AppIcon name="add" /></span>
      <span className={styles.emptyLabel}>{t('room.seatEmpty')}</span>
    </button>
    {choose && <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { className: styles.menu, id: menuId, role: 'menu', 'aria-label': label } }}>
      <EmptySeatActions removable={props.removable} onSit={() => { setAnchor(null); props.onSit(); }}
        onAddBot={() => { setAnchor(null); props.onAddBot(); }}
        onRemoveSeat={() => { setAnchor(null); props.onRemoveSeat(); }} />
    </Popover>}
  </div>;
}

/** Bot management: difficulty and removal. */
export function BotControls({ player, disabled, blocked, pending, onDifficulty, onRemove }: {
  readonly player: PlayerInfo;
  /** The room no longer waits or the connection is down. */
  readonly disabled: boolean;
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly onDifficulty: (difficulty: BotDifficulty) => void;
  readonly onRemove: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <>
    <label className={styles.difficulty}>
      <span>{t('room.botDifficulty')}</span>
      <Select size="small" className={styles.select} value={player.botDifficulty ?? 'hard'} disabled={disabled}
        data-pending-disabled={pending && !blocked || undefined}
        inputProps={{ 'aria-label': t('room.botDifficultyFor', { nickname: player.nickname }) }}
        MenuProps={{ slotProps: { paper: { className: styles.selectMenu } } }}
        onChange={(event) => { if (isBotDifficulty(event.target.value)) onDifficulty(event.target.value); }}>
        {BOT_DIFFICULTIES.map((difficulty) => <MenuItem key={difficulty} value={difficulty}>
          {t(`room.botDifficulty.${difficulty}`)}
        </MenuItem>)}
      </Select>
    </label>
    <Button variant="danger-text" disabled={blocked} data-pending-disabled={pending || undefined}
      onClick={onRemove}>{t('room.removeBot')}</Button>
  </>;
}

function BotMenu({ player, anchor, props, onClose }: {
  readonly player: PlayerInfo;
  readonly anchor: HTMLElement | null;
  readonly props: RoomSeatProps;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const id = useId();
  const label = t('room.botControlsFor', { nickname: player.nickname });
  return <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
    slotProps={{ paper: { className: styles.menu, id, role: 'dialog', 'aria-label': label } }}>
    <BotControls player={player} disabled={props.blocked || !props.waiting} blocked={props.blocked}
      pending={props.pending && props.waiting} onDifficulty={props.onDifficulty}
      onRemove={() => { onClose(); props.onRemoveBot(); }} />
  </Popover>;
}

function OccupiedSeat(props: RoomSeatProps & { readonly player: PlayerInfo }): ReactNode {
  const { player, info } = props;
  const { t } = useI18nStore();
  const [botAnchor, setBotAnchor] = useState<HTMLButtonElement | null>(null);
  const isMe = player.id === props.playerId;
  const ready = isSeatReady({ hostId: props.hostId }, info);
  const manageBot = props.isHost && Boolean(player.isBot);
  const canKick = props.isHost && !player.isBot && !isMe && props.waiting;
  const status = player.isBot ? t(`room.botDifficulty.${player.botDifficulty ?? 'hard'}`)
    : t(ready ? 'room.ready.status' : 'room.notReady');
  const frame = seatFrameHostClass(player.seatFrame);
  const identity = <>
    <span className={styles.avatar}>
      <Avatar avatar={player.avatar} image={player.avatarImage} border={player.avatarBorder} color={player.color}
        size="compact" />
      <span className={`${styles.ring} ${isMe ? styles.mine : ''}`} aria-hidden="true" />
      <span className={styles.direction} title={props.label}>
        <span aria-hidden="true">{props.shortLabel}</span><span className={styles.srOnly}>{props.label}</span>
      </span>
      {ready && <span className={styles.ready} aria-hidden="true"><AppIcon name="check" /></span>}
      {player.id === props.hostId && <span className={styles.crown} title={t('room.host')}>
        {CROWN}<span className={styles.srOnly}>{t('room.host')}</span></span>}
    </span>
    <span className={`${styles.namePill} ${frame}`}>
      <SeatFrame frame={player.seatFrame} />
      <span className={styles.nickname}>{player.nickname}</span>
      {isMe && <span className={styles.srOnly}>{t('common.me')}</span>}
    </span>
  </>;
  return <div className={`${styles.seat} ${props.draggable ? styles.draggable : ''} ${props.moving ? styles.moving : ''} ${props.dropTarget ? styles.dropTarget : ''}`}
    style={props.position} data-room-drop={props.seatKey} onPointerDown={(event) => props.onPointerDown(event, player)}>
    <div className={`${styles.card} ${props.art ? styles.hasArt : ''}`} style={props.art}>
      {props.handle}
      {manageBot
        ? <button type="button" className={styles.identity} data-player-identity aria-haspopup="dialog"
          aria-expanded={Boolean(botAnchor)} aria-label={t('room.botControlsFor', { nickname: player.nickname })}
          disabled={!props.waiting} onClick={(event) => setBotAnchor(event.currentTarget)}>{identity}</button>
        : player.isBot ? <div className={styles.identity} data-player-identity>{identity}</div>
          : <Link className={styles.identity} data-player-identity to={`/players/${encodeURIComponent(player.id)}`}
            aria-label={t('room.profileOf', { nickname: player.nickname })}>{identity}</Link>}
      <span className={`${styles.status} ${ready && !player.isBot ? styles.readyText : ''}`}>{status}</span>
      {canKick && <button type="button" className={styles.kick} disabled={props.blocked}
        data-pending-disabled={props.pending || undefined} aria-label={`${t('room.kick')} ${player.nickname}`}
        title={t('room.kick')} onClick={() => props.onKick(player)}><AppIcon name="close" /></button>}
    </div>
    {manageBot && <BotMenu player={player} anchor={botAnchor} props={props} onClose={() => setBotAnchor(null)} />}
  </div>;
}

/** One seat on the waiting-room oval: an occupied card or a dashed "+" that offers sit or add bot. */
export function RoomSeat(props: RoomSeatProps): ReactNode {
  const player = props.info.player;
  return player ? <OccupiedSeat {...props} player={player} /> : <EmptySeat {...props} />;
}

/** The host's way to open another seat; it takes the next place on the oval. */
export function AddSeatSlot({ position, disabled, pending, onAdd }: {
  readonly position: CSSProperties;
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onAdd: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <div className={`${styles.seat} ${styles.empty}`} style={position}>
    <button type="button" className={styles.emptyButton} disabled={disabled} data-pending-disabled={pending || undefined}
      aria-label={t('room.addSeat')} title={t('room.addSeat')} onClick={onAdd}>
      <span className={styles.plus} aria-hidden="true"><AppIcon name="add" /></span>
      <span className={styles.emptyLabel}>{t('room.addSeat')}</span>
    </button>
  </div>;
}
