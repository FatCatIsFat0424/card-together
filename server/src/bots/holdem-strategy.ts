import type { Card, HoldemAction, HoldemVisibleState, Seat } from '@shared/types';
import { cpCompare } from '@shared/rules/chinesepoker';
import { heBestHand, heInHand, heLegalActions } from '@shared/rules/holdem';
import type { HeLegalActions } from '@shared/rules/holdem';
import { createDeck } from '../engine/deck';
import type { BotAction } from './bot-decisions';

// Heuristic summary: preflop hands are scored with the Chen formula; after the flop the bot estimates its equity by
// dealing random hole cards to each unfolded opponent and completing the board. Equity times the number of players in
// the hand measures strength against a fair share. Strong hands bet or raise about 60% of the pot (3 big blinds
// preflop), playable hands call when the price is below their equity, and the rest check or fold. Occasional small
// bluffs keep the bot from being fully predictable. Short stacks shove strong preflop hands. Opponents are not modeled.

const SIMULATIONS = 150;
const RAISE_STRENGTH = 1.6;
const VALUE_BET_STRENGTH = 1.25;
const CALL_MARGIN = 1.1;
const COMMIT_SHARE = 0.5;
const COMMIT_STRENGTH = 1.2;
const BLUFF_CHANCE = 0.08;
const RAISE_CHANCE = 0.85;
const POT_SHARE = 0.6;
const OPEN_BIG_BLINDS = 3;
const SHORT_STACK_BIG_BLINDS = 10;

const RANK_POINTS: Record<number, number> = { 14: 10, 13: 8, 12: 7, 11: 6 };

/** Chen formula preflop score, from −1 (72 offsuit) to 20 (pocket aces). */
export function chenScore(hole: readonly Card[]): number {
  const [high, low] = [...hole].sort((a, b) => b.rank - a.rank);
  const points = (rank: number): number => RANK_POINTS[rank] ?? rank / 2;
  if (high.rank === low.rank) return Math.max(5, points(high.rank) * 2);
  let score = points(high.rank);
  if (high.suit === low.suit) score += 2;
  const gap = high.rank - low.rank - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && high.rank < 12) score += 1;
  return Math.ceil(score);
}

/** Share of simulated showdowns won against `opponents` random hands, ties split. */
export function holdemEquity(
  hole: readonly Card[], board: readonly Card[], opponents: number, random: () => number, simulations = SIMULATIONS,
): number {
  const known = new Set([...hole, ...board].map((card) => `${card.suit}${card.rank}`));
  const unseen = createDeck().filter((card) => !known.has(`${card.suit}${card.rank}`));
  const needed = opponents * 2 + 5 - board.length;
  let won = 0;
  for (let run = 0; run < simulations; run++) {
    // Partial Fisher-Yates: the first `needed` cards become a uniform random sample.
    for (let i = 0; i < needed; i++) {
      const j = i + Math.floor(random() * (unseen.length - i));
      [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
    }
    const fullBoard = [...board, ...unseen.slice(opponents * 2, needed)];
    const mine = heBestHand([...hole, ...fullBoard]);
    let ties = 0;
    let lost = false;
    for (let opponent = 0; opponent < opponents && !lost; opponent++) {
      const compared = cpCompare(heBestHand([unseen[opponent * 2], unseen[opponent * 2 + 1], ...fullBoard]), mine);
      if (compared > 0) lost = true;
      else if (compared === 0) ties += 1;
    }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / simulations;
}

function raiseTo(legal: HeLegalActions, target: number): HoldemAction | null {
  if (!legal.raise) return null;
  return { type: 'raise', to: Math.max(legal.raise.min, Math.min(legal.raise.max, Math.round(target))) };
}

function passive(legal: HeLegalActions): HoldemAction {
  return legal.check ? { type: 'check' } : { type: 'fold' };
}

function preflop(visible: HoldemVisibleState, legal: HeLegalActions, random: () => number): HoldemAction {
  const seat = visible.mySeat;
  const score = chenScore(visible.myHand);
  const { bigBlind, currentBet } = visible;
  const stack = visible.chips[seat] + visible.streetBets[seat];
  if (stack <= bigBlind * SHORT_STACK_BIG_BLINDS && score >= 8) {
    return raiseTo(legal, Number.POSITIVE_INFINITY) ?? (legal.call > 0 ? { type: 'call' } : passive(legal));
  }
  const open = raiseTo(legal, currentBet + Math.max(visible.minRaise, bigBlind * (OPEN_BIG_BLINDS - 1)));
  if (score >= 10) return open ?? (legal.call > 0 ? { type: 'call' } : passive(legal));
  if (score >= 7) {
    if (currentBet === bigBlind && open && random() < 0.25) return open;
    if (legal.call === 0) return passive(legal);
    return legal.call <= Math.max(bigBlind * 4, visible.chips[seat] * 0.15) ? { type: 'call' } : { type: 'fold' };
  }
  if (score >= 5 && legal.call > 0 && legal.call <= bigBlind) return { type: 'call' };
  return passive(legal);
}

function postflop(visible: HoldemVisibleState, legal: HeLegalActions, random: () => number): HoldemAction {
  const seat = visible.mySeat;
  const opponents = heInHand(visible).filter((other: Seat) => other !== seat).length;
  const equity = holdemEquity(visible.myHand, visible.board, opponents, random);
  const strength = equity * (opponents + 1);
  const pot = Object.values(visible.totalBets).reduce((sum, value) => sum + value, 0);
  const bet = raiseTo(legal, visible.currentBet + Math.max(visible.minRaise, pot * POT_SHARE));
  if (strength >= RAISE_STRENGTH && bet && random() < RAISE_CHANCE) return bet;
  if (legal.call === 0) {
    if (bet && (strength >= VALUE_BET_STRENGTH || (opponents <= 2 && random() < BLUFF_CHANCE))) return bet;
    return passive(legal);
  }
  const price = legal.call / (pot + legal.call);
  const committing = legal.call >= visible.chips[seat] * COMMIT_SHARE;
  if (equity >= price * CALL_MARGIN && (!committing || strength >= COMMIT_STRENGTH)) return { type: 'call' };
  return { type: 'fold' };
}

export function getHoldemBotAction(visible: HoldemVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  const action = visible.street === 'preflop' ? preflop(visible, legal, random) : postflop(visible, legal, random);
  return { type: 'holdem-action', action };
}
