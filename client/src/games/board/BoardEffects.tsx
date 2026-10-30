// ─── Board effect layer: HTML over the board SVG, so every effect animates only transform and opacity ───

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { BoardPoint, NodeId } from '@shared/rules/board/board-model';
import type { PlayerVisibleGameState } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useConnectionReady } from '../use-connection-ready';
import {
  BOARD_FX_LIMITS, boardFxPlan, boardFxTiming, burstParticles, flipDelays, flipFrames, flipSequenceMs,
} from './board-effects';
import type { BoardFxPlan } from './board-effects';
import type { EffectAura, EffectParticle, PieceEffects, PieceFinish } from './board-theme';
import { PieceFinishContext } from './BoardPieces';
import styles from './BoardEffects.module.css';

/**
 * One move's effects. Nothing renders when an effect ends: piece copies finish exactly over the real pieces
 * and stand in for them until the board next renders, and rings and bursts end invisible; a later render
 * drops them (see `useBoardFx`).
 */
export interface BoardFxGroup {
  readonly id: number;
  /** `Date.now()` when the move arrived. */
  readonly startedAt: number;
  readonly plan: BoardFxPlan;
  /** The piece now on `to`, drawn sliding in from `from`. */
  readonly piece: ReactNode;
  /** Turned pieces animated one after another: their look before and after. */
  readonly flips: readonly { readonly node: NodeId; readonly before: ReactNode; readonly after: ReactNode; readonly delay: number }[];
  /** The board SVG hides these nodes' pieces while their HTML copies move. */
  readonly hides: readonly NodeId[];
  readonly hideMs: number;
  readonly totalMs: number;
}

interface FxState {
  readonly visible: PlayerVisibleGameState | null;
  readonly ready: boolean;
  /** The connection dropped since the last snapshot, so the next one is a resume and plays nothing. */
  readonly stale: boolean;
  readonly groups: readonly BoardFxGroup[];
  /** Pieces as drawn for `visible`, so a turned piece's earlier look is known. */
  readonly drawn: ReadonlyMap<NodeId, ReactNode>;
}

let nextGroupId = 1;

/** Builds the effect group of a move, or `null` when its pieces are not on this board. */
export function boardFxGroup(
  plan: BoardFxPlan, pieces: ReadonlyMap<NodeId, ReactNode>, previous: ReadonlyMap<NodeId, ReactNode>, now = Date.now(),
): BoardFxGroup | null {
  const piece = pieces.get(plan.to);
  if (piece === undefined) return null;
  const delays = flipDelays(plan.flips.length);
  const flips = plan.flips.slice(0, delays.length).flatMap((node, index) => {
    const before = previous.get(node);
    const after = pieces.get(node);
    return before !== undefined && after !== undefined ? [{ node, before, after, delay: delays[index] }] : [];
  });
  const { hideMs, totalMs } = boardFxTiming(plan);
  const hides = [...plan.from !== undefined ? [plan.to] : [], ...flips.map((flip) => flip.node)];
  return { id: nextGroupId++, startedAt: now, plan, piece, flips, hides, hideMs, totalMs };
}

/**
 * The groups kept when `group` starts at `now`: earlier groups still playing, at most `BOARD_FX_LIMITS.groups`
 * in all. Finished groups leave in the same render that adds the new one, so no render only removes effects.
 */
export function nextFxGroups(
  groups: readonly BoardFxGroup[], group: BoardFxGroup, now: number,
): readonly BoardFxGroup[] {
  const playing = groups.filter((item) => now - item.startedAt < item.totalMs);
  return [...playing.slice(1 - BOARD_FX_LIMITS.groups), group];
}

/** Groups whose moving pieces have arrived by `now`, so the board may draw them again. */
export function landedFxGroups(groups: readonly BoardFxGroup[], now = Date.now()): ReadonlySet<number> {
  return new Set(groups.filter((group) => now - group.startedAt >= group.hideMs).map((group) => group.id));
}

const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

