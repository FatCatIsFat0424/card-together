import { afterEach, describe, expect, it } from 'vitest';
import type { BattleshipShot, BattleshipVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import {
  BS_SHIPS, DEFAULT_BATTLESHIP_OPTIONS, bsCell, bsContacts, bsIndex, bsNode, bsOrthogonal, bsRandomFleet,
} from '@shared/rules/battleship';
import type { BattleshipOptions } from '@shared/rules/battleship';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import * as battleship from '../../src/managers/games/battleship-game';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { spreadFleet, getBattleshipBotAction, hardShot, shotDensity, targetKnowledge } from '../../src/bots/battleship-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';

const CODE = 'BSBOT1';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true };
}

/** A seated view with the given own shots at the opponent. */
function viewWith(log: readonly BattleshipShot[], options: BattleshipOptions = DEFAULT_BATTLESHIP_OPTIONS): BattleshipVisibleState {
  return {
    gameType: 'battleship', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options, placeDeadline: 0,
    placed: ['N', 'S'], autoPlaced: [], fleets: {}, currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, log, result: null,
  };
}

const shot = (col: number, row: number, result: BattleshipShot['result'], extra: Partial<BattleshipShot> = {}): BattleshipShot =>
  ({ seat: 'N', to: bsNode(bsIndex(col, row)), result, timestamp: 1, ...extra });

function target(action: BotAction | null): number {
  if (action?.type !== 'game-action' || action.request.gameType !== 'battleship' || action.request.action.type !== 'fire') {
    throw new Error('Expected a shot');
  }
  return bsCell(action.request.action.to)!;
}

afterEach(() => battleship.abortGame(CODE));

describe('Battleship hard bot', () => {
  it('hunts on a checkerboard and finishes a ship next to an open hit', () => {
    const empty = targetKnowledge(viewWith([]));
    const density = shotDensity(empty);
    // The centre is likelier than a corner, and off-parity cells are discounted.
    expect(density[bsIndex(4, 4)]).toBeGreaterThan(density[0]);
    expect(density[bsIndex(4, 5)]).toBeLessThan(density[bsIndex(4, 4)]);
    const afterHit = targetKnowledge(viewWith([shot(5, 5, 'hit')]));
    for (let seed = 1; seed <= 10; seed++) {
      expect(bsOrthogonal(bsIndex(5, 5))).toContain(hardShot(afterHit, seededRandom(seed)));
    }
    // Two hits in a row point along the line.
    const line = targetKnowledge(viewWith([shot(5, 5, 'hit'), shot(6, 5, 'hit')]));
    expect([bsIndex(4, 5), bsIndex(7, 5)]).toContain(hardShot(line, seededRandom(3)));
  });

  it('treats sunk ships as resolved and, without touching, rules out the water around them', () => {
    const log = [shot(0, 0, 'hit'), shot(1, 0, 'sunk', { ship: 'destroyer', sunkCells: [bsNode(0), bsNode(1)] })];
    const knowledge = targetKnowledge(viewWith(log, { noTouching: true, hitAgain: false }));
    expect(knowledge.openHits).toEqual([]);
    expect(knowledge.afloat).toEqual(BS_SHIPS.filter((ship) => ship !== 'destroyer'));
    expect([2, 10, 11, 12].every((cell) => knowledge.blocked.has(cell))).toBe(true);
    expect(shotDensity(knowledge)[2]).toBe(0);
  });

  it('places spread-out fleets', () => {
    const contacts = (pick: (seed: number) => number): number => Array.from({ length: 20 }, (_, seed) => pick(seed + 1))
      .reduce((sum, value) => sum + value, 0);
    const spread = contacts((seed) => bsContacts(spreadFleet({ options: DEFAULT_BATTLESHIP_OPTIONS }, seededRandom(seed))));
    const random = contacts((seed) => bsContacts(bsRandomFleet(seededRandom(seed), DEFAULT_BATTLESHIP_OPTIONS)));
    expect(spread * 3).toBeLessThan(random);
  });

  it('decides each shot within a few milliseconds', () => {
    const view = viewWith([shot(5, 5, 'hit'), shot(2, 2, 'miss')]);
    const started = performance.now();
    for (let repeat = 0; repeat < 50; repeat++) target(getBattleshipBotAction(view, seededRandom(repeat)));
    expect((performance.now() - started) / 50).toBeLessThan(20);
  });

  it('beats the easy bot over seeded matches', () => {
    let hardWins = 0;
    const games = 30;
    for (let match = 0; match < games; match++) {
      // Alternate who shoots first so the first-shot edge cancels out.
      const hardSeat: GameSeat = match % 2 === 0 ? 'N' : 'S';
      battleship.startGame(CODE, { N: player('N'), S: player('S') }, DEFAULT_BATTLESHIP_OPTIONS, 60_000, 0);
      const random = seededRandom(1_000 + match);
      const act = (seat: GameSeat): void => {
        const visible = battleship.getPlayerVisibleState(CODE, seat)!;
        const action = getBotAction(visible, random, seat === hardSeat ? 'hard' : 'easy');
        if (action?.type !== 'game-action' || action.request.gameType !== 'battleship') throw new Error('Expected an action');
        const request = action.request.action;
        const result = request.type === 'place-fleet' ? battleship.placeFleet(CODE, seat, request.fleet, true, 1)
          : request.type === 'fire' ? battleship.fire(CODE, seat, request.to, 1) : { success: false };
        expect(result.success).toBe(true);
      };
      act('N');
      act('S');
      for (let step = 0; step < 300 && battleship.getGameState(CODE)?.phase === 'playing'; step++) {
        act(battleship.getGameState(CODE)!.currentTurnSeat);
      }
      if (battleship.getGameState(CODE)?.result?.winners[0] === hardSeat) hardWins++;
      battleship.abortGame(CODE);
    }
    // Measured 30 of 30; the hard bot sinks a fleet in about 45 shots.
    expect(hardWins).toBeGreaterThanOrEqual(24);
  });
});
