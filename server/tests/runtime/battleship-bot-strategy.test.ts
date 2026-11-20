import { afterEach, describe, expect, it } from 'vitest';
import type { BattleshipShot, BattleshipVisibleState, GameSeat, PlayerInfo } from '@shared/types';
import {
  BS_CELLS, BS_SHIPS, DEFAULT_BATTLESHIP_OPTIONS, bsCell, bsFleetError, bsIndex, bsNode, bsOrthogonal, bsRandomFleet,
  bsResolveShot, bsShipCells,
} from '@shared/rules/battleship';
import type { BattleshipOptions } from '@shared/rules/battleship';
import type { BattleshipGameAction } from '@shared/games/battleship/actions';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import * as battleship from '../../src/managers/games/battleship-game';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getBattleshipBotAction, hardShot, shotDensity, targetKnowledge } from '../../src/bots/battleship-strategy';
import type { BsTargetKnowledge } from '../../src/bots/battleship-strategy';
import { mixedFleet } from '../../src/bots/battleship-fleet';
import { battleshipSearch, likeliestCell, sampleFleets } from '../../src/bots/battleship-search';
import { gameBot } from '../../src/bots/bot-registry';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
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

  it('places legal fleets that lean toward the edges and vary from game to game', () => {
    const edgeness = (fleets: readonly (readonly { cell: number; vertical: boolean }[])[]): number => {
      let total = 0;
      let cells = 0;
      for (const fleet of fleets) {
        fleet.forEach((placement, index) => {
          for (const cell of bsShipCells(BS_SHIPS[index], placement)!) {
            total += Math.max(Math.abs((cell % 10) - 4.5), Math.abs(Math.floor(cell / 10) - 4.5));
            cells++;
          }
        });
      }
      return total / cells;
    };
    for (const options of [DEFAULT_BATTLESHIP_OPTIONS, { noTouching: true, hitAgain: false }]) {
      const mixed = Array.from({ length: 60 }, (_, seed) => mixedFleet(options, seededRandom(seed + 1)));
      const random = Array.from({ length: 60 }, (_, seed) => bsRandomFleet(seededRandom(seed + 1), options));
      expect(mixed.every((fleet) => bsFleetError(fleet, options) === null)).toBe(true);
      expect(edgeness(mixed)).toBeGreaterThan(edgeness(random) + 0.1);
      expect(new Set(mixed.map((fleet) => JSON.stringify(fleet))).size).toBeGreaterThan(50);
    }
  });

  it('decides each shot within a few milliseconds', () => {
    const view = viewWith([shot(5, 5, 'hit'), shot(2, 2, 'miss')]);
    const started = performance.now();
    for (let repeat = 0; repeat < 50; repeat++) target(getBattleshipBotAction(view, seededRandom(repeat)));
    expect((performance.now() - started) / 50).toBeLessThan(20);
  });

  it('beats a random shooter over seeded matches', () => {
    let botWins = 0;
    const games = 30;
    for (let match = 0; match < games; match++) {
      // Alternate who shoots first so the first-shot edge cancels out.
      const botSeat: GameSeat = match % 2 === 0 ? 'N' : 'S';
      battleship.startGame(CODE, { N: player('N'), S: player('S') }, DEFAULT_BATTLESHIP_OPTIONS, 60_000, 0);
      const random = seededRandom(1_000 + match);
      const act = (seat: GameSeat): void => {
        const visible = battleship.getPlayerVisibleState(CODE, seat)!;
        let request: BattleshipGameAction;
        if (seat === botSeat) {
          const action = getBotAction(visible, random);
          if (action?.type !== 'game-action' || action.request.gameType !== 'battleship') throw new Error('Expected an action');
          request = action.request.action;
        } else if (!visible.placed.includes(seat)) {
          request = { type: 'place-fleet', fleet: bsRandomFleet(random, DEFAULT_BATTLESHIP_OPTIONS) };
        } else {
          // The baseline shoots any cell it has not fired at yet.
          const fired = new Set(visible.log.filter((entry) => entry.seat === seat).map((entry) => entry.to));
          const open = Array.from({ length: BS_CELLS }, (_, cell) => bsNode(cell)).filter((node) => !fired.has(node));
          request = { type: 'fire', to: open[Math.floor(random() * open.length)] };
        }
        const result = request.type === 'place-fleet' ? battleship.placeFleet(CODE, seat, request.fleet, true, 1)
          : request.type === 'fire' ? battleship.fire(CODE, seat, request.to, 1) : { success: false };
        expect(result.success).toBe(true);
      };
      act('N');
      act('S');
      for (let step = 0; step < 300 && battleship.getGameState(CODE)?.phase === 'playing'; step++) {
        act(battleship.getGameState(CODE)!.currentTurnSeat);
      }
      if (battleship.getGameState(CODE)?.result?.winners[0] === botSeat) botWins++;
      battleship.abortGame(CODE);
    }
    // Measured 30 of 30; the bot sinks a fleet in about 45 shots, a random shooter needs about 95.
    expect(botWins).toBeGreaterThanOrEqual(24);
  });
});

