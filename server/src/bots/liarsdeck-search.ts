import type { LiarCard, LiarsDeckVisibleState } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { LD_CHAMBERS, LD_MAX_PLAY, LD_TRUTH_COUNT, ldIsTruth, ldMustChallenge } from '@shared/rules/liarsdeck';
import type { BotAction } from './bot-decisions';
import { DECK_SIZE, dealWorld, seatIndex, tableCallRates, tableHonesty } from './liarsdeck-knowledge';
import type { DeckWorld } from './liarsdeck-knowledge';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';

// Determinized search over the next play or call. Each sample deals the unseen truths and lies to the other seats so
// they explain the round's plays (see liarsdeck-knowledge), plays a candidate, lets the other seats answer with a
// quick policy until someone calls, and scores the round by the chance of winning the match from the trigger pull
// that follows. That chance accounts for how many pulls each seat has taken: a seat is likelier to die with every
// pull, so making a seat that is deep into the chamber shoot is worth far more than a fresh one, and an elimination
// is worth what it does to the survivors.

const CALL = 0;
const MAX_SAMPLES = 3_000;
const MIN_SAMPLES = 24;
const CONFIDENCE = 1;
const ROLLOUTS_PER_SAMPLE = 2;
/** Quick-policy scores this close to the best are chosen between at random. */
const POLICY_MARGIN = 0.01;
const SHED_VALUE = 0.003;
const FUTURE_LIE_WEIGHT = 0.3;
const WRONG_CALL_SHARE = 0.5;
/** Share of plays a seat holding a truth and a lie still spends on one lie, in the quick policy; each world draws its own. */
const SIM_BLUFF_RANGE = [0.05, 0.35] as const;
/** Each world's table calls with a value shifted by up to this much, in chances of winning the match. */
const CALL_BIAS_RANGE = 0.03;
/** The quick policy trusts earlier claims this much when it counts the truths still unseen. */
const PRIOR_CLAIM_HONESTY = 0.6;

const SEATS = SEAT_ORDER_CLOCKWISE.length;

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/** Chance that `size` cards drawn from `pool` cards, `truths` of them true, include at least `need` truths. */
export function atLeastTruths(pool: number, truths: number, size: number, need: number): number {
  const draw = Math.min(size, pool);
  const total = combinations(pool, draw);
  if (total === 0) return 0;
  let chance = 0;
  for (let hits = need; hits <= Math.min(draw, truths); hits++) {
    chance += (combinations(truths, hits) * combinations(pool - truths, draw - hits)) / total;
  }
  return Math.min(1, chance);
}

const winCache = new Map<number, number[]>();

/**
 * Each seat's chance of winning the match from the trigger pulls taken (-1 for an eliminated seat), if every later
 * round were lost by a seat chosen uniformly among those alive. A seat that has pulled `k` times dies on the next
 * pull with chance `1 / (6 - k)`.
 */
export function winChances(pulls: readonly number[]): number[] {
  const alive = pulls.flatMap((count, seat) => (count >= 0 ? [seat] : []));
  if (alive.length === 1) return pulls.map((_, seat) => (seat === alive[0] ? 1 : 0));
  const key = pulls.reduce((sum, count) => sum * (LD_CHAMBERS + 1) + count + 1, 0);
  const cached = winCache.get(key);
  if (cached) return cached;
  const result = pulls.map(() => 0);
  for (const seat of alive) {
    const death = 1 / (LD_CHAMBERS - pulls[seat]);
    const killed = winChances(pulls.map((count, other) => (other === seat ? -1 : count)));
    killed.forEach((value, other) => { result[other] += (death * value) / alive.length; });
    if (death < 1) {
      const survived = winChances(pulls.map((count, other) => (other === seat ? count + 1 : count)));
      survived.forEach((value, other) => { result[other] += ((1 - death) * value) / alive.length; });
    }
  }
  winCache.set(key, result);
  return result;
}

/** What the quick policy knows about the table: the stakes and the table's habits so far. */
interface Model extends Stakes {
  readonly honesty: number;
  /** Chance a claim of 1, 2 or 3 cards is called */
  readonly callRates: readonly number[];
}

