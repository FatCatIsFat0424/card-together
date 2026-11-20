// ─── Land Battle Chess identity inference: joint samples of the opponent's hidden pieces ───
//
// The posterior over the opponent's identities combines three parts:
// - hard constraints from the public replay (`landbattle-knowledge.ts`) and the exact identity counts;
// - a generic deployment prior: a mixture of the four formations the deployment screen offers (mirrored, and
//   loosened so edited copies still fit) and a broad table of legal formations;
// - a generic behaviour likelihood: how any player's pieces of each identity tend to act (stronger pieces
//   attack and approach proven pieces; weaker ones step away from them; pieces that never move lean toward
//   mines). Nothing is specific to one player.
// The formation component is drawn from its approximate posterior first, then identities come from a
// Metropolis chain of swaps between tokens, which keeps every count and constraint exact.

import {
  LB_COUNTS, LB_PIECES_PER_SIDE, LB_PRESETS, LB_RANKS, lbIsHq, lbMirrorLayout, lbRandomLayout, lbSlotOf, lbSlotProblem,
} from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import { botLayout } from './landbattle-deploy';
import type { LbKnowledge } from './landbattle-knowledge';
import { seededRandom } from './search/seeded-random';
import { BOMB, FLAG, LOSE_BATTLE, MINE, OUTCOME, RANK_COUNT, WIN_BATTLE } from './landbattle-world';

const SLOTS = LB_PIECES_PER_SIDE;
const COUNTS: readonly number[] = LB_RANKS.map((rank) => LB_COUNTS[rank]);

/** Share of the prior on the screen's preset formations, spread over the presets and their mirror images. */
const PRESET_SHARE = 0.35;
/** Probability mass a preset component leaves to the broad table, so edited presets still fit. */
const PRESET_LOOSENESS = 0.3;

/** Behaviour likelihood factors; each is a mild, generic tendency. */
export const BEHAVIOUR = {
  /** Relative tendency of each identity to start battles */
  attack: [1.5, 1.45, 1.3, 1.15, 1.05, 1, 0.95, 0.9, 0.85, 0, 1.5, 0] as readonly number[],
  /** Likelihood of stepping next to a proven own piece it would lose to (bombs excepted) */
  approachWeaker: 0.55,
  /** Likelihood of stepping away from a proven own piece it would beat */
  fleeStronger: 0.55,
  /** Mobile identities of a never-moved piece lose this much log-likelihood per opponent move per 25 pieces */
  stillness: 0.25,
};

/** Per-slot identity probabilities, `slot * RANK_COUNT + rank`. */
type SlotTable = Float64Array;

function tableFromLayouts(layouts: readonly (readonly LbRank[])[]): SlotTable {
  const table = new Float64Array(SLOTS * RANK_COUNT);
  for (const layout of layouts) layout.forEach((rank, slot) => { table[slot * RANK_COUNT + LB_RANKS.indexOf(rank)] += 1; });
  return normalizeSlots(table);
}

function normalizeSlots(table: SlotTable): SlotTable {
  for (let slot = 0; slot < SLOTS; slot++) {
    let total = 0;
    for (let rank = 0; rank < RANK_COUNT; rank++) total += table[slot * RANK_COUNT + rank];
    if (total > 0) for (let rank = 0; rank < RANK_COUNT; rank++) table[slot * RANK_COUNT + rank] /= total;
  }
  return table;
}

/** Every legal identity of a slot, weighted by its count over the slots it may take. */
function uniformTable(): SlotTable {
  const table = new Float64Array(SLOTS * RANK_COUNT);
  LB_RANKS.forEach((rank, index) => {
    const slots = Array.from({ length: SLOTS }, (_, slot) => slot).filter((slot) => lbSlotProblem(rank, slot) === null);
    for (const slot of slots) table[slot * RANK_COUNT + index] = COUNTS[index] / slots.length;
  });
  return normalizeSlots(table);
}

