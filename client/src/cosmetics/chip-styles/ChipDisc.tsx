import type { ReactNode } from 'react';
import type { ChipStyleId } from '@shared/types';
import {
  CHIP_CENTER, CHIP_DESIGNS, CHIP_FACE_RADIUS, CHIP_RIM_RADIUS, CHIP_RIM_WIDTH,
} from './chip-designs';

const RIM_CIRCUMFERENCE = 2 * Math.PI * CHIP_RIM_RADIUS;

/** Flat fills only (no gradients or ids), so many chips can share a page without reference clashes. */
export function ChipDisc({ style, className }: {
  readonly style: ChipStyleId;
  readonly className?: string;
}): ReactNode {
  const { palette, spots, emblem } = CHIP_DESIGNS[style];
  const step = 360 / spots.count;
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false" data-chip-style={style}>
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
      {emblem(palette)}
      <path d="M12 17.5A24 24 0 0 1 28 8.5" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