/** Chances for every seat as the table stands and after each seat pulls the trigger. */
interface Stakes {
  readonly pulls: readonly number[];
  /** `standing[viewer]`: chance with nobody in particular shooting */
  readonly standing: readonly number[];
  /** `shooting[viewer][shooter]`: viewer's chance once `shooter` has pulled the trigger */
  readonly shooting: readonly (readonly number[])[];
}

function stakesFor(visible: LiarsDeckVisibleState): Stakes {
  const pulls = SEAT_ORDER_CLOCKWISE.map((seat) => (visible.eliminated.includes(seat) ? -1 : visible.shots[seat]));
  const standing = winChances(pulls);
  const outcomes = pulls.map((count, seat) => {
    if (count < 0) return null;
    const death = 1 / (LD_CHAMBERS - count);
    const killed = winChances(pulls.map((other, index) => (index === seat ? -1 : other)));
    const survived = death < 1 ? winChances(pulls.map((other, index) => (index === seat ? other + 1 : other))) : killed;
    return { death, killed, survived };
  });
  const shooting = pulls.map((_, viewer) => outcomes.map((outcome) => (outcome
    ? outcome.death * outcome.killed[viewer] + (1 - outcome.death) * outcome.survived[viewer] : standing[viewer])));
  return { pulls, standing, shooting };
}

/** The round in play with every card placed as truth or lie. */
interface DeckSim {
  readonly handTruths: Int8Array;
  readonly handLies: Int8Array;
  readonly playedTruths: Int8Array;
  readonly playedLies: Int8Array;
  /** Cards each seat claimed this round */
  readonly claimed: Int8Array;
  lastSeat: number;
  lastCount: number;
  lastLies: number;
  turn: number;
  done: boolean;
  shooter: number;
  /** How readily this world's table bluffs and calls, so no single opponent style decides a play */
  readonly bluffRate: number;
  readonly callBias: number;
}

const handSize = (state: DeckSim, seat: number): number => state.handTruths[seat] + state.handLies[seat];

/** Next seat counterclockwise, other than `seat`, still holding cards; -1 when none does. */
function nextHolder(state: DeckSim, seat: number): number {
  for (let step = 1; step < SEATS; step++) {
    const candidate = (seat + SEATS - step) % SEATS;
    if (handSize(state, candidate) > 0) return candidate;
  }
  return -1;
}

function holdersBesides(state: DeckSim, seat: number): number {
  let holders = 0;
  for (let other = 0; other < SEATS; other++) if (other !== seat && handSize(state, other) > 0) holders++;
  return holders;
}

const canCall = (state: DeckSim, seat: number): boolean => state.lastCount > 0 && state.lastSeat !== seat;
const mustCall = (state: DeckSim, seat: number): boolean => canCall(state, seat) && holdersBesides(state, seat) === 0;

/** The chance the seat to act thinks the last play contains a lie, from its own cards and the claims on the table. */
function lieChance(state: DeckSim, seat: number, honesty: number): number {
  const count = state.lastCount;
  const known = handSize(state, seat) + state.playedTruths[seat] + state.playedLies[seat];
  const truths = LD_TRUTH_COUNT - state.handTruths[seat] - state.playedTruths[seat];
  if (count > truths) return 1;
  let otherClaims = -count;
  for (let other = 0; other < SEATS; other++) if (other !== seat) otherClaims += state.claimed[other];
  const pool = Math.max(count, DECK_SIZE - known - otherClaims);
  const remaining = Math.max(0, Math.round(truths - PRIOR_CLAIM_HONESTY * otherClaims));
  const handBefore = handSize(state, state.lastSeat) + count;
  return 1 - honesty * atLeastTruths(pool, remaining, handBefore, count);
}

interface ScoredMove {
  readonly move: number;
  readonly score: number;
}

const playMoveCode = (truths: number, lies: number): number => truths * 4 + lies;

/**
 * What the quick policy thinks of each move for the seat to act, in that seat's chance of winning the match:
 * a call is worth the chance the last play lies, a play the chance it is caught (a lie) or wrongly called (a truth)
 * and a neutral value when nobody calls. Plays that shed cards and keep a truth for later score a little more.
 */
