import type { SpadesMatchResult } from '../games/spades/types';
import type { GameSeat, Seat } from '../types/player';
import { spadesTeam } from '../rules/spades';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

export function spadesFacts(result: SpadesMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  const compass = seat as Seat;
  facts.count('nilsMade', result.hands.filter((hand) => hand.bids[compass] === 0 && hand.taken[compass] === 0).length);
  facts.value('topScore', result.scores[spadesTeam(compass)]);
  return facts;
}
