// ─── Land Battle Chess bot deployment: a mixed strategy of structured, randomly varied formations ───
//
// The flag goes in a random headquarters, usually ringed by mines, sometimes with one mine moved to the other
// headquarters as a decoy; the rest is placed piece by piece with noisy positional preferences, so no two
// formations repeat and an observer cannot learn a fixed template.

import { LB_PIECES_PER_SIDE, LB_SLOT_POSITIONS, lbLayoutError, lbSlotProblem } from '@shared/rules/landbattle';
import type { LbRank } from '@shared/rules/landbattle';

const slotAt = (col: number, row: number): number => LB_SLOT_POSITIONS.findIndex(([c, r]) => c === col && r === row);
const isRail = (col: number, row: number): boolean => row === 0 || row === 4 || ((col === 0 || col === 4) && row <= 4);

/** Positional preference by rank and own row (front row first); railway stations add mobility. */
const ROW_PREFERENCE: Readonly<Partial<Record<LbRank, readonly number[]>>> = {
  marshal: [3, 3, 2, 1.2, 1, 0.2],
  general: [3, 3, 2, 1.2, 1, 0.2],
  'major-general': [3, 2, 2, 1.5, 1, 0.4],
  brigadier: [2, 2, 2, 2, 1.5, 0.8],
  colonel: [1.5, 1.5, 1.5, 1.5, 1.5, 1],
  major: [1.2, 1, 1, 1, 1.2, 1.2],
  engineer: [0.6, 1, 1, 1.5, 2, 1],
  captain: [2, 1, 1, 1, 1, 1.5],
  lieutenant: [2.5, 1, 1, 1, 1, 2],
  bomb: [0, 1.5, 2.5, 2.5, 1, 0.5],
};
const RAIL_PREFERENCE: Readonly<Partial<Record<LbRank, number>>> = {
  marshal: 1.6, general: 1.6, 'major-general': 1.4, engineer: 1.8, brigadier: 1.2,
};

/** Placement order: constrained and important pieces first. */
const ORDER: readonly LbRank[] = [
  'bomb', 'bomb', 'marshal', 'general', 'major-general', 'major-general', 'engineer', 'engineer', 'engineer', 'brigadier',
  'brigadier', 'colonel', 'colonel', 'major', 'major', 'captain', 'captain', 'captain', 'lieutenant', 'lieutenant', 'lieutenant',
];

function weightedPick(weights: readonly number[], random: () => number): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index];
    if (roll <= 0 && weights[index] > 0) return index;
  }
  let last = weights.length - 1;
  while (last > 0 && weights[last] <= 0) last--;
  return last;
}

/** A varied legal formation; see the module comment. */
export function botLayout(random: () => number): LbRank[] {
  for (let attempt = 0; attempt < 8; attempt++) {
    const layout = draftLayout(random);
    if (layout && lbLayoutError(layout) === null) return layout;
  }
  // Unreachable with the placement rules above; a fixed legal formation keeps the bot playing regardless.
  return fallbackLayout();
}

function draftLayout(random: () => number): LbRank[] | null {
  const layout: (LbRank | null)[] = new Array<LbRank | null>(LB_PIECES_PER_SIDE).fill(null);
  const remaining: LbRank[] = [...ORDER];
  const flagCol = random() < 0.5 ? 1 : 3;
  const decoyCol = 4 - flagCol;
  layout[slotAt(flagCol, 5)] = 'flag';
  const ring = [slotAt(flagCol - 1, 5), slotAt(flagCol + 1, 5), slotAt(flagCol, 4)];
  const decoyRing = [slotAt(decoyCol - 1, 5), slotAt(decoyCol + 1, 5), slotAt(decoyCol, 4)].filter((slot) => !ring.includes(slot));
  if (random() < 0.6) {
    for (const slot of ring) layout[slot] = 'mine';
  } else {
    // Two mines beside the flag; the third ring station takes a defender, the third mine guards the decoy.
    const open = ring[Math.floor(random() * ring.length)];
    for (const slot of ring) if (slot !== open) layout[slot] = 'mine';
    const defender: LbRank = random() < 0.5 ? 'bomb' : random() < 0.5 ? 'major-general' : 'brigadier';
    layout[open] = defender;
    remaining.splice(remaining.indexOf(defender), 1);
    const options = decoyRing.filter((slot) => layout[slot] === null);
    layout[options[Math.floor(random() * options.length)]] = 'mine';
  }
  // The other headquarters: pieces there never move, so a weak piece usually waits there as a decoy flag.
  const hq = slotAt(decoyCol, 5);
  const hqChoice: LbRank = (['lieutenant', 'lieutenant', 'captain', 'captain', 'engineer', 'major'] as const)[Math.floor(random() * 6)];
  layout[hq] = hqChoice;
  remaining.splice(remaining.indexOf(hqChoice), 1);

  let marshalCol = -1;
  for (const rank of remaining) {
    const free: number[] = [];
    const weights: number[] = [];
    layout.forEach((occupant, slot) => {
      if (occupant !== null || lbSlotProblem(rank, slot) !== null) return;
      const [col, row] = LB_SLOT_POSITIONS[slot];
      let weight = ROW_PREFERENCE[rank]?.[row] ?? 1;
      if (isRail(col, row)) weight *= RAIL_PREFERENCE[rank] ?? 1;
      // The general usually takes the other flank from the marshal.
      if (rank === 'general' && marshalCol >= 0 && Math.sign(col - 2) === Math.sign(marshalCol - 2) && col !== 2) weight *= 0.4;
      // Bombs near the flag column defend against a breakthrough.
      if (rank === 'bomb' && Math.abs(col - flagCol) <= 1) weight *= 1.4;
      free.push(slot);
      weights.push(weight * (0.35 + random()));
    });
    if (free.length === 0) return null;
    const slot = free[weightedPick(weights, random)];
    layout[slot] = rank;
    if (rank === 'marshal') marshalCol = LB_SLOT_POSITIONS[slot][0];
  }
  return layout.every((rank) => rank !== null) ? layout as LbRank[] : null;
}

function fallbackLayout(): LbRank[] {
  return [
    'major-general', 'captain', 'brigadier', 'lieutenant', 'colonel', 'engineer', 'bomb', 'captain', 'major', 'marshal',
    'brigadier', 'general', 'lieutenant', 'bomb', 'colonel', 'engineer', 'mine', 'major-general', 'major', 'captain',
    'mine', 'flag', 'mine', 'lieutenant', 'engineer',
  ];
}
