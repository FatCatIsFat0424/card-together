import type { Card, GameSeat, TenHalfAction, TenHalfVisibleState } from '@shared/types';
import { BJ_MIN_BET, bjSitsIn } from '@shared/rules/blackjack';
import {
  TH_LIMIT, TH_MAX_CARDS, TH_MULTIPLIERS, thCardHalves, thHalves, thKindOf, thStrengthOf,
} from '@shared/rules/tenhalf';
import { createDeck } from '../engine/deck';
import { planRace, raceInput, SYNC_RACE } from './chip-race';
import type { Atom, RaceOptions } from './chip-race';
import type { BotAction } from './bot-decisions';

// Heuristic summary: the bot bets for the chance of finishing first (see chip-race) and decides every draw from
// the cards it cannot see: its own hole card and every face-up card leave the deck, and each draw, including the
// hidden hole cards of opponents, comes from what remains. A player compares standing with drawing (and drawing
// on) against the banker's final hand. The banker acts last and sees every face-up card, so the player models it
// as the bot itself would play it: it solves the banker's stand-or-draw choice for every hand it could hold against
// the players' visible cards. The banker reads each player's hole card from that player's own play: a seat that
// drew and stood is assumed to follow the same stand-or-draw rule as the bot, which rules out the hole cards
// that would have acted differently. Losses are capped at the chips a player held before the hand. Short-bank
// proportional payouts are ignored.

/** A hand as its half points and card count, which decide its kind, strength, and multiple. */
interface Hand {
  readonly halves: number;
  readonly count: number;
}

/** One kind of unseen card: its half points and chance of being drawn. */
interface Draw {
  readonly halves: number;
  readonly chance: number;
}

type Distribution = ReadonlyMap<string, { readonly hand: Hand; readonly chance: number }>;
type Builder = Map<string, { hand: Hand; chance: number }>;

const keyOf = (hand: Hand): string => `${hand.halves}:${hand.count}`;

/** Weight kept for a hole card whose owner played differently from the bot's own rule. */
const DEVIATION = 0.12;
/** The average banker draws below this many half points (7.5). */
const GENERIC_BANKER_STANDS = 15;

/** Probability of the next card's half points among the cards this seat cannot see. */
export function unseenDraws(visible: TenHalfVisibleState): Draw[] {
  const seen = new Set<string>();
  const mark = (card: Card): void => { seen.add(`${card.suit}${card.rank}`); };
  const hole = visible.holes[visible.mySeat];
  if (hole) mark(hole);
  for (const seat of visible.seats) visible.ups[seat].forEach(mark);
  const counts = new Map<number, number>();
  let total = 0;
  for (const card of createDeck()) {
    if (seen.has(`${card.suit}${card.rank}`)) continue;
    counts.set(thCardHalves(card), (counts.get(thCardHalves(card)) ?? 0) + 1);
    total += 1;
  }
  return [...counts].map(([halves, count]) => ({ halves, chance: count / total }));
}

const canDraw = (hand: Hand): boolean => hand.halves < TH_LIMIT && hand.count < TH_MAX_CARDS;

function add(distribution: Builder, hand: Hand, chance: number): void {
  const key = keyOf(hand);
  const entry = distribution.get(key);
  if (entry) entry.chance += chance;
  else distribution.set(key, { hand, chance });
}

/** Bets a player nets (negative is a loss) with `hand` against the banker's final hand; losses stop at `capBets`. */
function playerResult(hand: Hand, banker: Hand, capBets: number): number {
  const own = thStrengthOf(hand.halves, hand.count);
  if (own >= 0 && own > thStrengthOf(banker.halves, banker.count)) return TH_MULTIPLIERS[thKindOf(hand.halves, hand.count)];
  return -Math.min(TH_MULTIPLIERS[thKindOf(banker.halves, banker.count)], capBets);
}

/** Expected bets a player nets with `hand` against each possible banker hand. */
function playerValue(hand: Hand, banker: Distribution, capBets: number): number {
  let value = 0;
  for (const { hand: other, chance } of banker.values()) value += chance * playerResult(hand, other, capBets);
  return value;
}

interface Solved {
  /** Whether drawing beats standing on the hand. */
  readonly draws: (hand: Hand) => boolean;
  /** Expected value of drawing one more card and then playing on optimally. */
  readonly drawValue: (hand: Hand) => number;
}