function scoreMoves(state: DeckSim, seat: number, model: Model): ScoredMove[] {
  const moves: ScoredMove[] = [];
  const standing = model.standing[seat];
  const shooting = model.shooting[seat];
  if (canCall(state, seat)) {
    const lie = lieChance(state, seat, model.honesty);
    moves.push({ move: CALL, score: lie * shooting[state.lastSeat] + (1 - lie) * shooting[seat] + state.callBias });
  }
  if (mustCall(state, seat)) return moves;
  const truthsHeld = state.handTruths[seat];
  const liesHeld = state.handLies[seat];
  const holders = holdersBesides(state, seat);
  for (let truths = 0; truths <= Math.min(LD_MAX_PLAY, truthsHeld); truths++) {
    for (let lies = 0; lies <= Math.min(LD_MAX_PLAY - truths, liesHeld); lies++) {
      const cards = truths + lies;
      if (cards === 0) continue;
      const remaining = truthsHeld + liesHeld - cards;
      const forced = remaining === 0 && holders === 1;
      const callChance = forced ? 1 : model.callRates[cards - 1];
      let score: number;
      if (lies > 0) {
        score = callChance * shooting[seat] + (1 - callChance) * standing;
      } else {
        const caller = nextHolder(state, seat);
        const wrongCall = forced ? 1 : WRONG_CALL_SHARE * callChance;
        score = wrongCall * (caller >= 0 ? shooting[caller] : standing) + (1 - wrongCall) * standing;
      }
      score += SHED_VALUE * cards;
      if (remaining > 0 && truthsHeld - truths === 0) score -= FUTURE_LIE_WEIGHT * Math.max(0, standing - shooting[seat]);
      moves.push({ move: playMoveCode(truths, lies), score });
    }
  }
  return moves;
}

function pickNearBest(moves: readonly ScoredMove[], random: () => number): number {
  let best = -Infinity;
  for (const entry of moves) if (entry.score > best) best = entry.score;
  let sum = 0;
  for (const entry of moves) if (entry.score >= best - POLICY_MARGIN) sum += 1 / (1 + best - entry.score);
  let ticket = random() * sum;
  let last = CALL;
  for (const entry of moves) {
    if (entry.score < best - POLICY_MARGIN) continue;
    last = entry.move;
    ticket -= 1 / (1 + best - entry.score);
    if (ticket < 0) break;
  }
  return last;
}

function playMove(state: DeckSim, move: number): void {
  const seat = state.turn;
  if (move === CALL) {
    state.shooter = state.lastLies > 0 ? state.lastSeat : seat;
    state.done = true;
    return;
  }
  const truths = move >> 2;
  const lies = move & 3;
  state.handTruths[seat] -= truths;
  state.handLies[seat] -= lies;
  state.playedTruths[seat] += truths;
  state.playedLies[seat] += lies;
  state.claimed[seat] += truths + lies;
  state.lastSeat = seat;
  state.lastCount = truths + lies;
  state.lastLies = lies;
  state.turn = nextHolder(state, seat);
}

function legalMoves(state: DeckSim): number[] {
  const seat = state.turn;
  const moves: number[] = canCall(state, seat) ? [CALL] : [];
  if (mustCall(state, seat)) return moves;
  for (let truths = 0; truths <= Math.min(LD_MAX_PLAY, state.handTruths[seat]); truths++) {
    for (let lies = 0; lies <= Math.min(LD_MAX_PLAY - truths, state.handLies[seat]); lies++) {
      if (truths + lies > 0) moves.push(playMoveCode(truths, lies));
    }
  }
  return moves;
}

function copySim(state: DeckSim): DeckSim {
  return {
    ...state,
    handTruths: state.handTruths.slice(), handLies: state.handLies.slice(),
    playedTruths: state.playedTruths.slice(), playedLies: state.playedLies.slice(), claimed: state.claimed.slice(),
  };
}

function simFor(visible: LiarsDeckVisibleState, world: DeckWorld, bluffRate: number, callBias: number): DeckSim {
  const me = seatIndex(visible.mySeat);
  const handTruths = Int8Array.from(world.handTruths);
  const handLies = Int8Array.from(world.handLies);
  const playedTruths = Int8Array.from(world.playedTruths);
  const playedLies = Int8Array.from(world.playedLies);
  const isTruth = (card: LiarCard): boolean => ldIsTruth(card.face, visible.tableFace);
  handTruths[me] = visible.myHand.filter(isTruth).length;
  handLies[me] = visible.myHand.length - handTruths[me];
  playedTruths[me] = visible.myPlayed.filter(isTruth).length;
  playedLies[me] = visible.myPlayed.length - playedTruths[me];
  const claimed = Int8Array.from(playedTruths, (truths, seat) => truths + playedLies[seat]);
  const last = visible.lastPlay;
  return {
    handTruths, handLies, playedTruths, playedLies, claimed,
    lastSeat: last ? seatIndex(last.seat) : -1, lastCount: last?.count ?? 0, lastLies: world.lastLies,
    turn: me, done: false, shooter: -1, bluffRate, callBias,
  };
}

