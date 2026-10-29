// ─── Battleship pieces: ships and shot markers, drawn in board units around their cell's centre ───

import type { ReactNode } from 'react';
import { BS_SHIP_LENGTH } from '@shared/rules/battleship';
import type { BsShip } from '@shared/rules/battleship';
import styles from './BattleshipPieces.module.css';

/** Half the drawn width of a hull; cells are one unit apart. */
const BEAM = 0.32;

/**
 * A ship from its bow cell (the piece origin) along its length: a hull with a pointed bow and deck turrets.
 * Colours come from the piece style (`--piece-black` hull, `--piece-face` deck, `--piece-accent` trim), so
 * equipped piece styles reach the fleet. `sunk` dims the hull; `selected` outlines it while placing.
 */
export function ShipPiece({ ship, vertical, sunk = false, selected = false }: {
  readonly ship: BsShip; readonly vertical: boolean; readonly sunk?: boolean; readonly selected?: boolean;
}): ReactNode {
  const length = BS_SHIP_LENGTH[ship];
  const stern = length - 1 + 0.42;
  // Drawn pointing right; vertical ships turn a quarter round about the bow cell.
  const hull = `M-0.3 ${-BEAM}H${stern - 0.12}Q${stern} ${-BEAM} ${stern} ${-BEAM + 0.12}V${BEAM - 0.12}`
    + `Q${stern} ${BEAM} ${stern - 0.12} ${BEAM}H-0.3L-0.46 0Z`;
  const turrets = Array.from({ length: Math.max(1, length - 1) }, (_, index) => index + (length > 2 ? 0.5 : 0.35));
  return <g className={`${styles.ship} ${sunk ? styles.sunk : ''} ${selected ? styles.selected : ''}`}
    transform={vertical ? 'rotate(90)' : undefined}>
    <path className={styles.hull} d={hull} />
    <rect className={styles.deck} x={-0.12} y={-BEAM * 0.42} width={stern - 0.1} height={BEAM * 0.84} rx={BEAM * 0.4} />
    {turrets.map((x) => <circle key={x} className={styles.turret} cx={x} cy={0} r={0.1} />)}
  </g>;
}

/** A miss: a solid splash that stands out from the drawn waves. */
export function MissMarker(): ReactNode {
  return <g className={styles.miss}>
    <circle r={0.19} className={styles.splash} />
    <circle r={0.07} className={styles.drop} />
  </g>;
}

/** A hit: a burst in the side's red over whatever is underneath. */
export function HitMarker(): ReactNode {
  return <g className={styles.hit}>
    <path className={styles.burst}
      d="M0 -0.32L0.09 -0.12L0.3 -0.2L0.17 -0.02L0.32 0.13L0.11 0.12L0.06 0.32L-0.06 0.14L-0.27 0.24L-0.16 0.04L-0.32 -0.1L-0.11 -0.1Z" />
    <circle className={styles.core} r={0.08} />
  </g>;
}

/** The newest shot at a sea, outlined like the board kit's last-move marker. */
export function LastShotMarker(): ReactNode {
  return <rect className={styles.last} x={-0.47} y={-0.47} width={0.94} height={0.94} rx={0.08} />;
}
