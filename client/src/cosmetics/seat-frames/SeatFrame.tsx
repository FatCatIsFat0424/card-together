import type { ReactNode } from 'react';
import { SEAT_FRAME_MOTIFS, seatFrameDesign } from './seat-frame-designs';
import styles from './SeatFrame.module.css';

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/**
 * Class for the element that contains the frame. It carries the frame palette and turn-glow
 * colours, so the host can restyle its own border and time bar to match the frame.
 */
export function seatFrameHostClass(frame: string | null | undefined): string {
  const design = seatFrameDesign(frame);
  return design ? styles[design] : '';
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
  if (!design) return null;
  const motif = SEAT_FRAME_MOTIFS[design];
  return (
    <span className={`${styles.frame} ${styles[design]}`} data-seat-frame={design}
      data-turn={turn ? 'true' : undefined} aria-hidden="true">
      <span className={styles.ring} />
      <span className={styles.fx} />
      <span className={styles.fx2} />
      {CORNERS.map((corner) => (
        <svg key={corner} className={`${styles.corner} ${styles[corner]}`} viewBox="0 0 24 24" focusable="false">
          {(corner === 'tr' || corner === 'bl' ? motif.alt ?? motif.main : motif.main).map((part, index) => (
            <path key={index} className={styles[part.kind]} d={part.d} transform={part.transform} />
          ))}
        </svg>
      ))}
    </span>
  );
}
