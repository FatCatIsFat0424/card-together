import { useMemo } from 'react';
import type { BoardTheme } from '../../games/board/board-theme';
import { useAccountStore } from '../../stores/account-store';
import { resolvePieceStyle } from '../piece-styles/piece-designs';
import { resolveBoardStyle } from './board-designs';
import { boardThemeFor } from './board-theme-for';

/** Boards and pieces follow the signed-in player's private styles; spectators and opponents never see them. */
export function useEquippedBoardTheme(): BoardTheme {
  const board = useAccountStore((state) => resolveBoardStyle(state.account?.boardStyle));
  const piece = useAccountStore((state) => resolvePieceStyle(state.account?.pieceStyle));
  return useMemo(() => boardThemeFor(board, piece), [board, piece]);
}
