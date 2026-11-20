import { afterEach, describe, expect, it } from 'vitest';
import type { Card, GameSeat, PlayerInfo, TenHalfAction, TenHalfVisibleState } from '@shared/types';
import { BJ_MAX_BET, BJ_MIN_BET } from '@shared/rules/blackjack';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { finalHands, tenHalfBet, tenHalfDecision, unseenDraws } from '../../src/bots/tenhalf-strategy';
import { tenHalfSearch } from '../../src/bots/tenhalf-search';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { seededRandom } from '../../src/bots/search/seeded-random';
import type { SearchContext } from '../../src/bots/search/search-types';
import { runSeededGame } from './seeded-game-runner';
import { createDeck } from '../../src/engine/deck';
import * as tenhalf from '../../src/managers/games/tenhalf-game';

const CODE = 'TENHB1';

const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});
const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

function rigged(top: readonly Card[]): () => number {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let index = 0;
  return () => draws[index++];
}

/** Banker N plus players E and S; `top` lists the hole cards of N, E, S and then the draws. */
function deal(top: readonly Card[]): void {
  tenhalf.startGame(CODE, { N: player('N'), E: player('E'), S: player('S') }, 60_000, 1_000, () => 0);
  tenhalf.bet(CODE, 'E', 50, true, 1_500);
  tenhalf.bet(CODE, 'S', 50, true, 1_500, rigged(top));
}

const view = (seat: GameSeat): TenHalfVisibleState => tenhalf.getPlayerVisibleState(CODE, seat)!;
const act = (type: BotAction | null): string | null => (type?.type === 'game-action' && type.request.gameType === 'tenhalf'
  && type.request.action.type === 'act' ? type.request.action.action : null);
const decide = (seat: GameSeat): TenHalfAction | null => act(getBotAction(view(seat), () => 0.5)) as TenHalfAction | null;

afterEach(() => tenhalf.abortGame(CODE));

