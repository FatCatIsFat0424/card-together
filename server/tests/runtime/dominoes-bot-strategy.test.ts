import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { DominoesVisibleState, DominoPlacement, DominoTile } from '@shared/games/dominoes/types';
import { dmAllTiles, dmSameTile, dmTurnOptions } from '@shared/rules/dominoes';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { dominoesKnowledge, sampleDominoesWorld, tileId } from '../../src/bots/dominoes-knowledge';
import { dominoesSearch } from '../../src/bots/dominoes-search';
import { dominoesValues } from '../../src/bots/dominoes-sim';
import type { DominoesSim } from '../../src/bots/dominoes-sim';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as dm from '../../src/managers/games/dominoes-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'DMB001';

function player(seat: GameSeat): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null };
}

function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, player(seat)]));
}

const t = (a: number, b: number): DominoTile => [Math.min(a, b), Math.max(a, b)] as unknown as DominoTile;
const empty = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };

function view(myHand: DominoTile[], overrides: Partial<DominoesVisibleState> = {}): DominoesVisibleState {
  return {
    gameType: 'dominoes', phase: 'playing', options: { targetScore: 100 }, mySeat: 'N', seats: ['N', 'E'], myHand,
    handCounts: { ...empty, N: myHand.length, E: 5 }, boneyardCount: 9, line: [{ tile: t(2, 5), left: 2, right: 5 }],
    round: 1, leader: 'N', currentTurnSeat: 'N', openingTile: null, scores: { ...empty }, log: [], result: null,
    ...overrides,
  };
}

function act(action: BotAction | null): { type: string; tile?: DominoTile; side?: string } {
  if (action?.type !== 'game-action' || action.request.gameType !== 'dominoes') throw new Error('Expected a Dominoes action');
  return action.request.action;
}

function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

/** Applies a bot action to the running match and fails the test on a rejected one. */
function apply(seat: GameSeat, action: BotAction | null): void {
  const chosen = act(action);
  const result = chosen.type === 'play' ? dm.play(CODE, seat, chosen.tile!, chosen.side as never)
    : chosen.type === 'draw' ? dm.draw(CODE, seat) : dm.pass(CODE, seat);
  expect(result).toEqual({ success: true });
}

