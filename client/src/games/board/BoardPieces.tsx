// ─── Piece primitives: drawn around (0, 0) in board units; the board view places them ───

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_PIECE_FINISH } from './board-theme';
import type { PieceBackMotif, PieceFinish } from './board-theme';
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

/** Rim of a stone or disc: a faint inner ring, or beads around the edge, in the piece style's accent. */
function StoneRim({ radius, finish }: { readonly radius: number; readonly finish: PieceFinish }): ReactNode {
  if (finish.rim === 'double') return <circle className={styles.stoneRing} r={radius * 0.86} strokeWidth={radius * 0.045} />;
  if (finish.rim === 'plain') return null;
  return <circle className={styles.stoneBeads} r={radius * 0.97} strokeWidth={radius * 0.057}
    strokeDasharray={finish.rim === 'beaded' ? `${radius * 0.07} ${radius * 0.25}` : `${radius * 0.2} ${radius * 0.18}`}
    strokeLinecap={finish.rim === 'beaded' ? 'round' : 'butt'} />;
}

/** A crisp specular point whose strength follows the material; plain pieces keep only the soft shine. */
function StoneGlint({ radius, finish }: { readonly radius: number; readonly finish: PieceFinish }): ReactNode {
  return finish.gloss > 0
    ? <circle className={styles.gloss} cx={-radius * 0.36} cy={-radius * 0.4} r={radius * 0.11} opacity={finish.gloss} />
    : null;
}

/** Gomoku stone. */
export function StonePiece({ tone, radius = PIECE_RADIUS }: {
  readonly tone: 'dark' | 'light'; readonly radius?: number;
}): ReactNode {
  const finish = useContext(PieceFinishContext);
  return <g className={tone === 'dark' ? styles.darkStone : styles.lightStone}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} />
    <StoneRim radius={radius} finish={finish} />
    <circle className={styles.shine} cx={-radius * 0.28} cy={-radius * 0.3} r={radius * 0.36} />
    <StoneGlint radius={radius} finish={finish} />
  </g>;
}

/** Reversi disc: its own colour on top over a thin rim of the other side, so it reads as a two-sided disc. */
export function DiscPiece({ tone, radius = PIECE_RADIUS }: {
  readonly tone: 'dark' | 'light'; readonly radius?: number;
}): ReactNode {
  const finish = useContext(PieceFinishContext);
  return <g className={`${styles.disc} ${tone === 'dark' ? styles.darkStone : styles.lightStone}`}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.under} r={radius} />
    <circle className={styles.body} cy={-radius * 0.07} r={radius * 0.92} />
    <StoneRim radius={radius * 0.92} finish={finish} />
    <circle className={styles.shine} cx={-radius * 0.28} cy={-radius * 0.36} r={radius * 0.32} />
    <StoneGlint radius={radius} finish={finish} />
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

const polygon = (points: number, radius: number, inner?: number, turn = -Math.PI / 2): string => Array.from(
  { length: inner === undefined ? points : points * 2 },
  (_, index) => {
    const step = inner === undefined ? (Math.PI * 2) / points : Math.PI / points;
    const length = inner !== undefined && index % 2 === 1 ? inner : radius;
    return `${Math.cos(turn + step * index) * length},${Math.sin(turn + step * index) * length}`;
  },
).join(' ');

