import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { rankedStanding } from '../result-standing';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const liarsDiceDefinition: GameDefinition<'liarsdice'> = {
  gameType: 'liarsdice',
  category: 'dice',
  equipment: [],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: null,
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: other === result.winnerSeat ? 1 : seats.length - result.eliminationOrder.indexOf(other),
      score: null,
    })),
  },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'round') return [{ key, kind: 'deal', durationMs: 2000, seat: entry.starter, cards: [] }];
      if (entry.type === 'bid') {
        return [{ key, kind: 'bid', durationMs: timing.playMs, seat: entry.seat, cards: [],
          liarsDice: { quantity: entry.quantity, face: entry.face } }];
      }
      // The call frame carries no outcome so the table cannot reveal the cups early.
      return [
        { key, kind: 'challenge', durationMs: 2000, seat: entry.seat, target: entry.target, cards: [],
          liarsDice: { quantity: entry.quantity, face: entry.face } },
        { key: `${key}:reveal`, kind: 'diceReveal', durationMs: 4000, seat: entry.seat, target: entry.target, cards: [],
          liarsDice: { quantity: entry.quantity, face: entry.face, wild: entry.wild, dice: entry.dice,
            count: entry.count, bidTrue: entry.bidTrue, loser: entry.loser, eliminated: entry.eliminated } },
      ];
    },
    finishSeat: (game) => game.result?.winnerSeat,
  },
};
