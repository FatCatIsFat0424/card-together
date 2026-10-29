// ─── Board effect layer: HTML over the board SVG, so every effect animates only transform and opacity ───

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { BoardPoint, NodeId } from '@shared/rules/board/board-model';
import type { PlayerVisibleGameState } from '@shared/types';
import { useGameStore } from '../../stores/game-store';
import { useConnectionReady } from '../use-connection-ready';
import { BOARD_FX_LIMITS, boardFxPlan, boardFxTiming, burstParticles, flipDelays } from './board-effects';
import type { BoardFxPlan } from './board-effects';
import type { EffectAura, EffectParticle, PieceEffects, PieceFinish } from './board-theme';
import { PieceFinishContext } from './BoardPieces';
import styles from './BoardEffects.module.css';

/** One move's effects, mounted until its last animation ends. */
export interface BoardFxGroup {
  readonly id: number;
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
  /** Groups whose pieces are back in the board SVG. */
  readonly shown: readonly number[];
  /** Pieces as drawn for `visible`, so a turned piece's earlier look is known. */
  readonly drawn: ReadonlyMap<NodeId, ReactNode>;
}

let nextGroupId = 1;

/** Builds the effect group of a move, or `null` when its pieces are not on this board. */
export function boardFxGroup(
  plan: BoardFxPlan, pieces: ReadonlyMap<NodeId, ReactNode>, previous: ReadonlyMap<NodeId, ReactNode>,
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
  return { id: nextGroupId++, plan, piece, flips, hides, hideMs, totalMs };
}

const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

/**
 * Effect groups for new moves at a live board. Plans are derived while rendering, so the board hides a moving
 * piece in the same paint that shows the new position, and shows it again once: two board repaints per move.
 * Nothing plays on the first snapshot, after a reconnect, on a replay seek or restore, or while the page is
 * hidden. At most three groups stay mounted; a fourth replaces the oldest. The effect layer unmounts finished
 * groups itself, so ending an effect never re-renders the board.
 */
export function useBoardFx(enabled: boolean, pieces: readonly { readonly node: NodeId; readonly piece: ReactNode }[]): {
  readonly groups: readonly BoardFxGroup[];
  readonly hidden: ReadonlySet<NodeId>;
} {
  const visible = useGameStore((store) => store.visible);
  const ready = useConnectionReady();
  const [state, setState] = useState<FxState>(() => ({
    visible, ready, stale: false, groups: [], shown: [], drawn: new Map(pieces.map((item) => [item.node, item.piece])),
  }));
  let current = state;
  if (ready !== current.ready) current = { ...current, ready, stale: current.stale || !ready };
  if (visible !== current.visible) {
    const drawn = new Map(pieces.map((item) => [item.node, item.piece]));
    const plan = enabled && !current.stale && !pageHidden() ? boardFxPlan(current.visible, visible) : null;
    const group = plan ? boardFxGroup(plan, drawn, current.drawn) : null;
    const groups = group ? [...current.groups.slice(1 - BOARD_FX_LIMITS.groups), group] : current.groups;
    current = {
      ...current, visible, stale: false, drawn, groups, shown: current.shown.filter((id) => groups.some((item) => item.id === id)),
    };
  }
  if (current !== state) setState(current);

  // Showing the moved pieces again is the board's second and last repaint for a move.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const group of state.groups) {
      if (timers.current.has(group.id) || group.hides.length === 0) continue;
      timers.current.set(group.id, setTimeout(() => setState((now) => ({ ...now, shown: [...now.shown, group.id] })), group.hideMs));
    }
  }, [state.groups]);
  useEffect(() => () => {
    for (const pending of timers.current.values()) clearTimeout(pending);
    timers.current.clear();
  }, []);

  const hidden = new Set(current.groups.filter((group) => !current.shown.includes(group.id)).flatMap((group) => group.hides));
  return { groups: enabled ? current.groups : [], hidden: enabled ? hidden : new Set() };
}

