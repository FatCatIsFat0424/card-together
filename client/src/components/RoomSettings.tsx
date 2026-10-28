import type { ReactNode } from 'react';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import { GAME_TYPES } from '@shared/constants';
import { gameTimeControl } from '@shared/games/registry';
import type {
  GameOptionsPayload, GameType, RoomInfo, TimeControl,
} from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { gameUi } from '../games/ui-registry';
import { RoomOption } from './RoomOption';
import { TimeControlSettings } from './TimeControlSettings';
import styles from './RoomSettings.module.css';

export interface RoomSettingsActions {
  readonly setGameType: (gameType: GameType) => void;
  readonly setTimeControl: (settings: TimeControl) => void;
  readonly setShuffleSeats: (enabled: boolean) => void;
  readonly setGameOptions: (payload: GameOptionsPayload) => void;
}

interface RoomSettingsProps extends RoomSettingsActions {
  readonly room: RoomInfo;
  /** Only the host edits, and only while the room waits and the connection is idle. */
  readonly editable: boolean;
  readonly isHost: boolean;
  /** A request is in flight: keep the enabled look while input is locked. */
  readonly pending: boolean;
}

/** Everything the host can configure for the room: game, turn timer, seat shuffling and the game's own options. */
export function RoomSettings({ room, editable, isHost, pending, ...actions }: RoomSettingsProps): ReactNode {
  const { t } = useI18nStore();
  const lock = !editable;
  const GameRoomOptions = gameUi(room.gameType).roomOptions;
  const pendingFlag = pending && isHost && room.status === 'waiting' || undefined;
  return <div className={styles.panel}>
    <label className={styles.field}>
      <span className={styles.label}>{t('gameType.label')}</span>
      <Select size="small" className={styles.select} value={room.gameType} disabled={lock}
        data-pending-disabled={pendingFlag}
        title={isHost ? undefined : t('room.hostOnly')}
        inputProps={{ 'aria-label': t('gameType.label') }}
        MenuProps={{ slotProps: { paper: { className: styles.menu } } }}
        onChange={(event) => {
          const selected = GAME_TYPES.find((gameType) => gameType === event.target.value);
          if (selected) actions.setGameType(selected);
        }}>
        {GAME_TYPES.map((gameType) => <MenuItem key={gameType} value={gameType}>{t(`gameType.${gameType}`)}</MenuItem>)}
      </Select>
    </label>
    <TimeControlSettings
      key={`${room.code}:${room.hostId}:${room.timeControl?.baseSeconds}:${room.timeControl?.bankSeconds}`}
      value={room.timeControl ?? gameTimeControl(room.gameType)} disabled={lock} onSave={actions.setTimeControl} />
    <RoomOption id="room-shuffle-hint" label={t('room.shuffleSeats')} hint={t('room.shuffleSeats')}
      checked={room.shuffleSeats ?? false} disabled={lock} onChange={actions.setShuffleSeats} />
    {GameRoomOptions && <GameRoomOptions gameOptions={room.gameOptions} disabled={lock}
      setGameOptions={actions.setGameOptions} />}
    {!isHost && <p className={styles.note}>{t('room.hostOnly')}</p>}
  </div>;
}
