import type { GameSeat, LiarsDiceMatchResult, ReplaySnapshot } from '../types';
import { LDI_DICE_PER_PLAYER } from '../rules/liarsdice';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/** Dice lost, the most dice kept in a win, challenges won, bids that held when called, and bids called exactly. */
export function liarsDiceFacts(result: LiarsDiceMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const left = result.dice[seat];
  facts.sum('diceLost', LDI_DICE_PER_PLAYER - left);
  if (result.winnerSeat === seat) facts.value('diceInWin', left);
  for (const entry of frameOf(frame, 'liarsdice')?.log ?? []) {
    if (entry.type !== 'challenge') continue;
    if (entry.seat === seat && !entry.bidTrue) facts.count('callsWon');
    if (entry.target === seat && entry.bidTrue) facts.count('bidsHeld');
    if (entry.target === seat && entry.count === entry.quantity) facts.count('exactBids');
  }
  return facts;
}