/** What the seat would know after the given shots, built from the log of a view. */
function knowledgeOf(log: readonly BattleshipShot[], options: BattleshipOptions = DEFAULT_BATTLESHIP_OPTIONS): BsTargetKnowledge {
  return targetKnowledge(viewWith(log, options));
}

const fullSampling = { maxSamples: 3000, expired: () => false };

describe('Battleship fleet sampling', () => {
  it('spreads exactly the afloat ships over the sea', () => {
    const open = sampleFleets(knowledgeOf([]), DEFAULT_BATTLESHIP_OPTIONS, seededRandom(1), fullSampling);
    expect(open.samples).toBe(3000);
    expect(open.probability.reduce((sum, value) => sum + value, 0)).toBeCloseTo(17, 6);
    // The middle holds a ship more often than a corner.
    expect(open.probability[bsIndex(4, 4)]).toBeGreaterThan(open.probability[0] * 1.5);
    const sunk = [shot(0, 0, 'hit'), shot(1, 0, 'sunk', { ship: 'destroyer', sunkCells: [bsNode(0), bsNode(1)] })];
    const rest = sampleFleets(knowledgeOf(sunk), DEFAULT_BATTLESHIP_OPTIONS, seededRandom(1), fullSampling);
    expect(rest.probability.reduce((sum, value) => sum + value, 0)).toBeCloseTo(15, 6);
    expect(rest.probability[0]).toBe(0);
    expect(rest.probability[1]).toBe(0);
  });

  it('honors misses, open hits, and the touching rule', () => {
    const log = [shot(5, 5, 'hit'), shot(4, 5, 'miss'), shot(5, 4, 'miss')];
    const sampling = sampleFleets(knowledgeOf(log), DEFAULT_BATTLESHIP_OPTIONS, seededRandom(2), fullSampling);
    expect(sampling.probability[bsIndex(5, 5)]).toBeCloseTo(1, 9);
    expect(sampling.probability[bsIndex(4, 5)]).toBe(0);
    expect(sampling.probability[bsIndex(5, 4)]).toBe(0);
    // A ship must continue from the hit to the right or downward, and those cells are the likeliest unshot ones.
    const cell = likeliestCell(sampling.probability, knowledgeOf(log).shot, seededRandom(2));
    expect([bsIndex(6, 5), bsIndex(5, 6)]).toContain(cell);

    const sunkNoTouch = [shot(0, 0, 'hit'), shot(1, 0, 'sunk', { ship: 'destroyer', sunkCells: [bsNode(0), bsNode(1)] })];
    const options = { noTouching: true, hitAgain: false };
    const near = sampleFleets(knowledgeOf(sunkNoTouch, options), options, seededRandom(3), fullSampling);
    expect([2, 10, 11, 12].every((cell) => near.probability[cell] === 0)).toBe(true);
    expect(near.probability.reduce((sum, value) => sum + value, 0)).toBeCloseTo(15, 6);
  });

  it('puts the last ship exactly where it must be', () => {
    const afloat = ['destroyer'] as const;
    const open = new Set([bsIndex(3, 3), bsIndex(4, 3)]);
    const shotCells = new Set(Array.from({ length: BS_CELLS }, (_, cell) => cell).filter((cell) => !open.has(cell)));
    const knowledge: BsTargetKnowledge = { shot: shotCells, blocked: shotCells, openHits: [], afloat };
    const sampling = sampleFleets(knowledge, DEFAULT_BATTLESHIP_OPTIONS, seededRandom(4), fullSampling);
    expect(sampling.probability[bsIndex(3, 3)]).toBeCloseTo(1, 9);
    expect(sampling.probability[bsIndex(4, 3)]).toBeCloseTo(1, 9);
    expect(sampling.probability.reduce((sum, value) => sum + value, 0)).toBeCloseTo(2, 9);
  });

  it('reports no fleet when the shots leave no consistent one', () => {
    // A lone hit that no ship can hold: every neighbour is a miss.
    const log = [shot(5, 5, 'hit'), shot(4, 5, 'miss'), shot(6, 5, 'miss'), shot(5, 4, 'miss'), shot(5, 6, 'miss')];
    const sampling = sampleFleets(knowledgeOf(log), DEFAULT_BATTLESHIP_OPTIONS, seededRandom(5), { maxSamples: 50, expired: () => false });
    expect(sampling.samples).toBe(0);
  });
});

