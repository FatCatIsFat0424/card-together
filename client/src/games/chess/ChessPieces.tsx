// ─── Chess piece silhouettes: drawn around (0, 0) in board units, coloured from the piece style palette ───

import { useContext } from 'react';
import type { ReactNode } from 'react';
import { chessKindOf, chessSideOf } from '@shared/rules/chess';
import type { ChessKind, ChessPiece } from '@shared/rules/chess';
import { PIECE_RADIUS, PieceFinishContext } from '../board/BoardPieces';
import styles from './ChessPieces.module.css';

/** The silhouette is designed for the default radius; other radii scale it. */
const DESIGN_RADIUS = PIECE_RADIUS;

interface Silhouette {
  /** Filled outline; every subpath runs clockwise, so overlapping parts merge instead of cancelling. */
  readonly body: string;
  /** Strokes in the opposite colour: the knight's eye, the bishop's cut. */
  readonly detail: string;
  /** A short highlight stroke that piece styles with gloss draw along the left of the body. */
  readonly gloss: string;
}

const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0Z`;

/** Two stacked plinth bars shared by every piece. */
const PLINTH = 'M-0.28 0.31H0.28V0.39H-0.28ZM-0.22 0.25H0.22V0.31H-0.22Z';

const SILHOUETTES: Readonly<Record<ChessKind, Silhouette>> = {
  p: {
    body: `${circle(0, -0.2, 0.12)}M-0.14 -0.09H0.14V-0.04H-0.14ZM-0.08 -0.05H0.08L0.19 0.25H-0.19Z${PLINTH}`,
    detail: '',
    gloss: 'M-0.05 -0.01L-0.11 0.2',
  },
  r: {
    body: `M-0.2 -0.36H-0.12V-0.3H-0.04V-0.36H0.04V-0.3H0.12V-0.36H0.2V-0.22H-0.2ZM-0.16 -0.23H0.16V-0.17H-0.16ZM-0.12 -0.18H0.12L0.17 0.25H-0.17Z${PLINTH}`,
    detail: '',
    gloss: 'M-0.07 -0.12L-0.1 0.2',
  },
  b: {
    body: `${circle(0, -0.34, 0.045)}M0 -0.3C0.14 -0.2 0.17 -0.07 0.1 0.02H-0.1C-0.17 -0.07 -0.14 -0.2 0 -0.3ZM-0.15 0.02H0.15V0.08H-0.15ZM-0.08 0.07H0.08L0.17 0.25H-0.17Z${PLINTH}`,
    detail: 'M0.01 -0.2L0.07 -0.1',
    gloss: 'M-0.07 -0.14L-0.1 -0.04',
  },
  n: {
    body: `M0.2 0.25H-0.2C-0.2 0.08 -0.1 0 -0.02 -0.08C-0.08 -0.1 -0.14 -0.06 -0.22 0L-0.3 -0.04C-0.28 -0.14 -0.18 -0.26 -0.12 -0.3L-0.1 -0.38L-0.03 -0.32C0.13 -0.3 0.24 -0.12 0.2 0.25Z${PLINTH}`,
    detail: `${circle(-0.11, -0.2, 0.012)}`,
    gloss: 'M-0.05 -0.2L-0.14 0.12',
  },
  q: {
    body: `${circle(-0.2, -0.3, 0.04)}${circle(0, -0.34, 0.04)}${circle(0.2, -0.3, 0.04)}M-0.22 -0.17L-0.2 -0.28L-0.1 -0.19L0 -0.32L0.1 -0.19L0.2 -0.28L0.22 -0.17ZM-0.2 -0.18H0.2L0.15 -0.03H-0.15ZM-0.17 -0.04H0.17V0.02H-0.17ZM-0.09 0.01H0.09L0.19 0.25H-0.19Z${PLINTH}`,
    detail: '',
    gloss: 'M-0.06 0.04L-0.12 0.2',
  },
  k: {
    body: `M-0.03 -0.4H0.03V-0.35H0.08V-0.3H0.03V-0.25H-0.03V-0.3H-0.08V-0.35H-0.03ZM-0.17 -0.12C-0.17 -0.24 -0.08 -0.25 0 -0.23C0.08 -0.25 0.17 -0.24 0.17 -0.12ZM-0.19 -0.13H0.19V-0.06H-0.19ZM-0.1 -0.07H0.1L0.2 0.25H-0.2Z${PLINTH}`,
    detail: '',
    gloss: 'M-0.07 -0.02L-0.12 0.2',
  },
};

/**
 * One chess piece. White is the piece style's light stone outlined in its dark one, black the reverse, so both
 * stay legible on light and dark squares; the style's rim and gloss finish carry over to the outline.
 */
export function ChessPieceShape({ piece, radius = PIECE_RADIUS }: {
  readonly piece: ChessPiece; readonly radius?: number;
}): ReactNode {
  const finish = useContext(PieceFinishContext);
  const shape = SILHOUETTES[chessKindOf(piece)];
  const scale = radius / DESIGN_RADIUS;
  return <g className={chessSideOf(piece) === 0 ? styles.white : styles.black} transform={`scale(${scale})`}>
    <ellipse className={styles.shadow} cx={0.03} cy={0.38} rx={0.3} ry={0.05} />
    <path className={styles.outline} d={shape.body} />
    <path className={styles.fill} d={shape.body} />
    {finish.rim === 'double' && <path className={styles.innerRing} d={shape.body} transform="scale(0.86)" />}
    {(finish.rim === 'beaded' || finish.rim === 'notched') && <path className={styles.rimMarks} d={shape.body}
      strokeDasharray={finish.rim === 'beaded' ? '0.01 0.05' : '0.07 0.05'} strokeLinecap={finish.rim === 'beaded' ? 'round' : 'butt'} />}
    {shape.detail && <path className={styles.detail} d={shape.detail} />}
    {finish.gloss > 0 && <path className={styles.gloss} d={shape.gloss} opacity={finish.gloss} />}
  </g>;
}

/** A piece in the fixed default colours, small enough for captured-piece rows and the promotion picker. */
export function ChessPieceIcon({ piece, className }: { readonly piece: ChessPiece; readonly className?: string }): ReactNode {
  return <svg className={`${styles.icon} ${className ?? ''}`} viewBox="-0.36 -0.44 0.72 0.88" aria-hidden="true" focusable="false">
    <ChessPieceShape piece={piece} />
  </svg>;
}