/**
 * Effect groups for new moves at a live board. Plans are derived while rendering, so the board hides a moving
 * piece in the same paint that shows the new position. A move costs no render of its own after that: once its
 * pieces have landed, the next render for any reason (the next move, a selection) shows the real pieces again
 * and drops their copies, which until then look the same in the same place. Nothing plays on the first
 * snapshot, after a reconnect, on a replay seek or restore, or while the page is hidden.
 */
export function useBoardFx(enabled: boolean, pieces: readonly { readonly node: NodeId; readonly piece: ReactNode }[]): {
  readonly groups: readonly BoardFxGroup[];
  /** Groups whose pieces have landed: the board SVG shows them again and their copies are gone. */
  readonly landed: ReadonlySet<number>;
  readonly hidden: ReadonlySet<NodeId>;
} {
  const visible = useGameStore((store) => store.visible);
  const ready = useConnectionReady();
  const [state, setState] = useState<FxState>(() => ({
    visible, ready, stale: false, groups: [], drawn: new Map(pieces.map((item) => [item.node, item.piece])),
  }));
  let current = state;
  if (ready !== current.ready) current = { ...current, ready, stale: current.stale || !ready };
  if (visible !== current.visible) {
    const drawn = new Map(pieces.map((item) => [item.node, item.piece]));
    const plan = enabled && !current.stale && !pageHidden() ? boardFxPlan(current.visible, visible) : null;
    const group = plan ? boardFxGroup(plan, drawn, current.drawn) : null;
    const groups = group ? nextFxGroups(current.groups, group, group.startedAt) : current.groups;
    current = { ...current, visible, stale: false, drawn, groups };
  }
  if (current !== state) setState(current);

  if (!enabled) return { groups: [], landed: new Set(), hidden: new Set() };
  const landed = landedFxGroups(current.groups);
  const hidden = new Set(current.groups.filter((group) => !landed.has(group.id)).flatMap((group) => group.hides));
  return { groups: current.groups, landed, hidden };
}

