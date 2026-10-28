import type { GameSeat, ReplaySnapshot } from '../types';
import type { CrazyEightsMatchResult } from '../games/crazyeights/types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * Hands won by going out and the lowest match total; from the log, 8s played, hands finished with an 8,
 * and cards a seat's 2s made opponents draw.
 */
export function crazyEightsFacts(
  result: CrazyEightsMatchResult, seat: GameSeat, frame: ReplaySnapshot | null,
): SeatFacts {
  const facts = factsBuilder();
  facts.count('handsWon', result.handWinners.filter((winner) => winner === seat).length);
  facts.value('lowScore', result.scores[seat]);
  const log = frameOf(frame, 'crazyeights')?.log ?? [];
  log.forEach((entry, index) => {
    if (entry.type !== 'play' || entry.seat !== seat) return;
    if (entry.card.rank === 8) {
      facts.count('eights');
      const next = log[index + 1];
      if (next?.type === 'handEnd' && next.winner === seat) facts.count('wildFinishes');
    }
    if (entry.effect === 'draw') facts.count('penaltiesDealt', entry.drawn);
  });
  return facts;
}