interface Prior {
  /** Log probabilities per component */
  readonly components: readonly SlotTable[];
  readonly logWeight: readonly number[];
  /** The broad table on its own (component 0), also used for what the opponent expects of our pieces */
  readonly broad: SlotTable;
}

let cachedPrior: Prior | null = null;

/** The deployment prior, built once per process from seeded formation samples. */
export function deploymentPrior(): Prior {
  if (cachedPrior) return cachedPrior;
  const random = seededRandom(20_261_120);
  const sampled: LbRank[][] = [];
  for (let index = 0; index < 100; index++) sampled.push(lbRandomLayout(random), botLayout(random));
  const fromSamples = tableFromLayouts(sampled);
  const uniform = uniformTable();
  const broad = new Float64Array(SLOTS * RANK_COUNT);
  for (let index = 0; index < broad.length; index++) broad[index] = 0.75 * fromSamples[index] + 0.25 * uniform[index];
  normalizeSlots(broad);
  const presets = LB_PRESETS.flatMap((preset) => [preset, lbMirrorLayout(preset)]);
  const components: SlotTable[] = [broad.map(Math.log)];
  const logWeight = [Math.log(1 - PRESET_SHARE)];
  for (const preset of presets) {
    const table = new Float64Array(SLOTS * RANK_COUNT);
    for (let slot = 0; slot < SLOTS; slot++) {
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        const exact = LB_RANKS[rank] === preset[slot] ? 1 - PRESET_LOOSENESS : 0;
        table[slot * RANK_COUNT + rank] = Math.log(exact + PRESET_LOOSENESS * broad[slot * RANK_COUNT + rank] + 1e-9);
      }
    }
    components.push(table);
    logWeight.push(Math.log(PRESET_SHARE / presets.length));
  }
  cachedPrior = { components, logWeight, broad };
  return cachedPrior;
}

/** Sampler state for one decision. */
export interface Inference {
  /** Opponent tokens (deployment stations) */
  readonly tokens: readonly number[];
  readonly slots: Int8Array;
  /** Allowed identities per token as bit masks */
  readonly allowed: Int16Array;
  /** Behaviour log-likelihood, `token index * RANK_COUNT + rank` */
  readonly behaviour: Float64Array;
  /** Posterior probability of each prior component */
  readonly componentOdds: Float64Array;
  /** Warm chain state per component, null until first used */
  readonly chains: (Int8Array | null)[];
  /** Whether the tokens cover a whole deployment, so identity counts are exact */
  readonly exact: boolean;
}

/** Generic behaviour log-likelihood of each identity for one token. */
function behaviourLikelihood(knowledge: LbKnowledge, token: number, out: Float64Array, offset: number): void {
  const record = knowledge.behaviour.get(token);
  if (!record) return;
  for (let rank = 0; rank < RANK_COUNT; rank++) {
    let log = 0;
    const attack = BEHAVIOUR.attack[rank];
    if (record.attacks > 0 && attack > 0) log += Math.min(record.attacks, 2) * Math.log(attack);
    for (const own of record.approached) {
      const outcome = OUTCOME[rank * RANK_COUNT + LB_RANKS.indexOf(own)];
      if (rank !== BOMB && outcome === LOSE_BATTLE) log += Math.log(BEHAVIOUR.approachWeaker);
    }
    for (const own of record.fled) {
      if (OUTCOME[rank * RANK_COUNT + LB_RANKS.indexOf(own)] === WIN_BATTLE) log += Math.log(BEHAVIOUR.fleeStronger);
    }
    if (!record.moved && !lbIsHq(token) && rank !== MINE && rank !== FLAG) {
      log -= BEHAVIOUR.stillness * knowledge.opponentMoves / SLOTS;
    }
    out[offset + rank] = log;
  }
}

