import { useEffect } from 'react';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import { setVoiceSilenced } from '../stores/voice-store';

/**
 * Observers know every hand, so a seat still playing a match stops hearing them until it
 * ends. Their voice is muted on the listener's side because WebRTC audio is peer to peer.
 */
export function useVoiceSilencing(): void {
  const playerId = usePlayerStore((state) => state.playerId);
  // A joined key keeps the selector result stable between equal snapshots.
  const silenced = useRoomStore((state) => {
    const room = state.roomInfo;
    const observers = room?.observerIds ?? [];
    const playing = room?.status === 'playing' && state.mySeat !== null
      && playerId !== null && !observers.includes(playerId);
    return playing ? observers.join('\n') : '';
  });
  useEffect(() => {
    setVoiceSilenced(silenced ? silenced.split('\n') : []);
  }, [silenced]);
}
