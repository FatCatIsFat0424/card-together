import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlayerInfo } from '@shared/types';
import { RoomSpectators } from '../components/RoomSpectators';
import { DockCount } from '../components/Dock';
import { LazyPlayerCard } from '../components/LazyPlayerCard';
import { useI18nStore } from '../stores/i18n-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';

/**
 * Who is watching the running match. Read-only: seats are fixed during a match, so there is
 * no stand-up, kick, or drag-to-seat here, and the host's room controls stay in the waiting room.
 * A name opens the player card over the table, so nobody leaves the match to look someone up.
 */
export function GameSpectators({ layout }: { readonly layout: 'dock' | 'sheet' }): ReactNode {
  const room = useRoomStore((state) => state.roomInfo);
  const playerId = usePlayerStore((state) => state.playerId);
  const [open, setOpen] = useState<{ readonly id: string; readonly anchor: HTMLElement } | null>(null);
  if (!room) return null;
  const spectators = room.spectators ?? [];
  // A spectator who leaves takes the anchor with them; the card closes rather than jump to a corner.
  const opened = open && spectators.find((spectator) => spectator.id === open.id);
  return <>
    <RoomSpectators layout={layout} spectators={spectators} hostId={room.hostId} playerId={playerId}
      seated={false} canSpectate={false} canManage={false} isHost={false} blocked pending={false}
      onStandUp={noop} onKick={noop}
      onOpenPlayer={(player: PlayerInfo, anchor) => setOpen({ id: player.id, anchor })} />
    {open && opened && <Suspense fallback={null}>
      <LazyPlayerCard player={opened} gameType={room.gameType} anchor={open.anchor} onClose={() => setOpen(null)} />
    </Suspense>}
  </>;
}

/** The side panel tab: the name and a live count of the spectators in the room. */
export function SpectatorsTabLabel(): ReactNode {
  const { t } = useI18nStore();
  const count = useRoomStore((state) => state.roomInfo?.spectators?.length ?? 0);
  return <>{t('room.spectatorsTab')}<DockCount>{count}</DockCount></>;
}

function noop(): void {}
