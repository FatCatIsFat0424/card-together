import { describe, expect, it } from 'vitest';
import type { BigTwoLogEntry, BigTwoVisibleState, Card, PlayerInfo, Seat } from '@shared/types';
import { canPlay, identifyCombo } from '@shared/rules/bigtwo';
import { getBigTwoBotAction } from '../../src/bots/bigtwo-strategy';
import { cardIndex, fastCombo, readKnowledge, unseenBeatChecker } from '../../src/bots/bigtwo-model';
import { bigTwoSearch } from '../../src/bots/bigtwo-search';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { createDeck, shuffleDeck } from '../../src/engine/deck';
import * as bigtwo from '../../src/managers/games/bigtwo-game';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'BTS123';
const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const player = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const PLAYERS = { N: player('north'), E: player('east'), S: player('south'), W: player('west') };
const twos = (['clubs', 'diamonds', 'hearts', 'spades'] as const).map((suit) => card(suit, 2));

function state(myHand: Card[], overrides: Partial<BigTwoVisibleState> = {}): BigTwoVisibleState {
  return { gameType: 'bigtwo', phase: 'playing', mySeat: 'N', myHand,
    handCounts: { N: myHand.length, E: 5, S: 5, W: 5 }, currentTurnSeat: 'N',
    lastPlay: null, lockedSeats: [], firstPlay: false, log: [], result: null, revealedHands: null,
    ...overrides };
}

const play = (seat: Seat, cards: Card[]): BigTwoLogEntry =>
  ({ type: 'play', seat, cards, comboType: identifyCombo(cards)!.type, timestamp: 0 });

const DECK = (['clubs', 'diamonds', 'hearts', 'spades'] as const)
  .flatMap((suit) => ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const).map((rank) => card(suit, rank)));
const same = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** A consistent view: every card outside the hand and `unseen` was played earlier as an E single. */
function withUnseen(visible: BigTwoVisibleState, unseen: readonly Card[]): BigTwoVisibleState {
  const shown = DECK.filter((entry) => !visible.myHand.some((own) => same(own, entry)) && !unseen.some((other) => same(other, entry))
    && !visible.log.some((logged) => logged.type === 'play' && logged.cards.some((played) => same(played, entry)))
    && !(visible.lastPlay?.cards ?? []).some((played) => same(played, entry)));
  return { ...visible, log: [...shown.map((entry) => play('E', [entry])), ...visible.log] };
}

/** A budget that runs out after `checks` look-ups, so a search's result depends only on its seed. */
function checkedBudget(checks: number): SearchContext['budget'] {
  let used = 0;
  return { maxDepth: undefined, timeLeftMs: () => 1000, expired: () => ++used > checks };
}

describe('Big Two knowledge', () => {
  it('treats an ace as unbeatable once every 2 has been played', () => {
    const log = [play('E', [twos[0]]), play('S', [twos[1]]), play('W', [twos[2]]), play('E', [twos[3]])];
    const visible = state([card('spades', 14), card('clubs', 4)], { log });
    const knowledge = readKnowledge(visible);
    // Four-card hands rule out bombs, which need five cards.
    const beaten = unseenBeatChecker(knowledge.unseen, 4);
    const ace = fastCombo(identifyCombo([card('spades', 14)])!);
    expect(knowledge.unseen).not.toContain(cardIndex(twos[3]));
    expect(beaten(ace)).toBe(false);
    expect(beaten(fastCombo(identifyCombo([card('clubs', 4)])!))).toBe(true);
    expect(unseenBeatChecker(readKnowledge(state([card('spades', 14)])).unseen, 4)(ace)).toBe(true);
    expect(unseenBeatChecker(knowledge.unseen, 5)(ace)).toBe(true);
  });

  it('reads a pass on a single as a ceiling until the seat shows a higher single', () => {
    const queen = play('E', [card('diamonds', 12)]);
    const passed: BigTwoLogEntry = { type: 'pass', seat: 'W', timestamp: 0 };
    const roundEnd: BigTwoLogEntry = { type: 'round_end', leaderSeat: 'E', timestamp: 0 };
    const knowledge = readKnowledge(state([card('clubs', 4)], { log: [queen, passed, roundEnd] }));
    expect(knowledge.singleCeiling[3]).toBe(cardIndex(card('diamonds', 12)));
    expect(knowledge.passes).toEqual([expect.objectContaining({ seat: 3, playedLater: [] })]);
    const shown = readKnowledge(state([card('clubs', 4)], { log: [queen, passed, roundEnd, play('W', [card('spades', 13)])] }));
    expect(shown.singleCeiling[3]).toBe(51);
  });
});

