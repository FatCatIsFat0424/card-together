import type { ReactNode } from 'react';
import type { PieceStyleId } from '@shared/types';
import { boardThemeStyle } from '../../games/board/board-theme';
import { MarblePiece, PieceFinishContext, StonePiece, TilePiece, TokenPiece } from '../../games/board/BoardPieces';
import { boardThemeFor } from '../board-styles/board-theme-for';
import type { PreviewAccount } from '../preview-props';
import { PIECE_DESIGNS } from './piece-designs';
import styles from './PieceStylePreview.module.css';

/** Xiangqi's two sides, a Jungle animal, a Land Battle Chess tile, both stones, and a marble on the default board. */
export function PieceStylePreview({ id }: { readonly id: PieceStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = boardThemeFor(null, id);
  return (
    <svg className={styles.preview} viewBox="-0.55 -0.55 4.1 2.1" style={boardThemeStyle(theme, 'wood')}
      aria-hidden="true" focusable="false" data-piece-style={id}>
      <rect className={styles.surface} x={-0.55} y={-0.55} width={4.1} height={2.1} rx={0.2} />
      <PieceFinishContext.Provider value={PIECE_DESIGNS[id].finish}>
        <g transform="translate(0 0)"><TokenPiece tone="red" label="帥" /></g>
        <g transform="translate(1 0)"><TokenPiece tone="black" label="將" /></g>
        <g transform="translate(2 0)"><TokenPiece tone="blue" variant="solid" label="象" badge="8" /></g>
        <g transform="translate(3 0) scale(0.55)"><TilePiece tone="red" label="司令" /></g>
        <g transform="translate(0.5 1)"><StonePiece tone="dark" /></g>
        <g transform="translate(1.5 1)"><StonePiece tone="light" /></g>
        <g transform="translate(2.5 1)"><MarblePiece corner={0} /></g>
        <g transform="translate(3.2 1)"><MarblePiece corner={3} radius={0.3} /></g>
      </PieceFinishContext.Provider>
    </svg>
  );
}
