import type { ReactNode } from 'react';
import { MAX_SPECTATORS } from '@shared/constants';
import type { PlayerInfo } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { PlayerLink } from './PlayerLink';
import styles from './RoomSpectators.module.css';

export interface RoomSpectatorsProps {
  readonly spectators: readonly PlayerInfo[];
  readonly hostId: string;
  readonly playerId: string | null;
  /** The viewer holds a seat and can step aside to watch. */
  readonly seated: boolean;
  readonly canSpectate: boolean;
  /** The connected host of a waiting room may move players. */
  readonly canManage: boolean;
  readonly isHost: boolean;
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly onStandUp: () => void;
  readonly onKick: (player: PlayerInfo) => void;
  readonly onMove: (player: PlayerInfo) => void;
  /** `dock` fills a side panel; the default is the 280px popover. */
  readonly layout?: 'popover' | 'dock';
}

/** The spectator list opened from "旁觀 n/8": join as spectator, and the host's kick and move controls. */
export function RoomSpectators(props: RoomSpectatorsProps): ReactNode {
  const { t } = useI18nStore();
  return <section className={`${styles.panel} ${props.layout === 'dock' ? styles.dock : ''}`}>
    <h2 id="room-spectators-label" className={styles.title}>
      {t('room.spectators', { n: String(props.spectators.length), max: String(MAX_SPECTATORS) })}</h2>
    {props.seated && <Button variant="ghost" disabled={!props.canSpectate}
      data-pending-disabled={props.pending || undefined} onClick={props.onStandUp}>{t('room.enterSpectators')}</Button>}
    {props.spectators.length === 0 ? <p className={styles.note}>{t('room.spectatorsNone')}</p>
      : <ul className={styles.list}>{props.spectators.map((spectator) => (
        <li key={spectator.id} className={styles.row}>
          <PlayerLink player={spectator} size="compact" showTitle={false} details={<>
            {spectator.id === props.hostId && <span className={styles.hostTag}>{t('room.host')}</span>}
            {spectator.id === props.playerId && <span>{t('common.me')}</span>}
          </>} />
          {props.canManage && !spectator.isBot && <IconButton icon="drag"
            label={t('room.movePlayer', { nickname: spectator.nickname })} disabled={props.blocked}
            onClick={() => props.onMove(spectator)} />}
          {props.isHost && spectator.id !== props.playerId && <Button variant="danger-text" size="small"
            disabled={props.blocked} data-pending-disabled={props.pending || undefined}
            onClick={() => props.onKick(spectator)}>{t('room.kick')}</Button>}
        </li>
      ))}</ul>}
  </section>;
}
