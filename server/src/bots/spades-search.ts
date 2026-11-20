import type { Card, Seat } from '@shared/types';
import type { SpadesTeam, SpadesVisibleState } from '@shared/games/spades/types';
import { SPADES_SEATS, SPADES_TARGET, spadesNext, spadesTeam } from '@shared/rules/spades';
import type { BotAction } from './bot-decisions';
import { dealUnseen } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { Candidate, DeterminizedGame, DeterminizedOptions, SampledWorld } from './search/determinized';
import type { SearchContext } from './search/search-types';
import { estimateSpadesTricks, nilRisk, readSpadesTable, SPADES_SUITS, spadesPartner, spadesPlayedBy } from './spades-knowledge';
import { chooseSpadesBid, getSpadesBotAction, scoredSpadesPlays, spadesBidFor } from './spades-strategy';

// Determinized search for Spades bids and card play. Each sample deals the cards this seat has not seen to
// the other three hands: hand sizes and shown voids are exact, and the bids made so far weigh each deal by
// how well the dealt hands match them. Every candidate bid or card is then played out to the end of the hand
// by a fast policy that knows the sampled deal, and scored by the side's real hand result (contract, Nil,
// overtricks, the ten-bag penalty, and a match bonus when the hand ends the match). Candidates within noise
// of the best keep the heuristic's order.

const SUIT_INDEX: Readonly<Record<Card['suit'], number>> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
const SPADE = 3;
const SEAT_INDEX: Readonly<Record<Seat, number>> = { N: 0, E: 1, S: 2, W: 3 };

/** A card as suit * 16 + rank. */
type Code = number;
const suitOf = (code: Code): number => code >> 4;
const rankOf = (code: Code): number => code & 15;
const encode = (card: Card): Code => SUIT_INDEX[card.suit] * 16 + card.rank;
const decode = (code: Code): Card => ({ suit: SPADES_SUITS[suitOf(code)], rank: rankOf(code) } as Card);

const lowBit = (mask: number): number => 31 - Math.clz32(mask & -mask);

/** One sampled deal in play: hands as rank bit masks (bit rank - 2) per seat and suit. */
interface SimState {
  readonly hands: Int32Array;
  /** Bids by seat; -1 for a seat yet to bid. */
  readonly bids: Int32Array;
  readonly trick: Int32Array;
  trickLength: number;
  leader: number;
  turn: number;
  readonly taken: Int32Array;
  broken: boolean;
  done: number;
  /** Heuristic bids of the seats yet to bid, while bidding (see `spadesGame`); never changed once dealt. */
  readonly predicted: Int32Array | null;
}

/** What stays fixed during a hand: scores and bags before it. */
interface HandFacts {
  readonly scores: readonly number[];
  readonly bags: readonly number[];
}

/** Expected future cost of a carried bag, in points: ten bags cost 100 if the match lasts long enough. */
export const SPADES_BAG_COST = 5;
/** Extra value of ending the match as the winner (or cost as the loser) with this hand. */
const MATCH_BONUS = 250;

function copyState(state: SimState): SimState {
  return {
    hands: state.hands.slice(), bids: state.bids.slice(), trick: state.trick.slice(), trickLength: state.trickLength, leader: state.leader,
    turn: state.turn, taken: state.taken.slice(), broken: state.broken, done: state.done, predicted: state.predicted,
  };
}

function legalMask(state: SimState, seat: number, suit: number): number {
  return state.hands[seat * 4 + suit];
}

/** Legal cards for the seat to act, as codes. */
function legalCodes(state: SimState): Code[] {
  const seat = state.turn;
  const codes: Code[] = [];
  const add = (suit: number): void => {
    for (let mask = legalMask(state, seat, suit); mask; mask &= mask - 1) codes.push(suit * 16 + lowBit(mask) + 2);
  };
  if (state.trickLength > 0) {
    const lead = suitOf(state.trick[0]);
    if (legalMask(state, seat, lead)) add(lead);
    else for (let suit = 0; suit < 4; suit++) add(suit);
    return codes;
  }
  const side = legalMask(state, seat, 0) | legalMask(state, seat, 1) | legalMask(state, seat, 2);
  for (let suit = 0; suit < (state.broken || !side ? 4 : 3); suit++) add(suit);
  return codes;
}

