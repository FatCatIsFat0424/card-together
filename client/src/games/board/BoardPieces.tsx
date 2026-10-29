// ─── Piece primitives: drawn around (0, 0) in board units; the board view places them ───

import { createContext, useContext } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_PIECE_FINISH } from './board-theme';
import type { PieceFinish } from './board-theme';
import styles from './BoardPieces.module.css';

/** The viewer's piece style finish; `BoardView` provides it, so every game's pieces pick it up. */
export const PieceFinishContext = createContext<PieceFinish>(DEFAULT_PIECE_FINISH);

/** Rim decoration of a round piece of `radius`; plain rims draw nothing. */
function RimFinish({ radius, finish }: { readonly radius: number; readonly finish: PieceFinish }): ReactNode {
  if (finish.rim === 'double') return <circle className={styles.innerRing} r={radius * 0.91} strokeWidth={radius * 0.035} />;
  if (finish.rim === 'plain') return null;
  const circumference = 2 * Math.PI * radius;
  const marks = finish.rim === 'beaded' ? 16 : 12;
  const mark = finish.rim === 'beaded' ? radius * 0.04 : radius * 0.16;
  return <circle className={styles.rimMarks} r={radius} strokeWidth={radius * (finish.rim === 'beaded' ? 0.07 : 0.06)}
    strokeLinecap={finish.rim === 'beaded' ? 'round' : 'butt'}
    strokeDasharray={`${mark} ${circumference / marks - mark}`} />;
}

/** Highlight in the upper left, drawn under the lettering so it never dims it. */
function Gloss({ radius, finish }: { readonly radius: number; readonly finish: PieceFinish }): ReactNode {
  return finish.gloss > 0
    ? <ellipse className={styles.gloss} cx={-radius * 0.3} cy={-radius * 0.42} rx={radius * 0.42} ry={radius * 0.2}
      transform={`rotate(-28 ${-radius * 0.3} ${-radius * 0.42})`} opacity={finish.gloss} />
    : null;
}

export type TokenTone = 'red' | 'black' | 'blue';

const TONE: Record<TokenTone, string> = { red: styles.red, black: styles.black, blue: styles.blue };

/** Default piece radius for boards whose neighbouring nodes are one unit apart. */
export const PIECE_RADIUS = 0.42;
/** Land Battle Chess tile size in board units. */
export const TILE_SIZE = { width: 1.72, height: 0.76 } as const;

/** Reversi disc or Gomoku stone. */
export function StonePiece({ tone, radius = PIECE_RADIUS }: {
  readonly tone: 'dark' | 'light'; readonly radius?: number;
}): ReactNode {
  return <g className={tone === 'dark' ? styles.darkStone : styles.lightStone}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} />
    <circle className={styles.shine} cx={-radius * 0.28} cy={-radius * 0.3} r={radius * 0.36} />
  </g>;
}

/**
 * Round token with a name: `engraved` is an ivory face with a coloured ring and text (Xiangqi, revealed Banqi
 * pieces); `solid` is filled with the side colour (Jungle). `badge` adds a small corner number such as a rank.
 */
export function TokenPiece({ tone, label, variant = 'engraved', badge, radius = PIECE_RADIUS }: {
  readonly tone: TokenTone; readonly label: string; readonly variant?: 'engraved' | 'solid'; readonly badge?: string;
  readonly radius?: number;
}): ReactNode {
  const finish = useContext(PieceFinishContext);
  return <g className={`${variant === 'solid' ? styles.solid : styles.engraved} ${TONE[tone]}`}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} strokeWidth={radius * 0.1} />
    <RimFinish radius={radius} finish={finish} />
    <Gloss radius={radius} finish={finish} />
    {variant === 'engraved' && <circle className={styles.ring} r={radius * 0.8} strokeWidth={radius * 0.06} />}
    <text className={styles.label} fontSize={radius * (label.length > 1 ? 0.8 : 1.2)} dominantBaseline="central"
      textAnchor="middle">{label}</text>
    {badge && <g transform={`translate(${radius * 0.72} ${radius * 0.72})`}>
      <circle className={styles.badge} r={radius * 0.4} />
      <text className={styles.badgeText} fontSize={radius * 0.55} dominantBaseline="central" textAnchor="middle">{badge}</text>
    </g>}
  </g>;
}

/** Face-down round token (Banqi); every covered piece looks the same under every piece style. */
export function CoveredToken({ radius = PIECE_RADIUS }: { readonly radius?: number }): ReactNode {
  return <g className={styles.covered}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} strokeWidth={radius * 0.08} />
    <circle className={styles.pattern} r={radius * 0.55} strokeWidth={radius * 0.12} />
  </g>;
}

/**
 * Land Battle Chess tile; without a label it shows the back in a darker shade of the side colour, so hidden
 * identities all look alike while the owner stays visible.
 */
export function TilePiece({ tone, label }: { readonly tone: TokenTone; readonly label?: string }): ReactNode {
  return label === undefined ? <HiddenTile tone={tone} /> : <ShownTile tone={tone} label={label} />;
}

/** The back of a tile uses fixed side colours and no style finish, so it looks the same to everyone. */
function HiddenTile({ tone }: { readonly tone: TokenTone }): ReactNode {
  return <TileShape className={`${styles.tile} ${styles.hidden} ${TONE[tone]}`} />;
}

function ShownTile({ tone, label }: { readonly tone: TokenTone; readonly label: string }): ReactNode {
  const finish = useContext(PieceFinishContext);
  const { width, height } = TILE_SIZE;
  return <TileShape className={`${styles.tile} ${TONE[tone]}`} label={label}>
    {finish.rim !== 'plain' && <rect className={styles.innerRing} x={-width / 2 + 0.08} y={-height / 2 + 0.08}
      width={width - 0.16} height={height - 0.16} rx={0.06} strokeWidth={0.025}
      strokeDasharray={finish.rim === 'double' ? undefined : finish.rim === 'beaded' ? '0.02 0.07' : '0.12 0.06'}
      strokeLinecap="round" />}
  </TileShape>;
}

function TileShape({ className, label, children }: {
  readonly className: string; readonly label?: string; readonly children?: ReactNode;
}): ReactNode {
  const { width, height } = TILE_SIZE;
  return <g className={className}>
    <rect className={styles.shadow} x={-width / 2 + 0.04} y={-height / 2 + 0.06} width={width} height={height} rx={0.1} />
    <rect className={styles.body} x={-width / 2} y={-height / 2} width={width} height={height} rx={0.1} strokeWidth={0.05} />
    {children}
    {label === undefined
      ? <path className={styles.pattern} d={`M${-width * 0.32} ${height * 0.22}L0 ${-height * 0.22}L${width * 0.32} ${height * 0.22}`}
        strokeWidth={0.07} fill="none" />
      : <text className={styles.label} fontSize={height * 0.62} dominantBaseline="central" textAnchor="middle">{label}</text>}
  </g>;
}

/** Chinese checkers marble in the colour of star corner `corner`. */
export function MarblePiece({ corner, radius = PIECE_RADIUS }: { readonly corner: number; readonly radius?: number }): ReactNode {
  return <g className={styles.marble} style={{ '--marble': `var(--piece-marble-${corner})` } as CSSProperties}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} strokeWidth={radius * 0.12} />
    <circle className={styles.shine} cx={-radius * 0.3} cy={-radius * 0.35} r={radius * 0.34} />
  </g>;
}
