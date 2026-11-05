import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, PlayerInfo, Seat } from '@shared/types';
import type { GongZhuGameState, GongZhuVisibleState } from '@shared/games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { cardKey } from '@shared/rules/cards';
import { gongZhuScore, gongZhuSeatMap } from '@shared/rules/gongzhu';
import { getPresentationFrames } from '@shared/game-presentation';
import { matchStanding } from '@shared/rules/match-standing';
import { favoriteTaskFor } from '@shared/constants/daily-rewards';
import { dailyGameProgress, taskProgress } from '../../src/database/daily-rewards';
import { gongZhuFacts } from '@shared/stats/gongzhu';
import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import { defaultGameOptions } from '@shared/games/room-options';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as game from '../../src/managers/games/gongzhu-game';
import { gongZhuAdapter } from '../../src/managers/games/gongzhu-adapter';
import { coherentGongZhuGame, gongZhuGame, isGongZhuResult } from '../../src/managers/games/gongzhu-validation';
import { easyGongZhuAction, getGongZhuBotAction, gongZhuFirstLegalAction } from '../../src/bots/gongzhu-strategy';
import { gameBot } from '../../src/bots/bot-registry';
import type { ObjectValue } from '../../src/runtime/validation-helpers';
import { recordMatch } from '../client/replay-fixtures';
import { isMatchReplay } from '../../src/database/match-replay';
import { validMatch } from '../../src/database/schema';

const CODE = 'GONG01';
const PLAYERS = gongZhuSeatMap<PlayerInfo>((seat) => ({ id: seat, username: seat, nickname: seat,
  color: '#123456', avatar: 'cat', avatarImage: null }));
