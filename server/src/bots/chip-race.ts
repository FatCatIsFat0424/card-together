import type { GameSeat } from '@shared/types';
import { BJ_BET_STEP, BJ_MAX_BET, BJ_MIN_BET, bjMaxBet, bjNextDealer, bjSitsIn } from '@shared/rules/blackjack';

// Betting for the chip games whose match is won by the largest final stack (Blackjack, Ten and a Half). The
// planner treats the rest of the match as a race: a Monte Carlo estimate of the best rival stack at the end,
// then backward induction over the bot's own stack that picks, hand by hand, the stake with the highest chance of
// finishing first (ties win). Per-hand results come from a table of net chips per chip staked, so the plan reacts
// to the number of hands left, the rivals' stacks, and who deals the remaining hands. That plan treats the rivals
// as independent of the bot, which is wrong when a seat deals: its result is the other seats' loss. So the plan's
// stakes are then replayed from the first hand against rivals simulated together with the bot, and the first stake
// is the one that wins most of those matches.

/** One possible result of a hand, as net chips per chip staked, and its probability. */
export interface Atom {
  readonly x: number;
  readonly p: number;
}

export interface RaceInput {
  /** Net result per chip staked when a seat bets against the dealer or banker. */
  readonly player: readonly Atom[];
  /** Stacks of every seat taking part, by index. */
  readonly chips: readonly number[];
  readonly me: number;
  /** Dealer or banker seat index of each remaining hand, the current one first; -1 for the house. */
  readonly dealers: readonly number[];
  /** Stakes already laid on the first hand, by seat, when its bets are known. */
  readonly firstStakes?: readonly number[];
  /** The results by what the dealer finishes with, when the seats' results on one hand are linked through it. */
  readonly classes?: readonly { readonly chance: number; readonly atoms: readonly Atom[] }[];
}

export interface RacePlan {
  /** Chance of finishing first holding `chips` with `hands` hands still to play; 0 hands is the match end. */
  readonly value: (hands: number, chips: number) => number;
  /** The stake with the best chance for the current hand; null when the seat does not bet in it. */
  readonly bet: number | null;
  /** Chance of finishing first with each stake from the minimum up, for diagnostics and tests. */
  readonly stakes: readonly { readonly bet: number; readonly value: number }[];
}

export interface RaceOptions {
  /** Rival stack samples; more is smoother and slower. */
  readonly samples: number;
  /** Simulated matches that choose the first stake among the plan's; 0 keeps the plan's own choice. */
  readonly matches: number;
}

export const SYNC_RACE: RaceOptions = { samples: 160, matches: 0 };
export const SEARCH_RACE: RaceOptions = { samples: 900, matches: 2400 };
/** The same without the replays, for a value function that is only read. */
export const SEARCH_VALUE: RaceOptions = { samples: 900, matches: 0 };

/** Chips per grid cell of the backward induction: the finer grid when stakes are replayed afterwards. */
const FINE_CELL = 5;
const COARSE_CELL = 10;
/** The terminal chance is smoothed over this many cells on each side, so sampling noise does not decide a stake. */
const SMOOTHING = 4;
/** A banker's hand is estimated from this many sampled sets of player stakes and results. */
const BANKER_SAMPLES = 80;
/** Stakes the backward induction tries for later hands; the first hand's stakes are all tried. */
const DP_BETS: readonly number[] = [10, 20, 30, 50, 70, 100, 140, 200];
/** Seat-hands one decision may replay in total: matches times hands times seats times stakes. */
const REPLAY_WORK = 1_500_000;

function stepped(amount: number): number {
  return Math.round(amount / BJ_BET_STEP) * BJ_BET_STEP;
}

function clampBet(chips: number, amount: number): number {
  return Math.max(BJ_MIN_BET, Math.min(bjMaxBet(chips), stepped(amount)));
}

/**
 * What a rival is assumed to stake: a small share of its stack that grows with the stakes of a
 * race, and the maximum on the last hand when it trails. Humans and bots differ, so the model is deliberately broad.
 */
