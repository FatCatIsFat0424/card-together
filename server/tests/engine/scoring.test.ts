import { describe, it, expect } from 'vitest';
import { getSeatTeam, calculateGameResult } from '../../src/engine/scoring';
import type { Contract } from '@shared/types';

describe('scoring engine', () => {
  it('maps every seat to its partnership', () => {
    expect(['N', 'E', 'S', 'W'].map((seat) => getSeatTeam(seat as Contract['declarer'])))
      .toEqual(['NS', 'EW', 'NS', 'EW']);
  });

  it.each<{ name: string; contract: Contract; ew: number; ns: number; tricks: number; required: number; wins: boolean }>([
    { name: 'North exact no trump', contract: { level: 3, suit: 'nt', declarer: 'N' }, ew: 4, ns: 9, tricks: 9, required: 9, wins: true },
    { name: 'East minimum contract', contract: { level: 1, suit: 'spades', declarer: 'E' }, ew: 7, ns: 6, tricks: 7, required: 7, wins: true },
    { name: 'South one below grand slam', contract: { level: 7, suit: 'hearts', declarer: 'S' }, ew: 1, ns: 12, tricks: 12, required: 13, wins: false },
    { name: 'West exact four level', contract: { level: 4, suit: 'clubs', declarer: 'W' }, ew: 10, ns: 3, tricks: 10, required: 10, wins: true },
    { name: 'North grand slam', contract: { level: 7, suit: 'nt', declarer: 'N' }, ew: 0, ns: 13, tricks: 13, required: 13, wins: true },
    { name: 'North overtrick', contract: { level: 3, suit: 'nt', declarer: 'N' }, ew: 3, ns: 10, tricks: 10, required: 9, wins: true },
  ])('settles $name', ({ contract, ew, ns, tricks, required, wins }) => {
    expect(calculateGameResult(contract, ew, ns)).toMatchObject({
      contract, declarerTeamWins: wins, declarerTeamTricks: tricks,
      defenderTeamTricks: 13 - tricks, requiredTricks: required,
    });
  });
});
