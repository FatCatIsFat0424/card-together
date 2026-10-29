// ─── BoardView: SVG board drawn from the shared board model, with pieces and move markers ───

import { useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { coordinateLabel, nodeById, zonesAt } from '@shared/rules/board/board-model';
import type { BoardModel, BoardNode, BoardPoint, NodeId } from '@shared/rules/board/board-model';
import { cardInput } from '../../components/card-hand-touch';
import type { CardInput } from '../../components/card-hand-touch';
import { useI18nStore } from '../../stores/i18n-store';
import { useEquippedBoardTheme } from '../../cosmetics/board-styles/use-board-theme';
import { useStillArt } from '../../cosmetics/art-layers/art-layers';
import { DEFAULT_PIECE_FINISH, boardThemeStyle } from './board-theme';
import type { BoardPattern, BoardSurface, BoardTheme } from './board-theme';
import { axisPositions, boardGeometry, hitBox, markerBox, movePath } from './board-view';
import type { BoardGeometry } from './board-view';
import { PIECE_RADIUS, PieceFinishContext } from './BoardPieces';
import { StarMarbles, StarSurface, starClipPath } from './StarBoard';
import { BoardFxLayer, useBoardFx } from './BoardEffects';
import styles from './BoardView.module.css';

export interface BoardPieceItem {
  readonly node: NodeId;
  /** Stable identity, so a moved piece keeps its element. */
  readonly key: string;
  /** Drawn around (0, 0) in board units, e.g. a `TokenPiece`. */
  readonly piece: ReactNode;
  /** Accessible name of the piece, such as "Red chariot". */
  readonly label?: string;
}

export interface BoardTarget {
  readonly node: NodeId;
  /** The move captures (or, in Reversi, flips) the piece there. */
  readonly capture?: boolean;
}

export interface BoardMarkedMove {
  readonly from?: NodeId;
  readonly to?: NodeId;
  readonly path?: readonly NodeId[];
}

export interface BoardViewProps {
  readonly board: BoardModel;
  readonly surface: BoardSurface;
  /** Board accessible name, such as the game title. */
  readonly label: string;
  /** Fixed look; by default the viewer's equipped board and piece styles. */
  readonly theme?: BoardTheme;
  /** Clockwise turn from `sideRotation` for the viewer's side; text and pieces stay upright. */
  readonly rotation?: number;
  readonly pieces: readonly BoardPieceItem[];
  readonly lastMove?: BoardMarkedMove | null;
  readonly selected?: NodeId | null;
  readonly targets?: readonly BoardTarget[];
  /** Move waiting for confirmation; `piece` is drawn translucent on its destination. */
  readonly pending?: (BoardMarkedMove & { readonly to: NodeId; readonly piece?: ReactNode }) | null;
  /** King in check. */
  readonly check?: NodeId | null;
  /** Labels per column and row index (from the top-left of side 0's view), drawn along the bottom and left. */
  readonly fileLabels?: readonly string[];
  readonly rankLabels?: readonly string[];
  /** Nodes the player may tap besides targets, usually own pieces with a legal move. */
  readonly selectable?: readonly NodeId[];
  /** A tap on a node, or on the board outside any interactive node (`null`). */
  readonly onNodeClick?: (node: NodeId | null, input: CardInput) => void;
  /** Accessible coordinate of a node; chess-style coordinates by default. */
  readonly nodeName?: (node: NodeId) => string;
  /** Star corners in play, tinted at full strength; every corner when unset. */
  readonly activeHomes?: readonly number[];
  /** A finished line of pieces (Gomoku's five), outlined by piece styles with effects. */
  readonly winLine?: readonly NodeId[];
  /**
   * Plays piece style effects for new moves in the game log (default). Boards that show only part of the game,
   * such as one of Battleship's two seas sharing node ids, turn it off.
   */
  readonly moveEffects?: boolean;
  readonly className?: string;
}

const coarsePointer = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;

const point = (geometry: BoardGeometry, id: NodeId | undefined): BoardPoint | undefined =>
  id === undefined ? undefined : geometry.point(id);

/** One tile of each material texture, in board units; drawn once into a static pattern, never animated. */
const PATTERN_TILES: Readonly<Record<Exclude<BoardPattern, 'none'>, { readonly size: readonly [number, number]; readonly d: string }>> = {
  grain: { size: [3, 0.55], d: 'M0 .28Q.75 .16 1.5 .28T3 .28M0 .05Q.9 .1 1.8 .04T3 .06' },
  speckle: { size: [0.9, 0.9], d: 'M.14 .2h.05M.52 .1h.04M.7 .48h.05M.3 .62h.04M.82 .8h.03M.08 .78h.04' },
  brushed: { size: [1, 0.22], d: 'M0 .07H.62M.4 .17H1' },
  crackle: { size: [2, 2], d: 'M0 .5L.6 .7L.9 .3L1.4 .5L2 .2M.6 .7L.5 1.3L1 1.6L1.6 1.3L2 1.5M1 1.6L.9 2M1.4 .5L1.6 1.3' },
};

/** Faint material texture over the whole board, from a small static tile. */
function MaterialPattern({ pattern, box }: {
  readonly pattern: BoardPattern; readonly box: readonly [number, number, number, number];
}): ReactNode {
  const id = useId();
  if (pattern === 'none') return null;
  const tile = PATTERN_TILES[pattern];
  const [x, y, width, height] = box;
  return <>
    <defs>
      <pattern id={id} width={tile.size[0]} height={tile.size[1]} patternUnits="userSpaceOnUse">
        <path className={styles.grain} d={tile.d} strokeWidth={pattern === 'speckle' ? 0.05 : 0.03}
          strokeLinecap={pattern === 'speckle' ? 'round' : 'butt'} />
      </pattern>
    </defs>
    <rect className={styles.material} x={x} y={y} width={width} height={height} rx={0.3} fill={`url(#${id})`} />
  </>;
}

/** River band of a river board, drawn before the lines so the side files still cross it. */
function riverBands(board: BoardModel, geometry: BoardGeometry): ReactNode[] {
  return board.decorations.flatMap((decoration, index) => {
    if (decoration.kind !== 'river') return [];
    const a = geometry.turn({ x: decoration.x0, y: decoration.y - 0.5 });
    const b = geometry.turn({ x: decoration.x1, y: decoration.y + 0.5 });
    return [<rect key={`band${index}`} className={styles.riverBand} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} />];
  });
}