function beats(card: Code, best: Code): boolean {
  return suitOf(card) === suitOf(best) ? rankOf(card) > rankOf(best) : suitOf(card) === SPADE;
}

/** Index in the trick of the winning card so far. */
function winningIndex(state: SimState): number {
  let best = 0;
  for (let index = 1; index < state.trickLength; index++) if (beats(state.trick[index], state.trick[best])) best = index;
  return best;
}

function playCode(state: SimState, code: Code): void {
  const seat = state.turn;
  state.hands[seat * 4 + suitOf(code)] &= ~(1 << (rankOf(code) - 2));
  state.trick[state.trickLength++] = code;
  if (suitOf(code) === SPADE) state.broken = true;
  if (state.trickLength < 4) {
    state.turn = (seat + 1) % 4;
    return;
  }
  const winner = (state.leader + winningIndex(state)) % 4;
  state.taken[winner]++;
  state.done++;
  state.trickLength = 0;
  state.leader = winner;
  state.turn = winner;
}

/** Whether `seat` can beat `best` in a trick led in `lead`, knowing its hand. */
function canBeat(state: SimState, seat: number, best: Code, lead: number): boolean {
  const follow = legalMask(state, seat, lead);
  const bestSuit = suitOf(best);
  if (follow) return bestSuit === lead && (follow >> (rankOf(best) - 1)) !== 0;
  const spades = legalMask(state, seat, SPADE);
  if (bestSuit === SPADE) return (spades >> (rankOf(best) - 1)) !== 0;
  return spades !== 0;
}

function teamNeed(state: SimState, team: number): number {
  let need = 0;
  for (let seat = team; seat < 4; seat += 2) if (state.bids[seat] > 0) need += state.bids[seat] - state.taken[seat];
  return Math.max(0, need);
}

function nilLive(state: SimState, seat: number): boolean {
  return state.bids[seat] === 0 && state.taken[seat] === 0;
}

function wantsTricks(state: SimState, seat: number): boolean {
  if (teamNeed(state, seat & 1) > 0) return true;
  const theirs = teamNeed(state, (seat + 1) & 1);
  const left = 13 - state.done;
  if (theirs <= 0 || theirs > left) return false;
  return (left - theirs + 1) * 2 <= left + 1;
}

function lowestOf(codes: readonly Code[]): Code {
  let best = codes[0];
  for (const code of codes) {
    const spadeFirst = (suitOf(code) === SPADE ? 100 : 0) + rankOf(code);
    if (spadeFirst < (suitOf(best) === SPADE ? 100 : 0) + rankOf(best)) best = code;
  }
  return best;
}

function highestOf(codes: readonly Code[]): Code {
  let best = codes[0];
  for (const code of codes) {
    if ((suitOf(code) === SPADE ? 100 : 0) + rankOf(code) > (suitOf(best) === SPADE ? 100 : 0) + rankOf(best)) best = code;
  }
  return best;
}

/** A later opponent of `seat` in the current trick that can beat `card`. */
function opponentCanBeat(state: SimState, seat: number, card: Code, lead: number): boolean {
  for (let offset = state.trickLength + 1; offset < 4; offset++) {
    const later = (state.leader + offset) % 4;
    if (((later ^ seat) & 1) === 1 && canBeat(state, later, card, lead)) return true;
  }
  return false;
}

function laterInTrick(state: SimState, target: number): boolean {
  for (let offset = state.trickLength + 1; offset < 4; offset++) if ((state.leader + offset) % 4 === target) return true;
  return false;
}