function state(): GongZhuGameState { return game.getGameState(CODE)!; }
function visible(seat: Seat = state().currentTurnSeat): GongZhuVisibleState { return game.getPlayerVisibleState(CODE, seat)!; }
function seeded(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function act(card: Card): void { expect(game.playCard(CODE, state().currentTurnSeat, card).success).toBe(true); }
function validate(stored: GongZhuGameState = state()): void {
  const clone = JSON.parse(JSON.stringify(stored)) as GongZhuGameState;
  expect(gongZhuGame(clone as unknown as ObjectValue, () => true)).toBe(true);
  expect(coherentGongZhuGame(clone)).toBe(true);
}

afterEach(() => { game.restoreGames([]); vi.restoreAllMocks(); });

describe('Gong Zhu runtime', () => {
  it('starts exactly four compass seats and hides all opponents’ hands and legal options', () => {
    expect(gongZhuAdapter.start({ roomCode: CODE, players: { N: PLAYERS.N }, settings: DEFAULT_TIME_CONTROL,
      options: defaultGameOptions() }).success).toBe(false);
    game.startGame(CODE, PLAYERS, createDeck());
    validate();
    const acting = state().currentTurnSeat;
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      const view = visible(seat);
      expect(view.myHand).toEqual(state().hands[seat]);
      expect(view).not.toHaveProperty('hands');
      expect(view).not.toHaveProperty('observedHands');
      expect(view.validCards).toHaveLength(seat === acting ? 1 : 0);
      expect(view.handCounts).toEqual({ N: 13, E: 13, S: 13, W: 13 });
    }
    const view = gongZhuAdapter.withObserverView(visible(), state(), 'spectator');
    expect(view.observedHands).toEqual(state().hands);
    expect(getGongZhuBotAction(view)).toBeNull();
    expect(gongZhuAdapter.getPlayerVisibleState(CODE, 'P5')).toBeNull();
  });

  it('rejects out-of-turn, missing-card, opening-lead and follow-suit violations without mutation', () => {
    const deck = createDeck();
    const mixed = SEAT_ORDER_CLOCKWISE.flatMap((_seat, index) => deck.filter((_card, offset) => offset % 4 === index));
    game.startGame(CODE, PLAYERS, mixed);
    const before = structuredClone(state());
    const held = visible().myHand.find((card) => card.suit !== 'clubs' || card.rank !== 2)!;
    expect(game.playCard(CODE, state().currentTurnSeat, held).success).toBe(false);
    expect(game.playCard(CODE, state().currentTurnSeat === 'N' ? 'E' : 'N', held).success).toBe(false);
    expect(state()).toEqual(before);
    act(visible().validCards[0]);
    const legal = visible().validCards;
    const wrong = visible().myHand.find((card) => !legal.some((entry) => cardKey(entry) === cardKey(card)));
    expect(wrong).toBeDefined();
    const snapshot = structuredClone(state());
    expect(game.playCard(CODE, state().currentTurnSeat, wrong!).success).toBe(false);
    expect(state()).toEqual(snapshot);
    expect(game.playCard(CODE, state().currentTurnSeat, { suit: 'clubs', rank: 2 }).success).toBe(false);
    validate();
  });

  it.each([1, 17, 1009, 99181])('plays four complete hands with legal visible-only bots and resumable state (seed %i)', (seed) => {
    const random = seeded(seed);
    vi.spyOn(Math, 'random').mockImplementation(random);
    game.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random));
    let steps = 0;
    while (!state().result) {
      const view = structuredClone(visible());
      const strategy = steps % 2 ? getGongZhuBotAction(view) : easyGongZhuAction(view, random);
      expect(strategy?.type).toBe('game-action');
      if (strategy?.type !== 'game-action' || strategy.request.gameType !== 'gongzhu') throw new Error('Expected Gong Zhu action.');
      const timeout = gameBot('gongzhu').turnTimeout?.(view, { isBot: false, strategy: () => null });
      expect(timeout).toEqual(gongZhuFirstLegalAction(view));
      const before = structuredClone(view);
      const poisoned = { ...view, observedHands: gongZhuSeatMap(() => [{ suit: 'spades', rank: 14 } as Card]) };
      expect(getGongZhuBotAction(poisoned)).toEqual(getGongZhuBotAction(view));
      expect(view).toEqual(before);
      act(strategy.request.action.card);
      validate();
      if (++steps === 73) {
        const saved = JSON.parse(JSON.stringify(game.exportGames())) as GongZhuGameState[];
        game.abortGame(CODE);
        game.restoreGames(saved);
        validate();
      }
      expect(steps).toBeLessThanOrEqual(208);
    }
    expect(steps).toBe(208);
    const result = state().result!;
    expect(result.handResults).toHaveLength(4);
    expect(isGongZhuResult(result)).toBe(true);
    for (const hand of result.handResults) {
      expect(SEAT_ORDER_CLOCKWISE.flatMap((seat) => hand.captures[seat])).toHaveLength(52);
      for (const seat of SEAT_ORDER_CLOCKWISE) expect(hand.scores[seat]).toBe(gongZhuScore(hand.captures[seat]));
    }
    for (const seat of SEAT_ORDER_CLOCKWISE) {
      expect(result.scores[seat]).toBe(result.handResults.reduce((sum, hand) => sum + hand.scores[seat], 0));
      expect(matchStanding(result, seat)?.won).toBe(result.winners.includes(seat));
      expect(gongZhuFacts(result, seat).values.topScore).toBe(result.scores[seat]);
    }
    expect(game.playCard(CODE, state().currentTurnSeat, { suit: 'clubs', rank: 2 }).success).toBe(false);
  });

  it('presents the last trick and settlement before the new deal and refills the hand clock', () => {
    game.startGame(CODE, PLAYERS, createDeck());
    for (let index = 0; index < 51; index++) act(visible().validCards[0]);
    const logStart = state().log.length;
    const clockAdvance = gongZhuAdapter.clockBeforeAction!(state(), state().currentTurnSeat);
    act(visible().validCards[0]);
    expect(state().hand).toBe(2);
    expect(clockAdvance(state())).toEqual({ redealt: true });
    expect(state().log.slice(logStart).map((entry) => entry.type)).toEqual(['play', 'trick', 'settle', 'deal']);
    const frames = getPresentationFrames({ ...visible(), presentation: { id: 'p', startedAt: Date.now(), logStart, timingVersion: 3 } });
    expect(frames.map((frame) => frame.kind)).toEqual(['play', 'trick', 'settle', 'deal']);
    expect(visible().validCards).toEqual([{ suit: 'clubs', rank: 2 }]);
    validate();
  });

  it('rejects corrupt persisted cards, turn, captures, logs, summaries and results', () => {
    game.startGame(CODE, PLAYERS, createDeck());
    for (let index = 0; index < 60; index++) act(visible().validCards[0]);
    const mutations: ((copy: GongZhuGameState) => void)[] = [
      (copy) => { copy.hands.N.push(copy.hands.N[0]); },
      (copy) => { copy.currentTurnSeat = copy.currentTurnSeat === 'N' ? 'E' : 'N'; },
      (copy) => { copy.captures.N.push({ suit: 'clubs', rank: 2 }); },
      (copy) => { copy.log.splice(3, 1); },
      (copy) => { copy.scores.N += 1; },
      (copy) => { copy.handResults[0].captures.N.push({ suit: 'clubs', rank: 2 }); },
      (copy) => { copy.phase = 'scoring'; },
      (copy) => { copy.tricks.reverse(); },
    ];
    // At least two current tricks are needed for reversing them to be a real corruption.
    expect(state().tricks).toHaveLength(2);
    for (const mutate of mutations) {
      const copy = structuredClone(state()); mutate(copy);
      expect(gongZhuGame(copy as unknown as ObjectValue, () => true) && coherentGongZhuGame(copy)).toBe(false);
    }
    while (!state().result) act(visible().validCards[0]);
    const result = structuredClone(state().result!);
    result.scores.N += 1;
    expect(isGongZhuResult(result)).toBe(false);
    expect(isGongZhuResult({ ...state().result, winners: [] })).toBe(false);
    expect(isGongZhuResult({ ...state().result, hands: 3 })).toBe(false);
    expect(isGongZhuResult({ ...state().result, handResults: [null, null, null, null] })).toBe(false);
  });


  it('shares first place on tied totals and counts special records and daily completion', () => {
    const handResults = SEAT_ORDER_CLOCKWISE.map((winner, index) => ({ hand: index + 1,
      captures: gongZhuSeatMap((seat) => seat === winner ? createDeck() : []),
      scores: gongZhuSeatMap((seat) => seat === winner ? 1000 : 0) }));
    const result = { gameType: 'gongzhu' as const, hands: 4, handResults,
      scores: gongZhuSeatMap(() => 1000), winners: [...SEAT_ORDER_CLOCKWISE] };
    expect(isGongZhuResult(result)).toBe(true);
    expect(matchStanding(result, 'N')).toMatchObject({ won: true, tied: true, rank: 1, score: 1000, players: 4 });
    expect(matchStanding(result, 'P5')).toBeNull();
    expect(gongZhuFacts(result, 'N')).toMatchObject({ counts: { allHearts: 1, grandSlams: 1 },
      values: { topScore: 1000, bestHand: 1000 } });
    expect(favoriteTaskFor('gongzhu')).toBe('play-gongzhu');
    const daily = dailyGameProgress(undefined, { gameType: 'gongzhu', players: PLAYERS, result }, 'N',
      1_800_000_000_000, () => ({}));
    expect(taskProgress(daily, 'play-gongzhu')).toBe(1);
    expect(daily.wins).toBe(1);
  });

  it('records a complete replay through the common facade with final private views and accepted match storage', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const { replay, match, snapshots } = recordMatch('gongzhu', CODE);
    expect(isMatchReplay(replay, match.result, match.finishedAt)).toBe(true);
    expect(validMatch(match)).toBe(true);
    expect(snapshots).toHaveLength(209);
    expect(snapshots[0]).toHaveProperty('observedHands');
    const last = snapshots.at(-1);
    expect(last?.gameType).toBe('gongzhu');
    expect(last?.result).toEqual(match.result);
    expect(replay.steps).toHaveLength(208);
  });
});
