import type { DouDizhuVisibleState } from '@shared/types';
import type { DouDizhuAction } from '@shared/games/doudizhu/actions';
import { ddzReplay } from '@shared/rules/doudizhu-table';
import type { BotAction } from './bot-decisions';
import { cardTotal, rankMoves } from './doudizhu-hand';
import type { Counts, RankMove } from './doudizhu-hand';
import { DEFAULT_ENDGAME, solveEndgame } from './doudizhu-endgame';
import type { EndgameTable } from './doudizhu-endgame';
import { dealGuesser } from './doudizhu-inference';
import { dealValue, matchValue } from './doudizhu-match';
import { getDouDizhuBotAction, playable, viewWorld } from './doudizhu-strategy';
import { applyMove, copyWorld, dealEnd, policyMove, rolloutWorld, scoreChoices } from './doudizhu-world';
import type { DealEnd, World } from './doudizhu-world';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame } from './search/determinized';
import type { SearchBudget, SearchContext } from './search/search-types';

// The Dou Dizhu search bot. Every decision guesses the hidden cards many times from the seat's own view
// (doudizhu-inference.ts) and scores its options on each guess in match terms: the chance of finishing the
// six deals on top, given the running totals, the stake (bid, grabs, bombs, spring), and the deals left.
// Play: every legal play with every kicker choice is ranked by the rollout policy, the best are searched,
// each guess is played out by the policy or, once few cards remain, solved exactly. Auction: each guess
// deals the bottom too, and the deal is played out with this seat as landlord to price every bid or claim.

const asAction = (action: DouDizhuAction): BotAction => ({ type: 'game-action', request: { gameType: 'doudizhu', action } });

function seatTotals(visible: DouDizhuVisibleState): number[] {
  return visible.seats.map((seat) => visible.totals[seat] ?? 0);
}

const dealsLeft = (visible: DouDizhuVisibleState): number => Math.max(0, visible.totalDeals - visible.deal);

/** A budget that also ends at `fraction` of the time left now. */
function stage(budget: SearchBudget, fraction: number): SearchBudget {
  const end = Date.now() + budget.timeLeftMs() * fraction;
  return {
    maxDepth: budget.maxDepth,
    timeLeftMs: () => Math.max(0, Math.min(budget.timeLeftMs(), end - Date.now())),
    expired: () => budget.expired() || Date.now() >= end,
  };
}

// ─── Play ───

/** Searched candidates at most, and kicker variants kept per main group. */
const MAX_CANDIDATES = 12;
const KICKER_VARIANTS = 2;
/** Candidates kept for the second half of the budget. */
const FINALISTS = 4;
/** A first-half lead (in match-win chance) that ends the search early. */
const CLEAR_LEAD = 0.2;
/** Total cards in all hands at which a guessed world is solved exactly rather than played out. */
const ENDGAME_LIMITS = DEFAULT_ENDGAME;
/** No new guess starts with less time left than this, so one slow evaluation cannot overrun the budget. */
const RESERVE_MS = 60;

const familyKey = (move: RankMove): string => `${move.combo.type}:${move.combo.power}:${move.combo.length}`;

