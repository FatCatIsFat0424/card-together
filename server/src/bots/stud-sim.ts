import type { GameSeat, StudAction, StudVisibleState } from '@shared/types';
import { HE_HANDS, heInHand, heLegalActions } from '@shared/rules/holdem';
import type { HeLegalActions } from '@shared/rules/holdem';
import { STUD_FINAL_STREET, studStakes } from '@shared/rules/stud';
import { cardId, evaluateIds } from './holdem-evaluator';
import { betFraction, holeLikelihoods, lineObservations, lineProbabilities } from './stud-model';
import { studStrength } from './stud-strength';

// Expected-value decisions for five-card stud by sampling whole hands. Each sample ("world") deals the
// opponents' hole cards from the likelihood of the betting line they showed this hand, and the cards still to
// come at random. Every candidate action is then played out in that same world: the other seats, and the bot
// itself after the first move, bet with the generic line model, so a raise earns the folds that hands it would
// scare off really fold, and a call pays for the later streets. A world is scored by how likely the final
// chip counts leave the bot with the most chips after the last hand, which prices variance by the match clock.

const MAX_RAISES = 3;
/** Extra equity the bot asks of itself, over the line model, when it plays on after the first move. */
const OWN_MARGIN = 0.03;
const BET_SHARES: readonly number[] = [0.4, 0.8, 1.5];
const SEATS_MAX = 8;
/**
 * The match-win utility assumes the bot out-earns the table by `DRIFT` minimum bets per remaining hand and that
 * chip swings are `SPREAD_SCALE` times a typical hand's: early on that makes a pot's chips count nearly in full
 * and a gamble for the whole stack a poor trade, while the last hands still reward protecting or chasing a lead.
 */
const DRIFT = 2;
const SPREAD_SCALE = 2;
/** Utility difference (match-win chance) below which two candidates count as equal. */
const INDIFFERENCE = 0.004;
const SUIT_RANK = [3, 2, 0, 1];

export type CandidateKind = 'fold' | 'call' | 'raise';

export interface StudCandidate {
  readonly kind: CandidateKind;
  /** Total stake on this street after a raise */
  readonly to: number;
  readonly action: StudAction;
}

export interface StudEvaluation {
  readonly candidates: readonly StudCandidate[];
  /** Mean match-win utility per candidate */
  readonly values: readonly number[];
  readonly worlds: number;
}

export interface StudLimits {
  readonly minWorlds: number;
  readonly maxWorlds: number;
  /** Milliseconds left to think; sampling stops when it is spent */
  readonly timeLeftMs: () => number;
}

/** Candidate actions from the legal ones: fold or check, call, and raises at several sizes (the last one all in). */
export function studCandidates(visible: StudVisibleState, legal: HeLegalActions): StudCandidate[] {
  const candidates: StudCandidate[] = [];
  if (legal.check) candidates.push({ kind: 'call', to: visible.currentBet, action: { type: 'check' } });
  else {
    candidates.push({ kind: 'fold', to: 0, action: { type: 'fold' } });
    candidates.push({ kind: 'call', to: visible.currentBet, action: { type: 'call' } });
  }
  const bounds = legal.raise;
  if (bounds) {
    const pot = Object.values(visible.totalBets).reduce((sum, bet) => sum + bet, 0);
    const targets = new Set<number>();
    for (const share of BET_SHARES) {
      const to = Math.round(visible.currentBet + share * (pot + legal.call));
      targets.add(Math.min(bounds.max, Math.max(bounds.min, to)));
    }
    targets.add(bounds.max);
    const sorted = [...targets].sort((a, b) => a - b);
    // A raise that leaves almost nothing behind is the all-in.
    for (const to of sorted) {
      if (to < bounds.max && bounds.max - to < 0.25 * bounds.max) continue;
      candidates.push({ kind: 'raise', to, action: { type: 'raise', to } });
    }
  }
  return candidates;
}

