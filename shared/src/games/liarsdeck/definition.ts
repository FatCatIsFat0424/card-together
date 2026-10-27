import type { GameDefinition } from '../game-definition';
import type { PresentationFrame } from '../presentation';

export const liarsDeckDefinition: GameDefinition<'liarsdeck'> = {
  gameType: 'liarsdeck',
  category: 'cards',
  equipment: ['cards'],
  seats: { minPlayers: 4, maxPlayers: 4, flexible: false, expandable: false, numbered: false },
  presentation: {
    logFrames: (game, index, key, timing): PresentationFrame[] => {
      const entry = game.log[index];
      if (entry.type === 'round') {
        return [{ key, kind: 'deal', durationMs: 2000, seat: entry.starter, cards: [], tableFace: entry.tableFace }];
      }
      if (entry.type === 'play') {
        return [{ key, kind: 'play', durationMs: timing.playMs, seat: entry.seat, cards: [], count: entry.count }];
      }
      if (entry.type === 'challenge') {
        return [{ key, kind: 'challenge', durationMs: 2500, seat: entry.seat, target: entry.target, cards: [],
          liarFaces: entry.revealed, lied: entry.lied }];
      }
      // The suspense frame carries no outcome so the table cannot reveal it early.
      return [
        { key, kind: 'roulette', durationMs: 2500, seat: entry.seat, cards: [], shot: entry.shot },
        { key: `${key}:result`, kind: 'shot', durationMs: 1500, seat: entry.seat, cards: [],
          shot: entry.shot, survived: entry.survived },
      ];
    },
    finishSeat: (game) => game.result?.winnerSeat,
  },
};