/** Stand-or-draw choices over every hand, given the value of standing on any hand. */
function solveDrawing(draws: readonly Draw[], stand: (hand: Hand) => number): Solved {
  const memo = new Map<string, { value: number; draws: boolean }>();
  const drawValue = (hand: Hand): number => draws.reduce(
    (sum, draw) => sum + draw.chance * solved({ halves: hand.halves + draw.halves, count: hand.count + 1 }).value, 0);
  const solved = (hand: Hand): { value: number; draws: boolean } => {
    const key = keyOf(hand);
    const known = memo.get(key);
    if (known) return known;
    let result = { value: stand(hand), draws: false };
    if (canDraw(hand)) {
      const hit = drawValue(hand);
      if (hit > result.value) result = { value: hit, draws: true };
    }
    memo.set(key, result);
    return result;
  };
  return { draws: (hand) => solved(hand).draws, drawValue };
}

/** Final hands of seats that draw until they hold `stand` half points, five cards, or bust. */
function drawToStand(starts: Distribution, draws: readonly Draw[], stand: number): Distribution {
  const result: Builder = new Map();
  let frontier = starts;
  while (frontier.size > 0) {
    const next: Builder = new Map();
    for (const { hand, chance } of frontier.values()) {
      if (hand.halves >= stand || hand.count >= TH_MAX_CARDS) {
        add(result, hand, chance);
        continue;
      }
      for (const draw of draws) add(next, { halves: hand.halves + draw.halves, count: hand.count + 1 }, chance * draw.chance);
    }
    frontier = next;
  }
  return result;
}

function fullDeckDraws(): Draw[] {
  const counts = new Map<number, number>();
  for (const card of createDeck()) counts.set(thCardHalves(card), (counts.get(thCardHalves(card)) ?? 0) + 1);
  return [...counts].map(([halves, count]) => ({ halves, chance: count / 52 }));
}

/** The bot's own rule as a player facing an average banker from a fresh deck, as a table over hands. */
let standingRule: Solved | null = null;

function genericRule(): Solved {
  if (standingRule) return standingRule;
  const draws = fullDeckDraws();
  const starts: Builder = new Map();
  for (const hole of draws) add(starts, { halves: hole.halves, count: 1 }, hole.chance);
  const banker = drawToStand(starts, draws, GENERIC_BANKER_STANDS);
  standingRule = solveDrawing(draws, (hand) => playerValue(hand, banker, Infinity));
  return standingRule;
}

/** Whether the public record shows `seat` chose to stand this hand (rather than being ended by its last card). */
function stoodThisHand(visible: TenHalfVisibleState, seat: GameSeat): boolean {
  for (let index = visible.log.length - 1; index >= 0; index--) {
    const entry = visible.log[index];
    if (entry.type === 'deal') return false;
    if (entry.type === 'stand' && entry.seat === seat) return true;
  }
  return false;
}

/**
 * A seat's final hands as the banker sees them: the unknown hole card weighted by how likely a seat that follows
 * the bot's own rule is to have drawn and stood as this one did.
 */
export function finalHands(ups: readonly Card[], stood: boolean, draws: readonly Draw[]): Distribution {
  const rule = genericRule();
  const result: Builder = new Map();
  let total = 0;
  for (const hole of draws) {
    let weight = hole.chance;
    let halves = hole.halves;
    let count = 1;
    for (const card of ups) {
      const hand = { halves, count };
      if (!canDraw(hand)) {
        weight = 0;
        break;
      }
      if (!rule.draws(hand)) weight *= DEVIATION;
      halves += thCardHalves(card);
      count += 1;
    }
    if (weight > 0 && stood) {
      const hand = { halves, count };
      if (!canDraw(hand)) weight = 0;
      else if (rule.draws(hand)) weight *= DEVIATION;
    }
    if (weight === 0) continue;
    add(result, { halves, count }, weight);
    total += weight;
  }
  if (total === 0) {
    // The record contradicts every hole card, so keep the plain chances.
    for (const hole of draws) add(result, { halves: hole.halves + thHalves(ups), count: ups.length + 1 }, hole.chance);
    return result;
  }
  for (const entry of result.values()) entry.chance /= total;
  return result;
}

interface Opponent {
  readonly bet: number;
  /** What the seat can lose, in bets. */
  readonly capBets: number;
  readonly hands: Distribution;
}

/** The players the banker faces, as the banker sees them. */
function opponentsOf(visible: TenHalfVisibleState, draws: readonly Draw[]): Opponent[] {
  return visible.dealt.filter((seat) => seat !== visible.banker && visible.bets[seat] > 0).map((seat) => {
    const bet = visible.bets[seat];
    // Chips are shown after the stake left them.
    return {
      bet, capBets: (visible.chips[seat] + bet) / bet,
      hands: finalHands(visible.ups[seat], stoodThisHand(visible, seat), draws),
    };
  });
}

