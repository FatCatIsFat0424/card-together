import { applyReplayPatch } from '../replay-patch';
import type { GameSeat, MatchReplay, MatchResult, ReplaySnapshot } from '../types';
import { bigTwoFacts } from './bigtwo';
import { blackjackFacts } from './blackjack';
import { bridgeFacts } from './bridge';
import { chinesePokerFacts } from './chinesepoker';
import type { SeatFacts } from './facts';
import { holdemFacts } from './holdem';
import { liarsDeckFacts } from './liarsdeck';
import { napoleonFacts } from './napoleon';
import { ninetyNineFacts } from './ninetynine';
import { redPointsFacts } from './redpoints';
import { sevensFacts } from './sevens';

export type { SeatFacts } from './facts';

/**
 * The game's facts for one seat from its result and, when the match was recorded, the final
 * spectator frame of its replay. Live updates and the backfill both come through here, so stored
 * and recounted counters agree. Log facts are added only when `frame` is given.
 */
export function matchFacts(result: MatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  // Only the data: extractors return their builders.
  const { counts, sums, values } = gameFacts(result, seat, frame);
  return { counts, sums, values };
}

function gameFacts(result: MatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  switch (result.gameType) {
    case 'bridge': return bridgeFacts(result, seat);
    case 'bigtwo': return bigTwoFacts(result, seat, frame);
    case 'redpoints': return redPointsFacts(result, seat, frame);
    case 'ninetynine': return ninetyNineFacts(result, seat, frame);
    case 'sevens': return sevensFacts(result, seat, frame);
    case 'chinesepoker': return chinesePokerFacts(result, seat);
    case 'liarsdeck': return liarsDeckFacts(result, seat, frame);
    case 'blackjack': return blackjackFacts(result, seat, frame);
    case 'holdem': return holdemFacts(seat, frame);
    case 'napoleon': return napoleonFacts(result, seat);
  }
}

/** The last recorded spectator frame: every step applied to the initial snapshot. Throws on an invalid patch. */
export function finalReplayFrame(replay: Pick<MatchReplay, 'initial' | 'steps'>): ReplaySnapshot {
  let frame = replay.initial;
  for (const step of replay.steps) frame = applyReplayPatch(frame, step);
  return frame;
}
