import type { Card, GameSeat, ReplaySnapshot } from '../types';
import { studHand } from '../rules/stud';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';
import { encodePokerHand } from './holdem';

/**
 * Only public facts: the hole card counts once a showdown reveals it. Per hand: showdowns reached and won,
 * the best revealed hand, the chips won from pots, opponents eliminated by a hand the seat won, and
 * hands won after going all in.
 */
export function studFacts(seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  let up: readonly Card[] = [];
  let allIn = false;
  let showdown = false;
  let best: number | null = null;
  let biggest: number | null = null;
  for (const entry of frameOf(frame, 'stud')?.log ?? []) {
    switch (entry.type) {
      case 'hand':
        up = [];
        allIn = false;
        showdown = false;
        break;
      case 'street':
        up = [...up, ...entry.cards[seat] ?? []];
        break;
      case 'action':
        if (entry.seat === seat && entry.allIn) allIn = true;
        break;
      case 'showdown': {
        const hole = entry.cards[seat] ?? [];
        if (hole.length === 0) break;
        showdown = true;
        facts.count('showdowns');
        const value = encodePokerHand(studHand(hole, up));
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
