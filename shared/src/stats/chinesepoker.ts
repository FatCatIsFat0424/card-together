import type { ChinesePokerMatchResult, GameSeat, Seat } from '../types';
import { cpEvaluate } from '../rules/chinesepoker';
import type { SeatFacts } from './facts';
import { factsBuilder } from './facts';

/** Fouls, shoots and home runs, straight flushes and fours set in the middle or back, and the best score. */
export function chinesePokerFacts(result: ChinesePokerMatchResult, seat: GameSeat): SeatFacts {
  const facts = factsBuilder();
  const own = seat as Seat;
  if (result.fouls.includes(own)) facts.count('fouls');
  facts.count('shoots', result.matchups.filter((matchup) => matchup.shooter === own).length);
  if (result.homeRun === own) facts.count('homeRuns');
  const arrangement = result.arrangements[own];
  for (const row of [arrangement.middle, arrangement.back]) {
    const { category } = cpEvaluate(row);
    if (category === 'straightFlush') facts.count('straightFlushRows');
    if (category === 'fourOfAKind') facts.count('fourOfAKindRows');
  }
  facts.value('topScore', result.scores[own]);
  return facts;
}
