import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PlayerVisibleGameState, GameSeat } from '@shared/types';
import { useGameStore } from '../stores/game-store';
import { useGodViewStore } from '../stores/god-view-store';
import { useRoomStore } from '../stores/room-store';
import { useTablePerspectiveStore } from '../stores/table-perspective-store';
import { perspectiveSeat, spectatorGame } from './table-perspective';

export function useTablePerspective(): GameSeat {
  const game = useGameStore((state) => state.visible);
  const own = useRoomStore((state) => state.mySeat);
  const selected = useTablePerspectiveStore((state) => state.seat);
  const chosen = useTablePerspectiveStore((state) => state.chosen);
  return perspectiveSeat(game, selected, own, chosen);
}

export function useViewedGame<T extends PlayerVisibleGameState>(game: T | null): T | null {
  const seat = useTablePerspective();
  const view = useGodViewStore(useShallow((state) => ({
    role: state.role, hands: state.hands, covered: state.covered, liarHands: state.liarHands, diceHands: state.diceHands,
    napoleonHands: state.napoleonHands, oldMaidHands: state.oldMaidHands, hole: state.hole,
  })));
  return useMemo(() => game ? spectatorGame(game, seat, view) : null, [game, seat, view]);
}