/** Fast policy for any seat, reading the whole sampled deal; mirrors the heuristic's priorities. */
function policy(state: SimState): Code {
  const codes = legalCodes(state);
  if (codes.length === 1) return codes[0];
  const seat = state.turn;
  const partner = (seat + 2) % 4;
  const opponentNil = nilLive(state, (seat + 1) % 4) ? (seat + 1) % 4 : nilLive(state, (seat + 3) % 4) ? (seat + 3) % 4 : -1;
  if (state.trickLength === 0) return leadPolicy(state, codes, seat, partner, opponentNil);
  const lead = suitOf(state.trick[0]);
  const bestIndex = winningIndex(state);
  const best = state.trick[bestIndex];
  const bestSeat = (state.leader + bestIndex) % 4;
  const winners = codes.filter((code) => beats(code, best));
  const losers = codes.filter((code) => !beats(code, best));
  const last = state.trickLength === 3;
  if (nilLive(state, seat)) {
    if (losers.length) return highestOf(losers);
    return last ? highestOf(winners) : lowestOf(winners);
  }
  if (nilLive(state, partner)) {
    if (laterInTrick(state, partner)) return winners.length ? highestOf(winners) : highestOf(codes);
    if (bestSeat === partner && winners.length) {
      const safe = winners.filter((code) => !opponentCanBeat(state, seat, code, lead));
      return safe.length ? lowestOf(safe) : highestOf(winners);
    }
  }
  if (opponentNil >= 0 && bestSeat === opponentNil) return losers.length ? highestOf(losers) : lowestOf(winners);
  if (opponentNil >= 0 && laterInTrick(state, opponentNil)) return lowestOf(losers.length ? losers : codes);
  if (!wantsTricks(state, seat)) {
    if (losers.length) return highestOf(losers);
    return last ? highestOf(winners) : lowestOf(winners);
  }
  if (bestSeat === partner && !opponentCanBeat(state, seat, best, lead)) return lowestOf(codes);
  const sure = winners.filter((code) => !opponentCanBeat(state, seat, code, lead));
  if (sure.length) return lowestOf(sure);
  return lowestOf(codes);
}

function leadPolicy(state: SimState, codes: readonly Code[], seat: number, partner: number, opponentNil: number): Code {
  if (nilLive(state, seat)) return lowestOf(codes);
  if (nilLive(state, partner)) {
    const sure = codes.filter((code) => !leadBeaten(state, seat, code));
    return highestOf(sure.length ? sure : codes);
  }
  if (opponentNil >= 0) {
    // A suit where the Nil bidder's lowest card is above ours forces it to win unless its partner overtakes.
    for (const code of [...codes].sort((a, b) => rankOf(a) - rankOf(b))) {
      const theirs = legalMask(state, opponentNil, suitOf(code));
      if (theirs && lowBit(theirs) + 2 > rankOf(code)) return code;
    }
    const live = codes.filter((code) => legalMask(state, opponentNil, suitOf(code)) !== 0);
    return lowestOf(live.length ? live : codes);
  }
  if (!wantsTricks(state, seat)) return lowestOf(codes);
  const sure = codes.filter((code) => !leadBeaten(state, seat, code));
  const sideSure = sure.filter((code) => suitOf(code) !== SPADE);
  if (sideSure.length) return sideSure[0];
  if (sure.length) return sure[0];
  // Give partner a ruff in a suit it lacks while the opponents still follow.
  for (const code of codes) {
    const suit = suitOf(code);
    if (suit !== SPADE && !legalMask(state, partner, suit) && legalMask(state, partner, SPADE)
      && legalMask(state, (seat + 1) % 4, suit) && legalMask(state, (seat + 3) % 4, suit)) return lowestOfSuit(codes, suit);
  }
  return lowestOf(codes);
}

function lowestOfSuit(codes: readonly Code[], suit: number): Code {
  return lowestOf(codes.filter((code) => suitOf(code) === suit));
}