/** Hash of the world, a seat, a street, and a step to a number in [0, 1): the same draw whatever the candidate. */
function unit(seed: number, seat: number, street: number, step: number): number {
  let hash = seed ^ Math.imul(seat + 1, 0x9e3779b1) ^ Math.imul(street + 7, 0x85ebca6b) ^ Math.imul(step + 13, 0xc2b2ae35);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

/** Spread in chips of the difference between two seats over the hands still to play after this one. */
function matchSpread(hand: number): number {
  let variance = 0;
  for (let next = hand + 1; next <= HE_HANDS; next++) variance += (2.5 * studStakes(next).minBet) ** 2;
  return SPREAD_SCALE * Math.max(12, Math.sqrt(2 * variance));
}

/** Chips the bot expects to win from the hands after this one: a share of each hand's minimum bet. */
function matchDrift(hand: number): number {
  let total = 0;
  for (let next = hand + 1; next <= HE_HANDS; next++) total += studStakes(next).minBet;
  return total * DRIFT;
}

/** Showing-hand order key of the first `count` up cards: counts, then ranks, then suits, as `studCompareShowing`. */
function showingKey(cards: Int8Array, base: number, count: number): number {
  const rank: number[] = [];
  const size: number[] = [];
  const suit: number[] = [];
  for (let index = 0; index < count; index++) {
    const id = cards[base + index];
    const value = (id >> 2) + 2;
    const strength = SUIT_RANK[id & 3];
    const found = rank.indexOf(value);
    if (found >= 0) {
      size[found] += 1;
      suit[found] = Math.max(suit[found], strength);
    } else {
      rank.push(value);
      size.push(1);
      suit.push(strength);
    }
  }
  const order = rank.map((_, index) => index)
    .sort((a, b) => size[b] - size[a] || rank[b] - rank[a]);
  let sizes = 0;
  let ranks = 0;
  let suits = 0;
  for (let slot = 0; slot < 4; slot++) {
    const group = order[slot];
    sizes = sizes * 5 + (group === undefined ? 0 : size[group]);
    ranks = ranks * 15 + (group === undefined ? 0 : rank[group]);
    suits = suits * 4 + (group === undefined ? 0 : suit[group]);
  }
  return (sizes * 50625 + ranks) * 256 + suits;
}

interface Sim {
  readonly n: number;
  readonly me: number;
  readonly street: number;
  readonly minBet: number;
  readonly spread: number;
  /** Chips the bot is expected to win over the hands still to play after this one */
  readonly drift: number;
  /** Dealt seats in order; a seat's index in this list is its index in every array below */
  readonly dealt: readonly GameSeat[];
  readonly base: {
    readonly chips: Float64Array; readonly streetBet: Float64Array; readonly total: Float64Array;
    readonly folded: Uint8Array; readonly acted: Uint8Array; readonly currentBet: number; readonly minRaise: number;
  };
  /** Free card ids, cumulative likelihood per opponent over their own candidate list */
  readonly pool: Int8Array;
  readonly cumulative: readonly (Float64Array | null)[];
  readonly knownUp: readonly (readonly number[])[];
  readonly hole: number;
  // Per-rollout working state
  readonly cards: Int8Array;
  readonly chips: Float64Array;
  readonly streetBet: Float64Array;
  readonly total: Float64Array;
  readonly folded: Uint8Array;
  readonly acted: Uint8Array;
  readonly strengths: Float64Array;
  readonly showing: Float64Array;
  readonly free: Int8Array;
  readonly used: Uint8Array;
  currentBet: number;
  minRaise: number;
  raises: number;
  step: number;
  seed: number;
}

function buildSim(visible: StudVisibleState): Sim | null {
  const dealt = [...visible.dealt];
  const n = dealt.length;
  const me = dealt.indexOf(visible.mySeat);
  if (me < 0 || visible.myHand.length === 0 || n > SEATS_MAX) return null;
  const street = visible.street;
  const array = (pick: (seat: GameSeat) => number): Float64Array => Float64Array.from(dealt.map(pick));
  const knownUp = dealt.map((seat) => visible.up[seat].map(cardId));
  const seen = new Uint8Array(52);
  seen[cardId(visible.myHand[0])] = 1;
  for (const ids of knownUp) for (const id of ids) seen[id] = 1;
  const pool = Int8Array.from(Array.from({ length: 52 }, (_, id) => id).filter((id) => !seen[id]));
  const observations = lineObservations(visible);
  const live = new Set(heInHand(visible));
  const cumulative = dealt.map((seat, index) => {
    if (index === me || !live.has(seat)) return null;
    const weights = holeLikelihoods(Array.from(pool), observations, seat);
    const sums = new Float64Array(weights.length);
    let total = 0;
    for (let slot = 0; slot < weights.length; slot++) {
      total += weights[slot];
      sums[slot] = total;
    }
    return sums;
  });
  return {
    n, me, street, minBet: visible.minBet, spread: matchSpread(visible.hand), drift: matchDrift(visible.hand), dealt,
    base: {
      chips: array((seat) => visible.chips[seat]), streetBet: array((seat) => visible.streetBets[seat]),
      total: array((seat) => visible.totalBets[seat]),
      folded: Uint8Array.from(dealt.map((seat) => (visible.folded.includes(seat) ? 1 : 0))),
      acted: Uint8Array.from(dealt.map((seat) => (visible.acted.includes(seat) ? 1 : 0))),
      currentBet: visible.currentBet, minRaise: visible.minRaise,
    },
    pool, cumulative, knownUp, hole: cardId(visible.myHand[0]),
    cards: new Int8Array(n * STUD_FINAL_STREET), chips: new Float64Array(n), streetBet: new Float64Array(n),
    total: new Float64Array(n), folded: new Uint8Array(n), acted: new Uint8Array(n),
    strengths: new Float64Array(n * 4), showing: new Float64Array(n * 4), free: new Int8Array(52), used: new Uint8Array(52),
    currentBet: 0, minRaise: 0, raises: 0, step: 0, seed: 0,
  };
}

/** Deals one world: the opponents' hole cards from their line, then every card still to come. */
function dealWorld(sim: Sim, random: () => number): void {
  const { n, me, street, pool, cards, used } = sim;
  used.fill(0);
  const alive = (index: number): boolean => sim.base.folded[index] === 0;
  for (let index = 0; index < n; index++) {
    if (!alive(index)) continue;
    const row = index * STUD_FINAL_STREET;
    const ups = sim.knownUp[index];
    for (let slot = 0; slot < ups.length; slot++) cards[row + 1 + slot] = ups[slot];
    if (index === me) {
      cards[row] = sim.hole;
      used[sim.hole] = 1;
    }
  }
  for (let index = 0; index < n; index++) {
    const sums = sim.cumulative[index];
    if (!sums) continue;
    let pick = -1;
    for (let attempt = 0; attempt < 12 && pick < 0; attempt++) {
      const target = random() * sums[sums.length - 1];
      let low = 0;
      let high = sums.length - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (sums[middle] < target) low = middle + 1;
        else high = middle;
      }
      if (!used[pool[low]]) pick = low;
    }
    if (pick < 0) pick = pool.findIndex((id) => !used[id]);
    cards[index * STUD_FINAL_STREET] = pool[pick];
    used[pool[pick]] = 1;
  }
  let length = 0;
  for (let slot = 0; slot < pool.length; slot++) if (!used[pool[slot]]) sim.free[length++] = pool[slot];
  let next = 0;
  for (let up = street; up < STUD_FINAL_STREET; up++) {
    for (let index = 0; index < n; index++) {
      if (!alive(index)) continue;
      const pick = next + Math.floor(random() * (length - next));
      const held = sim.free[next];
      sim.free[next] = sim.free[pick];
      sim.free[pick] = held;
      cards[index * STUD_FINAL_STREET + up] = sim.free[next++];
    }
  }
  sim.strengths.fill(-1);
  sim.showing.fill(-1);
}

