import { MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import { OM_DEALS } from '../../rules/oldmaid';
import { rankedStanding, rankAfterWinners } from '../result-standing';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const oldMaidDefinition: GameDefinition<'oldmaid'> = {
  gameType: 'oldmaid',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: MAX_ROOM_SEATS, flexible: true, expandable: true, numbered: false },
  matchHands: OM_DEALS,
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => result.totals[value], false),
      score: result.totals[other],
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'deal': return [{ key, kind: 'deal', durationMs: 2600, seat: entry.starter, cards: [],
          oldMaid: { discards: entry.discards, finished: entry.finished } }];
        case 'draw': return [{ key, kind: 'draw', durationMs: 1600, seat: entry.seat, target: entry.from,
          cards: entry.discarded, handIndex: entry.index, oldMaid: { finished: entry.finished } }];
        case 'settle': return [{ key, kind: 'settle', durationMs: 2800, seat: entry.loser, cards: [],
          oldMaid: { order: entry.order, points: entry.points, totals: entry.totals } }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
