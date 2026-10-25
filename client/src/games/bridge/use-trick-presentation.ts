import { useCallback, useState, useSyncExternalStore } from 'react';
import { useGameStore } from '../../stores/game-store';
import { useRoomStore } from '../../stores/room-store';
import { createTrickPresentation } from './trick-presentation';
import type { TrickPresentation, TrickSnapshot } from './trick-presentation';

type GameStoreApi = ReturnType<typeof useGameStore.useApi>;
type RoomStoreApi = ReturnType<typeof useRoomStore.useApi>;

function currentSnapshot(gameStore: GameStoreApi, roomStore: RoomStoreApi): TrickSnapshot {
  const { phase, playing } = gameStore.getState();
  return { roomCode: roomStore.getState().currentRoomCode, phase, playing };
}

/** Subscribe before React batches successive trick and scoring snapshots. */
export function useTrickPresentation(): TrickPresentation | null {
  const gameStore = useGameStore.useApi();
  const roomStore = useRoomStore.useApi();
  const [presentation] = useState(() => createTrickPresentation(currentSnapshot(gameStore, roomStore)));
  const subscribe = useCallback(
    (listener: () => void): (() => void) => {
      const unsubscribe = presentation.subscribe(listener);
      const update = (): void => presentation.update(currentSnapshot(gameStore, roomStore));
      const unsubscribeGame = gameStore.subscribe(update);
      const unsubscribeRoom = roomStore.subscribe(update);
      update();
      return () => {
        unsubscribe();
        unsubscribeGame();
        unsubscribeRoom();
        presentation.dispose();
      };
    },
    [presentation, gameStore, roomStore],
  );
  return useSyncExternalStore(subscribe, presentation.getSnapshot);
}
