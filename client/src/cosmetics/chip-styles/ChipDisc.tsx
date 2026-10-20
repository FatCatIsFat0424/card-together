import styles from './ChipDisc.module.css';
import type { ReactNode } from 'react';
import type { ChipStyleId } from '@shared/types';
import { useStillArt } from '../art-layers/art-layers';
import {
  CHIP_CENTER, CHIP_DESIGNS, CHIP_FACE_RADIUS, CHIP_RIM_RADIUS, CHIP_RIM_WIDTH,
} from './chip-designs';
import type { ChipDesign, ChipMotion } from './chip-designs';

const RIM_CIRCUMFERENCE = 2 * Math.PI * CHIP_RIM_RADIUS;

/** Rotation centres in the 64-unit box, as percentages of the chip. */
const ORIGINS: Partial<Record<ChipMotion, string>> = {
  warp: '50% 50%',
  propeller: `50% ${22 / 64 * 100}%`,
};

function Base({ design }: { design: ChipDesign }): ReactNode {
  const { palette, spots } = design;
  const step = 360 / spots.count;
  return <>
    <circle cx={CHIP_CENTER} cy={CHIP_CENTER} r="31" fill={palette.rim} />
    {spots.shape === 'bar' ? (
      <circle
        cx={CHIP_CENTER} cy={CHIP_CENTER} r={CHIP_RIM_RADIUS} fill="none" stroke={palette.spot} strokeWidth={CHIP_RIM_WIDTH}
        strokeDasharray={`${spots.size} ${RIM_CIRCUMFERENCE / spots.count - spots.size}`}
        strokeDashoffset={spots.size / 2} transform={`rotate(-90 ${CHIP_CENTER} ${CHIP_CENTER})`}
      />
    ) : Array.from({ length: spots.count }, (_, index) => (
      <circle
        key={index} cx={CHIP_CENTER} cy={CHIP_CENTER - CHIP_RIM_RADIUS} r={spots.size} fill={palette.spot}
        transform={`rotate(${step * index} ${CHIP_CENTER} ${CHIP_CENTER})`}
      />
    ))}
    <circle cx={CHIP_CENTER} cy={CHIP_CENTER} r="30.4" fill="none" stroke={palette.ring} strokeWidth="1.2" opacity=".85" />
    <circle cx={CHIP_CENTER} cy={CHIP_CENTER} r="23.2" fill="none" stroke={palette.ring} strokeWidth="1.4" />
    <circle cx={CHIP_CENTER} cy={CHIP_CENTER} r={CHIP_FACE_RADIUS} fill={palette.face} />
  </>;
}

const GLOSS = <path d="M12 17.5A24 24 0 0 1 28 8.5" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="2.2" strokeLinecap="round" />;

/**
 * Flat fills only (no gradients or ids), so many chips can share a page without reference clashes.
 * Animated designs stack their moving parts as separate images, in paint order, because browsers
 * repaint a whole SVG whenever anything inside it animates.
 */
export function ChipDisc({ style, className }: {
  readonly style: ChipStyleId;
  readonly className?: string;
}): ReactNode {
  const still = useStillArt();
  const design = CHIP_DESIGNS[style];
  const classes = [styles.disc, className].filter(Boolean).join(' ');
  if (!design.layers || still) {
    return (
      <svg className={classes} viewBox="0 0 64 64" aria-hidden="true" focusable="false" data-chip-style={style}>
        <Base design={design} />
        {design.emblem(design.palette)}
        {GLOSS}
      </svg>
    );
  }
  const runs: Array<{ motion?: ChipMotion; content: ReactNode[] }> = [{ content: [<Base key="base" design={design} />] }];
  design.layers.forEach((layer, index) => {
    const last = runs[runs.length - 1];
    if (!layer.motion && !last.motion) last.content.push(<g key={index}>{layer.draw(design.palette)}</g>);
    else runs.push({ motion: layer.motion, content: [<g key={index}>{layer.draw(design.palette)}</g>] });
  });
  if (runs[runs.length - 1].motion) runs.push({ content: [] });
  runs[runs.length - 1].content.push(<g key="gloss">{GLOSS}</g>);
  return (
    <span className={`${styles.layered} ${classes}`} aria-hidden="true" data-chip-style={style}>
      {runs.map(({ motion, content }, index) => {
        const image = <svg className={styles.part} viewBox="0 0 64 64" focusable="false">{content}</svg>;
        return motion ? <span key={index} className={`${styles.part} ${styles[motion]}`}
          style={{ transformOrigin: ORIGINS[motion] }}>{image}</span> : <span key={index} className={styles.part}>{image}</span>;
      })}
    </span>
  );
}
