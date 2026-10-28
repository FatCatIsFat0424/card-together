import type { BigTwoMatchResult, GameSeat, ReplaySnapshot, Seat } from '../types';
import type { BigTwoComboType } from '../rules/bigtwo';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

const COMBO_RECORDS: Readonly<Partial<Record<BigTwoComboType, string>>> = {
  straightFlush: 'straightFlushes', fourOfAKind: 'fourOfAKinds', fullHouse: 'fullHouses',
};

/** A dragon, the penalties collected as the winner, being caught holding twos, and the five-card combinations played. */
export function bigTwoFacts(result: BigTwoMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const own = seat as Seat;
  if (own === result.winnerSeat) {
    if (result.dragon) facts.count('dragons');
    facts.value('topCollect', Object.values(result.scores).reduce((sum, score) => sum + score, 0));
  } else if (result.twosLeft[own] > 0) facts.count('caughtTwos');
  for (const entry of frameOf(frame, 'bigtwo')?.log ?? []) {
    if (entry.type !== 'play' || entry.seat !== own) continue;
    const id = COMBO_RECORDS[entry.comboType];
    if (id) facts.count(id);
  }
  return facts;
}
