import type { GameDefinition } from '../game-definition';
import { soleWinner } from '../game-definition';
import { rankedStanding, rankAfterWinners } from '../result-standing';
import { compassScore } from '../result-standing';

export const HEARTS_DEAL_MS = 1500;

export const heartsDefinition: GameDefinition<'hearts'> = {
  gameType: 'hearts', category: 'cards', equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  result: {
    kind: 'ranking', scoreKind: 'penalty',
    standing: (result, seat, seats) => rankedStanding(seats, seat, (other) => ({
      rank: rankAfterWinners(seats, result.winners, other, (member) => compassScore(result.scores, member), true),
      score: compassScore(result.scores, other),
    })),
  },
  presentation: {
    logFrames: (game, index, key, timing) => {
      const entry = game.log[index];
      if (entry.type === 'deal') return [{ key, kind: 'deal', durationMs: HEARTS_DEAL_MS, cards: [] }];
      if (entry.type === 'play') return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [entry.card] }];
      if (entry.type === 'trick_end') return [{ key, kind: 'trick', durationMs: 2000, seat: entry.trick.winner,
        cards: entry.trick.plays.map((play) => play.card), cardSeats: entry.trick.plays.map((play) => play.seat) }];
      if (entry.type === 'hand_end') return [{ key, kind: 'settle', durationMs: 3200, seat: entry.score.moon ?? undefined,
        cards: [] }];
      return [];
    },
    finishSeat: (game) => soleWinner(game.result?.winners),
  },
};