function BoardSurfaceLayer({ board, geometry, surface, activeHomes, pattern }: {
  readonly board: BoardModel; readonly geometry: BoardGeometry; readonly surface: BoardSurface;
  readonly activeHomes?: readonly number[]; readonly pattern: BoardPattern;
}): ReactNode {
  const { t } = useI18nStore();
  if (isStar(board, surface)) return <StarSurface board={board} geometry={geometry} activeHomes={activeHomes} />;
  const [x, y, width, height] = geometry.viewBox;
  const turned = (node: BoardNode): BoardPoint => geometry.point(node.id) ?? node;
  const edgeLine = (a: NodeId, b: NodeId): { x1: number; y1: number; x2: number; y2: number } | null => {
    const start = geometry.point(a);
    const end = geometry.point(b);
    return start && end ? { x1: start.x, y1: start.y, x2: end.x, y2: end.y } : null;
  };
  const items: ReactNode[] = [<rect key="surface" className={styles.surface} x={x} y={y} width={width} height={height} rx={0.3} />,
    <MaterialPattern key="material" pattern={pattern} box={geometry.viewBox} />, ...riverBands(board, geometry)];

  if (board.layout === 'cells') {
    const { minX, minY, maxX, maxY } = geometry.bounds;
    items.push(<rect key="grid" className={styles.grid} x={minX - 0.5} y={minY - 0.5} width={maxX - minX + 1} height={maxY - minY + 1} />);
    for (const node of board.nodes) {
      const { x: cx, y: cy } = turned(node);
      const zones = zonesAt(board, node.id);
      const zone = (kind: string): { owner?: number } | undefined => zones.find((entry) => entry.kind === kind);
      const den = zone('den');
      const kind = zone('water') ? styles.water : den ? styles.den : zone('trap') ? styles.trap : styles.cell;
      items.push(<g key={node.id} transform={`translate(${cx} ${cy})`}>
        <rect className={kind} x={-0.475} y={-0.475} width={0.95} height={0.95} rx={0.06} />
        {zone('water') && <path className={styles.waves} d="M-.32 -.09q.16 -.14 .32 0t.32 0M-.32 .18q.16 -.14 .32 0t.32 0" />}
        {zone('trap') && <path className={styles.trapMark} d="M-.22 -.22L.22 .22M.22 -.22L-.22 .22" />}
        {den && <path className={styles.denMark} style={{ fill: `var(--board-den-${den.owner ?? 0})` }}
          d="M-.25 .27V-.04a.25 .25 0 0 1 .5 0V.27Z" />}
      </g>);
    }
  }

  if (board.layout === 'points' || board.layout === 'stations') {
    for (const decoration of board.decorations) {
      if (decoration.kind !== 'frame') continue;
      const { minX, minY, maxX, maxY } = geometry.bounds;
      items.push(<rect key="frame" className={styles.frame} x={minX - 0.12} y={minY - 0.12}
        width={maxX - minX + 0.24} height={maxY - minY + 0.24} />);
    }
    board.edges.forEach((edge, index) => {
      if (edge.hidden) return;
      const line = edgeLine(edge.a, edge.b);
      if (!line) return;
      if (edge.kind === 'rail') {
        items.push(<g key={`e${index}`}><line className={styles.rail} {...line} /><line className={styles.railInner} {...line} /></g>);
      } else {
        const kind = board.layout === 'stations' ? styles.road : edge.kind === 'diagonal' ? styles.palace : styles.line;
        items.push(<line key={`e${index}`} className={kind} {...line} />);
      }
    });
  }

  board.decorations.forEach((decoration, index) => {
    const key = `d${index}`;
    if (decoration.kind === 'star') {
      const at = geometry.turn(decoration);
      items.push(<circle key={key} className={styles.star} cx={at.x} cy={at.y} r={0.09} />);
    } else if (decoration.kind === 'marks') {
      const segments: string[] = [];
      for (const dx of [-1, 1]) {
        if ((dx < 0 && !decoration.left) || (dx > 0 && !decoration.right)) continue;
        for (const dy of [-1, 1]) {
          const corner = [[0.1, 0.3], [0.1, 0.1], [0.3, 0.1]].map(([px, py]) =>
            geometry.turn({ x: decoration.x + dx * px, y: decoration.y + dy * py }));
          segments.push(`M${corner[0].x} ${corner[0].y}L${corner[1].x} ${corner[1].y}L${corner[2].x} ${corner[2].y}`);
        }
      }
      items.push(<path key={key} className={styles.marks} d={segments.join('')} />);
    } else if (decoration.kind === 'river') {
      const span = decoration.x1 - decoration.x0;
      const left = geometry.turn({ x: decoration.x0 + span * 0.25, y: decoration.y });
      const right = geometry.turn({ x: decoration.x0 + span * 0.75, y: decoration.y });
      items.push(<g key={key} className={styles.river}>
        <text x={left.x} y={left.y} dominantBaseline="central" textAnchor="middle" fontSize={0.42}>{t('board.riverLeft')}</text>
        <text x={right.x} y={right.y} dominantBaseline="central" textAnchor="middle" fontSize={0.42}>{t('board.riverRight')}</text>
      </g>);
    } else if (decoration.kind === 'mountain') {
      const at = geometry.turn(decoration);
      items.push(<g key={key} transform={`translate(${at.x} ${at.y})`}>
        <rect className={styles.mountain} x={-0.9} y={-0.32} width={1.8} height={0.64} rx={0.1} />
        <text className={styles.mountainText} dominantBaseline="central" textAnchor="middle" fontSize={0.36}>{t('board.mountain')}</text>
      </g>);
    }
  });

  if (board.layout === 'stations') {
    for (const node of board.nodes) {
      const { x: cx, y: cy } = turned(node);
      const zones = zonesAt(board, node.id);
      const shape = zones.some((zone) => zone.kind === 'camp')
        ? <ellipse className={styles.camp} rx={0.96} ry={0.46} />
        : zones.some((zone) => zone.kind === 'hq')
          ? <rect className={styles.hq} x={-0.95} y={-0.46} width={1.9} height={0.92} rx={0.22} />
          : <rect className={styles.station} x={-0.86} y={-0.38} width={1.72} height={0.76} rx={0.1} />;
      items.push(<g key={node.id} transform={`translate(${cx} ${cy})`}>{shape}</g>);
    }
  }

  if (board.layout === 'holes') {
    for (const node of board.nodes) {
      const { x: cx, y: cy } = turned(node);
      items.push(<circle key={`b${node.id}`} className={styles.holeBed} cx={cx} cy={cy} r={0.62} />);
    }
    for (const node of board.nodes) {
      const { x: cx, y: cy } = turned(node);
      const home = zonesAt(board, node.id).find((zone) => zone.kind === 'home');
      items.push(<circle key={node.id} className={styles.hole} cx={cx} cy={cy} r={0.34}
        style={home ? { stroke: `var(--board-home-${home.owner ?? 0})`, strokeWidth: 0.1 } : undefined} />);
    }
  }
  return <g>{items}</g>;
}