function strengthOf(sim: Sim, index: number, street: number): number {
  const slot = index * 4 + street - 2;
  if (sim.strengths[slot] < 0) {
    sim.strengths[slot] = studStrength(sim.cards.subarray(index * STUD_FINAL_STREET, index * STUD_FINAL_STREET + street), street);
  }
  return sim.strengths[slot];
}

function showingOf(sim: Sim, index: number, street: number): number {
  const slot = index * 4 + street - 2;
  if (sim.showing[slot] < 0) sim.showing[slot] = showingKey(sim.cards, index * STUD_FINAL_STREET + 1, street - 1);
  return sim.showing[slot];
}

const aliveCount = (sim: Sim): number => {
  let count = 0;
  for (let index = 0; index < sim.n; index++) if (!sim.folded[index]) count += 1;
  return count;
};

const canAct = (sim: Sim, index: number): boolean => !sim.folded[index] && sim.chips[index] > 0;

const needsAction = (sim: Sim, index: number): boolean => canAct(sim, index)
  && (!sim.acted[index] || sim.streetBet[index] < sim.currentBet);

function bettingClosed(sim: Sim): boolean {
  if (aliveCount(sim) <= 1) return true;
  let active = 0;
  let owing = false;
  let matched = true;
  for (let index = 0; index < sim.n; index++) {
    if (!canAct(sim, index)) continue;
    active += 1;
    if (needsAction(sim, index)) owing = true;
    if (sim.streetBet[index] < sim.currentBet) matched = false;
  }
  return !owing || (active <= 1 && matched);
}

