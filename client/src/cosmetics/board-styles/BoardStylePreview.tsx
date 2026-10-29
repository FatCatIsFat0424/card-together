import type { ReactNode } from 'react';
import type { BoardStyleId } from '@shared/types';
import { squareBoard } from '@shared/rules/board/boards';
import { nodeId } from '@shared/rules/board/board-model';
import { BoardView } from '../../games/board/BoardView';
import { StonePiece, TokenPiece } from '../../games/board/BoardPieces';
import type { PreviewAccount } from '../preview-props';
import { boardThemeFor } from './board-theme-for';
import styles from './BoardStylePreview.module.css';

const LINES = squareBoard({ cols: 5, rows: 5, layout: 'points', decorations: [{ kind: 'star', x: 2, y: 2 }] });
const CELLS = squareBoard({ cols: 4, rows: 4, layout: 'cells' });

/** A line board (Xiangqi, Gomoku) and a felt cell board (Reversi) in the style, with default pieces. */
export function BoardStylePreview({ id }: { readonly id: BoardStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = boardThemeFor(id, null);
  return (
    <div className={styles.preview} aria-hidden="true" data-board-style={id}>
      <div className={styles.board}>
        <BoardView board={LINES} surface="wood" label="" theme={theme} pieces={[
          { node: nodeId(1, 1), key: 'r', piece: <TokenPiece tone="red" label="炮" /> },
          { node: nodeId(3, 3), key: 'b', piece: <TokenPiece tone="black" label="馬" /> },
        ]} />
      </div>
      <div className={styles.board}>
        <BoardView board={CELLS} surface="green" label="" theme={theme} pieces={[
          { node: nodeId(1, 1), key: 'd', piece: <StonePiece tone="dark" /> },
          { node: nodeId(2, 1), key: 'l', piece: <StonePiece tone="light" /> },
        ]} />
      </div>
    </div>
  );
}