/** The Chinese checkers star draws its own outline, holes, and marbles (`StarBoard.tsx`). */
const isStar = (board: BoardModel, surface: BoardSurface): boolean => surface === 'star' && board.layout === 'holes';

function Highlight({ at, layout, className, dashed }: {
  readonly at: BoardPoint; readonly layout: BoardModel['layout']; readonly className: string; readonly dashed?: boolean;
}): ReactNode {
  if (layout === 'holes') {
    return <circle className={`${className} ${dashed ? styles.dashed : ''}`} cx={at.x} cy={at.y} r={0.56} />;
  }
  const { width, height } = markerBox(layout);
  return <rect className={`${className} ${dashed ? styles.dashed : ''}`} x={at.x - width / 2} y={at.y - height / 2}
    width={width} height={height} rx={0.1} />;
}

/**
 * Draws the board, its pieces, and the shared markers: last move (blue), selection (gold), legal targets (green
 * dots, orange rings for captures), a pending move (dashed blue with a translucent piece), and check (red).
 */
export function BoardView({
  board, surface, label, theme: fixedTheme, rotation = 0, pieces, lastMove, selected, targets = [], pending,
  check, fileLabels, rankLabels, selectable = [], onNodeClick, nodeName, activeHomes, winLine, moveEffects = true,
  className,
}: BoardViewProps): ReactNode {
  const { t } = useI18nStore();
  const equippedTheme = useEquippedBoardTheme();
  const theme = fixedTheme ?? equippedTheme;
  const still = useStillArt();
  const motion = still ? null : theme.motion ?? null;
  // Piece effects play only at live tables (a fixed theme is a shop preview). Chinese checkers keeps its own look.
  const effects = still || fixedTheme !== undefined || board.layout === 'holes' ? null : theme.effects ?? null;
  const fx = useBoardFx(effects !== null && moveEffects, pieces);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const labels = Boolean(fileLabels || rankLabels);
  const geometry = useMemo(() => boardGeometry(board, rotation, labels), [board, rotation, labels]);
  const style = useMemo(() => boardThemeStyle(theme, surface), [theme, surface]);
  const lastPointer = useRef<string | null>(null);
  const [vx, vy, vw, vh] = geometry.viewBox;
  const name = nodeName ?? ((id: NodeId) => coordinateLabel(board, id));
  const layout = board.layout;
  const markerRadius = layout === 'stations' ? 0.2 : PIECE_RADIUS;

  const lastPath = lastMove ? movePath(board, lastMove) : [];
  const lastFrom = point(geometry, lastMove?.from);
  const lastTo = point(geometry, lastMove?.to);
  const selectedAt = point(geometry, selected ?? undefined);
  const checkAt = point(geometry, check ?? undefined);
  const pendingPath = pending ? movePath(board, pending) : [];
  const pendingTo = point(geometry, pending?.to);
  const polyline = (ids: readonly NodeId[]): string => ids.map((id) => geometry.point(id))
    .filter((at): at is BoardPoint => at !== undefined).map((at) => `${at.x},${at.y}`).join(' ');

  const activate = (node: NodeId | null, input: CardInput): void => onNodeClick?.(node, input);
  const tapInput = (detail: number): CardInput => {
    const pointerType = lastPointer.current;
    lastPointer.current = null;
    return detail === 0 ? 'keyboard' : cardInput(pointerType, coarsePointer());
  };
  const onKey = (node: NodeId) => (event: KeyboardEvent<SVGElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate(node, 'keyboard');
  };

  const interactive = onNodeClick ? [...new Set([...selectable, ...targets.map((target) => target.node),
    ...pending ? [pending.to] : []])] : [];
  const targetSet = new Map(targets.map((target) => [target.node, target]));

  const viewBox = `${vx} ${vy} ${vw} ${vh}`;
  const star = isStar(board, surface);
  const surfaceLayer = <BoardSurfaceLayer board={board} geometry={geometry} surface={surface} activeHomes={activeHomes}
    pattern={theme.surfaces[surface].pattern} />;
  const content = <PieceFinishContext.Provider value={theme.finish ?? DEFAULT_PIECE_FINISH}><StarPieces star={star} theme={theme}>
    {fileLabels && axisPositions(board, geometry).files.map(({ index, x }) => fileLabels[index] !== undefined
      && <text key={`f${index}`} className={styles.axis} x={x} y={vy + vh - 0.2} textAnchor="middle" fontSize={0.3}>
        {fileLabels[index]}</text>)}
    {rankLabels && axisPositions(board, geometry).ranks.map(({ index, y }) => rankLabels[index] !== undefined
      && <text key={`r${index}`} className={styles.axis} x={vx + 0.24} y={y} dominantBaseline="central"
        textAnchor="middle" fontSize={0.3}>{rankLabels[index]}</text>)}

    <g className={styles.under}>
      {lastFrom && <Highlight at={lastFrom} layout={layout} className={styles.lastFrom} dashed />}
      {lastTo && lastFrom && <Highlight at={lastTo} layout={layout} className={styles.lastTo} />}
      {lastPath.length > 2 && <polyline className={styles.lastPath} points={polyline(lastPath)} />}
      {selectedAt && (layout === 'stations'
        ? <Highlight at={selectedAt} layout={layout} className={styles.selected} />
        : <circle className={styles.selected} cx={selectedAt.x} cy={selectedAt.y} r={PIECE_RADIUS * 1.3} />)}
      {checkAt && <circle className={styles.check} cx={checkAt.x} cy={checkAt.y} r={PIECE_RADIUS * 1.42} />}
    </g>

    <g className={styles.pieces}>
      {pieces.map((item) => {
        const at = geometry.point(item.node);
        if (!at) return null;
        const lifted = item.node === selected && !pending;
        const dimmed = pending?.from === item.node;
        const moving = fx.hidden.has(item.node);
        return <g key={item.key} className={moving ? styles.moving : dimmed ? styles.dimmed : undefined}
          transform={`translate(${at.x} ${at.y - (lifted ? 0.07 : 0)})`}>
          {item.piece}
          {item.label && <title>{item.label}</title>}
        </g>;
      })}
    </g>

    <g className={styles.over}>
      {lastTo && !lastFrom && <circle className={styles.lastDot} cx={lastTo.x} cy={lastTo.y} r={0.11} />}
      {targets.map((target) => {
        const at = geometry.point(target.node);
        if (!at) return null;
        // Star holes are about 17 px apart on a phone, so their targets are drawn large enough to aim at.
        if (!target.capture) {
          return <circle key={target.node} className={styles.target} cx={at.x} cy={at.y} r={layout === 'holes' ? 0.24 : 0.13} />;
        }
        return layout === 'stations'
          ? <Highlight key={target.node} at={at} layout={layout} className={styles.capture} />
          : <circle key={target.node} className={styles.capture} cx={at.x} cy={at.y} r={PIECE_RADIUS * 1.18} />;
      })}
      {pending && pendingTo && <>
        {pendingPath.length > 1 && <polyline className={styles.pendingPath} points={polyline(pendingPath)} />}
        {pending.piece && <g className={styles.ghost} transform={`translate(${pendingTo.x} ${pendingTo.y})`}>{pending.piece}</g>}
        {layout === 'stations' ? <Highlight at={pendingTo} layout={layout} className={styles.pendingRing} />
          : <circle className={styles.pendingRing} cx={pendingTo.x} cy={pendingTo.y} r={markerRadius * 1.28} />}
      </>}
    </g>

    {interactive.map((id) => {
      const at = geometry.point(id);
      const node = nodeById(board, id);
      if (!at || !node) return null;
      const target = targetSet.get(id);
      const pieceLabel = pieces.find((item) => item.node === id)?.label;
      const coordinate = name(id);
      const aria = target || pending?.to === id ? t('board.moveTo', { point: coordinate })
        : `${t('board.select', { point: coordinate })}${pieceLabel ? ` · ${pieceLabel}` : ''}`;
      const { width, height } = hitBox(layout);
      return <rect key={`hit${id}`} className={styles.hit} data-board-node={id} x={at.x - width / 2} y={at.y - height / 2}
        width={width} height={height} rx={layout === 'points' ? 0 : 0.1} role="button" tabIndex={0} aria-label={aria}
        aria-pressed={id === selected || undefined}
        onClick={(event) => {
          event.stopPropagation();
          activate(id, tapInput(event.detail));
        }}
        onKeyDown={onKey(id)} />;
    })}
  </StarPieces></PieceFinishContext.Provider>;

  const layered = Boolean(motion || effects);
  const interactiveSvg = (classes: string, children: ReactNode): ReactNode => <svg className={classes}
    style={layered ? undefined : style} viewBox={viewBox} role="group" aria-label={label} data-board-layout={layout}
    onPointerDown={(event) => { lastPointer.current = event.pointerType; }}
    onClick={onNodeClick ? (event) => activate(null, tapInput(event.detail)) : undefined}>{children}</svg>;
  if (!layered) return interactiveSvg(`${styles.board} ${className ?? ''}`, <>{surfaceLayer}{content}</>);
  // Animated styles move a light layer between the surface and the pieces, so it never covers lettering or
  // move markers; the layer only changes transform or opacity, so the compositor runs it. Piece effects play in
  // an HTML layer on top, which never takes taps. The star clips both to its outline, so they never light the
  // table round the board.
  return <div ref={setHost} className={`${styles.layered} ${className ?? ''}`}
    style={star ? { ...style, clipPath: starClipPath(board, geometry) } : style} data-board-motion={motion?.kind}>
    {motion ? <>
      <svg className={`${styles.board} ${styles.layer}`} viewBox={viewBox} aria-hidden="true" focusable="false">
        {surfaceLayer}
      </svg>
      <span className={`${styles.motion} ${styles[motion.kind]}`} style={{ '--board-glow': motion.glow } as CSSProperties}
        aria-hidden="true" />
      {interactiveSvg(`${styles.board} ${styles.layer}`, content)}
    </> : interactiveSvg(`${styles.board} ${styles.layer}`, <>{surfaceLayer}{content}</>)}
    {effects && <BoardFxLayer host={host} viewBox={geometry.viewBox} point={geometry.point} effects={effects}
      finish={theme.finish ?? DEFAULT_PIECE_FINISH} groups={fx.groups} selected={pending ? null : selected}
      winLine={winLine} />}
  </div>;
}

function StarPieces({ star, theme, children }: {
  readonly star: boolean; readonly theme: BoardTheme; readonly children: ReactNode;
}): ReactNode {
  return star ? <StarMarbles theme={theme}>{children}</StarMarbles> : children;
}