function nextToAct(sim: Sim, from: number): number {
  for (let step = 1; step <= sim.n; step++) {
    const index = (from + step) % sim.n;
    if (needsAction(sim, index)) return index;
  }
  return -1;
}

function potOf(sim: Sim): number {
  let pot = 0;
  for (let index = 0; index < sim.n; index++) pot += sim.total[index];
  return pot;
}

/** Moves the seat's stake on the street to `to` as `heApplyBet` does: a full raise reopens the betting. */
function stake(sim: Sim, index: number, to: number): void {
  const added = to - sim.streetBet[index];
  sim.chips[index] -= added;
  sim.streetBet[index] = to;
  sim.total[index] += added;
  const increment = to - sim.currentBet;
  if (increment > 0) {
    sim.currentBet = to;
    if (increment >= sim.minRaise) {
      sim.minRaise = increment;
      sim.acted.fill(0);
      sim.acted[index] = 1;
      sim.raises += 1;
      return;
    }
  }
  sim.acted[index] = 1;
}

/** A seat's move under the line model; the bot's own seat asks a little more before it pays. */
function modelMove(sim: Sim, index: number, street: number): void {
  const owed = Math.min(sim.currentBet - sim.streetBet[index], sim.chips[index]);
  const maxTo = sim.streetBet[index] + sim.chips[index];
  const pot = potOf(sim);
  const rivals = aliveCount(sim) - 1;
  const strength = strengthOf(sim, index, street);
  const odds = owed > 0 ? owed / (pot + owed) : 0;
  const probabilities = lineProbabilities(strength, odds, rivals, index === sim.me ? OWN_MARGIN : 0);
  const draw = unit(sim.seed, index, street, sim.step++);
  if (draw < probabilities.fold) {
    sim.folded[index] = 1;
    return;
  }
  let opponentsCanAct = false;
  for (let other = 0; other < sim.n; other++) if (other !== index && canAct(sim, other)) opponentsCanAct = true;
  const canRaise = !sim.acted[index] && maxTo > sim.currentBet && opponentsCanAct && sim.raises < MAX_RAISES;
  if (canRaise && draw >= 1 - probabilities.aggressive) {
    const increment = Math.max(sim.minRaise, Math.round(betFraction(strength, rivals) * (pot + owed)));
    stake(sim, index, Math.min(maxTo, sim.currentBet + increment));
    return;
  }
  stake(sim, index, Math.min(maxTo, sim.currentBet));
}

function playStreet(sim: Sim, street: number, first: number): void {
  let actor = first;
  for (let guard = 0; actor >= 0 && guard < 60; guard++) {
    modelMove(sim, actor, street);
    if (bettingClosed(sim)) return;
    actor = nextToAct(sim, actor);
  }
}

/** The seat that opens a fresh street: the best showing hand, or the next seat that can act. */
function opener(sim: Sim, street: number): number {
  let best = -1;
  for (let index = 0; index < sim.n; index++) {
    if (sim.folded[index]) continue;
    if (best < 0 || showingOf(sim, index, street) > showingOf(sim, best, street)) best = index;
  }
  if (best < 0) return -1;
  return needsAction(sim, best) ? best : nextToAct(sim, best);
}

/** Final chips of every seat after the pots go to the best hands; ties split. */
function settle(sim: Sim): void {
  const { n } = sim;
  const scores = new Float64Array(n);
  for (let index = 0; index < n; index++) {
    scores[index] = sim.folded[index] ? -1 : evaluateIds(sim.cards.subarray(index * STUD_FINAL_STREET, (index + 1) * STUD_FINAL_STREET), 5);
  }
  const levels = [...new Set(Array.from(sim.total).filter((value) => value > 0))].sort((a, b) => a - b);
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    const eligible: number[] = [];
    for (let index = 0; index < n; index++) {
      amount += Math.max(0, Math.min(sim.total[index], level) - previous);
      if (!sim.folded[index] && sim.total[index] >= level) eligible.push(index);
    }
    previous = level;
    if (eligible.length === 0) {
      // Chips above every live stake come back to the seat that put in the most.
      const top = sim.total.indexOf(Math.max(...sim.total));
      sim.chips[top] += amount;
      continue;
    }
    let best = -Infinity;
    for (const index of eligible) best = Math.max(best, scores[index]);
    const winners = eligible.filter((index) => scores[index] === best);
    for (const index of winners) sim.chips[index] += amount / winners.length;
  }
}

