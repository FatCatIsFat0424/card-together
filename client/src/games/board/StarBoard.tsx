// ─── The Chinese checkers star: a wooden star with an inlay, deep holes, tinted homes, and glass marbles ───

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { zonesAt } from '@shared/rules/board/board-model';
import type { BoardModel, BoardPoint } from '@shared/rules/board/board-model';
import { DEFAULT_BOARD_THEME } from './board-theme';
import type { BoardTheme } from './board-theme';
import { STAR_RIM } from './board-view';
import type { BoardGeometry } from './board-view';
import { PIECE_RADIUS, PieceFinishContext } from './BoardPieces';
import { marbleShades } from './marble-finish';
import type { MarbleShades } from './marble-finish';
import styles from './BoardView.module.css';

/*
 * The star surface reads the board palette as materials: `cell` is the wood face, `line` its grain, `surface` the
 * dark outer edge, `edge` the inlay, `hole` the upper well, `holeRim` the hole bottom, and `homes` the corner hues.
 * Everything here is static: no filters, and patterns rather than noise, so phones draw it once.
 */

const RINGS = { glow: STAR_RIM, edge: 0.98, wood: 0.86, inlay: 0.68, face: 0.62 } as const;
const HOLE_RADIUS = 0.46;
const HOME_TINT = { active: 0.26, idle: 0.08 } as const;

/** Centre-relative radii of the star's points and inner corners on the 121-hole board. */
const TIP_RADIUS = 8 * (Math.sqrt(3) / 2);
const INNER_RADIUS = 4;

const svgId = (raw: string): string => raw.replace(/[^\w-]/g, '');

