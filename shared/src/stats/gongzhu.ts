import type { GameSeat } from '../types';
import type { GongZhuMatchResult } from '../games/gongzhu/types';
import { factsBuilder } from './facts';
import type { SeatFacts } from './facts';
import { isCompassSeat } from '../rules/seats';

export function gongZhuFacts(result: GongZhuMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  if (!isCompassSeat(seat)) return facts;
  facts.value('topScore', result.scores[seat]);
  facts.value('bestHand', Math.max(...result.handResults.map((hand) => hand.scores[seat])));
  for (const hand of result.handResults) {
    if (hand.captures[seat].filter((card) => card.suit === 'hearts').length === 13) facts.count('allHearts');
    if (hand.scores[seat] === 1000) facts.count('grandSlams');
  }
  return facts;
}
