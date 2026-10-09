import { describe, expect, it } from 'vitest';
import type { BigTwoLogEntry, Card, NinetyNineLogEntry, RedPointsLogEntry, SevensLogEntry } from '@shared/types';
import { deriveRoundHistory } from '../../../client/src/games/round-history';

const card: Card = { suit: 'hearts', rank: 4 };
const captured: Card = { suit: 'diamonds', rank: 6 };

function bigTwo(log: BigTwoLogEntry[], phase: 'playing' | 'scoring' = 'playing'):
ReturnType<typeof deriveRoundHistory> {
  return deriveRoundHistory({ gameType: 'bigtwo', phase, log });
}

function redPoints(log: RedPointsLogEntry[], pendingFlip: Card | null = null):
ReturnType<typeof deriveRoundHistory> {
  return deriveRoundHistory({ gameType: 'redpoints', phase: 'playing', log,
    pendingFlip, currentTurnSeat: log.at(-1)?.seat ?? 'N' });
}

describe('round history', () => {
  it('should preserve all rounds and passes independently of identical timestamps', () => {
    const log: BigTwoLogEntry[] = [
      { type: 'play', seat: 'N', cards: [card], comboType: 'single', timestamp: 1 },
      { type: 'pass', seat: 'W', timestamp: 1 },
      { type: 'round_end', leaderSeat: 'N', timestamp: 1 },
      { type: 'play', seat: 'N', cards: [captured], comboType: 'single', timestamp: 1 },
    ];
    const before = structuredClone(log);
    const rounds = bigTwo(log);
    expect(rounds.map((round) => round.complete)).toEqual([true, false]);
    expect(rounds[0].actions.map((action) => action.kind)).toEqual(['play', 'pass', 'round_end']);
    expect(rounds[0].actions[2].seat).toBe('N');
    expect(bigTwo(structuredClone(log))).toEqual(rounds);
    expect(log).toEqual(before);
    expect(bigTwo(log, 'scoring').map((round) => round.complete)).toEqual([true, true]);
  });

  it('should include dragon wins and avoid fabricating empty rounds', () => {
    expect(bigTwo([])).toEqual([]);
    expect(bigTwo([{ type: 'dragon', seat: 'E', timestamp: 0 }], 'scoring'))
      .toEqual([{ number: 1, complete: true,
        actions: [{ kind: 'dragon', seat: 'E', cards: [] }] }]);
    expect(bigTwo([{ type: 'round_end', leaderSeat: 'S', timestamp: 0 }])).toHaveLength(1);
  });

  it('should group play and flip with capture points and retain pending public flips', () => {
    const play: RedPointsLogEntry = { type: 'play', seat: 'N', card, captured, timestamp: 0 };
    const flip: RedPointsLogEntry = { type: 'flip', seat: 'N', card: captured, captured: null, timestamp: 0 };
    const pending = redPoints([play], captured);
    expect(pending[0].complete).toBe(false);
    expect(pending[0].actions[0]).toMatchObject({ points: 10, captured });
    expect(pending[0].actions[1]).toMatchObject({ pending: true, cards: [captured] });
    const completed = redPoints([play, flip, { ...play, seat: 'E' }]);
    expect(completed.map((round) => round.complete)).toEqual([true, false]);
    expect(completed[0].actions[1]).toMatchObject({ points: 0, captured: null });
    expect(deriveRoundHistory({ gameType: 'redpoints', phase: 'playing', log: [play],
      pendingFlip: null, currentTurnSeat: 'E' })[0].complete).toBe(true);
    expect(deriveRoundHistory({ gameType: 'redpoints', phase: 'scoring', log: [play],
      pendingFlip: null, currentTurnSeat: 'N' })[0].complete).toBe(true);
  });

  it('should group 99 eliminations with each play and derive total changes on reconnect', () => {
    const log: NinetyNineLogEntry[] = [
      { type: 'eliminated', seat: 'E', timestamp: 0 },
      { type: 'play', seat: 'N', card, choice: null, target: 'S', total: 0, timestamp: 1 },
      { type: 'eliminated', seat: 'S', timestamp: 1 },
      { type: 'eliminated', seat: 'W', timestamp: 1 },
      { type: 'play', seat: 'N', card: { suit: 'clubs', rank: 10 }, choice: 'plus', target: null,
        total: 10, timestamp: 2 },
    ];
    const input = { gameType: 'ninetynine' as const, phase: 'scoring' as const, log };
    const rounds = deriveRoundHistory(input);
    expect(rounds).toHaveLength(3);
    expect(rounds[0].actions[0].kind).toBe('eliminated');
    expect(rounds[1].actions.map((action) => action.kind)).toEqual(['play', 'eliminated', 'eliminated']);
    expect(rounds[1].actions[0]).toMatchObject({ previousTotal: 0, total: 0, target: 'S' });
    expect(rounds[2].actions[0]).toMatchObject({ previousTotal: 0, total: 10, choice: 'plus' });
    expect(rounds.every((round) => round.complete)).toBe(true);
    expect(deriveRoundHistory(structuredClone(input))).toEqual(rounds);
  });

  it('should group Sevens actions by rotation and never show covered cards', () => {
    const log: SevensLogEntry[] = [
      { type: 'play', seat: 'N', card: { suit: 'spades', rank: 7 }, timestamp: 1 },
      { type: 'cover', seat: 'W', timestamp: 2 },
      { type: 'play', seat: 'S', card: { suit: 'spades', rank: 8 }, timestamp: 3 },
      { type: 'play', seat: 'E', card: { suit: 'spades', rank: 6 }, timestamp: 4 },
      { type: 'cover', seat: 'N', timestamp: 5 },
    ];
    const rounds = deriveRoundHistory({ gameType: 'sevens', phase: 'playing', log });
    expect(rounds.map((round) => [round.number, round.complete, round.actions.length])).toEqual([[1, true, 4], [2, false, 1]]);
    expect(rounds[0].actions[1]).toEqual({ kind: 'cover', seat: 'W', cards: [] });
    expect(deriveRoundHistory({ gameType: 'chinesepoker', phase: 'scoring', log: [] })).toEqual([]);
  });
});
