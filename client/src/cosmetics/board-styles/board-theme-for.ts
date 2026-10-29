import type { BoardStyleId, PieceStyleId } from '@shared/types';
import { DEFAULT_BOARD_THEME, DEFAULT_PIECE_FINISH } from '../../games/board/board-theme';
import type { BoardTheme } from '../../games/board/board-theme';
import { PIECE_DESIGNS, piecePalette } from '../piece-styles/piece-designs';
import { BOARD_DESIGNS } from './board-designs';

/** The board look for one viewer: board and piece styles combine freely; markers never change. */
export function boardThemeFor(board: BoardStyleId | null, piece: PieceStyleId | null): BoardTheme {
  if (!board && !piece) return DEFAULT_BOARD_THEME;
  return {
    surfaces: board ? BOARD_DESIGNS[board].surfaces : DEFAULT_BOARD_THEME.surfaces,
    pieces: piecePalette(piece),
    markers: DEFAULT_BOARD_THEME.markers,
    finish: piece ? PIECE_DESIGNS[piece].finish : DEFAULT_PIECE_FINISH,
    motion: board ? BOARD_DESIGNS[board].motion : null,
    effects: piece ? PIECE_DESIGNS[piece].effects : null,
  };
}
