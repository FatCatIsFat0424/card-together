import type { ReactNode } from 'react';
import { RoomSpectators } from '../components/RoomSpectators';
import { DockCount } from '../components/Dock';
import { useI18nStore } from '../stores/i18n-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';

/**
 * Who is watching the running match. Read-only: seats are fixed during a match, so there is
 * no stand-up, kick, or drag-to-seat here, and the host's room controls stay in the waiting room.
 */
export function GameSpectators({ layout }: { readonly layout: 'dock' | 'sheet' }): ReactNode {
  const room = useRoomStore((state) => state.roomInfo);
  const playerId = usePlayerStore((state) => state.playerId);
  if (!room) return null;
  return <RoomSpectators layout={layout} spectators={room.spectators ?? []} hostId={room.hostId} playerId={playerId}
    seated={false} canSpectate={false} canManage={false} isHost={false} blocked pending={false}
    onStandUp={noop} onKick={noop} />;
}

/** The side panel tab: the name and a live count of the spectators in the room. */
export function SpectatorsTabLabel(): ReactNode {
  const { t } = useI18nStore();
  const count = useRoomStore((state) => state.roomInfo?.spectators?.length ?? 0);
  return <>{t('room.spectatorsTab')}<DockCount>{count}</DockCount></>;
}

function noop(): void {}