/** Groups still animating; each unmounts when its last animation ends, re-rendering only the effect layer. */
function usePlayingGroups(groups: readonly BoardFxGroup[]): readonly BoardFxGroup[] {
  const [finished, setFinished] = useState<readonly number[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const group of groups) {
      if (timers.current.has(group.id)) continue;
      timers.current.set(group.id, setTimeout(() => setFinished((now) => [...now.slice(-BOARD_FX_LIMITS.groups), group.id]),
        group.totalMs));
    }
  }, [groups]);
  useEffect(() => () => {
    for (const pending of timers.current.values()) clearTimeout(pending);
  }, []);
  return groups.filter((group) => !finished.includes(group.id));
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

/** A capture burst: an impact ring and the style's particles flying out. */
export function FxBurst({ effects, delay = 0 }: { readonly effects: PieceEffects; readonly delay?: number }): ReactNode {
  const size = PARTICLE_SIZE[effects.particle];
  return <>
    <i className={styles.ring} style={{ animationDelay: `${delay}ms` }} />
    {effects.aura === 'neon' && <i className={`${styles.ring} ${styles.ring2}`} style={{ animationDelay: `${delay + 80}ms` }} />}
    <i className={styles.burst} style={{ animationDelay: `${delay}ms` }}>
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

export interface BoardFxLayerProps {
  /** The element the board fills; the layer measures it to find the drawn board. */
  readonly host: HTMLElement | null;
  readonly viewBox: readonly [number, number, number, number];
  readonly point: (id: NodeId) => BoardPoint | undefined;
  readonly effects: PieceEffects;
  readonly finish: PieceFinish;
  readonly groups: readonly BoardFxGroup[];
  readonly selected?: NodeId | null;
  /** Gomoku's winning line: a sheen runs along it three times, then its outline stays. */
  readonly winLine?: readonly NodeId[];
}

/** Effects over the board; markers and hints stay in the board SVG, untouched. */
export function BoardFxLayer({ host, viewBox, point, effects, finish, groups, selected, winLine }: BoardFxLayerProps): ReactNode {
  const [vx, vy, vw, vh] = viewBox;
  const box = useBoardBox(host, vw / vh);
  const paused = usePageHidden();
  const playing = usePlayingGroups(groups);
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
      {playing.map((group) => {
        const to = point(group.plan.to);
        if (!to) return null;
        const from = group.plan.from !== undefined ? point(group.plan.from) : undefined;
        const landed = from ? BOARD_FX_LIMITS.slideMs - 80 : 0;
        return <span key={group.id}>
          {from && <span className={styles.at} style={at(to, 2)}>
            <span className={styles.slide} style={{
              '--dx': `${((from.x - to.x) / 2) * 100}%`, '--dy': `${((from.y - to.y) / 2) * 100}%`,
            } as CSSProperties}><PieceCopy piece={group.piece} finish={finish} /></span>
          </span>}
          <span className={styles.at} style={at(to, group.plan.capture ? 1.7 : 1.1)}>
            {group.plan.capture ? <FxBurst effects={effects} delay={landed} />
              : <i className={styles.ring} style={{ animationDelay: `${landed}ms` }} />}
          </span>
          {group.flips.map((flip) => {
            const where = point(flip.node);
            return where && <span key={flip.node} className={styles.at} style={at(where, 2)}>
              <span className={styles.flip} style={{ animationDelay: `${flip.delay}ms` }}>
                <span className={styles.before} style={{ animationDelay: `${flip.delay}ms` }}>
                  <PieceCopy piece={flip.before} finish={finish} />
                </span>
                <span className={styles.after} style={{ animationDelay: `${flip.delay}ms` }}>
                  <PieceCopy piece={flip.after} finish={finish} />
                </span>
              </span>
              <i className={styles.glint} style={{ '--d': `${flip.delay + BOARD_FX_LIMITS.flipMs / 2}ms` } as CSSProperties} />
            </span>;
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
