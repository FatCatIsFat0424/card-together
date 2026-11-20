import type { Card, GameSeat, Suit } from '@shared/types';
import type { CrazyEightsVisibleState } from '@shared/games/crazyeights/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { CE_HANDS, CE_SUITS, CE_WILD_RANK, ceCardPoints, ceDeckCount } from '@shared/rules/crazyeights';
import type { BotAction } from './bot-decisions';
import {
  crazyEightsDrawOrPass, crazyEightsOptions, crazyEightsPile, crazyEightsPlay, crazyEightsTurn, getCrazyEightsBotAction,
} from './crazyeights-strategy';
import { dealUnseen } from './search/card-dealer';
import type { DealSeat } from './search/card-dealer';
import { determinizedSearch } from './search/determinized';
import type { DeterminizedGame } from './search/determinized';
import type { SearchContext } from './search/search-types';
import { seededRandom } from './search/seeded-random';

// Determinized search for Crazy Eights. Each sample deals the unseen cards to the opponents' hands and the
// stock, keeping out of each hand the cards it provably lacked when it drew; each candidate is played out to
// the end of the hand with a quick policy for every seat, and scored by the chance of winning the 3-hand
// match from the totals that hand leaves.

/** Cards are suit * 16 + rank (2–14). */
type Code = number;
const code = (card: Card): Code => CE_SUITS.indexOf(card.suit) * 16 + card.rank;
const rankOf = (card: Code): number => card & 15;
const suitOf = (card: Code): number => card >> 4;
const cardOf = (value: Code): Card => ({ suit: CE_SUITS[suitOf(value)], rank: rankOf(value) as Card['rank'] });
const POINTS: readonly number[] = Array.from({ length: 64 }, (_, value) => (rankOf(value) >= 2 ? ceCardPoints(cardOf(value)) : 0));
const points = (card: Code): number => POINTS[card];

const DRAW = 1 << 10;
const PASS = 1 << 11;
/** A play: the card code plus the named suit (for an 8) shifted past it. */
const playMove = (card: Code, suit: number): number => card | (suit << 7);
const cardOfMove = (move: number): Code => move & 127;
const suitOfMove = (move: number): number => (move >> 7) & 3;

/** A complete hand in play; seats are indices in GAME_SEAT_ORDER. */
export interface CrazyEightsWorld {
  readonly hands: Code[][];
  /** Seats at the table in seat order. */
  readonly seats: readonly number[];
  stock: Code[];
  /** Top card last. */
  discard: Code[];
  activeSuit: number;
  /** +1 up the seat order (clockwise), -1 down it. */
  direction: number;
  turn: number;
  drawn: boolean;
  /** Seat that emptied its hand, or -1. */
  winner: number;
  plies: number;
  shuffleSeed: number;
  readonly actionCards: boolean;
}

function copyWorld(world: CrazyEightsWorld): CrazyEightsWorld {
  return { ...world, hands: world.hands.map((hand) => hand.slice()), stock: world.stock.slice(), discard: world.discard.slice() };
}

function nextSeat(world: CrazyEightsWorld, seat: number, direction = world.direction): number {
  const size = GAME_SEAT_ORDER.length;
  let index = seat;
  do index = (index + direction + size) % size; while (!world.seats.includes(index));
  return index;
}

function isPlayable(world: CrazyEightsWorld, card: Code): boolean {
  const top = world.discard[world.discard.length - 1];
  return rankOf(card) === CE_WILD_RANK || suitOf(card) === world.activeSuit || rankOf(card) === rankOf(top);
}

function shuffleInPlace(items: Code[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const swap = items[index];
    items[index] = items[other];
    items[other] = swap;
  }
}

/** The stock top, refilling an empty stock from the discards below the top card. */
function takeCard(world: CrazyEightsWorld): Code | undefined {
  if (world.stock.length === 0 && world.discard.length > 1) {
    world.stock = world.discard.slice(0, -1);
    shuffleInPlace(world.stock, seededRandom(world.shuffleSeed++));
    world.discard = world.discard.slice(-1);
  }
  return world.stock.pop();
}

function advance(world: CrazyEightsWorld, from: number): void {
  world.drawn = false;
  world.turn = nextSeat(world, from);
}