function deckGame(visible: LiarsDeckVisibleState, model: Model): DeterminizedGame<DeckSim, number> {
  const me = seatIndex(visible.mySeat);
  return {
    seat: visible.mySeat,
    sample: (random) => {
      const world = dealWorld(visible, model.honesty, random);
      const bluffRate = SIM_BLUFF_RANGE[0] + random() * (SIM_BLUFF_RANGE[1] - SIM_BLUFF_RANGE[0]);
      return { state: simFor(visible, world, bluffRate, (random() + random() - 1) * CALL_BIAS_RANGE), weight: world.weight };
    },
    copy: copySim,
    legalMoves,
    play: playMove,
    rolloutMove: (state, random) => {
      const seat = state.turn;
      const moves = scoreMoves(state, seat, model);
      if (moves.length === 0) return CALL;
      const choice = pickNearBest(moves, random);
      // A seat holding both kinds of card sometimes spends a lone lie in place of an honest play.
      if (choice !== CALL && (choice & 3) === 0 && state.handTruths[seat] > 0 && state.handLies[seat] > 0
        && random() < state.bluffRate) return playMoveCode(0, 1);
      return choice;
    },
    isTerminal: (state) => state.done,
    utility: (state) => (state.done ? model.shooting[me][state.shooter] : model.standing[me]),
  };
}

/** The cards of a move: plain truths before jokers, then lies. */
function cardsFor(visible: LiarsDeckVisibleState, move: number): number[] {
  const truths = visible.myHand.filter((card) => ldIsTruth(card.face, visible.tableFace))
    .sort((a, b) => Number(a.face === 'joker') - Number(b.face === 'joker'));
  const lies = visible.myHand.filter((card) => !ldIsTruth(card.face, visible.tableFace));
  return [...truths.slice(0, move >> 2), ...lies.slice(0, move & 3)].map((card) => card.id);
}

function moveAction(visible: LiarsDeckVisibleState, move: number): BotAction {
  return move === CALL ? { type: 'liarsdeck-challenge' } : { type: 'liarsdeck-play', cardIds: cardsFor(visible, move) };
}

export interface DeckSearchOptions {
  readonly maxSamples?: number;
}

/** Worker entry: the play or call that scores best across worlds dealt from the unseen cards. */
export function liarsDeckSearch(
  visible: LiarsDeckVisibleState, context: SearchContext, options: DeckSearchOptions = {},
): BotAction | null {
  const me = visible.mySeat;
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== me) return null;
  if (ldMustChallenge(me, visible.handCounts, visible.lastPlay)) return { type: 'liarsdeck-challenge' };
  const model: Model = { ...stakesFor(visible), honesty: tableHonesty(visible), callRates: tableCallRates(visible) };
  // Candidate moves and their priors come from the quick policy applied to my own cards alone.
  const root = simFor(visible, {
    handTruths: new Int8Array(SEATS), handLies: Int8Array.from(SEAT_ORDER_CLOCKWISE, (seat) => (seat === me ? 0 : visible.handCounts[seat])),
    playedTruths: new Int8Array(SEATS), playedLies: new Int8Array(SEATS), lastLies: 0, weight: 1,
  }, 0, 0);
  const moves = scoreMoves(root, seatIndex(me), model);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moveAction(visible, moves[0].move);
  const candidates: Candidate<number>[] = moves.map((entry) => ({ move: entry.move, prior: entry.score }));
  const choice = determinizedSearch(deckGame(visible, model), candidates, context, {
    maxSamples: options.maxSamples ?? MAX_SAMPLES, minSamples: MIN_SAMPLES, confidence: CONFIDENCE,
    rolloutsPerSample: ROLLOUTS_PER_SAMPLE,
  });
  return moveAction(visible, choice.move);
}
