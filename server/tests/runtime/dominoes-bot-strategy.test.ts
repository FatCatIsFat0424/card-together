import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { BotDifficulty, GameSeat, PlayerInfo } from '@shared/types';
import type { DominoesVisibleState, DominoTile } from '@shared/games/dominoes/types';
import { dmSameTile, dmTurnOptions } from '@shared/rules/dominoes';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as dm from '../../src/managers/games/dominoes-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'DMB001';

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

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

describe('Dominoes easy and fallback bots', () => {
  it('plays a random legal tile and end', () => {
    const hand = [t(0, 1), t(2, 4), t(5, 6)];
    const seen = new Set<string>();
    for (const sample of [0, 0.2, 0.4, 0.6, 0.8, 0.9999]) {
      const action = act(getBotAction(view(hand), () => sample, 'easy'));
      expect(action.type).toBe('play');
      seen.add(`${action.tile}-${action.side}`);
    }
    expect([...seen].sort()).toEqual(['2,4-left', '5,6-right']);
  });

  it('plays the heaviest legal tile as the timeout fallback', () => {
    const action = act(firstLegalAction(view([t(2, 3), t(5, 6), t(0, 5), t(1, 2)])));
    expect(action).toMatchObject({ type: 'play', tile: t(5, 6), side: 'right' });
  });

  it('opens with the required tile', () => {
    const opening = view([t(3, 3), t(6, 6)], { line: [], openingTile: t(6, 6) });
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(act(getBotAction(opening, () => 0.5, difficulty))).toEqual({ type: 'play', tile: t(6, 6) });
    }
    expect(act(firstLegalAction(opening))).toEqual({ type: 'play', tile: t(6, 6) });
  });

  it('draws with nothing playable, and passes once the boneyard is empty', () => {
    const stuck = [t(0, 1), t(3, 4)];
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(act(getBotAction(view(stuck), () => 0.5, difficulty)).type).toBe('draw');
      expect(act(getBotAction(view(stuck, { boneyardCount: 0 }), () => 0.5, difficulty)).type).toBe('pass');
    }
    expect(act(firstLegalAction(view(stuck))).type).toBe('draw');
  });

  it('only acts on its own turn while the round is in play', () => {
    const hand = [t(2, 4)];
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(getBotAction(view(hand, { currentTurnSeat: 'E' }), () => 0.5, difficulty)).toBeNull();
      expect(getBotAction(view(hand, { phase: 'scoring' }), () => 0.5, difficulty)).toBeNull();
    }
  });
});

describe('Dominoes hard bot', () => {
  it('sheds the heavy double before a light tile of the same end', () => {
    const action = act(getBotAction(view([t(2, 2), t(2, 1), t(0, 5)], { line: [{ tile: t(2, 3), left: 3, right: 2 }] }), () => 0.5, 'hard'));
    expect(action).toMatchObject({ type: 'play' });
  });

  it('prefers to leave an end an opponent was seen unable to match', () => {
    // E drew with 3 and 6 open, so ending the line on a 3 or 6 is good for N.
    const hand = [t(1, 3), t(1, 4)];
    const line = [{ tile: t(1, 2), left: 1, right: 2 }] as DominoesVisibleState['line'];
    const log = [
      { type: 'round', round: 1, leader: 'N', counts: { ...empty, N: 5, E: 5 }, boneyard: 18, timestamp: 1 },
      { type: 'draw', seat: 'E', ends: { left: 3, right: 6 }, timestamp: 2 },
    ] as DominoesVisibleState['log'];
    const action = act(getBotAction(view(hand, { line, log, boneyardCount: 17 }), () => 0.5, 'hard'));
    expect(action).toMatchObject({ type: 'play', tile: t(1, 3), side: 'left' });
  });

  it('goes out when it can', () => {
    const action = act(getBotAction(view([t(6, 6), t(2, 4)]), () => 0.5, 'hard'));
    expect(action).toMatchObject({ type: 'play', tile: t(2, 4) });
    const last = act(getBotAction(view([t(2, 4)]), () => 0.5, 'hard'));
    expect(last).toMatchObject({ type: 'play', tile: t(2, 4) });
  });
});

/** Plays one match; each seat is driven by the named difficulty through the visible state only. */
function playMatch(seed: number, difficulties: readonly BotDifficulty[], targetScore: 50 | 100 | 150 = 100): GameSeat[] {
  const random = seeded(seed);
  vi.spyOn(Math, 'random').mockImplementation(random);
  const seats = GAME_SEAT_ORDER.slice(0, difficulties.length);
  dm.startGame(CODE, playersOf(seats.length), undefined, { targetScore });
  runSeededGame(`dominoes seed ${seed}`, 4000, () => dm.getGameState(CODE)?.phase === 'scoring', () => {
    const game = dm.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const visible = dm.getPlayerVisibleState(CODE, seat)!;
    const options = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile);
    const action = act(getBotAction(visible, random, difficulties[seats.indexOf(seat)]));
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

describe('Dominoes bot matches', () => {
  beforeEach(() => dm.restoreGames([]));
  afterEach(() => vi.restoreAllMocks());

  it('finishes seeded matches of every table size with only legal decisions', () => {
    for (const [index, size] of [2, 3, 4].entries()) {
      for (let seed = 1; seed <= 6; seed++) {
        expect(playMatch(seed * 31 + index, Array(size).fill(seed % 2 ? 'hard' : 'easy'), 50).length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every decision under 50 ms', () => {
    dm.startGame(CODE, playersOf(2), undefined);
    const visible = dm.getPlayerVisibleState(CODE, dm.getGameState(CODE)!.currentTurnSeat)!;
    const started = performance.now();
    for (let index = 0; index < 100; index++) getBotAction(visible, Math.random, 'hard');
    expect((performance.now() - started) / 100).toBeLessThan(50);
  });

  it('hard beats easy over seeded heads-up matches', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const hardFirst = seed % 2 === 0;
      const winners = playMatch(seed * 7919, hardFirst ? ['hard', 'easy'] : ['easy', 'hard']);
      if (winners.length !== 1) continue;
      if ((winners[0] === 'N') === hardFirst) hard++;
      else easy++;
    }
    expect(hard).toBeGreaterThan(easy * 2);
  });
});

describe('Dominoes bots use only visible information', () => {
  beforeEach(() => dm.restoreGames([]));

  it('decides the same whatever the other hands and boneyard hold', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(5));
    dm.startGame(CODE, playersOf(3), undefined);
    const game = dm.getGameState(CODE)!;
    const seat = game.currentTurnSeat;
    const before = getBotAction(dm.getPlayerVisibleState(CODE, seat)!, () => 0.4, 'hard');
    // Swap the other seats' hidden tiles with the boneyard's: counts stay, nothing the bot may see changes.
    const others = GAME_SEAT_ORDER.filter((other) => other !== seat && game.hands[other].length > 0);
    others.forEach((other, index) => {
      const hidden = game.hands[other][0];
      game.hands[other][0] = game.boneyard[index];
      game.boneyard[index] = hidden;
    });
    expect(others.length).toBe(2);
    expect(getBotAction(dm.getPlayerVisibleState(CODE, seat)!, () => 0.4, 'hard')).toEqual(before);
    vi.restoreAllMocks();
  });
});