function playSearch(visible: DouDizhuVisibleState, context: SearchContext): BotAction | null {
  const view = viewWorld(visible);
  if (!view) return getDouDizhuBotAction(visible, context.random);
  const me = view.turn;
  const hand = view.hands[me];
  const previous = visible.lastPlay?.combo ?? null;
  const options: (RankMove | null)[] = [];
  const cardsOf = new Map<RankMove, ReturnType<typeof playable>>();
  for (const raw of rankMoves(hand, previous, 'all')) {
    const play = playable(visible, raw);
    if (!play) continue;
    if (play.move.ranks.length === cardTotal(hand)) return asAction({ type: 'play', cards: play.cards });
    cardsOf.set(play.move, play);
    options.push(play.move);
  }
  if (previous) options.push(null);
  if (options.length === 0) return getDouDizhuBotAction(visible, context.random);
  const finish = (move: RankMove | null): BotAction => (move
    ? asAction({ type: 'play', cards: cardsOf.get(move)!.cards })
    : asAction({ type: 'pass' }));
  if (options.length === 1) return finish(options[0]);

  // Candidates: the policy's ranking, with at most two kicker choices per main group.
  const priors = scoreChoices(view, options);
  const ranked = options.map((move, index) => ({ move, prior: priors[index] })).sort((a, b) => b.prior - a.prior);
  const perFamily = new Map<string, number>();
  const candidates: Candidate<RankMove | null>[] = [];
  for (const option of ranked) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (option.move) {
      const key = familyKey(option.move);
      const seen = perFamily.get(key) ?? 0;
      if (seen >= KICKER_VARIANTS) continue;
      perFamily.set(key, seen + 1);
    }
    candidates.push(option);
  }
  if (previous && !candidates.some((candidate) => candidate.move === null)) {
    candidates[candidates.length - 1] = ranked.find((option) => option.move === null)!;
  }

  const landlord = view.landlord;
  const match = matchValue(seatTotals(visible), me, dealsLeft(visible), context.random);
  const value = dealValue(match, 3, landlord, visible.base, visible.grabs);
  const guesser = dealGuesser(visible);
  const table: EndgameTable = new Map();
  const template = view;
  const game: DeterminizedGame<World, RankMove | null> = {
    seat: visible.mySeat,
    sample: (random) => {
      const deal = guesser.guess(random);
      if (!deal) return null;
      return { state: { ...copyWorld(template), hands: deal.hands } };
    },
    copy: copyWorld,
    legalMoves: (state) => {
      const moves: (RankMove | null)[] = rankMoves(state.hands[state.turn], state.last && state.lastSeat !== state.turn ? state.last.combo : null);
      if (state.last && state.lastSeat !== state.turn) moves.push(null);
      return moves;
    },
    play: applyMove,
    rolloutMove: (state) => policyMove(state),
    isTerminal: (state) => state.winner >= 0,
    utility: (state) => value(dealEnd(state)),
    evaluate: (state) => {
      const solved = solveEndgame(state, table, ENDGAME_LIMITS, context.budget.expired);
      if (solved !== null) return value({ landlordWins: solved, doublings: state.bombs });
      // A solve cut short by the clock drops the whole guess.
      if (context.budget.expired()) return null;
      rolloutWorld(state);
      return value(dealEnd(state));
    },
  };
  const first = determinizedSearch(game, candidates, { random: context.random, budget: stage(context.budget, 0.5) },
    { maxSamples: 4000, minSamples: 8, reserveMs: RESERVE_MS });
  if (first.reason !== 'searched') return finish(first.move);
  const means = first.stats.map((stats) => stats.mean).sort((a, b) => b - a);
  if (first.stats.length <= 2 || means[0] - means[1] >= CLEAR_LEAD) return finish(first.move);
  const finalists = [...first.stats].sort((a, b) => b.mean - a.mean).slice(0, FINALISTS)
    .map((stats) => ({ move: stats.move, prior: stats.prior }));
  const second = determinizedSearch(game, finalists, context, { maxSamples: 4000, minSamples: 8, reserveMs: RESERVE_MS });
  return finish(second.reason === 'searched' ? second.move : first.move);
}

// ─── Auction ───

/** Simulated deals per auction decision at most. */
const AUCTION_SAMPLES = 600;
/**
 * Match value a pass is worth beyond standing still: a farmer facing a landlord who outbid it usually
 * loses a little, but a bid is only as good as its estimate.
 */
const PASS_MARGIN = 0.004;

function auctionSearch(visible: DouDizhuVisibleState, context: SearchContext): BotAction | null {
  const auction = ddzReplay(visible.options.variant, visible.seats, visible.log).auction;
  if (!auction || auction.done) return getDouDizhuBotAction(visible, context.random);
  const seats = visible.seats;
  const me = seats.indexOf(visible.mySeat);
  const guesser = dealGuesser(visible);
  const outcomes: DealEnd[] = [];
  while (outcomes.length < AUCTION_SAMPLES && (outcomes.length === 0 || context.budget.timeLeftMs() > RESERVE_MS)) {
    const deal = guesser.guess(context.random);
    if (!deal || !deal.bottom) break;
    const hands: Counts[] = deal.hands.map((hand) => new Uint8Array(hand));
    for (let rank = 0; rank < hands[me].length; rank++) hands[me][rank] += deal.bottom[rank];
    const world: World = {
      hands, sizes: hands.map(cardTotal), landlord: me, turn: me, last: null, lastSeat: me, passes: 0, bombs: 0,
      plays: [0, 0, 0], winner: -1,
    };
    if (rolloutWorld(world)) outcomes.push(dealEnd(world));
  }
  if (outcomes.length === 0) return getDouDizhuBotAction(visible, context.random);
  const match = matchValue(seatTotals(visible), me, dealsLeft(visible), context.random);
  const standStill = match([0, 0, 0]) + PASS_MARGIN;
  const asLandlord = (base: number, grabs: number): number => {
    const value = dealValue(match, 3, me, base, grabs);
    return outcomes.reduce((sum, end) => sum + value(end), 0) / outcomes.length;
  };
  if (visible.options.variant === 'score') {
    let best = 0;
    let bestValue = standStill;
    for (let score = Math.max(1, auction.minScore); score <= 3; score++) {
      const value = asLandlord(score, 0);
      if (value > bestValue) {
        best = score;
        bestValue = value;
      }
    }
    return asAction({ type: 'bid', score: best as 0 | 1 | 2 | 3 });
  }
  // A grab doubles the stake for whoever ends up landlord.
  const callerIndex = visible.bids.findIndex((entry) => entry.kind === 'claim' && entry.take);
  const grabs = callerIndex < 0 ? 0
    : visible.bids.slice(callerIndex + 1).filter((entry) => entry.kind === 'claim' && entry.take).length;
  const taking = asLandlord(1, auction.mode === 'grab' ? grabs + 1 : 0);
  return asAction({ type: 'claim', take: taking > standStill });
}

/** Bot search for the worker pool. */
export function douDizhuSearch(visible: DouDizhuVisibleState, context: SearchContext): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.phase === 'calling') return auctionSearch(visible, context);
  return playSearch(visible, context);
}
