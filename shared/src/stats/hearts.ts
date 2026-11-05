import type { GameSeat } from '../types';
import type { HeartsMatchResult } from '../games/hearts/types';
import { factsBuilder } from './facts';
import type { SeatFacts } from './facts';
import { seatValue } from './facts';
export function heartsFacts(result: HeartsMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  facts.count('moons', result.hands.filter((hand) => hand.moon === seat).length);
  facts.count('cleanHands', result.hands.filter((hand) => seatValue(hand.penalties, seat) === 0).length);
  facts.value('lowPenalty', seatValue(result.scores, seat));
  return facts;
}
