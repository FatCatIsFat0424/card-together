import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, ChinesePokerGameState, ChinesePokerLogEntry, PlayerInfo, Seat } from '@shared/types';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { createDeck } from '../../src/engine/deck';
import * as chinesepoker from '../../src/managers/games/chinesepoker-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'ABC123';
const ARRANGE_MS = 60_000;

function player(id: string, isBot = false): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null, isBot };
}

const PLAYERS: Record<Seat, PlayerInfo> = {
  N: player('north'), E: player('east'), S: player('south'), W: player('west', true),
};

/** Interleaves 13-card hands in dealing order (N, E, S, W round robin). */
function deckFor(hands: Record<Seat, Card[]>): Card[] {
  return Array.from({ length: 52 }, (_, index) => hands[SEATS[index % 4]][Math.floor(index / 4)]);
}

/** N holds every ace, king and queen plus the jack of spades, so it shoots at least one opponent. */
function dominantDeck(): Card[] {
  const strong = (card: Card): boolean => card.rank >= 12 || (card.rank === 11 && card.suit === 'spades');
  const rest = createDeck().filter((card) => !strong(card));
  return deckFor({
    N: createDeck().filter(strong),
    E: rest.filter((_, index) => index % 3 === 0),
    S: rest.filter((_, index) => index % 3 === 1),
    W: rest.filter((_, index) => index % 3 === 2),
  });
}

function game(): ChinesePokerGameState {
  const state = chinesepoker.getGameState(CODE);
  if (!state) throw new Error('Expected a Chinese Poker game');
  return state;
}

function submit(seat: Seat, automatic = false): ReturnType<typeof chinesepoker.arrange> {
  return chinesepoker.arrange(CODE, seat, cpGreedyArrangement(game().hands[seat]), automatic);
}

