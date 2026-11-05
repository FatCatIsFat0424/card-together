import type { GameDefinition } from '../game-definition';
import { soleWinner } from '../game-definition';
import { compassScore, rankAfterWinners, rankedStanding } from '../result-standing';
import { GONGZHU_HANDS } from '../../rules/gongzhu';

export const gongZhuDefinition: GameDefinition<'gongzhu'> = {
  gameType: 'gongzhu', category: 'cards', equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  matchHands: GONGZHU_HANDS,
  result: {
    kind: 'ranking', scoreKind: 'points',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (value) => compassScore(result.scores, value), false),
      score: compassScore(result.scores, other),
    })),
  },
  presentation: {
    logFrames: (game, index, key, timing) => {
      const entry = game.log[index];
      switch (entry.type) {
        case 'deal': return [{ key, kind: 'deal', durationMs: 1500, seat: entry.first, cards: [] }];
        case 'play': return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [entry.card] }];
        case 'trick': return [{ key, kind: 'trick', durationMs: 1800, seat: entry.winner,
          cards: entry.plays.map((play) => play.card), cardSeats: entry.plays.map((play) => play.seat) }];
        case 'settle': return [{ key, kind: 'settle', durationMs: 2500, cards: [] }];
      }
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
