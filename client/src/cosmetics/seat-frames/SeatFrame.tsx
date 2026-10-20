import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useStillArt } from '../art-layers/art-layers';
import { borderOrbitKeyframes } from './border-orbit';
import { SEAT_FRAME_MOTIFS, motifMotion, seatFrameDesign } from './seat-frame-designs';
import type { MotifMotion, MotifPart, SeatFrameDesign } from './seat-frame-designs';
import styles from './SeatFrame.module.css';

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/** Designs whose fx2 mark circles the frame on turn: start of the lap and seconds per lap. */
const ORBITS: Partial<Record<SeatFrameDesign, { from: number; seconds: number }>> = {
  constellation: { from: 0.12, seconds: 3.4 },
  neoncity: { from: 0.15, seconds: 2.5 },
};

/**
 * Class for the element that contains the frame. It carries the frame palette and turn-glow
 * colours, so the host can restyle its own border and time bar to match the frame.
 */
export function seatFrameHostClass(frame: string | null | undefined): string {
  const design = seatFrameDesign(frame);
  return design ? styles[design] : '';
}

/**
 * Static parts share one image; each animated part gets its own, in paint order, because browsers
 * repaint a whole SVG when anything inside it animates.
 */
function CornerImages({ design, parts }: { design: SeatFrameDesign; parts: readonly MotifPart[] }): ReactNode {
  const runs: Array<{ motion: MotifMotion | null; parts: MotifPart[] }> = [];
  parts.forEach((part, index) => {
    const motion = motifMotion(design, part, index);
    const last = runs[runs.length - 1];
    if (!motion && last && !last.motion) last.parts.push(part);
    else runs.push({ motion, parts: [part] });
  });
  return runs.map(({ motion, parts: group }, index) => {
    const image = <svg className={styles.part} viewBox="0 0 24 24" focusable="false">
      {group.map((part, partIndex) => <path key={partIndex} className={styles[part.kind]} d={part.d} transform={part.transform} />)}
    </svg>;
    if (!motion) return <Fragment key={index}>{image}</Fragment>;
    // The animation runs on an HTML wrapper: browsers do not composite animations on SVG elements.
    const origin = group[0].origin;
    return <span key={index} className={`${styles.part} ${styles[motion]}`}
      style={origin ? { transformOrigin: `${origin[0] / 24 * 100}% ${origin[1] / 24 * 100}%` } : undefined}>{image}</span>;
  });
}

/**
 * Runs a design's border orbit on the compositor, refitting the path when the frame resizes. While it
 * runs, `data-orbit` replaces the static CSS motion path that places the mark when idle.
 */
function useBorderOrbit(design: SeatFrameDesign | null, active: boolean, markRef: RefObject<HTMLSpanElement | null>): void {
  const orbit = design ? ORBITS[design] : undefined;
  useEffect(() => {
    const mark = markRef.current;
    const frame = mark?.parentElement;
    if (!active || !orbit || !mark || !frame || typeof mark.animate !== 'function') return;
    let animation: Animation | null = null;
    const start = (): void => {
      const radius = parseFloat(getComputedStyle(frame).borderTopLeftRadius) || 0;
      const keyframes = borderOrbitKeyframes({ width: frame.clientWidth, height: frame.clientHeight, radius },
        { width: mark.offsetWidth, height: mark.offsetHeight }, orbit.from, orbit.from + 1);
      const elapsed = animation?.currentTime ?? 0;
      animation?.cancel();
      animation = mark.animate(keyframes, { duration: orbit.seconds * 1000, iterations: Infinity });
      animation.currentTime = elapsed;
    };
    mark.dataset.orbit = '';
    start();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(start) : null;
    resize?.observe(frame);
    return () => {
      resize?.disconnect();
      animation?.cancel();
      delete mark.dataset.orbit;
    };
  }, [active, orbit, markRef]);
}

/**
 * Decorative frame drawn over a seat plate or room seat card. The host must be positioned and
 * keep its padding clear of the plate corners, because the layer paints above plain content.
 * `turn` swaps the idle ornament for the matching turn glow.
 */
export function SeatFrame({ frame, turn = false }: {
  readonly frame: string | null | undefined;
  readonly turn?: boolean;
}): ReactNode {
  const design = seatFrameDesign(frame);
  const still = useStillArt();
  const orbitRef = useRef<HTMLSpanElement>(null);
  useBorderOrbit(design, turn && !still, orbitRef);
  if (!design) return null;
  const motif = SEAT_FRAME_MOTIFS[design];
  return (
    <span className={`${styles.frame} ${styles[design]}`} data-seat-frame={design}
      data-turn={turn ? 'true' : undefined} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.fx} />
      <span className={styles.fx2} ref={orbitRef} />
      {CORNERS.map((corner) => (
        <span key={corner} className={`${styles.corner} ${styles[corner]}`}>
          <CornerImages design={design} parts={corner === 'tr' || corner === 'bl' ? motif.alt ?? motif.main : motif.main} />
        </span>
      ))}
    </span>
  );
}