/** Whether an opponent of `seat` can beat a lead of `code`. */
function leadBeaten(state: SimState, seat: number, code: Code): boolean {
  const suit = suitOf(code);
  return canBeat(state, (seat + 1) % 4, code, suit) || canBeat(state, (seat + 3) % 4, code, suit);
}

/** The team's hand score as scoreSpadesHand computes it, less the expected cost of carried bags. */
function teamValue(facts: HandFacts, state: SimState, team: number): { points: number; carried: number } {
  let contract = 0;
  let tricks = 0;
  let nilTricks = 0;
  let nilPoints = 0;
  for (let seat = team; seat < 4; seat += 2) {
    if (state.bids[seat] === 0) {
      nilTricks += state.taken[seat];
      nilPoints += state.taken[seat] === 0 ? 100 : -100;
    } else {
      contract += state.bids[seat];
      tricks += state.taken[seat];
    }
  }
  const bagsAdded = Math.max(0, tricks - contract) + nilTricks;
  const contractPoints = tricks >= contract ? contract * 10 : -contract * 10;
  const allBags = facts.bags[team] + bagsAdded;
  return { points: contractPoints + nilPoints + bagsAdded - Math.floor(allBags / 10) * 100, carried: allBags % 10 };
}

/** The deciding side's margin over the other side for the hand, in match terms. */
function handUtility(facts: HandFacts, state: SimState, seat: number): number {
  const mine = teamValue(facts, state, seat & 1);
  const theirs = teamValue(facts, state, (seat + 1) & 1);
  let value = mine.points - theirs.points - SPADES_BAG_COST * (mine.carried - theirs.carried);
  const myTotal = facts.scores[seat & 1] + mine.points;
  const theirTotal = facts.scores[(seat + 1) & 1] + theirs.points;
  if (Math.max(myTotal, theirTotal) >= SPADES_TARGET && myTotal !== theirTotal) value += myTotal > theirTotal ? MATCH_BONUS : -MATCH_BONUS;
  return value;
}


const TEAM_OF_INDEX: readonly SpadesTeam[] = ['NS', 'EW'];

/** The search's value of a finished hand for `seat`'s side, from public records. */
export function spadesHandUtility(
  bids: Readonly<Record<Seat, number>>, taken: Readonly<Record<Seat, number>>, scores: Readonly<Record<SpadesTeam, number>>,
  bags: Readonly<Record<SpadesTeam, number>>, seat: Seat,
): number {
  const facts: HandFacts = { scores: TEAM_OF_INDEX.map((team) => scores[team]), bags: TEAM_OF_INDEX.map((team) => bags[team]) };
  const state = { bids: Int32Array.from(SPADES_SEATS.map((other) => bids[other])),
    taken: Int32Array.from(SPADES_SEATS.map((other) => taken[other])) } as SimState;
  return handUtility(facts, state, SEAT_INDEX[seat]);
}

/** Spread of a bid around the bidder's estimated tricks, for weighting deals. */
const BID_SPREAD = 1.6;

/**
 * The search plug-in for the seat's own view, while bidding or playing. A move is a card code while
 * playing; while bidding it is this seat's bid, after which the seats still to bid bid as the heuristic
 * would with their dealt hands and the hand is played out.
 */
