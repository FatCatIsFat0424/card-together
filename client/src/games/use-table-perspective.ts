import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PlayerVisibleGameState, Seat } from '@shared/types';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useRoomStore } from '../stores/room-store';
import { useTablePerspectiveStore } from '../stores/table-perspective-store';
import { perspectiveSeat, spectatorGame } from './table-perspective';

export function useTablePerspective(): Seat {
  const game = useGameStore((state) => state.visible);
  const own = useRoomStore((state) => state.mySeat);
  const selected = useTablePerspectiveStore((state) => state.seat);
  return perspectiveSeat(game, selected, own);
}

export function useViewedGame<T extends PlayerVisibleGameState>(game: T | null): T | null {
  const seat = useTablePerspective();
  const view = useGodViewStore(useShallow((state) => ({
    role: state.role, hands: state.hands, covered: state.covered, liarHands: state.liarHands, hole: state.hole,
  })));
  return useMemo(() => game ? spectatorGame(game, seat, view) : null, [game, seat, view]);
}
