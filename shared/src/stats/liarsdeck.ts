import type { GameSeat, LiarsDeckMatchResult, ReplaySnapshot, Seat } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Trigger pulls taken and survived, the most pulls in a won match, lies caught, and honest plays called liar. */
export function liarsDeckFacts(result: LiarsDeckMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const shots = result.shots[seat as Seat];
  facts.sum('shots', shots);
  if (result.winnerSeat === seat) facts.value('shotsInWin', shots);
  for (const entry of frameOf(frame, 'liarsdeck')?.log ?? []) {
    if (entry.type === 'shot' && entry.seat === seat && entry.survived) facts.count('survivedShots');
    if (entry.type !== 'challenge') continue;
    if (entry.seat === seat && entry.lied) facts.count('caughtLies');
    if (entry.target === seat && !entry.lied) facts.count('honestCalled');
  }
  return facts;
}
