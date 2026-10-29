import { rankAfterWinners, rankedStanding } from '../result-standing';
import { GAME_SEAT_ORDER } from '../../constants';
import { MIN_FLEXIBLE_PLAYERS } from '../../constants/game-rules';
import type { GameSeat } from '../../types/player';
import { GF_HANDS } from '../../rules/gofish';
import { soleWinner } from '../game-definition';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

/** Go Fish seats two to six players. */
export const GOFISH_MAX_PLAYERS = 6;

/** The one seat with the most books in a finished hand, or none when seats share the lead. */
function handLeader(books: Readonly<Record<GameSeat, number>>): GameSeat | undefined {
  const best = Math.max(...GAME_SEAT_ORDER.map((seat) => books[seat]));
  return soleWinner(GAME_SEAT_ORDER.filter((seat) => books[seat] === best));
}

export const goFishDefinition: GameDefinition<'gofish'> = {
  gameType: 'gofish',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: MIN_FLEXIBLE_PLAYERS, maxPlayers: GOFISH_MAX_PLAYERS, flexible: true, expandable: true, numbered: false },
  matchHands: GF_HANDS,
  result: {
    kind: 'ranking',
    scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => result.scores[value], false),
      score: result.scores[other],
    })),
  },
  presentation: {
    logFrames: (game, index, key): PresentationFrame[] => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'hand':
          return [{ key, kind: 'deal', durationMs: 1500, seat: entry.first, cards: [] }];
        case 'ask':
          return [{ key, kind: 'play', durationMs: 2000, seat: entry.seat, target: entry.target, cards: [],
            goFish: { rank: entry.rank, given: entry.given, fished: entry.fished } }];
        case 'book':
          return [{ key, kind: 'award', durationMs: 1500, seat: entry.seat, cards: [], goFish: { rank: entry.rank } }];
        // A refill reuses the shared draw frame.
        case 'refill':
          return [{ key, kind: 'hit', durationMs: 900, seat: entry.seat, cards: [], count: 1 }];
        case 'handEnd':
          return [{ key, kind: 'settle', durationMs: 2500, seat: handLeader(entry.books), cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