function rivalStake(chips: number, handsAfter: number, trailing: boolean, first: number, second: number, third: number): number {
  if (handsAfter === 0 && trailing && third < 0.6) return bjMaxBet(chips);
  const share = first < 0.25 ? 0.08 + second * 0.12 : 0.03 + second * 0.07;
  return clampBet(chips, chips * share);
}

function rivalBet(chips: number, handsAfter: number, trailing: boolean, random: () => number): number {
  return rivalStake(chips, handsAfter, trailing, random(), random(), random());
}

function sampler(atoms: readonly Atom[]): (random: () => number) => number {
  const total = atoms.reduce((sum, atom) => sum + atom.p, 0);
  const xs = atoms.map((atom) => atom.x);
  const cumulative: number[] = [];
  let running = 0;
  for (const atom of atoms) {
    running += atom.p / total;
    cumulative.push(running);
  }
  return (random) => {
    const roll = random();
    for (let index = 0; index < cumulative.length; index++) if (roll < cumulative[index]) return xs[index];
    return xs[xs.length - 1];
  };
}

/** Plays out the remaining hands for every seat but `skip`'s own decisions, returning the stacks at the end. */
function simulateStacks(
  input: RaceInput, draw: (random: () => number) => number, random: () => number, myBetHint: number,
): number[] {
  const stacks = input.chips.slice();
  const hands = input.dealers.length;
  for (let hand = 0; hand < hands; hand++) {
    const dealer = input.dealers[hand];
    const lead = Math.max(...stacks);
    let dealerNet = 0;
    for (let seat = 0; seat < stacks.length; seat++) {
      if (seat === dealer || !bjSitsIn(stacks[seat])) continue;
      const known = hand === 0 ? input.firstStakes?.[seat] : undefined;
      if (known === 0) continue;
      const stake = known ?? (seat === input.me ? Math.min(myBetHint, bjMaxBet(stacks[seat])) || BJ_MIN_BET
        : rivalBet(stacks[seat], hands - hand - 1, stacks[seat] < lead, random));
      const net = stake * draw(random);
      // A rival's own stack follows its result; the bot's is only needed when a rival deals.
      if (seat !== input.me) stacks[seat] = Math.max(0, stacks[seat] + net);
      dealerNet -= net;
    }
    if (dealer >= 0 && dealer !== input.me) stacks[dealer] = Math.max(0, stacks[dealer] + dealerNet);
  }
  return stacks;
}

/** Chance of finishing first for each stack on the grid: the share of simulated best rival stacks it matches or beats. */
function terminalValue(best: readonly number[], cells: number, CELL: number): Float64Array {
  const counts = new Float64Array(cells + 1);
  for (const stack of best) counts[Math.min(cells, Math.max(0, Math.ceil(stack / CELL)))] += 1;
  const cumulative = new Float64Array(cells + 1);
  let running = 0;
  for (let cell = 0; cell <= cells; cell++) {
    running += counts[cell];
    cumulative[cell] = running / best.length;
  }
  const smooth = new Float64Array(cells + 1);
  for (let cell = 0; cell <= cells; cell++) {
    let sum = 0;
    for (let offset = -SMOOTHING; offset <= SMOOTHING; offset++) {
      sum += cumulative[Math.max(0, Math.min(cells, cell + offset))];
    }
    smooth[cell] = sum / (2 * SMOOTHING + 1);
  }
  return smooth;
}

/**
 * Backward induction over the bot's stack for the remaining hands. The rivals' final best stack is simulated
 * once from their current stacks, independently of what the bot does.
 */
