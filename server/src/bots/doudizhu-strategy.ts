import type { CardOrJoker, DouDizhuVisibleState, GameSeat } from '@shared/types';
import type { DouDizhuAction } from '@shared/games/doudizhu/actions';
import { cardKey } from '@shared/rules/cards';
import { createDdzDeck, ddzIsBomb, ddzMoves, ddzPower, ddzSmallestMove } from '@shared/rules/doudizhu';
import type { DdzCombo, DdzMove } from '@shared/rules/doudizhu';
import { ddzReplay } from '@shared/rules/doudizhu-table';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

// Heuristic summary: bots bid from a count of jokers, 2s, aces and bombs. Easy plays the smallest legal
// combination. Hard measures a hand by how many plays it needs to empty (rocket, bombs, chains, triples with
// kickers, pairs, singles); it plays the move that leaves the fewest plays, spends control cards only when
// the table is close to ending, never beats a partner's winning play, and feeds a partner who is about to
// go out. The same evaluation drives the rollouts of the search bot.

const asAction = (action: DouDizhuAction): BotAction => ({ type: 'game-action', request: { gameType: 'doudizhu', action } });

// ─── Hand evaluation ───

function countsOf(hand: readonly CardOrJoker[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of hand) counts.set(ddzPower(card), (counts.get(ddzPower(card)) ?? 0) + 1);
  return counts;
}

/** How strong a 17-card hand is for the landlord: high cards, bombs, and the rocket. */
export function handStrength(hand: readonly CardOrJoker[]): number {
  const counts = countsOf(hand);
  let strength = 0;
  if (counts.has(16) && counts.has(17)) strength += 4;
  else if (counts.has(17)) strength += 2;
  else if (counts.has(16)) strength += 1.2;
  strength += (counts.get(15) ?? 0) * 1.4 + (counts.get(14) ?? 0) * 0.5;
  for (const [power, count] of counts) if (count === 4 && power < 16) strength += 2.5;
  return strength;
}

function removeRun(counts: Map<number, number>, minimum: number, minimumLength: number): number {
  let best: number[] = [];
  for (let start = 3; start <= 14; start++) {
    const run: number[] = [];
    for (let power = start; power <= 14 && (counts.get(power) ?? 0) >= minimum; power++) run.push(power);
    if (run.length >= minimumLength && run.length > best.length) best = run;
  }
  for (const power of best) counts.set(power, counts.get(power)! - (minimum === 1 ? 1 : minimum));
  return best.length;
}

function planTurns(source: ReadonlyMap<number, number>, chains: boolean): number {
  const counts = new Map(source);
  let turns = 0;
  if (chains) {
    while (removeRun(counts, 2, 3) > 0) turns += 1;
    while (removeRun(counts, 1, 5) > 0) turns += 1;
  }
  let triples = 0;
  let small = 0;
  for (let power = 3; power <= 17; power++) {
    const count = counts.get(power) ?? 0;
    if (count >= 3) triples += 1;
    else if (count > 0) small += 1;
  }
  // Consecutive triples fly together, and a triple or airplane takes along one small group per triple.
  let planes = 0;
  for (let power = 3; power <= 13; power++) {
    if ((counts.get(power) ?? 0) >= 3 && (counts.get(power + 1) ?? 0) >= 3) {
      planes += 1;
      while ((counts.get(power + 1) ?? 0) >= 3) power += 1;
    }
  }
  const absorbed = Math.min(triples, small);
  return turns + triples - planes + small - absorbed;
}

/** Rough minimum number of plays to empty the hand. */
export function handTurns(hand: readonly CardOrJoker[]): number {
  const counts = countsOf(hand);
  let turns = 0;
  if (counts.has(16) && counts.has(17)) {
    turns += 1;
    counts.delete(16);
    counts.delete(17);
  }
  for (const [power, count] of [...counts]) {
    if (count === 4) {
      turns += 1;
      counts.delete(power);
    }
  }
  return turns + Math.min(planTurns(counts, false), planTurns(counts, true));
}

// ─── What the seat can know ───

/** Cards played since the current deal began. */
export function dealPlays(visible: DouDizhuVisibleState): CardOrJoker[] {
  let start = visible.log.length - 1;
  while (start >= 0 && visible.log[start].type !== 'deal') start -= 1;
  return visible.log.slice(Math.max(0, start)).flatMap((entry) => (entry.type === 'play' ? entry.cards : []));
}

/** Cards that are neither in this hand nor already played: split between the two other hands. */
export function unseenCards(visible: DouDizhuVisibleState): CardOrJoker[] {
  const known = new Set([...visible.myHand, ...dealPlays(visible)].map(cardKey));
  // The bottom cards are open once the landlord holds them; before that they are unseen like any other card.
  return createDdzDeck().filter((card) => !known.has(cardKey(card)));
}

export function partnerOf(visible: DouDizhuVisibleState): GameSeat | null {
  if (!visible.landlord || visible.landlord === visible.mySeat) return null;
  return visible.seats.find((seat) => seat !== visible.mySeat && seat !== visible.landlord) ?? null;
}

// ─── Auction ───

function auctionAction(visible: DouDizhuVisibleState, strong: number): BotAction | null {
  if (visible.phase !== 'calling' || visible.currentTurnSeat !== visible.mySeat) return null;
  const strength = handStrength(visible.myHand);
  const auction = ddzReplay(visible.options.variant, visible.seats, visible.log).auction;
  if (visible.options.variant === 'grab') return asAction({ type: 'claim', take: strength >= strong });
  const wanted = strength >= strong + 3 ? 3 : strength >= strong + 1.5 ? 2 : strength >= strong ? 1 : 0;
  const minimum = auction && !auction.done ? auction.minScore : 1;
  return asAction({ type: 'bid', score: wanted >= minimum ? (wanted as 1 | 2 | 3) : 0 });
}

