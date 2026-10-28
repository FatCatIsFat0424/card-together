import { rankedStanding, rankAfterWinners, compassScore } from '../result-standing';
import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const bigTwoDefinition: GameDefinition<'bigtwo'> = {
  gameType: 'bigtwo',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  result: {
    kind: 'ranking',
    scoreKind: 'penalty',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, [result.winnerSeat], other, (seat) => compassScore(result.scores, seat), true),
      score: compassScore(result.scores, other),
    })),
  },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'play') {
        return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: entry.cards }];
      }
      if (entry.type === 'pass') {
        return [{ key, kind: 'pass', durationMs: timing.passMs, seat: entry.seat, cards: [] }];
      }
      if (entry.type !== 'round_end') return [];
      const preceding = game.log.slice(0, index);
      const lastPlay = [...preceding].reverse().find((event) => event.type === 'play');
      let previousRound = preceding.length - 1;
      while (previousRound >= 0 && preceding[previousRound].type !== 'round_end') previousRound--;
      const passedSeats = preceding.slice(previousRound + 1)
        .filter((event) => event.type === 'pass').map((event) => event.seat);
      return [{ key, kind: 'round', durationMs: 2000, seat: entry.leaderSeat,
        cards: lastPlay?.type === 'play' ? lastPlay.cards : [], passedSeats }];
    },
    finishSeat: (game) => game.result?.winnerSeat,
  },
};