export function planRace(input: RaceInput, random: () => number, options: RaceOptions = SYNC_RACE): RacePlan {
  const { me, dealers } = input;
  const hands = dealers.length;
  const draw = sampler(input.player);
  const rivals = input.chips.map((_, seat) => seat).filter((seat) => seat !== me);
  const myStack = input.chips[me];
  const assumedStake = clampBet(myStack, myStack * 0.06);

  const best: number[] = [];
  for (let sample = 0; sample < options.samples; sample++) {
    const stacks = simulateStacks(input, draw, random, assumedStake);
    best.push(rivals.length === 0 ? 0 : Math.max(...rivals.map((seat) => stacks[seat])));
  }
  const top = Math.max(myStack, ...best) + BJ_MAX_BET;
  const CELL = options.matches > 0 ? FINE_CELL : COARSE_CELL;
  const cells = Math.ceil(top / CELL);
  const layers: Float64Array[] = new Array<Float64Array>(hands + 1);
  layers[0] = terminalValue(best, cells, CELL);
  const at = (layer: Float64Array, chips: number): number => {
    const position = Math.max(0, Math.min(cells, chips / CELL));
    const low = Math.floor(position);
    const fraction = position - low;
    return fraction === 0 ? layer[low] : layer[low] * (1 - fraction) + layer[Math.min(cells, low + 1)] * fraction;
  };

  // layers[n] is the value with n hands left; hand index `hands - n` is the one about to be played.
  const atoms = input.player;
  let stakes: { bet: number; value: number }[] = [];
  let firstBet: number | null = null;
  const policies: Int16Array[] = new Array<Int16Array>(hands + 1);
  for (let left = 1; left <= hands; left++) {
    policies[left] = new Int16Array(cells + 1);
    const dealer = dealers[hands - left];
    const next = layers[left - 1];
    const layer = new Float64Array(cells + 1);
    // As the dealer or banker the result depends on every player's stake and hand: sample it once per layer.
    const dealerNets: number[] = [];
    if (dealer === me) {
      const players = rivals.filter((seat) => bjSitsIn(input.chips[seat]));
      for (let sample = 0; sample < BANKER_SAMPLES; sample++) {
        let net = 0;
        for (const seat of players) {
          net -= rivalBet(input.chips[seat], left - 1, false, random) * draw(random);
        }
        dealerNets.push(net);
      }
    }
    for (let cell = 0; cell <= cells; cell++) {
      const chips = cell * CELL;
      if (dealer === me) {
        let sum = 0;
        for (const net of dealerNets) sum += at(next, Math.max(0, chips + net));
        layer[cell] = sum / dealerNets.length;
      } else if (!bjSitsIn(chips)) {
        layer[cell] = next[cell];
      } else {
        let bestSum = 0;
        const limit = bjMaxBet(chips);
        for (const bet of limit <= BJ_MAX_BET && !DP_BETS.includes(limit) ? [...DP_BETS.filter((stake) => stake < limit), limit] : DP_BETS) {
          if (bet > limit) break;
          let sum = 0;
          for (const atom of atoms) sum += atom.p * at(next, chips + bet * atom.x);
          if (sum > bestSum + 1e-12) {
            bestSum = sum;
            policies[left][cell] = bet;
          }
        }
        layer[cell] = bestSum;
      }
    }
    layers[left] = layer;
    if (left === hands) {
      if (dealer !== me && bjSitsIn(myStack)) {
        stakes = [];
        for (let bet = BJ_MIN_BET; bet <= bjMaxBet(myStack); bet += BJ_BET_STEP) {
          let sum = 0;
          for (const atom of atoms) sum += atom.p * at(next, myStack + bet * atom.x);
          stakes.push({ bet, value: sum });
        }
        // Equal values go to the smaller stake: the bigger one only adds risk.
        firstBet = stakes.reduce((winner, stake) => (stake.value > winner.value + 1e-9 ? stake : winner)).bet;
      }
    }
  }
  if (firstBet !== null && options.matches > 0 && rivals.length > 0) {
    // Long matches at big tables replay fewer times so a decision stays inside its budget.
    const matches = Math.min(options.matches, Math.floor(REPLAY_WORK / (hands * input.chips.length * stakes.length)));
    const wins = replayMatches(input, policies, stakes.map((stake) => stake.bet), random, Math.max(200, matches), CELL);
    stakes = stakes.map((stake, index) => ({ bet: stake.bet, value: wins[index] }));
    firstBet = stakes.reduce((winner, stake) => (stake.value > winner.value + 1e-9 ? stake : winner)).bet;
  }
  return {
    value: (remaining, chips) => at(layers[Math.max(0, Math.min(hands, remaining))], chips),
    bet: firstBet,
    stakes,
  };
}

/**
 * Share of simulated matches the bot wins for each first stake in `firsts`, with the bot staking by `policies` on
 * the later hands and the rivals staking by the rival model. Every stake plays the same random numbers, so the
 * differences between stakes are not noise. Seats' results on one hand share the dealer's finish when the input
 * gives results by dealer class, and the dealer or banker takes the other seats' results.
 */