/** Chance of finishing the match with the most chips, from the chip counts after this hand. */
function utility(sim: Sim): number {
  if (sim.chips[sim.me] <= 0) return 0;
  const scale = sim.spread / 1.702;
  const boost = (index: number): number => (index === sim.me ? sim.drift + 0.5 : 0);
  let top = -Infinity;
  for (let index = 0; index < sim.n; index++) {
    if (sim.chips[index] > 0) top = Math.max(top, sim.chips[index] + boost(index));
  }
  let mine = 0;
  let all = 0;
  for (let index = 0; index < sim.n; index++) {
    if (sim.chips[index] <= 0) continue;
    const weight = Math.exp((sim.chips[index] + boost(index) - top) / scale);
    all += weight;
    if (index === sim.me) mine = weight;
  }
  return mine / all;
}

/** Plays the rest of the hand in the dealt world after the bot's candidate move; returns the match utility. */
function rollout(sim: Sim, candidate: StudCandidate): number {
  const { base, me } = sim;
  sim.chips.set(base.chips);
  sim.streetBet.set(base.streetBet);
  sim.total.set(base.total);
  sim.folded.set(base.folded);
  sim.acted.set(base.acted);
  sim.currentBet = base.currentBet;
  sim.minRaise = base.minRaise;
  sim.raises = 0;
  sim.step = 0;
  if (candidate.kind === 'fold') sim.folded[me] = 1;
  else stake(sim, me, candidate.kind === 'call' ? Math.min(sim.currentBet, sim.streetBet[me] + sim.chips[me]) : candidate.to);
  if (!bettingClosed(sim)) playStreet(sim, sim.street, nextToAct(sim, me));
  for (let street = sim.street + 1; street <= STUD_FINAL_STREET && aliveCount(sim) > 1; street++) {
    sim.streetBet.fill(0);
    sim.acted.fill(0);
    sim.currentBet = 0;
    sim.minRaise = sim.minBet;
    sim.raises = 0;
    if (!bettingClosed(sim)) playStreet(sim, street, opener(sim, street));
  }
  settle(sim);
  return utility(sim);
}

/**
 * Mean utility of each candidate over sampled worlds, in the same worlds for every candidate. Stops when the
 * best candidate leads clearly, the sample cap is reached, or the time is spent (after the minimum).
 */
export function evaluateCandidates(
  visible: StudVisibleState, candidates: readonly StudCandidate[], random: () => number, limits: StudLimits,
): StudEvaluation | null {
  const sim = buildSim(visible);
  if (!sim) return null;
  const count = candidates.length;
  const sums = new Float64Array(count);
  const products = new Float64Array(count * count);
  const scores = new Float64Array(count);
  let worlds = 0;
  while (worlds < limits.maxWorlds) {
    dealWorld(sim, random);
    sim.seed = Math.floor(random() * 4294967296);
    for (let index = 0; index < count; index++) scores[index] = rollout(sim, candidates[index]);
    for (let a = 0; a < count; a++) {
      sums[a] += scores[a];
      for (let b = 0; b < count; b++) products[a * count + b] += scores[a] * scores[b];
    }
    worlds += 1;
    if (worlds >= limits.minWorlds && worlds % 16 === 0) {
      if (limits.timeLeftMs() <= 0 || leadIsClear(sums, products, count, worlds)) break;
    }
  }
  return { candidates, values: Array.from(sums, (sum) => sum / worlds), worlds };
}

/** True once the best mean beats every other by three standard errors of their paired difference, or cannot lose much to it. */
function leadIsClear(sums: Float64Array, products: Float64Array, count: number, worlds: number): boolean {
  let best = 0;
  for (let index = 1; index < count; index++) if (sums[index] > sums[best]) best = index;
  for (let other = 0; other < count; other++) {
    if (other === best) continue;
    const mean = (sums[best] - sums[other]) / worlds;
    const second = (products[best * count + best] - 2 * products[best * count + other] + products[other * count + other]) / worlds;
    const variance = Math.max(0, second - mean * mean) / worlds;
    const margin = 3 * Math.sqrt(variance);
    // Settled when the lead is clear, or when the candidates are provably too close for the choice to matter.
    if (mean < margin && margin > INDIFFERENCE) return false;
  }
  return true;
}

/** The legal actions of the bot's turn, or null when it is not its turn to act. */
export function studLegal(visible: StudVisibleState): HeLegalActions | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  return heLegalActions(visible, visible.mySeat);
}