/** Whether the page is in a background tab; looping effects pause meanwhile. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(pageHidden);
  useEffect(() => {
    const update = (): void => setHidden(pageHidden());
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

/** The drawn board's box inside the host: the SVG keeps its aspect ratio and centres the board. */
function useBoardBox(element: HTMLElement | null, aspect: number): CSSProperties | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (): void => setSize((now) => (now && now.width === element.clientWidth && now.height === element.clientHeight
      ? now : { width: element.clientWidth, height: element.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  if (!size || size.width === 0 || size.height === 0) return null;
  const width = Math.min(size.width, size.height * aspect);
  const height = width / aspect;
  return { left: (size.width - width) / 2, top: (size.height - height) / 2, width, height };
}

/** Particle size as a share of the burst box; CSS draws each shape at this size. */
const PARTICLE_SIZE: Readonly<Record<EffectParticle, number>> = {
  petal: 0.15, streak: 0.4, spark: 0.08, dot: 0.08, flake: 0.11, leaf: 0.14, ember: 0.07, bubble: 0.12,
};

/**
 * A capture burst: an impact ring and the style's particles flying out. `late` holds it until a sliding piece
 * lands, inside the animation rather than with a delay (see `.late`); `delay` is for shop previews.
 */
export function FxBurst({ effects, delay = 0, late = false }: {
  readonly effects: PieceEffects; readonly delay?: number; readonly late?: boolean;
}): ReactNode {
  const size = PARTICLE_SIZE[effects.particle];
  const timing = delay ? { animationDelay: `${delay}ms` } : undefined;
  const wait = late ? styles.late : '';
  return <>
    <i className={`${styles.ring} ${wait}`} style={timing} />
    {effects.aura === 'neon' && <i className={`${styles.ring} ${styles.ring2} ${wait}`} style={timing} />}
    <i className={`${styles.burst} ${wait}`} style={timing}>
      {burstParticles(effects.count, effects.spread).map(({ angle, reach }, index) => <i key={index}
        className={`${styles.particle} ${styles[effects.particle]}`}
        style={{ '--a': `${angle}deg`, '--r': `${Math.round((reach / 2 / size) * 100)}%`, '--s': `${80 + index * 45}deg` } as CSSProperties} />)}
    </i>
  </>;
}

const AURA: Readonly<Record<EffectAura, string>> = {
  ring: styles.auraRing, orbit: styles.auraOrbit, flame: styles.auraFlame, radar: styles.auraRadar, neon: styles.auraNeon,
  halo: styles.auraHalo,
};

/** Selection aura: looping styles keep it moving while selected; the others ring once and stay still. */
export function FxAura({ effects }: { readonly effects: PieceEffects }): ReactNode {
  return <i className={`${styles.aura} ${AURA[effects.aura]} ${effects.loop ? styles.loop : styles.once}`} />;
}

/**
 * Shop preview of a piece style's effects over a drawing: the selection aura on `aura` (looping for animated
 * collections) and a capture burst on `burst`, replayed whenever `replay` changes. Positions are percentages.
 */
export function FxPreview({ effects, aura, burst, replay }: {
  readonly effects: PieceEffects;
  readonly aura: { readonly left: number; readonly top: number; readonly width: number };
  readonly burst: { readonly left: number; readonly top: number; readonly width: number };
  readonly replay: number;
}): ReactNode {
  const place = (spot: typeof aura): CSSProperties => ({ left: `${spot.left}%`, top: `${spot.top}%`, width: `${spot.width}%` });
  return <span className={styles.layer} aria-hidden="true" style={{ '--fx-c': effects.colour, '--fx-c2': effects.colour2 } as CSSProperties}>
    <span key={`a${replay}`} className={styles.at} style={place(aura)}><FxAura effects={effects} /></span>
    <span key={`b${replay}`} className={styles.at} style={place(burst)}><FxBurst effects={effects} delay={250} /></span>
  </span>;
}

/** A piece copy drawn in its own small SVG, centred in a two-unit box. */
function PieceCopy({ piece, finish }: { readonly piece: ReactNode; readonly finish: PieceFinish }): ReactNode {
  return <svg className={styles.copy} viewBox="-1 -1 2 2" focusable="false">
    <PieceFinishContext.Provider value={finish}>{piece}</PieceFinishContext.Provider>
  </svg>;
}

/**
 * One turned piece: its two faces until the move lands, and the sheen. Web Animations run every part for the
 * whole sequence (`flipFrames`), so the pieces of a move start and end together however they are staggered.
 */
function TurnedPiece({ delay, totalMs, before, after, copies, paused, finish, style }: {
  readonly delay: number;
  readonly totalMs: number;
  readonly before: ReactNode;
  readonly after: ReactNode;
  /** False once the board shows the real piece again. */
  readonly copies: boolean;
  readonly paused: boolean;
  readonly finish: PieceFinish;
  readonly style: CSSProperties;
}): ReactNode {
  const box = useRef<HTMLSpanElement>(null);
  const face = useRef<HTMLSpanElement>(null);
  const back = useRef<HTMLSpanElement>(null);
  const glint = useRef<HTMLElement>(null);
  const running = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const frames = flipFrames(delay, totalMs);
    const parts: readonly [HTMLElement | null, Keyframe[]][] = [
      [box.current, frames.flip], [face.current, frames.before], [back.current, frames.after], [glint.current, frames.glint],
    ];
    const animations = parts.flatMap(([element, keyframes]) => (element && typeof element.animate === 'function'
      ? [element.animate(keyframes, { duration: totalMs, fill: 'both' })] : []));
    running.current = animations;
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, [delay, totalMs]);
  useEffect(() => {
    for (const animation of running.current) {
      if (paused) animation.pause();
      else if (animation.playState === 'paused') animation.play();
    }
  }, [paused]);
  return <span className={styles.at} style={style}>
    {copies && <span ref={box} className={styles.flip}>
      <span ref={face}><PieceCopy piece={before} finish={finish} /></span>
      <span ref={back} className={styles.after}><PieceCopy piece={after} finish={finish} /></span>
    </span>}
    <i ref={glint} className={styles.glint} />
  </span>;
}

export interface BoardFxLayerProps {
  /** The element the board fills; the layer measures it to find the drawn board. */
  readonly host: HTMLElement | null;
  readonly viewBox: readonly [number, number, number, number];
  readonly point: (id: NodeId) => BoardPoint | undefined;
  readonly effects: PieceEffects;
  readonly finish: PieceFinish;
  readonly groups: readonly BoardFxGroup[];
  /** Groups whose moving pieces are back in the board SVG; their copies are gone. */
  readonly landed: ReadonlySet<number>;
  readonly selected?: NodeId | null;
  /** Gomoku's winning line: a sheen runs along it three times, then its outline stays. */
  readonly winLine?: readonly NodeId[];
}

/** Effects over the board; markers and hints stay in the board SVG, untouched. */
export function BoardFxLayer({
  host, viewBox, point, effects, finish, groups, landed, selected, winLine,
}: BoardFxLayerProps): ReactNode {
  const [vx, vy, vw, vh] = viewBox;
  const box = useBoardBox(host, vw / vh);
  const paused = usePageHidden();
  if (!box) return null;
  const at = (where: BoardPoint, size: number, extra?: CSSProperties): CSSProperties => ({
    left: `${((where.x - vx) / vw) * 100}%`, top: `${((where.y - vy) / vh) * 100}%`, width: `${(size / vw) * 100}%`, ...extra,
  });
  const selectedAt = selected ? point(selected) : undefined;
  const line = (winLine ?? []).map(point).filter((where): where is BoardPoint => where !== undefined)
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const lineStart = line[0];
  const lineEnd = line[line.length - 1];

  return <div className={`${styles.layer} ${paused ? styles.paused : ''}`} aria-hidden="true"
    style={{ '--fx-c': effects.colour, '--fx-c2': effects.colour2 } as CSSProperties}>
    <div className={styles.box} style={box}>
      {selectedAt && <span key={selected} className={styles.at} style={at(selectedAt, 1.3)}><FxAura effects={effects} /></span>}
      {groups.map((group) => {
        const to = point(group.plan.to);
        if (!to) return null;
        const from = group.plan.from !== undefined ? point(group.plan.from) : undefined;
        const copies = !landed.has(group.id);
        const flipMs = flipSequenceMs(group.flips.map((flip) => flip.delay));
        return <span key={group.id}>
          {from && copies && <span className={styles.at} style={at(to, 2)}>
            <span className={styles.slide} style={{
              '--dx': `${((from.x - to.x) / 2) * 100}%`, '--dy': `${((from.y - to.y) / 2) * 100}%`,
            } as CSSProperties}><PieceCopy piece={group.piece} finish={finish} /></span>
          </span>}
          <span className={styles.at} style={at(to, group.plan.capture ? 1.7 : 1.1)}>
            {group.plan.capture ? <FxBurst effects={effects} late={from !== undefined} />
              : <i className={`${styles.ring} ${from ? styles.late : ''}`} />}
          </span>
          {group.flips.map((flip) => {
            const where = point(flip.node);
            return where && <TurnedPiece key={flip.node} delay={flip.delay} totalMs={flipMs} before={flip.before}
              after={flip.after} copies={copies} paused={paused} finish={finish} style={at(where, 2)} />;
          })}
        </span>;
      })}
      {lineStart && lineEnd && line.length > 1 && <span className={styles.winLine} style={{
        left: `${(((lineStart.x + lineEnd.x) / 2 - vx) / vw) * 100}%`,
        top: `${(((lineStart.y + lineEnd.y) / 2 - vy) / vh) * 100}%`,
        width: `${((Math.hypot(lineEnd.x - lineStart.x, lineEnd.y - lineStart.y) + 1) / vw) * 100}%`,
        height: `${(0.9 / vh) * 100}%`,
        transform: `translate(-50%, -50%) rotate(${Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x)}rad)`,
      }}><i /></span>}
    </div>
  </div>;
}