/** Chips the banker nets by standing on `hand` against every player. */
function bankerStand(opponents: readonly Opponent[]): (hand: Hand) => number {
  return (hand) => {
    const banker: Distribution = new Map([[keyOf(hand), { hand, chance: 1 }]]);
    let net = 0;
    for (const { bet, capBets, hands } of opponents) {
      let value = 0;
      for (const entry of hands.values()) value += entry.chance * playerValue(entry.hand, banker, capBets);
      net -= bet * value;
    }
    return net;
  };
}

/** The banker's final hands as a player sees them: the banker draws by its solved rule against the visible cards. */
function bankerOutcomes(visible: TenHalfVisibleState, draws: readonly Draw[]): Distribution {
  const solved = solveDrawing(draws, bankerStand(opponentsOf(visible, draws)));
  const ups = visible.ups[visible.banker];
  const result: Builder = new Map();
  const settle = (hand: Hand, chance: number): void => {
    if (!canDraw(hand) || !solved.draws(hand)) {
      add(result, hand, chance);
      return;
    }
    for (const draw of draws) settle({ halves: hand.halves + draw.halves, count: hand.count + 1 }, chance * draw.chance);
  };
  for (const hole of draws) settle({ halves: hole.halves + thHalves(ups), count: ups.length + 1 }, hole.chance);
  return result;
}

export function tenHalfDecision(visible: TenHalfVisibleState): TenHalfAction {
  const hole = visible.holes[visible.mySeat];
  if (!hole) return 'stand';
  const mine: Hand = { halves: thHalves([hole, ...visible.ups[visible.mySeat]]), count: visible.ups[visible.mySeat].length + 1 };
  const draws = unseenDraws(visible);
  if (visible.banker === visible.mySeat) {
    const stand = bankerStand(opponentsOf(visible, draws));
    return solveDrawing(draws, stand).drawValue(mine) > stand(mine) ? 'hit' : 'stand';
  }
  const bet = visible.bets[visible.mySeat];
  const capBets = bet > 0 ? (visible.chips[visible.mySeat] + bet) / bet : Infinity;
  const banker = bankerOutcomes(visible, draws);
  const stand = (hand: Hand): number => playerValue(hand, banker, capBets);
  return solveDrawing(draws, stand).drawValue(mine) > stand(mine) ? 'hit' : 'stand';
}

/**
 * Net chips per chip staked by a player over a whole hand against a banker who acts last, from simulated matches
 * of these bots: ties go to the banker, so the mean is -15%, with the banker's multiples in the tails.
 */
export const TENHALF_PLAYER: readonly Atom[] = [
  { x: -4, p: 0.00125 }, { x: -3, p: 0.03375 }, { x: -2, p: 0.04417 }, { x: -1, p: 0.49333 }, { x: 1, p: 0.35625 },
  { x: 2, p: 0.03417 }, { x: 3, p: 0.03417 }, { x: 4, p: 0.00208 }, { x: 5, p: 0.00083 },
];

/** The stake with the best chance of finishing first; see `chip-race`. */
export function tenHalfBet(visible: TenHalfVisibleState, random: () => number, options: RaceOptions = SYNC_RACE): number {
  
  return planRace(raceInput(visible, visible.banker, TENHALF_PLAYER), random, options).bet ?? BJ_MIN_BET;
}

function actionOf(action: TenHalfAction): BotAction {
  return { type: 'game-action', request: { gameType: 'tenhalf', action: { type: 'act', action } } };
}

function betOf(amount: number): BotAction {
  return { type: 'game-action', request: { gameType: 'tenhalf', action: { type: 'bet', amount } } };
}

function bettingOpen(visible: TenHalfVisibleState): boolean {
  return visible.phase === 'betting' && visible.myBet === null && visible.banker !== visible.mySeat
    && bjSitsIn(visible.chips[visible.mySeat]);
}

function myTurn(visible: TenHalfVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat
    && visible.holes[visible.mySeat] !== null && !visible.done[visible.mySeat];
}

export function tenHalfBetAction(
  visible: TenHalfVisibleState, random: () => number, options: RaceOptions = SYNC_RACE,
): BotAction | null {
  return bettingOpen(visible) ? betOf(tenHalfBet(visible, random, options)) : null;
}

export function getTenHalfBotAction(visible: TenHalfVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'betting') return tenHalfBetAction(visible, random);
  return myTurn(visible) ? actionOf(tenHalfDecision(visible)) : null;
}

/** Minimum bet when betting, otherwise stand: the timeout action and the last-resort legal move. */
export function tenHalfFirstLegalAction(visible: TenHalfVisibleState): BotAction | null {
  if (visible.phase === 'betting') return bettingOpen(visible) ? betOf(BJ_MIN_BET) : null;
  return myTurn(visible) ? actionOf('stand') : null;
}
