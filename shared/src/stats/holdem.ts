import type { Card, ChinesePokerCategory, GameSeat, ReplaySnapshot } from '../types';
import { CP_CATEGORY_ORDER } from '../rules/chinesepoker';
import type { CpEvaluation } from '../rules/chinesepoker';
import { heBestHand } from '../rules/holdem';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

const RANK_BASE = 15;
const RANK_SLOTS = 5;

/** A poker hand as a number that orders like the hands do. */
export function encodePokerHand(hand: CpEvaluation): number {
  let value = CP_CATEGORY_ORDER.indexOf(hand.category);
  for (let index = 0; index < RANK_SLOTS; index++) value = value * RANK_BASE + (hand.ranks[index] ?? 0);
  return value;
}

export function decodePokerHand(value: number): CpEvaluation {
  const ranks: number[] = [];
  let rest = value;
  for (let index = 0; index < RANK_SLOTS; index++) {
    ranks.unshift(rest % RANK_BASE);
    rest = Math.floor(rest / RANK_BASE);
  }
  const category: ChinesePokerCategory = CP_CATEGORY_ORDER[rest] ?? 'highCard';
  return { category, ranks: ranks.filter((rank) => rank > 0) };
}

/**
 * Only public facts: hole cards count once a showdown reveals them. Per hand: showdowns reached and won,
 * the best revealed hand, the chips won from pots, opponents eliminated by a hand the seat won, and
 * hands won after going all in.
 */
export function holdemFacts(seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  let board: Card[] = [];
  let allIn = false;
  let showdown = false;
  let best: number | null = null;
  let biggest: number | null = null;
  for (const entry of frameOf(frame, 'holdem')?.log ?? []) {
    switch (entry.type) {
      case 'hand':
        board = [];
        allIn = false;
        showdown = false;
        break;
      case 'street':
        board = [...board, ...entry.cards];
        break;
      case 'action':
        if (entry.seat === seat && entry.allIn) allIn = true;
        break;
      case 'showdown': {
        const hole = entry.cards[seat] ?? [];
        if (hole.length === 0) break;
        showdown = true;
        facts.count('showdowns');
        const value = encodePokerHand(heBestHand([...hole, ...board]));
        best = Math.max(best ?? value, value);
        break;
      }
      case 'award': {
        const won = entry.pots.filter((pot) => pot.winners.includes(seat));
        if (won.length === 0) break;
        const chips = won.reduce((sum, pot) => sum + Math.floor(pot.amount / pot.winners.length), 0);
        biggest = Math.max(biggest ?? chips, chips);
        if (showdown) facts.count('showdownWins');
        if (allIn) facts.count('allInWins');
        facts.count('knockouts', entry.eliminated.filter((other) => other !== seat).length);
      }
    }
  }
  if (best !== null) facts.value('bestShowdown', best);
  if (biggest !== null) facts.value('biggestPot', biggest);
  return facts;
}