export function spadesGame(visible: SpadesVisibleState): DeterminizedGame<SimState, number> {
  const { position } = visible;
  const table = readSpadesTable(visible);
  const mySeat = visible.mySeat;
  const me = SEAT_INDEX[mySeat];
  const facts: HandFacts = {
    scores: TEAM_OF_INDEX.map((team) => visible.scores[team]),
    bags: TEAM_OF_INDEX.map((team) => visible.bags[team]),
  };
  const others = SPADES_SEATS.filter((seat) => seat !== mySeat);
  const played = spadesPlayedBy(visible);
  const bidding = visible.phase === 'bidding';
  const firstLeader = SEAT_INDEX[spadesNext(visible.dealerSeat)];
  const base: SimState = {
    hands: new Int32Array(16),
    bids: Int32Array.from(SPADES_SEATS.map((seat) => position.bids[seat] ?? -1)),
    trick: new Int32Array(4),
    trickLength: position.trick.length,
    leader: bidding ? firstLeader : SEAT_INDEX[position.trick[0]?.seat ?? mySeat],
    turn: bidding ? firstLeader : me,
    taken: Int32Array.from(SPADES_SEATS.map((seat) => position.taken[seat])),
    broken: position.broken,
    done: position.tricks.length,
    predicted: null,
  };
  position.trick.forEach((play, index) => { base.trick[index] = encode(play.card); });
  for (const card of visible.myHand) base.hands[me * 4 + SUIT_INDEX[card.suit]] |= 1 << (card.rank - 2);
  const logLikelihood = (hands: readonly (readonly Card[])[]): number => others.reduce((sum, seat, index) => {
    const bid = position.bids[seat];
    if (bid === null) return sum;
    const original = [...hands[index], ...played[seat]];
    if (bid === 0) return sum - Math.max(0, nilRisk(original) - 0.8) ** 2 / (2 * 0.6 ** 2);
    return sum - (estimateSpadesTricks(original) - bid) ** 2 / (2 * BID_SPREAD ** 2);
  }, 0);
  /** Bids of the seats still to bid: by seat index, then again for when this seat bids Nil. */
  const predict = (hands: readonly (readonly Card[])[]): Int32Array => {
    const predicted = new Int32Array(8).fill(-1);
    others.forEach((seat, index) => {
      if (position.bids[seat] !== null) return;
      const team = spadesTeam(seat);
      const partner = spadesPartner(seat);
      const context = {
        partnerBid: position.bids[partner],
        behind: visible.scores[team === 'NS' ? 'EW' : 'NS'] - visible.scores[team],
        bags: visible.bags[team],
        otherBids: null,
      };
      predicted[SEAT_INDEX[seat]] = spadesBidFor(hands[index], context);
      predicted[4 + SEAT_INDEX[seat]] = spadesBidFor(hands[index], partner === mySeat ? { ...context, partnerBid: 0 } : context);
    });
    return predicted;
  };
  return {
    seat: mySeat,
    sample: (random): SampledWorld<SimState> | null => {
      const deal = dealUnseen({
        unseen: table.unseen,
        seats: others.map((seat) => ({
          size: visible.handCounts[seat] ?? 0,
          accepts: (card: Card) => !table.voids[seat].has(card.suit),
        })),
        logLikelihood,
      }, random);
      if (!deal) return null;
      const state = { ...copyState(base), predicted: bidding ? predict(deal.hands) : null };
      deal.hands.forEach((hand, index) => {
        const seat = SEAT_INDEX[others[index]];
        for (const card of hand) state.hands[seat * 4 + SUIT_INDEX[card.suit]] |= 1 << (card.rank - 2);
      });
      return { state, weight: deal.weight };
    },
    copy: copyState,
    legalMoves: legalCodes,
    play: (state, move) => {
      if (state.bids[me] >= 0) {
        playCode(state, move);
        return;
      }
      state.bids[me] = move;
      for (let seat = 0; seat < 4; seat++) {
        if (state.bids[seat] < 0) state.bids[seat] = state.predicted![(move === 0 ? 4 : 0) + seat];
      }
    },
    rolloutMove: (state) => policy(state),
    isTerminal: (state) => state.done === 13,
    utility: (state, seat) => handUtility(facts, state, SEAT_INDEX[seat as Seat]),
  };
}

/**
 * Legal cards that no unseen card separates, as one representative each (the heuristic's favorite):
 * they play identically against every deal.
 */