/** The star's twelve outline points, `offset` units outside the line through the outermost holes. */
export function starOutline(board: BoardModel, geometry: BoardGeometry, offset = 0): BoardPoint[] {
  const cx = board.width / 2;
  const cy = board.height / 2;
  const points: BoardPoint[] = [];
  for (let step = 0; step < 12; step++) {
    const angle = ((step * 30 - 90) * Math.PI) / 180;
    // Points move out along their bisectors: twice the offset at a 60° tip, 2/√3 of it at an inner corner.
    const radius = step % 2 === 0 ? TIP_RADIUS + offset * 2 : INNER_RADIUS + offset * (2 / Math.sqrt(3));
    points.push(geometry.turn({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }));
  }
  return points;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

const pathOf = (points: readonly BoardPoint[]): string =>
  `M${points.map(({ x, y }) => `${round(x)} ${round(y)}`).join('L')}Z`;

/**
 * CSS clip path of the star and its turn glow in the board's view box, so an animated light layer never lights the
 * table round the board. The points are rounded like the drawn rim.
 */
export function starClipPath(board: BoardModel, geometry: BoardGeometry): string {
  const [vx, vy, vw, vh] = geometry.viewBox;
  const corners = starOutline(board, geometry);
  const inner = starOutline(board, geometry, STAR_RIM);
  const centre = geometry.turn({ x: board.width / 2, y: board.height / 2 });
  const points: BoardPoint[] = [];
  corners.forEach((corner, step) => {
    if (step % 2 === 1) {
      points.push(inner[step]);
      return;
    }
    // A point's rim is an arc round its outermost hole, between the normals of its two edges.
    const facing = Math.atan2(corner.y - centre.y, corner.x - centre.x);
    for (let part = -3; part <= 3; part++) {
      const angle = facing + (part * Math.PI) / 9;
      points.push({ x: corner.x + STAR_RIM * Math.cos(angle), y: corner.y + STAR_RIM * Math.sin(angle) });
    }
  });
  return `polygon(${points.map(({ x, y }) =>
    `${round(((x - vx) / vw) * 100)}% ${round(((y - vy) / vh) * 100)}%`).join(', ')})`;
}

function convexHull(points: readonly BoardPoint[]): BoardPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: BoardPoint, a: BoardPoint, b: BoardPoint): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly BoardPoint[]): BoardPoint[] => {
    const hull: BoardPoint[] = [];
    for (const point of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 1e-9) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The star itself: the turn glow (shown by an ancestor's `data-my-turn`), the dark edge, the wood rim with its
 * inlay, home triangles tinted in their corner hue (faint for empty corners), and one shared hole drawn 121 times.
 */
export function StarSurface({ board, geometry, activeHomes }: {
  readonly board: BoardModel; readonly geometry: BoardGeometry; readonly activeHomes?: readonly number[];
}): ReactNode {
  const id = svgId(useId());
  const outline = pathOf(starOutline(board, geometry));
  const homes = board.zones.filter((zone) => zone.kind === 'home');
  const active = (owner: number): boolean => activeHomes === undefined || activeHomes.includes(owner);
  const ring = (className: string, radius: number, paint?: string): ReactNode =>
    <path className={className} d={outline} strokeWidth={radius * 2} style={paint ? { fill: paint, stroke: paint } : undefined} />;
  const grain = `url(#${id}-grain)`;
  return <g data-board-surface="star">
    <defs>
      <pattern id={`${id}-grain`} width={9} height={6.4} patternUnits="userSpaceOnUse" patternTransform="rotate(-7)">
        <rect className={styles.starFace} width={9} height={6.4} />
        {GRAIN.map(([y, width, opacity], index) => <path key={y} className={styles.starGrain} strokeWidth={width}
          strokeOpacity={opacity} d={`M0 ${y}Q2.2 ${round(y + (index % 2 ? 0.35 : -0.35))} 4.5 ${y}T9 ${y}`} />)}
        <ellipse className={styles.starKnot} cx={3} cy={3} rx={0.5} ry={0.16} />
      </pattern>
      <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity={0.16} />
        <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
        <stop offset="1" stopColor="#000" stopOpacity={0.2} />
      </linearGradient>
      <radialGradient id={`${id}-well`} cx="0.5" cy="0.62" r="0.62">
        <stop offset="0" className={styles.wellTop} />
        <stop offset="1" className={styles.wellBottom} />
      </radialGradient>
      <g id={`${id}-hole`}>
        <circle r={HOLE_RADIUS} fill={`url(#${id}-well)`} />
        <path className={styles.wellShadow} d={arc(HOLE_RADIUS * 0.94, -0.12, true)} />
        <path className={styles.wellLight} d={arc(HOLE_RADIUS * 0.8, 0.27, false)} />
      </g>
    </defs>
    <path className={styles.turnGlow} d={outline} strokeWidth={RINGS.glow * 2} />
    {ring(styles.starEdge, RINGS.edge)}
    {ring(styles.starRim, RINGS.wood, grain)}
    {ring(styles.starInlay, RINGS.inlay)}
    {ring(styles.starRim, RINGS.face, grain)}
    {ring(styles.starLight, RINGS.edge, `url(#${id}-light)`)}
    {homes.map((zone) => {
      const owner = zone.owner ?? 0;
      const points = zone.nodes.map((node) => geometry.point(node)).filter((at): at is BoardPoint => at !== undefined);
      const opacity = active(owner) ? HOME_TINT.active : HOME_TINT.idle;
      return <path key={`home${owner}`} className={styles.homeTint} d={pathOf(convexHull(points))}
        style={{ fill: `var(--board-home-${owner})`, stroke: `var(--board-home-${owner})` }} opacity={opacity} />;
    })}
    {board.nodes.map((node) => {
      const at = geometry.point(node.id) ?? node;
      return <use key={node.id} href={`#${id}-hole`} x={round(at.x)} y={round(at.y)} data-board-hole="" />;
    })}
    {board.nodes.map((node) => {
      const home = zonesAt(board, node.id).find((zone) => zone.kind === 'home');
      if (!home || !active(home.owner ?? 0)) return null;
      const at = geometry.point(node.id) ?? node;
      return <circle key={`r${node.id}`} className={styles.homeRing} cx={round(at.x)} cy={round(at.y)} r={HOLE_RADIUS + 0.04}
        style={{ stroke: `var(--board-home-${home.owner ?? 0})` }} />;
    })}
  </g>;
}

/** Wavy grain lines of the wood pattern: height, stroke width, and opacity. */
const GRAIN: readonly (readonly [number, number, number])[] = [
  [0.4, 0.05, 0.1], [1.1, 0.13, 0.2], [1.6, 0.04, 0.13], [2.5, 0.1, 0.23], [3.1, 0.05, 0.15], [3.7, 0.14, 0.25],
  [4.6, 0.06, 0.18], [5.2, 0.09, 0.1], [5.9, 0.04, 0.2],
];

/** Upper (`top`) or lower arc of a circle of `radius`, at height `y`, for the hole's shadow and lip light. */
function arc(radius: number, y: number, top: boolean): string {
  const half = Math.sqrt(Math.max(0, radius * radius - y * y));
  return `M${round(-half)} ${y}A${radius} ${radius} 0 0 ${top ? 1 : 0} ${round(half)} ${y}`;
}

/** Id prefix of the marble definitions in the current star board, or null outside one. */
const MarbleDefsContext = createContext<string | null>(null);

/**
 * Defines one marble per corner hue in the star board's SVG, so each of up to 60 marbles is a single `<use>`.
 * Pieces outside a star board draw the same marble inline.
 */
export function StarMarbles({ theme, children }: { readonly theme: BoardTheme; readonly children: ReactNode }): ReactNode {
  const id = svgId(useId());
  const finish = useContext(PieceFinishContext);
  return <MarbleDefsContext.Provider value={id}>
    <defs>
      {theme.pieces.marbles.map((hue, corner) => <Marble key={corner} id={`${id}-marble-${corner}`}
        shades={marbleShades(hue, theme.pieces.accent, finish)} />)}
    </defs>
    {children}
  </MarbleDefsContext.Provider>;
}

/** Chinese checkers marble of star corner `corner`: a reference to the board's shared definition when there is one. */
export function MarblePiece({ corner }: { readonly corner: number }): ReactNode {
  const id = useContext(MarbleDefsContext);
  const finish = useContext(PieceFinishContext);
  const inline = svgId(useId());
  if (id !== null) return <use href={`#${id}-marble-${corner}`} />;
  const pieces = DEFAULT_BOARD_THEME.pieces;
  return <Marble id={`${inline}-marble`} shades={marbleShades(pieces.marbles[corner] ?? pieces.marbles[0], pieces.accent, finish)} />;
}

const R = PIECE_RADIUS;
/** Positions on the unit circle, for rim beads and notches. */
const RIM_STEPS = Array.from({ length: 12 }, (_, step) => [Math.cos((step * Math.PI) / 6), Math.sin((step * Math.PI) / 6)] as const);
/** Fixed speckle positions of ivory and stone, so every marble of a style looks the same. */
const SPECKLES = Array.from({ length: 11 }, (_, step) => [((step * 47) % 44 - 22) / 60, ((step * 31) % 44 - 22) / 60] as const);

function Marble({ id, shades }: { readonly id: string; readonly shades: MarbleShades }): ReactNode {
  const { material, light, body, shade, outline, gloss } = shades;
  const fill = `url(#${id}-body)`;
  const highlight = (rx: number, ry: number, opacity: number, cy = -0.17): ReactNode =>
    <ellipse className={styles.marbleGloss} cx={-0.15} cy={cy} rx={rx} ry={ry} transform={`rotate(-35 -0.15 ${cy})`}
      opacity={Math.min(0.9, opacity)} />;
  return <g id={id}>
    {material === 'metal'
      ? <linearGradient id={`${id}-body`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
        <stop offset="0" stopColor={light} /><stop offset="0.38" stopColor={body} /><stop offset="0.55" stopColor={shade} />
        <stop offset="0.78" stopColor={body} /><stop offset="1" stopColor={shade} />
      </linearGradient>
      : <radialGradient id={`${id}-body`} cx="0.36" cy="0.3" r="0.85">
        <stop offset="0" stopColor={light} /><stop offset="0.42" stopColor={body} /><stop offset="1" stopColor={shade} />
      </radialGradient>}
    <circle className={styles.marbleShadow} cx={0.05} cy={0.09} r={R} />
    <circle r={R} fill={fill} stroke={outline} strokeWidth={0.045} />
    {material === 'glass' && <>
      <path className={styles.marbleLine} d="M-.29 .21A.37 .37 0 0 0 .29 .25" strokeOpacity={0.38} strokeWidth={0.04} />
      {highlight(0.17, 0.095, gloss * 1.5)}
      <circle className={styles.marbleGloss} cx={0.16} cy={0.15} r={0.045} opacity={0.4} />
    </>}
    {material === 'porcelain' && <>
      <circle className={styles.marbleLine} r={R * 0.84} strokeOpacity={0.38} strokeWidth={0.04} />
      {highlight(0.21, 0.125, gloss * 1.1)}
    </>}
    {material === 'jade' && <>
      <circle className={styles.marbleGloss} r={R} opacity={0.1} />
      <path className={styles.marbleLine} d="M-.27 .05Q-.1 -.12 .05 .02T.27 -.05" strokeOpacity={0.22} strokeWidth={0.04} />
      {highlight(0.16, 0.09, gloss * 1.2, -0.18)}
    </>}
    {material === 'enamel' && <>
      <circle r={R * 0.86} fill="none" stroke={outline} strokeOpacity={0.5} strokeWidth={0.025} />
      {highlight(0.16, 0.09, gloss * 1.6)}
    </>}
    {material === 'lacquer' && <>
      <circle r={R} fill="#000" fillOpacity={0.12} />
      {highlight(0.2, 0.07, gloss * 2, -0.2)}
    </>}
    {(material === 'ivory' || material === 'stone') && <>
      {SPECKLES.slice(0, material === 'ivory' ? 7 : 11).map(([x, y]) => <circle key={`${x},${y}`} cx={round(x)} cy={round(y)}
        r={0.02} fill={outline} fillOpacity={material === 'ivory' ? 0.25 : 0.3} />)}
      {highlight(0.2, 0.12, material === 'ivory' ? gloss * 0.8 : 0.14, -0.16)}
    </>}
    {material === 'metal' && <>
      <circle className={styles.marbleLine} r={R * 0.82} strokeOpacity={0.3} strokeWidth={0.025} />
      <path className={styles.marbleLine} d="M-.29 -.08L.05 -.31" strokeOpacity={0.7} strokeWidth={0.05} strokeLinecap="round" />
    </>}
    <MarbleRim shades={shades} />
  </g>;
}

function MarbleRim({ shades }: { readonly shades: MarbleShades }): ReactNode {
  const { rimStyle, rim } = shades;
  if (rimStyle === 'plain') return null;
  if (rimStyle === 'double') return <circle r={R * 0.7} fill="none" stroke={rim} strokeOpacity={0.55} strokeWidth={0.03} />;
  if (rimStyle === 'beaded') {
    return <g fill={rim} fillOpacity={0.8}>{RIM_STEPS.map(([x, y]) => <circle key={`${x},${y}`} cx={round(x * R * 0.82)}
      cy={round(y * R * 0.82)} r={0.03} />)}</g>;
  }
  return <path d={RIM_STEPS.map(([x, y]) => `M${round(x * R * 0.7)} ${round(y * R * 0.7)}L${round(x * R * 0.91)} ${round(y * R * 0.91)}`)
    .join('')} stroke={rim} strokeOpacity={0.8} strokeWidth={0.035} />;
}