function replayMatches(
  input: RaceInput, policies: readonly Int16Array[], firsts: readonly number[], random: () => number, matches: number, CELL: number,
): Float64Array {
  const { me, dealers } = input;
  const hands = dealers.length;
  const seats = input.chips.length;
  const width = 1 + 4 * seats;
  const randoms = new Float32Array(matches * hands * width);
  for (let index = 0; index < randoms.length; index++) randoms[index] = random();
  const classes = input.classes ?? [{ chance: 1, atoms: input.player }];
  const picks = classes.map((entry) => {
    const total = entry.atoms.reduce((sum, atom) => sum + atom.p, 0);
    let running = 0;
    return { xs: entry.atoms.map((atom) => atom.x), cumulative: entry.atoms.map((atom) => (running += atom.p / total)) };
  });
  let running = 0;
  const classChances = classes.map((entry) => (running += entry.chance));
  const wins = new Float64Array(firsts.length);
  const stacks = new Float64Array(seats);
  for (let index = 0; index < firsts.length; index++) {
    for (let match = 0; match < matches; match++) {
      for (let seat = 0; seat < seats; seat++) stacks[seat] = input.chips[seat];
      for (let hand = 0; hand < hands; hand++) {
        const base = (match * hands + hand) * width;
        let which = 0;
        while (which < classes.length - 1 && randoms[base] * running >= classChances[which]) which += 1;
        const { xs, cumulative } = picks[which];
        const dealer = dealers[hand];
        const left = hands - hand;
        let lead = 0;
        for (let seat = 0; seat < seats; seat++) lead = Math.max(lead, stacks[seat]);
        let dealerNet = 0;
        for (let seat = 0; seat < seats; seat++) {
          if (seat === dealer || !bjSitsIn(stacks[seat])) continue;
          let stake: number;
          if (seat === me) {
            stake = hand === 0 ? firsts[index] : policies[left][Math.round(stacks[seat] / CELL)] || BJ_MIN_BET;
          } else {
            const at = base + 1 + 4 * seat;
            stake = rivalStake(stacks[seat], left - 1, stacks[seat] < lead, randoms[at + 1], randoms[at + 2], randoms[at + 3]);
          }
          if (hand === 0 && input.firstStakes?.[seat] !== undefined) stake = input.firstStakes[seat];
          if (stake === 0) continue;
          let pick = 0;
          while (pick < cumulative.length - 1 && randoms[base + 1 + 4 * seat] >= cumulative[pick]) pick += 1;
          const net = stake * xs[pick];
          stacks[seat] = Math.max(0, stacks[seat] + net);
          dealerNet -= net;
        }
        if (dealer >= 0) stacks[dealer] = Math.max(0, stacks[dealer] + dealerNet);
      }
      let top = 0;
      for (let seat = 0; seat < seats; seat++) if (seat !== me) top = Math.max(top, stacks[seat]);
      if (stacks[me] >= top) wins[index] += 1;
    }
    wins[index] /= matches;
  }
  return wins;
}

/** The parts of a chip game's view the race needs. */
export interface RaceView {
  readonly seats: readonly GameSeat[];
  readonly chips: Readonly<Record<GameSeat, number>>;
  readonly mySeat: GameSeat;
  readonly totalHands: number;
  /** Hands dealt so far; betting or playing is for hand `hand + 1` once dealt. */
  readonly hand: number;
}

/**
 * The race from a seat's view during hand `hand + 1`. `dealer` is who deals or banks that hand (null for the
 * house); the deal then passes clockwise like the game does.
 */
export function raceInput(
  view: RaceView, dealer: GameSeat | null, player: readonly Atom[], handsLeft = view.totalHands - view.hand,
): RaceInput {
  const dealers: number[] = [];
  let current = dealer;
  for (let hand = 0; hand < handsLeft; hand++) {
    dealers.push(current === null ? -1 : view.seats.indexOf(current));
    if (current !== null) current = bjNextDealer(current, view.seats);
  }
  return { player, chips: view.seats.map((seat) => view.chips[seat]), me: view.seats.indexOf(view.mySeat), dealers };
}