describe('Ten and a Half bot', () => {
  it('bets within the table limits', () => {
    tenhalf.startGame(CODE, { N: player('N'), E: player('E') }, 60_000, 1_000, () => 0);
    for (const sample of [0, 0.5, 0.99]) {
      const action = getBotAction(view('E'), () => sample);
      const amount = action?.type === 'game-action' && action.request.action.type === 'bet' ? action.request.action.amount : 0;
      expect(amount).toBeGreaterThanOrEqual(BJ_MIN_BET);
      expect(amount).toBeLessThanOrEqual(BJ_MAX_BET);
      expect(amount % 10).toBe(0);
    }
  });

  it('draws on a tiny hand and stands on a strong one', () => {
    deal([card(5), card(2), card(10)]);
    expect(decide('E')).toBe('hit');
    tenhalf.abortGame(CODE);
    deal([card(5), card(10), card(2)]);
    expect(decide('E')).toBe('stand');
  });

  it('stands on 10 points and never draws into a certain loss', () => {
    deal([card(4), card(10), card(9)]);
    expect(decide('E')).toBe('stand');
    expect(decide('S')).toBeNull();
  });

  it('decides from its own view only: other face-down cards change nothing', () => {
    deal([card(5), card(6), card(10)]);
    const first = decide('E');
    tenhalf.abortGame(CODE);
    deal([card(13, 'hearts'), card(6), card(2, 'clubs')]);
    expect(decide('E')).toBe(first);
  });

  it('counts the cards it can see out of the deck: its own hole card and every face-up card', () => {
    deal([card(5), card(6), card(10), card(14, 'hearts')]);
    tenhalf.act(CODE, 'E', 'hit');
    const draws = unseenDraws(view('S'));
    expect(draws.reduce((sum, entry) => sum + entry.chance, 0)).toBeCloseTo(1);
    // 52 - S's own 10, - E's face-up ace = 50 unseen cards; aces (2 half points) now number three.
    expect(draws.find((entry) => entry.halves === 2)?.chance).toBeCloseTo(3 / 50);
    expect(draws.find((entry) => entry.halves === 20)?.chance).toBeCloseTo(3 / 50);
  });

  it('plays the banker against the visible hands', () => {
    deal([card(3), card(10), card(10, 'hearts')]);
    tenhalf.act(CODE, 'E', 'stand');
    tenhalf.act(CODE, 'S', 'stand');
    // A banker holding 3 must catch two likely 10-point players, so it draws.
    expect(decide('N')).toBe('hit');
  });

  it('reads a seat that drew and then stood as holding a hand that was worth standing on', () => {
    deal([card(3), card(5), card(10)]);
    const draws = unseenDraws(view('N'));
    const mass = (hands: ReturnType<typeof finalHands>, test: (halves: number) => boolean): number =>
      [...hands.values()].filter((entry) => test(entry.hand.halves)).reduce((sum, entry) => sum + entry.chance, 0);
    const drew = finalHands([card(2)], false, draws);
    const stood = finalHands([card(2)], true, draws);
    expect(mass(stood, () => true)).toBeCloseTo(1);
    // A seat that stood after its draw does not hold a few points, and one that drew first did not start high.
    expect(mass(stood, (halves) => halves <= 8)).toBeLessThan(mass(drew, (halves) => halves <= 8));
    expect(mass(stood, (halves) => halves >= 10)).toBeGreaterThan(mass(drew, (halves) => halves >= 10));
    expect(mass(drew, (halves) => halves >= 17)).toBeLessThan(mass(finalHands([], false, draws), (halves) => halves >= 17));
  });

  it('bets for the standings: all in when trailing late, minimal when far ahead', () => {
    const late = (mine: number): TenHalfVisibleState => ({
      ...view('E'), hand: 7, totalHands: 8, banker: 'N', chips: { N: 1000, E: mine, S: 1000, P5: 0, P6: 0, P7: 0, P8: 0, W: 0 },
    }) as TenHalfVisibleState;
    tenhalf.startGame(CODE, { N: player('N'), E: player('E'), S: player('S') }, 60_000, 1_000, () => 0);
    expect(tenHalfBet(late(700), seededRandom(1))).toBe(BJ_MAX_BET);
    expect(tenHalfBet(late(1600), seededRandom(1))).toBe(BJ_MIN_BET);
  });

  it('decides fast enough for a full table', () => {
    deal([card(2), card(2, 'hearts'), card(3)]);
    const started = performance.now();
    for (let run = 0; run < 50; run++) tenHalfDecision(view('E'));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

const context = (seed: number): SearchContext => ({
  random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs: () => 1_000, expired: () => false },
});

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe('Ten and a Half search bot', () => {
  it('is registered for the worker pool with the synchronous bot as fallback', () => {
    expect(GAME_BOTS.tenhalf.search?.strategy.exportName).toBe('tenHalfSearch');
    expect(GAME_BOTS.tenhalf.search?.budgetMs).toBeLessThanOrEqual(1500);
  });

  it.each([1, 2])('plays whole matches with legal actions, never mutating its view (seed %i)', (seed) => {
    const random = seededRandom(seed);
    tenhalf.startGame(CODE, { N: player('N'), E: player('E'), S: player('S'), W: player('W') }, 60_000, 1_000, random);
    let step = 0;
    const act = (seat: GameSeat): void => {
      const frozen = deepFreeze(structuredClone(view(seat)));
      const action = tenHalfSearch(frozen, context(seed * 1000 + step++));
      if (action?.type !== 'game-action' || action.request.gameType !== 'tenhalf') throw new Error(`${seat} has no action`);
      const request = action.request.action;
      const result = request.type === 'bet' ? tenhalf.bet(CODE, seat, request.amount, true, 1_500, random)
        : tenhalf.act(CODE, seat, request.type === 'act' ? request.action : 'stand', 2_000);
      expect(result).toEqual({ success: true });
    };
    runSeededGame('tenhalf-search/full', 600, () => tenhalf.getGameState(CODE)?.phase === 'scoring', () => {
      const game = tenhalf.getGameState(CODE)!;
      if (game.phase === 'betting') {
        tenhalf.openBetting(CODE, 1_000);
        for (const seat of tenhalf.pendingBetSeats(game)) act(seat);
      } else act(game.currentTurnSeat);
    });
    expect(tenhalf.getGameState(CODE)?.result).not.toBeNull();
  }, 90_000);
});