// ─── Play ───

export interface Situation {
  readonly hand: readonly CardOrJoker[];
  readonly previous: DdzCombo | null;
  readonly lastSeat: GameSeat | null;
  readonly partner: GameSeat | null;
  readonly counts: Readonly<Record<GameSeat, number>>;
  readonly me: GameSeat;
  readonly seats: readonly GameSeat[];
  readonly landlord: GameSeat;
}

function situation(visible: DouDizhuVisibleState): Situation | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat || !visible.landlord) return null;
  return {
    hand: visible.myHand, previous: visible.lastPlay?.combo ?? null, lastSeat: visible.lastPlay?.seat ?? null,
    partner: partnerOf(visible), counts: visible.handCounts, me: visible.mySeat, seats: visible.seats,
    landlord: visible.landlord,
  };
}

/** Cards that win rounds later, so spending them early costs tempo. */
function controlCost(move: DdzMove): number {
  let cost = 0;
  for (const card of move.cards) {
    const power = ddzPower(card);
    cost += power >= 16 ? 5 : power === 15 ? 4 : power === 14 ? 1.5 : 0;
  }
  return cost;
}

function opponents(state: Situation): GameSeat[] {
  return state.seats.filter((seat) => seat !== state.me && seat !== state.partner);
}

/** Scores every legal play and the pass, higher is better. */
export function scoreOptions(state: Situation): { move: DdzMove | null; score: number }[] {
  const moves = ddzMoves(state.hand, state.previous);
  const opposing = opponents(state);
  const nearEnd = opposing.some((seat) => state.counts[seat] <= 2);
  const turnsNow = handTurns(state.hand);
  const options: { move: DdzMove | null; score: number }[] = [];
  for (const move of moves) {
    const rest = state.hand.filter((card) => !move.cards.some((played) => cardKey(played) === cardKey(card)));
    if (rest.length === 0) return [{ move, score: 1000 }];
    let score = -12 * handTurns(rest) - 0.6 * (move.combo.power - 3);
    if (!nearEnd) score -= controlCost(move) * (state.previous ? 1.2 : 2);
    if (ddzIsBomb(move.combo) && !nearEnd) score -= 14;
    // An opponent one card from winning must not be handed an easy single or pair.
    if (!state.previous && opposing.some((seat) => state.counts[seat] === 1) && move.combo.type === 'single') {
      score += move.combo.power * 0.8 - 8;
    }
    if (!state.previous && opposing.some((seat) => state.counts[seat] === 2) && move.combo.type === 'pair') {
      score += move.combo.power * 0.5 - 4;
    }
    // Feed the partner: low singles and pairs let them go out.
    const partnerCards = state.partner ? state.counts[state.partner] : 0;
    if (!state.previous && partnerCards > 0 && partnerCards <= 2 && !nearEnd) {
      const feeds = (partnerCards === 1 && move.combo.type === 'single')
        || (partnerCards === 2 && (move.combo.type === 'pair' || move.combo.type === 'single'));
      if (feeds) score += 10 - (move.combo.power - 3) * 0.6;
    }
    options.push({ move, score });
  }
  if (state.previous) {
    const partnerLead = state.partner !== null && state.lastSeat === state.partner;
    let pass = -12 * turnsNow - 1;
    if (partnerLead) pass += 40;
    else if (nearEnd) pass -= 60;
    options.push({ move: null, score: pass });
  }
  return options;
}

function toAction(move: DdzMove | null): BotAction {
  return move ? asAction({ type: 'play', cards: move.cards }) : asAction({ type: 'pass' });
}

/** Hard decision from the heuristic alone; cheap enough to run on the event loop. */
export function getDouDizhuBotAction(visible: DouDizhuVisibleState, random: () => number): BotAction | null {
  if (visible.phase === 'calling') return auctionAction(visible, 3.5);
  const state = situation(visible);
  if (!state) return null;
  const options = scoreOptions(state);
  if (options.length === 0) return null;
  const chosen = selectNearBest(options.map((option) => ({ value: option.move, score: option.score })), random, 0.4);
  return toAction(chosen);
}

/** Easy: bid on a high-card count, then always play the smallest legal combination. */
export function easyDouDizhuAction(visible: DouDizhuVisibleState): BotAction | null {
  if (visible.phase === 'calling') return auctionAction(visible, 4);
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const move = ddzSmallestMove(visible.myHand, visible.lastPlay?.combo ?? null);
  if (move) return toAction(move);
  return visible.lastPlay ? asAction({ type: 'pass' }) : null;
}

/** Pass when allowed, otherwise the smallest legal play: the timeout action and the last-resort move. */
export function douDizhuFirstLegalAction(visible: DouDizhuVisibleState): BotAction | null {
  if (visible.currentTurnSeat !== visible.mySeat) return null;
  if (visible.phase === 'calling') {
    return asAction(visible.options.variant === 'grab' ? { type: 'claim', take: false } : { type: 'bid', score: 0 });
  }
  if (visible.phase !== 'playing') return null;
  if (visible.lastPlay) return asAction({ type: 'pass' });
  const move = ddzSmallestMove(visible.myHand, null);
  return move ? toAction(move) : null;
}