function candidateCards(visible: SpadesVisibleState): Candidate<Code>[] {
  const scored = scoredSpadesPlays(visible);
  const table = readSpadesTable(visible);
  const unseen = new Set(table.unseen.map(encode));
  const groups: { code: Code; prior: number }[] = [];
  const sorted = [...scored].sort((a, b) => encode(a.value) - encode(b.value));
  let previous: Code | null = null;
  for (const option of sorted) {
    const code = encode(option.value);
    let touching = previous !== null && suitOf(previous) === suitOf(code);
    for (let between = (previous ?? 0) + 1; touching && between < code; between++) if (unseen.has(between)) touching = false;
    if (touching && groups.length) {
      const group = groups[groups.length - 1];
      if (option.score > group.prior) {
        group.code = code;
        group.prior = option.score;
      }
    } else groups.push({ code, prior: option.score });
    previous = code;
  }
  return groups.map((group) => ({ move: group.code, prior: group.prior }));
}

/** Bids near the heuristic's, which ranks first; Nil joins when the hand is close to one. */
function candidateBids(visible: SpadesVisibleState): Candidate<number>[] {
  const heuristic = chooseSpadesBid(visible);
  const estimate = Math.max(1, Math.floor(estimateSpadesTricks(visible.myHand) + 0.4));
  const center = heuristic === 0 ? estimate : heuristic;
  const bids = new Map<number, number>();
  for (let offset = -2; offset <= 2; offset++) {
    const bid = center + offset;
    if (bid >= 1 && bid <= 13) bids.set(bid, -Math.abs(offset));
  }
  const partnerNil = visible.position.bids[spadesPartner(visible.mySeat)] === 0;
  if (heuristic === 0) bids.set(0, 1);
  else if (!partnerNil && nilRisk(visible.myHand) < NIL_CANDIDATE_RISK) bids.set(0, -1.5);
  return [...bids].map(([move, prior]) => ({ move, prior }));
}

/** Nil risk up to which a bid search also tries Nil. */
const NIL_CANDIDATE_RISK = 1.8;

/** Search settings; the budget usually ends the search before `maxSamples`. */
const SEARCH = { maxSamples: 600, minSamples: 12, tolerance: 0.5, confidence: 1, reserveMs: 20 } as const;
const BID_SEARCH = { maxSamples: 500, minSamples: 24, tolerance: 1, confidence: 1, reserveMs: 20 } as const;

/** The card the search prefers, or null when the heuristic should decide. */
export function chooseSpadesPlay(
  visible: SpadesVisibleState, context: SearchContext, options: DeterminizedOptions = {},
): Card | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || visible.validCards.length === 0) return null;
  const candidates = candidateCards(visible);
  if (candidates.length === 1) return decode(candidates[0].move);
  const choice = determinizedSearch(spadesGame(visible), candidates, context, { ...SEARCH, ...options });
  return choice.reason === 'prior' ? null : decode(choice.move);
}

/** The bid the search prefers by playing each candidate out on sampled deals, or null for the heuristic's. */
export function chooseSpadesSearchBid(
  visible: SpadesVisibleState, context: SearchContext, options: DeterminizedOptions = {},
): number | null {
  if (visible.phase !== 'bidding' || visible.currentTurnSeat !== visible.mySeat) return null;
  const choice = determinizedSearch(spadesGame(visible), candidateBids(visible), context, { ...BID_SEARCH, ...options });
  return choice.reason === 'prior' ? null : choice.move;
}

/**
 * Worker-pool strategy: bids and cards search sampled deals; the heuristic decides when the search
 * cannot. `options` override the search settings (tests bound the samples instead of the clock).
 */
export function spadesSearch(visible: SpadesVisibleState, context: SearchContext, options: DeterminizedOptions = {}): BotAction | null {
  if (visible.phase === 'playing') {
    const card = chooseSpadesPlay(visible, context, options);
    if (card) return { type: 'game-action', request: { gameType: 'spades', action: { type: 'play', card } } };
  }
  if (visible.phase === 'bidding') {
    const bid = chooseSpadesSearchBid(visible, context, options);
    if (bid !== null) return { type: 'game-action', request: { gameType: 'spades', action: { type: 'bid', bid } } };
  }
  return getSpadesBotAction(visible, context.random);
}