function applyMove(world: CrazyEightsWorld, move: number): void {
  world.plies++;
  const seat = world.turn;
  if (move === PASS) {
    advance(world, seat);
    return;
  }
  const hand = world.hands[seat];
  if (move === DRAW) {
    const card = takeCard(world);
    if (card === undefined) {
      advance(world, seat);
      return;
    }
    hand.push(card);
    if (isPlayable(world, card)) world.drawn = true;
    else advance(world, seat);
    return;
  }
  const card = cardOfMove(move);
  hand.splice(hand.indexOf(card), 1);
  world.discard.push(card);
  world.activeSuit = rankOf(card) === CE_WILD_RANK ? suitOfMove(move) : suitOf(card);
  world.drawn = false;
  if (hand.length === 0) {
    world.winner = seat;
    return;
  }
  const rank = rankOf(card);
  const effect = !world.actionCards ? null : rank === 2 ? 'draw' : rank === 12 ? 'skip' : rank === 14 ? 'reverse' : null;
  if (effect === 'reverse') {
    world.direction = -world.direction;
    world.turn = world.seats.length === 2 ? seat : nextSeat(world, seat);
    return;
  }
  const following = nextSeat(world, seat);
  if (effect === null) {
    world.turn = following;
    return;
  }
  if (effect === 'draw') {
    for (let count = 0; count < 2; count++) {
      const penalty = takeCard(world);
      if (penalty === undefined) break;
      world.hands[following].push(penalty);
    }
  }
  world.turn = nextSeat(world, following);
}

function drawable(world: CrazyEightsWorld): number {
  return world.stock.length + Math.max(0, world.discard.length - 1);
}

function legalMoves(world: CrazyEightsWorld): number[] {
  const hand = world.hands[world.turn];
  const moves: number[] = [];
  for (const card of hand) {
    if (!isPlayable(world, card)) continue;
    if (rankOf(card) === CE_WILD_RANK && hand.length > 1) for (let suit = 0; suit < 4; suit++) moves.push(playMove(card, suit));
    else moves.push(playMove(card, 0));
  }
  if (moves.length > 0) {
    if (world.drawn) moves.push(PASS);
    return moves;
  }
  return [!world.drawn && drawable(world) > 0 ? DRAW : PASS];
}

/** An opponent with this many cards may go out soon, so the rollout policy sheds its 8s. */
const EIGHT_DUMP = 2;

/**
 * The rollout policy: go out when possible; otherwise the heaviest non-8 that plays, favoring the suit the
 * hand holds most of; an 8 only when nothing else plays or an opponent is about to go out, naming the
 * longest suit. A playable drawn card is always played.
 */