/** The piece style's motif on a face-down back, within `radius`; it depends on nothing but the style. */
function BackMotif({ motif, radius }: { readonly motif: PieceBackMotif; readonly radius: number }): ReactNode {
  const r = radius;
  switch (motif) {
    case 'ring': return <circle className={styles.pattern} r={r * 0.55} strokeWidth={r * 0.12} />;
    case 'wave': return <path className={styles.pattern} strokeWidth={r * 0.09} strokeLinecap="round"
      d={[-0.2, 0.16].map((y) => `M${-r * 0.5} ${r * y}q${r * 0.125} ${-r * 0.18} ${r * 0.25} 0t${r * 0.25} 0t${r * 0.25} 0t${r * 0.25} 0`).join('')} />;
    case 'petal': return <g>
      {[0, 72, 144, 216, 288].map((angle) => <ellipse key={angle} className={styles.patternFill} cy={-r * 0.28} rx={r * 0.14}
        ry={r * 0.25} transform={`rotate(${angle})`} />)}
      <circle className={styles.patternRim} r={r * 0.09} />
    </g>;
    case 'star': return <polygon className={styles.patternFill} points={polygon(5, r * 0.55, r * 0.23)} />;
    case 'lattice': return <g>
      <rect className={styles.pattern} x={-r * 0.4} y={-r * 0.4} width={r * 0.8} height={r * 0.8} strokeWidth={r * 0.08}
        transform="rotate(45)" />
      <path className={styles.pattern} strokeWidth={r * 0.07} d={`M${-r * 0.28} 0H${r * 0.28}M0 ${-r * 0.28}V${r * 0.28}`} />
    </g>;
    case 'diamond': return <g>
      <polygon className={styles.pattern} points={polygon(4, r * 0.58)} strokeWidth={r * 0.09} />
      <polygon className={styles.patternFill} points={polygon(4, r * 0.24)} />
    </g>;
    case 'sun': return <g>
      <circle className={styles.patternFill} r={r * 0.22} />
      <path className={styles.pattern} strokeWidth={r * 0.08} strokeLinecap="round"
        d={Array.from({ length: 8 }, (_, index) => {
          const angle = (Math.PI / 4) * index;
          return `M${Math.cos(angle) * r * 0.33} ${Math.sin(angle) * r * 0.33}L${Math.cos(angle) * r * 0.55} ${Math.sin(angle) * r * 0.55}`;
        }).join('')} />
    </g>;
    case 'hex': return <g>
      <polygon className={styles.pattern} points={polygon(6, r * 0.55, undefined, 0)} strokeWidth={r * 0.08} />
      <polygon className={styles.patternFill} points={polygon(6, r * 0.24, undefined, 0)} />
    </g>;
    case 'neon': return <g>
      <circle className={styles.patternRimStroke} r={r * 0.6} strokeWidth={r * 0.07} />
      <circle className={styles.pattern} r={r * 0.4} strokeWidth={r * 0.07} />
    </g>;
  }
}

/**
 * Face-down round token (Banqi) in the viewer's own piece style. It takes no identity: the server never sends
 * one, so every covered piece in a view is drawn identically.
 */
export function CoveredToken({ radius = PIECE_RADIUS }: { readonly radius?: number }): ReactNode {
  const finish = useContext(PieceFinishContext);
  return <g className={styles.covered}>
    <circle className={styles.shadow} cx={radius * 0.06} cy={radius * 0.1} r={radius} />
    <circle className={styles.body} r={radius} strokeWidth={radius * 0.08} />
    <BackMotif motif={finish.back} radius={radius} />
  </g>;
}

/**
 * Land Battle Chess tile; without a label it shows the back in a darker shade of the side colour, so hidden
 * identities all look alike while the owner stays visible.
 */
export function TilePiece({ tone, label }: { readonly tone: TokenTone; readonly label?: string }): ReactNode {
  return label === undefined ? <HiddenTile tone={tone} /> : <ShownTile tone={tone} label={label} />;
}

/** The back of a tile: the viewer's piece style and the owner's side colour, nothing about the identity. */
function HiddenTile({ tone }: { readonly tone: TokenTone }): ReactNode {
  const finish = useContext(PieceFinishContext);
  return <TileShape className={`${styles.tile} ${styles.hidden} ${TONE[tone]}`}>
    {finish.back !== 'ring' && <BackMotif motif={finish.back} radius={TILE_SIZE.height * 0.62} />}
  </TileShape>;
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
      ? !children && <path className={styles.pattern} strokeWidth={0.07} fill="none"
        d={`M${-width * 0.32} ${height * 0.22}L0 ${-height * 0.22}L${width * 0.32} ${height * 0.22}`} />
      : <text className={styles.label} fontSize={height * 0.62} dominantBaseline="central" textAnchor="middle">{label}</text>}
  </g>;
}