describe('Dominoes fallback and turn guards', () => {
  it('plays the heaviest legal tile as the timeout fallback', () => {
    const action = act(firstLegalAction(view([t(2, 3), t(5, 6), t(0, 5), t(1, 2)])));
    expect(action).toMatchObject({ type: 'play', tile: t(5, 6), side: 'right' });
    const visible = view([t(2, 3), t(5, 6), t(0, 5), t(1, 2)]);
    expect(gameBot('dominoes').turnTimeout?.(visible, { isBot: false, strategy: () => null })).toEqual(firstLegalAction(visible));
  });

  it('opens with the required tile', () => {
    const opening = view([t(3, 3), t(6, 6)], { line: [], openingTile: t(6, 6) });
    expect(act(getBotAction(opening, () => 0.5))).toEqual({ type: 'play', tile: t(6, 6) });
    expect(act(firstLegalAction(opening))).toEqual({ type: 'play', tile: t(6, 6) });
  });

  it('draws with nothing playable, and passes once the boneyard is empty', () => {
    const stuck = [t(0, 1), t(3, 4)];
    expect(act(getBotAction(view(stuck), () => 0.5)).type).toBe('draw');
    expect(act(getBotAction(view(stuck, { boneyardCount: 0 }), () => 0.5)).type).toBe('pass');
    expect(act(firstLegalAction(view(stuck))).type).toBe('draw');
    expect(act(dominoesSearch(view(stuck), context(1, 100))).type).toBe('draw');
  });

  it('only acts on its own turn while the round is in play', () => {
    const hand = [t(2, 4)];
    expect(getBotAction(view(hand, { currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
    expect(getBotAction(view(hand, { phase: 'scoring' }), () => 0.5)).toBeNull();
    expect(dominoesSearch(view(hand, { currentTurnSeat: 'E' }), context(1, 100))).toBeNull();
  });

  it('goes out when it can', () => {
    const action = act(getBotAction(view([t(6, 6), t(2, 4)]), () => 0.5));
    expect(action).toMatchObject({ type: 'play', tile: t(2, 4) });
    const last = act(getBotAction(view([t(2, 4)]), () => 0.5));
    expect(last).toMatchObject({ type: 'play', tile: t(2, 4) });
  });
});

/** A heads-up position with an empty boneyard: N holds 3-5 and 5-6, E holds only 3-3, and the line ends 6 … 3. */
function blockingPosition(): DominoesVisibleState {
  const held = [t(3, 5), t(5, 6), t(3, 3)];
  const rest = dmAllTiles().filter((tile) => !held.some((own) => dmSameTile(own, tile)));
  // Any line works for the bot as long as its ends are right; only the open numbers and the tiles shown matter.
  const line: DominoPlacement[] = rest.map((tile, index) => ({
    tile, left: index === 0 ? 6 : tile[0], right: index === rest.length - 1 ? 3 : tile[1],
  }));
  return view([t(3, 5), t(5, 6)], { line, boneyardCount: 0, handCounts: { ...empty, N: 2, E: 1 } });
}

describe('Dominoes bot', () => {
  it('solves a heads-up round with an empty boneyard exactly', () => {
    // 5-6 on the left leaves 5 … 3, and E goes out with 3-3; 3-5 on the right leaves 6 … 5, E must pass, and N goes out.
    const visible = blockingPosition();
    expect(act(getBotAction(visible, () => 0.5))).toEqual({ type: 'play', tile: t(3, 5), side: 'right' });
    expect(act(dominoesSearch(visible, context(3, 300)))).toEqual({ type: 'play', tile: t(3, 5), side: 'right' });
  });

  it('values a round that ends the match exactly and others by the distance to the target', () => {
    const state: DominoesSim = {
      hands: Int32Array.from([0, 1 << tileId(t(6, 6))]), pips: Int16Array.from([0, 12]), boneyard: new Int8Array(0),
      boneTop: 0, left: 1, right: 2, turn: 0, over: true, winner: 0, points: 12,
    };
    // E leads 95 to 90: N's 12 points end the match with N on top.
    expect([...dominoesValues(state, { scores: [90, 95], target: 100, round: 4 })]).toEqual([1, 0]);
    // N winning 12 points short of the target only improves its chances.
    const open = dominoesValues(state, { scores: [10, 40], target: 100, round: 2 });
    const before = dominoesValues({ ...state, winner: -1, points: 0 }, { scores: [10, 40], target: 100, round: 2 });
    expect(open[0]).toBeGreaterThan(before[0]);
    expect(open[0] + open[1]).toBeCloseTo(1);
  });

  it('rules out the doubles above round 1\'s opening tile for every dealt hand', () => {
    // E opened round 1 with 3-3, so nobody was dealt 4-4, 5-5, or 6-6: they are in the boneyard.
    const log = [
      { type: 'round', round: 1, leader: 'E', counts: { ...empty, N: 5, E: 5, S: 5 }, boneyard: 13, timestamp: 1 },
      { type: 'play', seat: 'E', tile: t(3, 3), side: null, placement: { tile: t(3, 3), left: 3, right: 3 }, timestamp: 2 },
    ] as DominoesVisibleState['log'];
    const visible = view([t(0, 1), t(1, 2), t(2, 4), t(0, 6), t(1, 5)], {
      seats: ['N', 'E', 'S'], handCounts: { ...empty, N: 5, E: 4, S: 5 }, boneyardCount: 13, log,
      line: [{ tile: t(3, 3), left: 3, right: 3 }], leader: 'E', currentTurnSeat: 'S',
    });
    const knowledge = dominoesKnowledge(visible);
    expect(knowledge.exact).toBe(true);
    const random = seededRandom(4);
    const high = [t(4, 4), t(5, 5), t(6, 6)].map((tile) => 1 << tileId(tile));
    for (let deal = 0; deal < 100; deal++) {
      const world = sampleDominoesWorld(knowledge, random)!;
      for (const bit of high) expect((world.hands[1] | world.hands[2]) & bit).toBe(0);
    }
  });

  it('keeps a draw\'s void for the tiles held then, not for the tile drawn', () => {
    // E drew with 3 and 6 open: its older tiles hold no 3 or 6, the drawn tile may.
    const log = [
      { type: 'round', round: 2, leader: 'N', counts: { ...empty, N: 7, E: 7 }, boneyard: 14, timestamp: 1 },
      { type: 'play', seat: 'N', tile: t(3, 6), side: null, placement: { tile: t(3, 6), left: 3, right: 6 }, timestamp: 2 },
      { type: 'draw', seat: 'E', ends: { left: 3, right: 6 }, timestamp: 3 },
    ] as DominoesVisibleState['log'];
    const visible = view([t(0, 0), t(1, 1), t(2, 2), t(4, 4), t(5, 5), t(0, 1)], {
      round: 2, handCounts: { ...empty, N: 6, E: 8 }, boneyardCount: 13, log, line: [{ tile: t(3, 6), left: 3, right: 6 }],
    });
    const knowledge = dominoesKnowledge(visible);
    expect(knowledge.exact).toBe(true);
    const sixes = (1 << tileId(t(3, 3))) | (1 << tileId(t(0, 3))) | (1 << tileId(t(6, 6))) | (1 << tileId(t(1, 6)));
    expect(knowledge.hands[1].filter((mask) => (mask & sixes) !== 0)).toHaveLength(1);
  });

  it('prefers to leave an end an opponent was seen unable to match', () => {
    // E drew with 3 and 6 open, so ending the line on a 3 or 6 is good for N.
    const hand = [t(1, 3), t(1, 4)];
    const line = [{ tile: t(1, 2), left: 1, right: 2 }] as DominoesVisibleState['line'];
    const log = [
      { type: 'round', round: 2, leader: 'N', counts: { ...empty, N: 5, E: 5 }, boneyard: 18, timestamp: 1 },
      { type: 'draw', seat: 'E', ends: { left: 3, right: 6 }, timestamp: 2 },
    ] as DominoesVisibleState['log'];
    const visible = view(hand, { line, log, boneyardCount: 19, handCounts: { ...empty, N: 2, E: 6 } });
    expect(dominoesKnowledge(visible).exact).toBe(true);
    const action = act(getBotAction(visible, () => 0.5));
    expect(action).toMatchObject({ type: 'play', tile: t(1, 3), side: 'left' });
  });
});

type Policy = (visible: DominoesVisibleState, random: () => number) => ReturnType<typeof act>;

const botPolicy: Policy = (visible, random) => act(getBotAction(visible, random));

/** A seeded uniformly random legal move: the weak baseline the bot is measured against. */
const randomPolicy: Policy = (visible, random) => {
  const options = dmTurnOptions(visible.myHand, visible.line, visible.boneyardCount, visible.openingTile);
  if (options.plays.length === 0) return { type: options.canDraw ? 'draw' : 'pass' };
  const { tile, side } = options.plays[Math.floor(random() * options.plays.length)];
  return side ? { type: 'play', tile, side } : { type: 'play', tile };
};

/** Plays one match; each seat is driven by its policy through the visible state only. */
function playMatch(seed: number, policies: readonly Policy[], targetScore: 50 | 100 | 150 = 100): GameSeat[] {
  const random = seededRandom(seed);
  vi.spyOn(Math, 'random').mockImplementation(random);
  const seats = GAME_SEAT_ORDER.slice(0, policies.length);
  dm.startGame(CODE, playersOf(seats.length), undefined, { targetScore });
  runSeededGame(`dominoes seed ${seed}`, 4000, () => dm.getGameState(CODE)?.phase === 'scoring', () => {
    const game = dm.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const visible = dm.getPlayerVisibleState(CODE, seat)!;
    const options = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile);
    const action = policies[seats.indexOf(seat)](visible, random);
    // Every decision must be one the rules allow.
    if (action.type === 'play') {
      expect(options.plays.some((play) => dmSameTile(play.tile, action.tile!) && (play.side ?? undefined) === (action.side as never))).toBe(true);
    } else if (action.type === 'draw') expect(options.canDraw).toBe(true);
    else expect(options.canPass).toBe(true);
    const result = action.type === 'play' ? dm.play(CODE, seat, action.tile!, action.side as never)
      : action.type === 'draw' ? dm.draw(CODE, seat) : dm.pass(CODE, seat);
    expect(result).toEqual({ success: true });
  });
  return dm.getGameState(CODE)!.result!.winners;
}

/** Whether the true hidden tiles fit the possibilities the knowledge keeps for that hand. */
function truthFits(tiles: readonly number[], slots: readonly number[]): boolean {
  if (tiles.length !== slots.length) return false;
  const owner = new Array<number>(slots.length).fill(-1);
  const place = (tile: number, seen: boolean[]): boolean => slots.some((mask, slot) => {
    if (seen[slot] || (mask & (1 << tiles[tile])) === 0) return false;
    seen[slot] = true;
    if (owner[slot] >= 0 && !place(owner[slot], seen)) return false;
    owner[slot] = tile;
    return true;
  });
  return tiles.every((_, index) => place(index, new Array<boolean>(slots.length).fill(false)));
}

describe('Dominoes bot matches', () => {
  beforeEach(() => dm.restoreGames([]));
  afterEach(() => vi.restoreAllMocks());

  it('finishes seeded matches of every table size with only legal decisions', () => {
    for (const [index, size] of [2, 3, 4].entries()) {
      for (let seed = 1; seed <= 4; seed++) {
        expect(playMatch(seed * 31 + index, Array<Policy>(size).fill(seed % 2 ? botPolicy : randomPolicy), 50).length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every synchronous decision fast', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(12));
    dm.startGame(CODE, playersOf(4), undefined);
    const random = seededRandom(13);
    let slowest = 0;
    runSeededGame('dominoes timing', 400, () => dm.getGameState(CODE)?.round !== 1, () => {
      const seat = dm.getGameState(CODE)!.currentTurnSeat;
      const visible = dm.getPlayerVisibleState(CODE, seat)!;
      const started = performance.now();
      const action = getBotAction(visible, random);
      slowest = Math.max(slowest, performance.now() - started);
      apply(seat, action);
    });
    expect(slowest).toBeLessThan(100);
  });

  it('beats a random legal player over seeded heads-up matches', () => {
    let bot = 0;
    let baseline = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const botFirst = seed % 2 === 0;
      const winners = playMatch(seed * 7919, botFirst ? [botPolicy, randomPolicy] : [randomPolicy, botPolicy], 50);
      if (winners.length !== 1) continue;
      if ((winners[0] === 'N') === botFirst) bot++;
      else baseline++;
    }
    expect(bot).toBeGreaterThan(baseline * 2);
  }, 20_000);

  it('keeps its knowledge true to the hidden hands over seeded matches', () => {
    for (const size of [2, 3, 4]) {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(size * 13));
      const random = seededRandom(size);
      dm.restoreGames([]);
      dm.startGame(CODE, playersOf(size), undefined, { targetScore: 50 });
      runSeededGame(`dominoes knowledge ${size}`, 4000, () => dm.getGameState(CODE)?.phase === 'scoring', () => {
        const game = dm.getGameState(CODE)!;
        const seat = game.currentTurnSeat;
        const visible = dm.getPlayerVisibleState(CODE, seat)!;
        const knowledge = dominoesKnowledge(visible);
        expect(knowledge.exact).toBe(true);
        knowledge.seats.forEach((other, index) => {
          if (index !== knowledge.mine) expect(truthFits(game.hands[other].map(tileId), knowledge.hands[index])).toBe(true);
        });
        apply(seat, getBotAction(visible, random));
      });
      vi.restoreAllMocks();
    }
  });

  it('searches within its budget, legally, without touching the view', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(77));
    dm.startGame(CODE, playersOf(3), undefined, { targetScore: 50 });
    const heuristic = seededRandom(8);
    let searched = 0;
    runSeededGame('dominoes search', 4000, () => dm.getGameState(CODE)?.phase === 'scoring', (step) => {
      const game = dm.getGameState(CODE)!;
      const seat = game.currentTurnSeat;
      const visible = dm.getPlayerVisibleState(CODE, seat)!;
      if (step % 5 !== 0) {
        apply(seat, getBotAction(visible, heuristic));
        return;
      }
      const before = structuredClone(visible);
      const started = performance.now();
      const action = dominoesSearch(visible, context(step, 60));
      expect(performance.now() - started).toBeLessThan(400);
      expect(visible).toEqual(before);
      searched++;
      apply(seat, action);
    });
    expect(searched).toBeGreaterThan(5);
  });
});

describe('Dominoes bots use only visible information', () => {
  beforeEach(() => dm.restoreGames([]));
  afterEach(() => vi.restoreAllMocks());

  it('decides the same whatever the other hands and boneyard hold', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(5));
    dm.startGame(CODE, playersOf(3), undefined);
    const game = dm.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const before = getBotAction(dm.getPlayerVisibleState(CODE, seat)!, () => 0.4);
    // Swap the other seats' hidden tiles with the boneyard's: counts stay, nothing the bot may see changes.
    const others = GAME_SEAT_ORDER.filter((other) => other !== seat && game.hands[other].length > 0);
    others.forEach((other, index) => {
      const hidden = game.hands[other][0];
      game.hands[other][0] = game.boneyard[index];
      game.boneyard[index] = hidden;
    });
    expect(others.length).toBe(2);
    expect(getBotAction(dm.getPlayerVisibleState(CODE, seat)!, () => 0.4)).toEqual(before);
  });
});