function rolloutMove(world: CrazyEightsWorld): number {
  const seat = world.turn;
  const hand = world.hands[seat];
  const lengths = [0, 0, 0, 0];
  for (const card of hand) if (rankOf(card) !== CE_WILD_RANK) lengths[suitOf(card)]++;
  let threat = false;
  for (const other of world.seats) if (other !== seat && world.hands[other].length <= EIGHT_DUMP) threat = true;
  let best = -1;
  let bestScore = -Infinity;
  let eight = -1;
  for (const card of hand) {
    if (!isPlayable(world, card)) continue;
    if (hand.length === 1) return playMove(card, 0);
    if (rankOf(card) === CE_WILD_RANK) {
      eight = card;
      continue;
    }
    const score = points(card) + 3 * (lengths[suitOf(card)] - 1);
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  if (eight >= 0 && (best < 0 || threat)) {
    let suit = 0;
    for (let other = 1; other < 4; other++) if (lengths[other] > lengths[suit]) suit = other;
    return playMove(eight, suit);
  }
  if (best >= 0) return playMove(best, 0);
  return !world.drawn && drawable(world) > 0 ? DRAW : PASS;
}

/** Match terms: the chance of the lowest total after the remaining hands, from the totals this hand leaves. */
export interface MatchOutlook {
  readonly scores: readonly number[];
  readonly handsLeft: number;
}

/** Typical spread of one hand's points between two seats. */
const HAND_SPREAD = 30;
/** Last hand: weight of the point margin to the average opponent, per point, beside winning outright. */
const LAST_MARGIN = 0.004;

function logistic(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function utilityFor(world: CrazyEightsWorld, seat: number, outlook: MatchOutlook): number {
  const totals = world.seats.map((other) => outlook.scores[other]
    + (other === world.winner ? 0 : world.hands[other].reduce((sum, card) => sum + points(card), 0)));
  const me = world.seats.indexOf(seat);
  const mine = totals[me];
  if (outlook.handsLeft === 0) {
    let lowest = Infinity;
    let sum = 0;
    totals.forEach((total, index) => {
      if (index === me) return;
      lowest = Math.min(lowest, total);
      sum += total;
    });
    return (mine <= lowest ? 1 : 0) + LAST_MARGIN * (sum / (totals.length - 1) - mine);
  }
  // Each later hand spreads the totals further; a pairwise logistic stands in for beating each opponent.
  const scale = 1.7 / (HAND_SPREAD * Math.sqrt(outlook.handsLeft));
  let probability = 1;
  totals.forEach((total, index) => {
    if (index !== me) probability *= logistic((total - mine) * scale);
  });
  return probability;
}

/** One group of an opponent's hand: cards held since a draw, which could not be playable cards then. */
interface HandGroup {
  readonly seat: GameSeat;
  readonly size: number;
  readonly excluded: ReadonlySet<Code>;
}

/**
 * Splits each opponent's hand by what its draws proved. A seat that drew had no card of the active suit,
 * of the top rank, or an 8; the card it then could not play (or passed on) obeys that too. Cards drawn
 * later are unconstrained, and the split assumes as many of the current cards as possible were drawn
 * later, so it never asserts more than the log shows.
 */
export function crazyEightsHandGroups(visible: CrazyEightsVisibleState): HandGroup[] {
  const deckCards = CE_SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, index): Code => CE_SUITS.indexOf(suit) * 16 + index + 2));
  type Event = { excluded: Set<Code>; drawsAfter: number };
  const events = new Map<GameSeat, Event[]>();
  let top: Card | null = null;
  let active: Suit = visible.activeSuit;
  const addDraws = (seat: GameSeat, count: number): void => {
    for (const event of events.get(seat) ?? []) event.drawsAfter += count;
  };
  for (const entry of visible.log) {
    if (entry.type === 'hand') {
      events.clear();
      top = entry.starter;
      active = entry.starter.suit;
      continue;
    }
    if (entry.type === 'play') {
      top = entry.card;
      active = entry.card.rank === CE_WILD_RANK ? entry.suit ?? entry.card.suit : entry.card.suit;
      if (entry.target && entry.drawn > 0) addDraws(entry.target, entry.drawn);
      continue;
    }
    if (entry.type === 'draw') {
      if (!top) continue;
      const topRank = top.rank;
      const excluded = new Set(deckCards.filter((card) => rankOf(card) === CE_WILD_RANK || suitOf(card) === CE_SUITS.indexOf(active)
        || rankOf(card) === topRank));
      addDraws(entry.seat, 1);
      // The drawn card stays in the hand only when it could not be played, so it obeys the exclusion too.
      const list = events.get(entry.seat) ?? [];
      list.push({ excluded, drawsAfter: 0 });
      events.set(entry.seat, list);
    }
  }
  const groups: HandGroup[] = [];
  for (const seat of visible.seats) {
    if (seat === visible.mySeat) continue;
    const size = visible.handCounts[seat];
    const list = events.get(seat) ?? [];
    let assigned = 0;
    list.forEach((event, index) => {
      // Cards held since this draw: the hand minus everything drawn afterwards.
      const held = Math.max(0, Math.min(size, size - event.drawsAfter));
      const count = Math.max(0, held - assigned);
      if (count === 0) return;
      const excluded = new Set<Code>();
      for (const later of list.slice(index)) for (const card of later.excluded) excluded.add(card);
      groups.push({ seat, size: count, excluded });
      assigned += count;
    });
    if (size > assigned) groups.push({ seat, size: size - assigned, excluded: new Set() });
  }
  return groups;
}

/** Cards this seat has not seen: the decks minus its hand and the current discard pile. */
export function crazyEightsUnseen(visible: CrazyEightsVisibleState): Code[] {
  const decks = ceDeckCount(visible.seats.length);
  const remaining = new Map<Code, number>();
  for (let suit = 0; suit < 4; suit++) for (let rank = 2; rank <= 14; rank++) remaining.set(suit * 16 + rank, decks);
  const pile = crazyEightsPile(visible);
  for (const card of [...visible.myHand, ...pile]) {
    const key = code(card);
    remaining.set(key, (remaining.get(key) ?? 0) - 1);
  }
  const unseen: Code[] = [];
  for (const [card, count] of remaining) for (let index = 0; index < count; index++) unseen.push(card);
  return unseen;
}