describe('Chinese Poker gameplay', () => {
  beforeEach(() => chinesepoker.restoreGames([]));

  it('should deal 13 sorted cards each and wait for every seat', () => {
    const before = Date.now();
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    const state = game();
    expect(state).toMatchObject({ phase: 'arranging', autoArranged: [], log: [], result: null });
    expect(state.arrangeDeadline).toBeGreaterThanOrEqual(before + ARRANGE_MS);
    for (const seat of SEATS) {
      expect(state.hands[seat]).toHaveLength(13);
      expect(state.arrangements[seat]).toBeNull();
      const ranks = state.hands[seat].map((card) => card.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    }
    expect(chinesepoker.pendingSeats(state)).toEqual(SEATS);
  });

  it('should accept submissions in any order and score after the last one', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS, dominantDeck());
    for (const seat of ['S', 'W', 'N'] as const) {
      expect(submit(seat)).toEqual({ success: true });
      expect(game().phase).toBe('arranging');
    }
    expect(chinesepoker.pendingSeats(game())).toEqual(['E']);
    expect(submit('E')).toEqual({ success: true });

    const { result, log } = game();
    expect(game().phase).toBe('scoring');
    expect(result?.arrangements.N).toEqual(game().arrangements.N);
    const timestamp = log[log.length - 1].timestamp;
    const shoots = (result?.matchups ?? []).filter((matchup) => matchup.shooter).map(({ seats, shooter }) => ({
      type: 'shoot', seat: shooter, target: shooter === seats[0] ? seats[1] : seats[0], timestamp,
    }));
    expect(shoots.length).toBeGreaterThan(0);
    const expected: ChinesePokerLogEntry[] = [
      { type: 'submit', seat: 'E', timestamp },
      { type: 'reveal', row: 'front', timestamp },
      { type: 'reveal', row: 'middle', timestamp },
      { type: 'reveal', row: 'back', timestamp },
      ...shoots as ChinesePokerLogEntry[],
      ...(result?.homeRun ? [{ type: 'homerun', seat: result.homeRun, timestamp } as const] : []),
    ];
    expect(log.slice(3)).toEqual(expected);
    expect(log.slice(0, 3).map((entry) => entry.type === 'submit' && entry.seat)).toEqual(['S', 'W', 'N']);
    expect(submit('N')).toEqual({ success: false, reason: 'Not in arranging phase' });
  });

  it('should reject duplicate, invalid and foreign submissions', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    const hand = game().hands.N;
    const valid = cpGreedyArrangement(hand);
    const foreign = { ...valid, front: [...valid.front.slice(0, 2), game().hands.E[0]] };
    const short = { ...valid, front: valid.front.slice(0, 2) };
    expect(chinesepoker.arrange(CODE, 'N', foreign, false)).toEqual({ success: false, reason: 'Invalid arrangement' });
    expect(chinesepoker.arrange(CODE, 'N', short, false)).toEqual({ success: false, reason: 'Invalid arrangement' });
    expect(chinesepoker.arrange('NOPE00', 'N', valid, false)).toEqual({ success: false, reason: 'Game not found' });
    expect(chinesepoker.arrange(CODE, 'N', valid, false)).toEqual({ success: true });
    expect(chinesepoker.arrange(CODE, 'N', valid, false)).toEqual({ success: false, reason: 'Already submitted' });
    expect(game().log).toHaveLength(1);
  });

  it('should store a copy that later caller edits cannot change', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    const arrangement = cpGreedyArrangement(game().hands.N);
    const snapshot = structuredClone(arrangement);
    expect(chinesepoker.arrange(CODE, 'N', arrangement, false)).toEqual({ success: true });
    arrangement.front.reverse();
    expect(game().arrangements.N).toEqual(snapshot);
  });

  it('should close manual submissions at the deadline but accept automatic ones', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    const deadline = game().arrangeDeadline;
    const arrangement = cpGreedyArrangement(game().hands.N);
    expect(chinesepoker.arrange(CODE, 'N', arrangement, false, deadline - 1)).toEqual({ success: true });
    const late = cpGreedyArrangement(game().hands.E);
    expect(chinesepoker.arrange(CODE, 'E', late, false, deadline))
      .toEqual({ success: false, reason: 'The arrangement time is over' });
    expect(chinesepoker.arrange(CODE, 'S', cpGreedyArrangement(game().hands.S), true, deadline + 5))
      .toEqual({ success: true });
    expect(chinesepoker.arrange(CODE, 'E', late, true, deadline + 5)).toEqual({ success: true });
    // W is a bot, so its automatic arrangement is not reported as a timeout.
    expect(chinesepoker.arrange(CODE, 'W', cpGreedyArrangement(game().hands.W), true, deadline + 5))
      .toEqual({ success: true });
    expect(game().autoArranged).toEqual(['E', 'S']);
    expect(game().phase).toBe('scoring');
  });

  it('should hide other seats\' arrangements until scoring', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    expect(submit('N')).toEqual({ success: true });
    const visible = chinesepoker.getPlayerVisibleState(CODE, 'E');
    expect(visible).toMatchObject({
      gameType: 'chinesepoker', phase: 'arranging', mySeat: 'E', myArrangement: null, result: null,
      submitted: { N: true, E: false, S: false, W: false }, arrangeDeadline: game().arrangeDeadline,
    });
    const serialized = JSON.stringify(visible);
    for (const card of game().hands.N) expect(serialized).not.toContain(JSON.stringify(card));
    expect(chinesepoker.getPlayerVisibleState(CODE, 'N')?.myArrangement).toEqual(game().arrangements.N);

    for (const seat of ['E', 'S', 'W'] as const) expect(submit(seat)).toEqual({ success: true });
    expect(chinesepoker.getPlayerVisibleState(CODE, 'E')?.result?.arrangements.N).toEqual(game().arrangements.N);
    expect(chinesepoker.getPlayerVisibleState('NOPE00', 'E')).toBeNull();
  });

  it('should export and restore games mid-arrangement', () => {
    chinesepoker.startGame(CODE, PLAYERS, ARRANGE_MS);
    expect(submit('N')).toEqual({ success: true });
    const saved = structuredClone(chinesepoker.exportGames());
    chinesepoker.abortGame(CODE);
    expect(chinesepoker.getGameState(CODE)).toBeNull();

    chinesepoker.restoreGames(saved);
    expect(game()).toEqual(saved[0]);
    for (const seat of ['E', 'S', 'W'] as const) expect(submit(seat)).toEqual({ success: true });
    expect(game().result?.gameType).toBe('chinesepoker');
  });
});