describe('Big Two heuristic endgame', () => {
  it('leads a pair before its top single while an opponent holds one card', () => {
    const visible = state([card('spades', 2), card('clubs', 4), card('diamonds', 4), card('hearts', 7)], {
      handCounts: { N: 4, E: 6, S: 6, W: 1 },
    });
    for (const sample of [0, 0.5, 0.9999]) {
      expect(getBigTwoBotAction(visible, () => sample)).toEqual({ type: 'bigtwo-play', cards: [card('clubs', 4), card('diamonds', 4)] });
    }
  });

  it('leads a single the one-card seat already declined to beat', () => {
    // W passed on the 9 of diamonds and has not played since, so a 10 is as safe as the 2.
    const log = [play('E', [card('diamonds', 9)]), { type: 'pass', seat: 'W', timestamp: 0 } as const];
    const visible = state([card('spades', 2), card('clubs', 10), card('hearts', 5)], {
      handCounts: { N: 3, E: 6, S: 6, W: 1 }, log,
    });
    for (const sample of [0, 0.9999]) {
      const action = getBigTwoBotAction(visible, () => sample);
      if (action?.type !== 'bigtwo-play') throw new Error('Expected a lead');
      expect(action.cards[0].rank).not.toBe(5);
    }
  });
});

describe('Big Two search', () => {
  it('cashes its unbeatable singles before the low card', () => {
    const unseen = [card('clubs', 14), card('diamonds', 14), card('clubs', 13), card('diamonds', 13), card('hearts', 13),
      card('spades', 13), card('clubs', 12), card('diamonds', 12), card('hearts', 12)];
    const visible = withUnseen(state([card('spades', 2), card('hearts', 14), card('clubs', 3)], {
      handCounts: { N: 3, E: 3, S: 3, W: 3 },
    }), unseen);
    const original = structuredClone(visible);
    for (const seed of [1, 2, 3]) {
      const action = bigTwoSearch(visible, { random: seededRandom(seed), budget: checkedBudget(4_000) });
      if (action?.type !== 'bigtwo-play') throw new Error('Expected a lead');
      expect(action.cards[0].rank).not.toBe(3);
    }
    expect(visible).toEqual(original);
  });

  it('gives the same answer for the same seed and falls back to the heuristic without time', () => {
    const hand = [card('clubs', 4), card('hearts', 4), card('diamonds', 7), card('spades', 8), card('hearts', 11)];
    const unseen = DECK.filter((entry) => !hand.some((own) => same(own, entry)) && !same(entry, card('clubs', 3))).slice(0, 15);
    const visible = withUnseen(state(hand, {
      lastPlay: { seat: 'W', cards: [card('clubs', 3)], comboType: 'single' }, log: [play('W', [card('clubs', 3)])],
    }), unseen);
    const first = bigTwoSearch(visible, { random: seededRandom(9), budget: checkedBudget(500) });
    expect(bigTwoSearch(visible, { random: seededRandom(9), budget: checkedBudget(500) })).toEqual(first);
    const expired = { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true };
    const action = bigTwoSearch(visible, { random: () => 0, budget: expired });
    expect(action).toEqual(getBigTwoBotAction(visible, () => 0));
  });

  it('stays within a wall-clock budget', () => {
    const deck = shuffleDeck(createDeck(), seededRandom(5));
    const visible = state(deck.slice(0, 13), { handCounts: { N: 13, E: 13, S: 13, W: 13 } });
    const deadline = performance.now() + 150;
    const started = performance.now();
    bigTwoSearch(visible, { random: seededRandom(1), budget: {
      maxDepth: undefined, timeLeftMs: () => Math.max(0, deadline - performance.now()), expired: () => performance.now() >= deadline,
    } });
    expect(performance.now() - started).toBeLessThan(400);
  });

  it.each([3, 17, 29])('plays legal, non-mutating moves through seeded games with seed %i', (seed) => {
    const random = seededRandom(seed);
    bigtwo.restoreGames([]);
    bigtwo.startGame(CODE, PLAYERS, shuffleDeck(createDeck(), random));
    runSeededGame(`bigtwo/${seed}`, 400, () => bigtwo.getGameState(CODE)?.phase === 'scoring', (index) => {
      const game = bigtwo.getGameState(CODE)!;
      const seat = game.currentTurnSeat;
      const visible = bigtwo.getPlayerVisibleState(CODE, seat)!;
      const original = structuredClone(visible);
      const action = index % 2 === 0
        ? bigTwoSearch(visible, { random, budget: checkedBudget(200) })
        : getBigTwoBotAction(visible, random);
      expect(visible).toEqual(original);
      if (action?.type === 'bigtwo-play') {
        const previous = game.lastPlay ? identifyCombo(game.lastPlay.cards) : null;
        expect(canPlay(action.cards, previous, game.firstPlay)).toBe(true);
        expect(bigtwo.play(CODE, seat, action.cards).success).toBe(true);
      } else {
        expect(action).toEqual({ type: 'bigtwo-pass' });
        expect(bigtwo.pass(CODE, seat).success).toBe(true);
      }
    });
    expect(bigtwo.getGameState(CODE)?.result).not.toBeNull();
    bigtwo.restoreGames([]);
  });
});