describe('Battleship search strategy', () => {
  const context = (random: () => number, expired: () => boolean) =>
    ({ random, budget: { maxDepth: undefined, timeLeftMs: () => 1000, expired } });

  it('places a legal fleet and then fires only at cells it has not shot', () => {
    const placing = { ...viewWith([]), phase: 'placing' as const, placed: [] };
    const action = battleshipSearch(placing, context(seededRandom(1), () => false));
    if (action?.type !== 'game-action' || action.request.gameType !== 'battleship' || action.request.action.type !== 'place-fleet') {
      throw new Error('Expected a fleet');
    }
    expect(bsFleetError(action.request.action.fleet, DEFAULT_BATTLESHIP_OPTIONS)).toBeNull();
    const log = [shot(5, 5, 'hit'), shot(2, 2, 'miss')];
    const view = viewWith(log);
    const before = structuredClone(view);
    const fired = new Set(log.map((entry) => bsCell(entry.to)));
    for (let seed = 1; seed <= 5; seed++) {
      expect(fired.has(target(battleshipSearch(view, context(seededRandom(seed), () => false))))).toBe(false);
    }
    expect(view).toEqual(before);
    expect(battleshipSearch({ ...view, currentTurnSeat: 'S' }, context(seededRandom(1), () => false))).toBeNull();
  });

  it('answers with the density count when the budget leaves too few samples', () => {
    const view = viewWith([shot(5, 5, 'hit')]);
    expect(bsOrthogonal(bsIndex(5, 5))).toContain(target(battleshipSearch(view, context(seededRandom(1), () => true))));
  });

  it('sinks a fleet in fewer shots than a density count would need on average', () => {
    // Solo games against random fleets with a short clock per shot; the bot needs about 45 shots, random fire 95.
    let shots = 0;
    const games = 8;
    for (let seed = 1; seed <= games; seed++) {
      const random = seededRandom(seed * 17);
      const fleet = bsRandomFleet(random, DEFAULT_BATTLESHIP_OPTIONS);
      const log: BattleshipShot[] = [];
      const fired: number[] = [];
      let sunk = 0;
      while (sunk < BS_SHIPS.length) {
        const end = performance.now() + 4;
        const cell = target(battleshipSearch(viewWith(log), context(random, () => performance.now() >= end)));
        const result = bsResolveShot(fleet, fired, cell);
        fired.push(cell);
        log.push(shot(cell % 10, Math.floor(cell / 10), result.outcome === 'miss' ? 'miss' : result.outcome === 'hit' ? 'hit' : 'sunk',
          result.ship ? { ship: result.ship, sunkCells: result.cells!.map(bsNode) } : {}));
        if (result.outcome === 'sunk') sunk++;
      }
      shots += fired.length;
    }
    expect(shots / games).toBeLessThan(60);
  }, 30_000);

  it('runs in the worker pool with the synchronous count as its fallback', async () => {
    const bot = gameBot('battleship');
    expect(bot.decide).toBe(getBattleshipBotAction);
    expect(bot.search?.strategy.exportName).toBe('battleshipSearch');
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    try {
      const view = viewWith([shot(5, 5, 'hit')]);
      const outcome = await pool.run({ strategy: bot.search!.strategy, visible: view, budgetMs: 400, seed: 3 });
      if (outcome.status !== 'ok') throw new Error(`Search ended as ${outcome.status}`);
      expect(bsOrthogonal(bsIndex(5, 5))).toContain(target(outcome.action));
    } finally {
      await pool.close();
    }
  }, 20_000);
});
