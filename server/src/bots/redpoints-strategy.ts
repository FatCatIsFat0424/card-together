import type { Card, RedPointsVisibleState } from '@shared/types';
import { rpCanPair, rpCardPoints, rpPairOptions } from '@shared/rules/redpoints';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

const SUITS: readonly Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: readonly Card['rank'][] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function unseenCards(visible: RedPointsVisibleState): Card[] {
  const known = [...visible.myHand, ...visible.table, ...Object.values(visible.captured).flat()];
  if (visible.pendingFlip) known.push(visible.pendingFlip);
  const keys = new Set(known.map((card) => `${card.suit}:${card.rank}`));
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })))
    .filter((card) => !keys.has(`${card.suit}:${card.rank}`));
}

function remainingOpportunity(hand: readonly Card[], table: readonly Card[]): number {
  const options = hand.flatMap((card) => rpPairOptions(card, table).map((capture) => ({
    card, capture, points: rpCardPoints(card) + rpCardPoints(capture),
  }))).sort((a, b) => b.points - a.points);
  const usedHand = new Set<Card>();
  const usedTable = new Set<Card>();
  let points = 0;
  for (const option of options) {
    if (usedHand.has(option.card) || usedTable.has(option.capture)) continue;
    usedHand.add(option.card);
    usedTable.add(option.capture);
    points += option.points;
  }
  return points;
}

function tableExposure(table: readonly Card[], unknown: readonly Card[], opponentCards: number): number {
  if (unknown.length === 0 || opponentCards === 0) return 0;
  return table.reduce((sum, target) => {
    const matches = unknown.filter((card) => rpCanPair(card, target));
    const chance = 1 - Math.pow(1 - matches.length / unknown.length, opponentCards);
    const averagePoints = matches.length === 0 ? 0
      : matches.reduce((points, card) => points + rpCardPoints(card), 0) / matches.length;
    return sum + chance * (rpCardPoints(target) + averagePoints);
  }, 0);
}

/** Scores public capture opportunities without assuming the location of any unseen card. */
export function getRedPointsBotAction(visible: RedPointsVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const unknown = unseenCards(visible);
  const opponentCards = Object.entries(visible.handCounts)
    .filter(([seat]) => seat !== visible.mySeat)
    .reduce((sum, [, count]) => sum + count, 0);
  const options: { value: BotAction; score: number }[] = [];

  const addOption = (card: Card, capture: Card | undefined, flipping: boolean): void => {
    const table = capture ? visible.table.filter((entry) => !sameCard(entry, capture)) : [...visible.table, card];
    const hand = flipping ? visible.myHand : visible.myHand.filter((entry) => !sameCard(entry, card));
    const immediate = capture ? rpCardPoints(card) + rpCardPoints(capture) : 0;
    // Future captures are discounted because other players act before our next hand play.
    const score = immediate * 4 + remainingOpportunity(hand, table) * 0.6
      - tableExposure(table, unknown, opponentCards) * 1.2;
    const value: BotAction = flipping && capture
      ? { type: 'redpoints-flip', capture }
      : { type: 'redpoints-play', card, ...(capture ? { capture } : {}) };
    options.push({ value, score });
  };

  if (visible.step === 'flip-choose') {
    if (!visible.pendingFlip) return null;
    for (const capture of rpPairOptions(visible.pendingFlip, visible.table)) {
      addOption(visible.pendingFlip, capture, true);
    }
  } else {
    for (const card of visible.myHand) {
      const captures = rpPairOptions(card, visible.table);
      if (captures.length === 0) addOption(card, undefined, false);
      else for (const capture of captures) addOption(card, capture, false);
    }
  }
  return selectNearBest(options, random, 3);
}