export function createInference(knowledge: LbKnowledge): Inference {
  const prior = deploymentPrior();
  const opponent: LbSide = knowledge.side === 0 ? 1 : 0;
  const tokens = knowledge.tokens;
  const slots = Int8Array.from(tokens, (token) => lbSlotOf(opponent, token));
  const allowed = Int16Array.from(tokens, (token) => {
    let mask = 0;
    for (const rank of knowledge.allowed.get(token) ?? []) mask |= 1 << LB_RANKS.indexOf(rank);
    return mask;
  });
  const behaviour = new Float64Array(tokens.length * RANK_COUNT);
  tokens.forEach((token, index) => behaviourLikelihood(knowledge, token, behaviour, index * RANK_COUNT));
  // Approximate evidence of each component: tokens independent given the component, counts ignored.
  const logEvidence = prior.components.map((table, component) => {
    let total = prior.logWeight[component];
    tokens.forEach((_, index) => {
      let sum = 0;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        if ((allowed[index] & (1 << rank)) === 0) continue;
        sum += Math.exp((slots[index] >= 0 ? table[slots[index] * RANK_COUNT + rank] : 0) + behaviour[index * RANK_COUNT + rank]);
      }
      total += Math.log(sum + 1e-300);
    });
    return total;
  });
  const top = Math.max(...logEvidence);
  const componentOdds = Float64Array.from(logEvidence, (log) => Math.exp(log - top));
  const sum = componentOdds.reduce((total, odds) => total + odds, 0);
  for (let index = 0; index < componentOdds.length; index++) componentOdds[index] /= sum;
  return {
    tokens, slots, allowed, behaviour, componentOdds, chains: prior.components.map(() => null),
    exact: tokens.length === LB_PIECES_PER_SIDE,
  };
}

/** Log weight of one identity for one token; a token off the deployment slots (hand-made positions) has no prior. */
function logWeightOf(inference: Inference, table: SlotTable, index: number, rank: number): number {
  const slot = inference.slots[index];
  return (slot >= 0 ? table[slot * RANK_COUNT + rank] : 0) + inference.behaviour[index * RANK_COUNT + rank];
}

/**
 * A complete assignment drawn token by token in proportion to the weights. With exact counts, an identity
 * with exactly as many candidate tokens left as copies goes to those tokens at once; otherwise the token
 * with the fewest choices is drawn next. Null when every attempt runs into a contradiction.
 */
function initialAssignment(inference: Inference, table: SlotTable, random: () => number): Int8Array | null {
  const count = inference.tokens.length;
  for (let attempt = 0; attempt < 12; attempt++) {
    const left = [...COUNTS];
    const assignment = new Int8Array(count).fill(-1);
    let open = count;
    let failed = false;
    const assign = (index: number, rank: number): void => {
      assignment[index] = rank;
      left[rank]--;
      open--;
    };
    while (open > 0 && !failed) {
      let forced = false;
      if (inference.exact) {
        for (let rank = 0; rank < RANK_COUNT && !forced && !failed; rank++) {
          if (left[rank] === 0) continue;
          let candidates = 0;
          for (let index = 0; index < count; index++) {
            if (assignment[index] < 0 && (inference.allowed[index] & (1 << rank)) !== 0) candidates++;
          }
          if (candidates < left[rank]) failed = true;
          else if (candidates === left[rank]) {
            for (let index = 0; index < count; index++) {
              if (assignment[index] < 0 && (inference.allowed[index] & (1 << rank)) !== 0) assign(index, rank);
            }
            forced = true;
          }
        }
      }
      if (failed || forced) continue;
      let chosen = -1;
      let fewest = RANK_COUNT + 1;
      for (let index = 0; index < count; index++) {
        if (assignment[index] >= 0) continue;
        let options = 0;
        for (let rank = 0; rank < RANK_COUNT; rank++) if (left[rank] > 0 && (inference.allowed[index] & (1 << rank)) !== 0) options++;
        if (options < fewest) [chosen, fewest] = [index, options];
      }
      if (fewest === 0) {
        failed = true;
        continue;
      }
      const weights: number[] = [];
      let total = 0;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        const usable = left[rank] > 0 && (inference.allowed[chosen] & (1 << rank)) !== 0;
        const weight = usable ? Math.exp(logWeightOf(inference, table, chosen, rank)) * left[rank] + 1e-12 : 0;
        weights.push(weight);
        total += weight;
      }
      let roll = random() * total;
      let pick = RANK_COUNT - 1;
      while (pick > 0 && weights[pick] <= 0) pick--;
      for (let rank = 0; rank < RANK_COUNT; rank++) {
        roll -= weights[rank];
        if (roll <= 0 && weights[rank] > 0) {
          pick = rank;
          break;
        }
      }
      assign(chosen, pick);
    }
    if (!failed) return assignment;
  }
  return null;
}

