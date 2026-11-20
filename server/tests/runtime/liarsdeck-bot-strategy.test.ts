import { afterEach, describe, expect, it } from 'vitest';
import type { LiarCard, LiarFace, LiarsDeckLogEntry, LiarsDeckVisibleState, PlayerInfo, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { LD_DECK, LD_TRUTH_COUNT, ldCanChallenge, ldIsTruth, ldMustChallenge } from '@shared/rules/liarsdeck';
import type { BotAction } from '../../src/bots/bot-decisions';
import { getBotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { dealWorld, knownCards, tableCallRates, tableHonesty } from '../../src/bots/liarsdeck-knowledge';
import { atLeastTruths, liarsDeckSearch, winChances } from '../../src/bots/liarsdeck-search';
import { getLiarsDeckBotAction } from '../../src/bots/liarsdeck-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { firstLegalAction } from '../../src/runtime/automated-action';
import * as liarsdeck from '../../src/managers/games/liarsdeck-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'LIARBOT';

function hand(faces: readonly LiarFace[]): LiarCard[] {
  const used = new Set<number>();
  return faces.map((face) => {
    const card = LD_DECK.find((entry) => entry.face === face && !used.has(entry.id))!;
    used.add(card.id);
    return card;
  });
}

const round: LiarsDeckLogEntry = { type: 'round', round: 1, tableFace: 'K', starter: 'E', timestamp: 1 };
const play = (seat: Seat, count: number): LiarsDeckLogEntry => ({ type: 'play', seat, count, timestamp: 2 });
const challenged = (target: Seat, lied: boolean, seat: Seat = 'N'): LiarsDeckLogEntry => ({
  type: 'challenge', seat, target, revealed: [lied ? 'Q' : 'K'], lied, timestamp: 3,
});

/** North to act in round 1 with K as the table card. */
function state(myHand: LiarCard[], overrides: Partial<LiarsDeckVisibleState> = {}): LiarsDeckVisibleState {
  return {
    gameType: 'liarsdeck', phase: 'playing', mySeat: 'N', myHand, myPlayed: [],
    handCounts: { N: myHand.length, E: 5, S: 5, W: 5 }, pileCount: 0, lastPlay: null, tableFace: 'K', round: 1,
    currentTurnSeat: 'N', shots: { N: 0, E: 0, S: 0, W: 0 }, eliminated: [], log: [round], result: null,
    ...overrides,
  };
}

/** East just claimed `count` cards. */
function afterClaim(myHand: LiarCard[], count: number, eastLeft: number, overrides: Partial<LiarsDeckVisibleState> = {}): LiarsDeckVisibleState {
  return state(myHand, {
    handCounts: { N: myHand.length, E: eastLeft, S: 5, W: 5 }, pileCount: count, lastPlay: { seat: 'E', count },
    log: [round, play('E', count)], ...overrides,
  });
}

/** A search context with a wall-clock budget and a seeded generator. */
function context(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

/** The search with a fixed number of worlds, so equal views always give equal answers. */
function decide(visible: LiarsDeckVisibleState, seed = 3, samples = 400): BotAction | null {
  return liarsDeckSearch(visible, context(seed, 10_000), { maxSamples: samples });
}

const isCall = (action: BotAction | null): boolean => action?.type === 'liarsdeck-challenge';

/** Share of seeds on which the search calls. */
function callRate(visible: LiarsDeckVisibleState, seeds = 10): number {
  let calls = 0;
  for (let seed = 1; seed <= seeds; seed++) if (isCall(decide(visible, seed))) calls++;
  return calls / seeds;
}

function liesIn(visible: LiarsDeckVisibleState, action: BotAction | null): number {
  if (action?.type !== 'liarsdeck-play') return 0;
  return visible.myHand.filter((card) => action.cardIds.includes(card.id) && !ldIsTruth(card.face, visible.tableFace)).length;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe("Liar's Deck odds", () => {
  it('should compute hypergeometric truth chances', () => {
    expect(atLeastTruths(15, 6, 5, 0)).toBeCloseTo(1);
    expect(atLeastTruths(15, 6, 5, 1)).toBeCloseTo(1 - 126 / 3003);
    expect(atLeastTruths(15, 2, 5, 3)).toBe(0);
  });

  it('should rate every seat by the pulls it has left, summing to one over the survivors', () => {
    for (const pulls of [[0, 0, 0, 0], [3, 0, 5, -1], [4, 4, -1, -1], [5, -1, -1, -1]]) {
      const chances = winChances(pulls);
      expect(chances.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
      pulls.forEach((count, seat) => { if (count < 0) expect(chances[seat]).toBe(0); });
    }
    expect(winChances([0, 0, -1, -1])[0]).toBeCloseTo(0.5, 10);
    // A seat deep in the chamber is the likelier to die first.
    const [deep, fresh] = winChances([4, 0, -1, -1]);
    expect(deep).toBeLessThan(fresh);
    expect(winChances([5, 5, 5, 5]).every((value) => Math.abs(value - 0.25) < 1e-10)).toBe(true);
  });
});

describe("Liar's Deck table knowledge", () => {
  it('should start from a fixed honesty and learn it from other seats\' challenged plays only', () => {
    const base = state(hand(['K', 'Q', 'A', 'Q', 'A']));
    const prior = tableHonesty(base);
    expect(prior).toBeGreaterThan(0.7);
    const liars = tableHonesty({ ...base, log: [round, ...Array.from({ length: 12 }, () => challenged('E', true))] });
    const truthful = tableHonesty({ ...base, log: [round, ...Array.from({ length: 12 }, () => challenged('E', false))] });
    expect(liars).toBeLessThan(prior);
    expect(truthful).toBeGreaterThan(prior);
    // The bot's own plays say nothing about the others.
    expect(tableHonesty({ ...base, log: [round, ...Array.from({ length: 12 }, () => challenged('N', true))] })).toBe(prior);
  });

  it('should learn how often claims are called from the other seats, never from its own calls', () => {
    const base = state(hand(['K', 'Q', 'A', 'Q', 'A']));
    const prior = tableCallRates(base);
    const repeat = (entries: LiarsDeckLogEntry[], times: number): LiarsDeckLogEntry[] =>
      Array.from({ length: times }, () => [round, ...entries]).flat();
    const called = tableCallRates({ ...base, log: repeat([play('E', 1), challenged('E', true, 'S')], 10) });
    const ignored = tableCallRates({ ...base, log: repeat([play('E', 1), play('S', 1)], 10) });
    expect(called[0]).toBeGreaterThan(prior[0] + 0.3);
    expect(ignored[0]).toBeLessThan(prior[0]);
    // Claims of other sizes keep their prior.
    expect(called[2]).toBe(prior[2]);
    expect(tableCallRates({ ...base, log: repeat([play('E', 1), challenged('E', true)], 10) })).toEqual(prior);
  });

  it('should deal worlds that match every count the view shows', () => {
    const visible = afterClaim(hand(['K', 'Q', 'A', 'Q', 'A']), 2, 3);
    const known = knownCards(visible);
    const random = seededRandom(9);
    for (let sample = 0; sample < 200; sample++) {
      const world = dealWorld(visible, 0.8, random);
      let truths = known.truths;
      SEAT_ORDER_CLOCKWISE.forEach((seat, index) => {
        if (seat === 'N') return;
        expect(world.handTruths[index] + world.handLies[index]).toBe(visible.handCounts[seat]);
        expect(world.playedTruths[index] + world.playedLies[index]).toBe(seat === 'E' ? 2 : 0);
        truths += world.handTruths[index] + world.playedTruths[index];
      });
      expect(truths).toBeLessThanOrEqual(LD_TRUTH_COUNT);
      expect(world.weight).toBeGreaterThan(0);
      expect(world.lastLies).toBe(world.playedLies[1]);
    }
  });

  it('should explain a lie by a seat that held nothing true better than one that held a truth', () => {
    // North holds every truth but one, so East's two claimed cards are lies unless East has the last truth.
    const visible = afterClaim(hand(['K', 'K', 'K', 'K', 'K']), 2, 3);
    const random = seededRandom(4);
    let lieWeight = 0;
    let lieWorlds = 0;
    for (let sample = 0; sample < 400; sample++) {
      const world = dealWorld(visible, 0.8, random);
      if (world.lastLies === 2) {
        lieWeight += world.weight;
        lieWorlds++;
      }
    }
    expect(lieWorlds).toBeGreaterThan(0);
    // A play of two lies by a seat with no truth to its name is not penalized.
    expect(lieWeight / lieWorlds).toBeGreaterThan(0.2);
  });
});

describe("Liar's Deck bot decisions", () => {
  it('should always call when it is the last seat holding cards and never call on the first play', () => {
    const forced = state(hand(['Q', 'A']), {
      handCounts: { N: 2, E: 0, S: 0, W: 0 }, pileCount: 1, lastPlay: { seat: 'E', count: 1 },
    });
    expect(isCall(decide(forced))).toBe(true);
    expect(isCall(getLiarsDeckBotAction(forced, seededRandom(1)))).toBe(true);
    for (const seed of [1, 2, 3]) expect(decide(state(hand(['Q', 'A', 'Q', 'A', 'Q'])), seed)?.type).toBe('liarsdeck-play');
  });

  it('should play only matching cards when every card in hand matches', () => {
    const myHand = hand(['K', 'K', 'joker']);
    const action = decide(state(myHand));
    expect(action?.type).toBe('liarsdeck-play');
    expect(liesIn(state(myHand), action)).toBe(0);
  });

  it('should call a big claim when it holds no truth to fall back on', () => {
    // North has only lies, so a call is its way to make someone else shoot; a three-card claim is rarely honest.
    expect(callRate(afterClaim(hand(['Q', 'Q', 'Q', 'A', 'A']), 3, 2))).toBeGreaterThanOrEqual(0.9);
  });

  it('should weigh a call by how much the trigger pull helps, not by a flat bonus', () => {
    // East's claim is almost surely a lie. A fresh East who shoots is far worse off, so North calls; East already
    // five pulls in is as good as gone either way, so North does not risk its own pull to hurry that along.
    const myHand = hand(['Q', 'Q', 'A', 'A', 'A']);
    const freshEast = afterClaim(myHand, 3, 2);
    const doomedEast = afterClaim(myHand, 3, 2, { shots: { N: 0, E: 5, S: 0, W: 0 } });
    expect(callRate(freshEast)).toBe(1);
    expect(callRate(doomedEast)).toBeLessThanOrEqual(0.2);
  });

  it('should call less readily the nearer its own chamber is to the bullet', () => {
    const myHand = hand(['Q', 'Q', 'A', 'A', 'A']);
    const calls = (pulls: number): number => callRate(afterClaim(myHand, 3, 2, { shots: { N: pulls, E: 0, S: 0, W: 0 } }));
    expect(calls(0)).toBeGreaterThan(calls(5));
  });

  it('should choose how many lies to shed by the state of the table, not by a fixed bluff rate', () => {
    // Holding a truth, a lie-heavy hand and a seat close to the bullet: the more it has to lose by being stuck with
    // lies later, the more of them it sheds now.
    const myHand = hand(['K', 'Q', 'Q', 'A', 'A']);
    const average = (pulls: number): number => {
      let lies = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const visible = state(myHand, { shots: { N: pulls, E: 0, S: 0, W: 0 } });
        lies += liesIn(visible, decide(visible, seed));
      }
      return lies / 10;
    };
    expect(average(4)).toBeGreaterThan(average(0));
  });

  it('should trust a single-card claim when it can still play honestly', () => {
    expect(callRate(afterClaim(hand(['K', 'Q', 'A', 'Q', 'A']), 1, 4))).toBe(0);
  });

  it('should wait outside its turn and after the game ends', () => {
    expect(liarsDeckSearch(state(hand(['K']), { currentTurnSeat: 'E' }), context(1, 50))).toBeNull();
    expect(getLiarsDeckBotAction(state(hand(['K']), { phase: 'scoring' }), () => 0)).toBeNull();
    expect(getBotAction(state(hand(['K']), { currentTurnSeat: 'E' }), () => 0)).toBeNull();
  });

  it('should stay inside its budget and leave the view alone', () => {
    const visible = deepFreeze(afterClaim(hand(['K', 'Q', 'A', 'Q', 'joker']), 2, 3));
    const before = structuredClone(visible);
    const started = performance.now();
    expect(liarsDeckSearch(visible, context(5, 60))).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(400);
    expect(visible).toEqual(before);
  });

  it('should decide from its own view only', () => {
    const visible = afterClaim(hand(['K', 'Q', 'A', 'Q', 'joker']), 2, 3);
    expect(decide(structuredClone(visible))).toEqual(decide(visible));
    expect(Object.keys(visible)).not.toContain('hands');
  });
});

describe("Liar's Deck legality", () => {
  afterEach(() => liarsdeck.restoreGames([]));

  const players = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, {
    id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }])) as Record<Seat, PlayerInfo>;

  function apply(seat: Seat, action: BotAction | null, random: () => number): void {
    if (action?.type === 'liarsdeck-play') expect(liarsdeck.play(CODE, seat, action.cardIds).success).toBe(true);
    else if (action?.type === 'liarsdeck-challenge') expect(liarsdeck.challenge(CODE, seat, random).success).toBe(true);
    else throw new Error('Expected a Liar\'s Deck action');
  }

  it('should play complete matches with only legal moves, from the fallback and the search', () => {
    for (const seed of [1, 2, 3]) {
      const random = seededRandom(seed);
      liarsdeck.startGame(CODE, players, random);
      runSeededGame('liarsdeck bot match', 1_500, () => liarsdeck.getGameState(CODE)?.phase === 'scoring', (step) => {
        const seat = liarsdeck.getGameState(CODE)!.currentTurnSeat;
        const visible = deepFreeze(structuredClone(liarsdeck.getPlayerVisibleState(CODE, seat)!));
        const action = step % 3 === 0 ? liarsDeckSearch(visible, context(step, 30), { maxSamples: 60 }) : getBotAction(visible, random);
        if (action?.type === 'liarsdeck-challenge') expect(ldCanChallenge(seat, visible.lastPlay)).toBe(true);
        if (action?.type === 'liarsdeck-play') expect(ldMustChallenge(seat, visible.handCounts, visible.lastPlay)).toBe(false);
        apply(seat, action, random);
      });
      expect(liarsdeck.getGameState(CODE)?.result).not.toBeNull();
    }
  });

  it('should answer through the registry, the timeout hook and the first legal fallback', () => {
    const bot = gameBot('liarsdeck');
    expect(bot.turnTimeout).toBeUndefined();
    expect(bot.search?.budgetMs).toBeGreaterThan(0);
    const visible = afterClaim(hand(['K', 'Q', 'A', 'Q', 'A']), 1, 4);
    for (const action of [bot.decide(visible, seededRandom(1)), bot.firstLegal(visible), firstLegalAction(visible)]) {
      expect(action).not.toBeNull();
    }
  });
});
