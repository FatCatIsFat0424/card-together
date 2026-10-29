import { useState } from 'react';
import type { ReactNode } from 'react';
import { gameDefinition, gameTimeControl } from '@shared/games/registry';
import type { GameCategory } from '@shared/games/game-definition';
import type {
  GameOptionsPayload, GameType, RoomInfo, TimeControl,
} from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { gameUi } from '../games/ui-registry';
import { RoomGamePicker } from './RoomGamePicker';
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
  // The tab starts on the current game's category; the panel remounts on each open.
  const [pickedCategory, setPickedCategory] = useState<GameCategory | null>(null);
  const category = pickedCategory ?? gameDefinition(room.gameType).category;
  const GameRoomOptions = gameUi(room.gameType).roomOptions;
  const pendingFlag = pending && isHost && room.status === 'waiting';
  return <div className={styles.panel}>
    <RoomGamePicker gameType={room.gameType} category={category} onCategoryChange={setPickedCategory}
      onSelect={actions.setGameType} disabled={lock} pending={pendingFlag}
      title={isHost ? undefined : t('room.hostOnly')} />
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