/** Metropolis steps: swap two tokens' identities (or, with spare copies, change one) when both still fit. */
function advanceChain(inference: Inference, table: SlotTable, assignment: Int8Array, steps: number, random: () => number): void {
  const count = assignment.length;
  if (count < 2) return;
  const used = new Array<number>(RANK_COUNT).fill(0);
  if (!inference.exact) for (const rank of assignment) used[rank]++;
  for (let step = 0; step < steps; step++) {
    const i = Math.floor(random() * count);
    const ri = assignment[i];
    if (!inference.exact && random() < 0.3) {
      const rank = Math.floor(random() * RANK_COUNT);
      if (rank === ri || used[rank] >= COUNTS[rank] || (inference.allowed[i] & (1 << rank)) === 0) continue;
      const delta = logWeightOf(inference, table, i, rank) - logWeightOf(inference, table, i, ri);
      if (delta >= 0 || Math.log(random()) < delta) {
        assignment[i] = rank;
        used[ri]--;
        used[rank]++;
      }
      continue;
    }
    const j = Math.floor(random() * count);
    const rj = assignment[j];
    if (ri === rj || (inference.allowed[i] & (1 << rj)) === 0 || (inference.allowed[j] & (1 << ri)) === 0) continue;
    const delta = logWeightOf(inference, table, i, rj) + logWeightOf(inference, table, j, ri)
      - logWeightOf(inference, table, i, ri) - logWeightOf(inference, table, j, rj);
    if (delta >= 0 || Math.log(random()) < delta) {
      assignment[i] = rj;
      assignment[j] = ri;
    }
  }
}

/** Steps between consecutive samples of a warm chain, and the extra steps a freshly started chain takes. */
const THIN = 60;
const BURN_IN = 400;

/**
 * One joint sample: identity indices aligned with `inference.tokens`. Null when the constraints cannot be
 * met (a log the replay could not follow).
 */
export function sampleAssignment(inference: Inference, random: () => number): Int8Array | null {
  const prior = deploymentPrior();
  let roll = random();
  let component = inference.componentOdds.length - 1;
  for (let index = 0; index < inference.componentOdds.length; index++) {
    roll -= inference.componentOdds[index];
    if (roll <= 0) {
      component = index;
      break;
    }
  }
  const table = prior.components[component];
  let chain = inference.chains[component];
  if (!chain) {
    chain = initialAssignment(inference, table, random);
    if (!chain) return null;
    inference.chains[component] = chain;
    advanceChain(inference, table, chain, BURN_IN, random);
  }
  advanceChain(inference, table, chain, THIN, random);
  return Int8Array.from(chain);
}

/** Identity probabilities per token, `token index * RANK_COUNT + rank`, averaged over `samples` draws. */
export function estimateMarginals(inference: Inference, random: () => number, samples: number): Float64Array | null {
  const odds = new Float64Array(inference.tokens.length * RANK_COUNT);
  let drawn = 0;
  for (let sample = 0; sample < samples; sample++) {
    const assignment = sampleAssignment(inference, random);
    if (!assignment) continue;
    assignment.forEach((rank, index) => { odds[index * RANK_COUNT + rank] += 1; });
    drawn++;
  }
  if (drawn === 0) return null;
  for (let index = 0; index < odds.length; index++) odds[index] /= drawn;
  return odds;
}

/** The deployment rules' allowed identities of a slot as a bit mask. */
export function slotMask(slot: number): number {
  let mask = 0;
  LB_RANKS.forEach((rank, index) => { if (lbSlotProblem(rank, slot) === null) mask |= 1 << index; });
  return mask;
}