/** Deals one world; drops the draw evidence when it cannot be honored (a pass on a playable draw). */
export function sampleCrazyEightsWorld(visible: CrazyEightsVisibleState, random: () => number): CrazyEightsWorld | null {
  const unseen = crazyEightsUnseen(visible);
  const pile = crazyEightsPile(visible);
  const opponents = visible.seats.filter((seat) => seat !== visible.mySeat);
  const free = opponents.reduce((sum, seat) => sum + visible.handCounts[seat], 0) + visible.stockCount;
  if (free !== unseen.length || pile.length !== visible.reserveCount + 1 || !visible.lastPlayed) return null;
  for (const strict of [true, false]) {
    const groups = strict ? crazyEightsHandGroups(visible)
      : opponents.map((seat) => ({ seat, size: visible.handCounts[seat], excluded: new Set<Code>() }));
    const seats: DealSeat<Code>[] = [
      ...groups.map((group) => ({ size: group.size, accepts: (card: Code) => !group.excluded.has(card) })),
      { size: visible.stockCount },
    ];
    const deal = dealUnseen({ unseen, seats }, random);
    if (!deal) continue;
    const hands: Code[][] = GAME_SEAT_ORDER.map(() => []);
    const index = (seat: GameSeat): number => GAME_SEAT_ORDER.indexOf(seat);
    hands[index(visible.mySeat)] = visible.myHand.map(code);
    groups.forEach((group, position) => hands[index(group.seat)].push(...deal.hands[position]));
    const stock = deal.hands[groups.length];
    shuffleInPlace(stock, random);
    return {
      hands, seats: visible.seats.map(index), stock, discard: pile.map(code), activeSuit: CE_SUITS.indexOf(visible.activeSuit),
      direction: visible.direction === 'cw' ? 1 : -1, turn: index(visible.mySeat), drawn: visible.drawn, winner: -1, plies: 0,
      shuffleSeed: Math.floor(random() * 4294967296), actionCards: visible.options.actionCards,
    };
  }
  return null;
}

/** Plies after which a stuck hand (nothing to play or draw) is scored as it stands. */
const MAX_PLIES = 400;

export function crazyEightsGame(visible: CrazyEightsVisibleState): DeterminizedGame<CrazyEightsWorld, number> {
  const outlook: MatchOutlook = {
    scores: GAME_SEAT_ORDER.map((seat) => visible.scores[seat] ?? 0), handsLeft: CE_HANDS - visible.hand,
  };
  return {
    seat: visible.mySeat,
    sample: (random) => {
      const state = sampleCrazyEightsWorld(visible, random);
      return state ? { state } : null;
    },
    copy: copyWorld,
    legalMoves,
    play: applyMove,
    rolloutMove,
    isTerminal: (world) => world.winner >= 0,
    utility: (world, seat) => utilityFor(world, GAME_SEAT_ORDER.indexOf(seat), outlook),
  };
}

const MAX_SAMPLES = 600;
const MAX_CANDIDATES = 8;

/** Bot search for the worker pool; forced draws and passes skip the search. */
export function crazyEightsSearch(visible: CrazyEightsVisibleState, context: SearchContext): BotAction | null {
  const turn = crazyEightsTurn(visible);
  if (!turn) return null;
  if (turn.playable.length === 0) return crazyEightsDrawOrPass(turn);
  const scored = crazyEightsOptions(visible, turn);
  const candidates = scored.map((option) => ({
    move: playMove(code(option.value.card), CE_SUITS.indexOf(option.value.suit)), prior: option.score,
  }));
  // After a playable draw the bot may also keep the card.
  if (visible.drawn) candidates.push({ move: PASS, prior: Math.min(...candidates.map((candidate) => candidate.prior)) - 1 });
  const unique = [...new Map(candidates.map((candidate) => [candidate.move, candidate])).values()];
  if (unique.length === 1) return getCrazyEightsBotAction(visible, context.random);
  const choice = determinizedSearch(crazyEightsGame(visible), unique, context,
    { maxSamples: MAX_SAMPLES, maxCandidates: MAX_CANDIDATES, maxPlies: MAX_PLIES, minSamples: 12 });
  if (choice.move === PASS) return { type: 'game-action', request: { gameType: 'crazyeights', action: { type: 'pass' } } };
  const card = cardOf(cardOfMove(choice.move));
  return crazyEightsPlay(visible, card, CE_SUITS[suitOfMove(choice.move)]);
}
