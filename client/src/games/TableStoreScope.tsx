import type { ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useRoomStore } from '../stores/room-store';
import { useTablePerspectiveStore } from '../stores/table-perspective-store';

type StateOf<T extends { getState: () => unknown }> = ReturnType<T['getState']>;

/** Every store a game table reads whose state must stay apart from the live room and game. */
export interface TableStores {
  readonly game: StoreApi<StateOf<typeof useGameStore>>;
  readonly room: StoreApi<StateOf<typeof useRoomStore>>;
  readonly godView: StoreApi<StateOf<typeof useGodViewStore>>;
  readonly perspective: StoreApi<StateOf<typeof useTablePerspectiveStore>>;
}

export function createTableStores(): TableStores {
  return {
    game: useGameStore.createScope(),
    room: useRoomStore.createScope(),
    godView: useGodViewStore.createScope(),
    perspective: useTablePerspectiveStore.createScope(),
  };
}

/** Tables inside render against `stores`; socket handlers keep updating the global stores. */
export function TableStoreScope({ stores, children }: {
  readonly stores: TableStores | null;
  readonly children: ReactNode;
}): ReactNode {
  return <useGameStore.Scope value={stores?.game ?? null}>
    <useRoomStore.Scope value={stores?.room ?? null}>
      <useGodViewStore.Scope value={stores?.godView ?? null}>
        <useTablePerspectiveStore.Scope value={stores?.perspective ?? null}>
          {children}
        </useTablePerspectiveStore.Scope>
      </useGodViewStore.Scope>
    </useRoomStore.Scope>
  </useGameStore.Scope>;
}
