import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { DEFAULT_YACHT_OPTIONS, isYachtOptions } from '../../rules/yacht';
import { rankAfterWinners, rankedStanding } from '../result-standing';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { TimeControl } from '../../types/room';

/** A turn holds up to three rolls: 60 seconds each turn and a reserve for slow ones. */
export const YACHT_TIME_CONTROL: TimeControl = { baseSeconds: 60, bankSeconds: 120 };

export const yachtDefinition: GameDefinition<'yacht'> = {
  gameType: 'yacht',
  category: 'dice',
  equipment: [],
  options: {
    defaults: DEFAULT_YACHT_OPTIONS,
    legacyDefaults: DEFAULT_YACHT_OPTIONS,
    isValid: isYachtOptions,
  },
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  timeControl: YACHT_TIME_CONTROL,
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (member) => result.totals[member] ?? 0, false),
      score: result.totals[other] ?? 0,
    })),
  },
  // Rolls and scores show on the table itself, so the match never starts a presentation.
  presentation: {
    logFrames: () => [],
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
