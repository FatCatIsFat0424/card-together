import { describe, expect, it } from 'vitest';
import type { GameSeat, MatchResult, PlayerInfo, PlayerVisibleGameState, VictoryEffectId } from '@shared/types';
import { VICTORY_EFFECTS } from '@shared/constants';
import { gameSeatValues } from '../helpers/game-seat-values';
import { resultWinnerSeats } from '../../../client/src/match-history';
import {
  VICTORY_DURATION_MS, createVictorySchedule, settlementKey, victoryPlays, visibleMatchResult,
} from '../../../client/src/cosmetics/victory-effects/victory-schedule';
import type { VictoryStore } from '../../../client/src/cosmetics/victory-effects/victory-schedule';
import { VICTORY_DESIGNS } from '../../../client/src/cosmetics/victory-effects/victory-designs';
import { seededRandom } from '../../../client/src/cosmetics/victory-effects/victory-particles';

function bridge(declarer: 'N' | 'E' | 'S' | 'W', declarerTeamWins: boolean): MatchResult {
  return {
    gameType: 'bridge', contract: { level: 3, suit: 'nt', declarer }, declarerTeamTricks: declarerTeamWins ? 9 : 7,
    defenderTeamTricks: declarerTeamWins ? 4 : 6, requiredTricks: 9, declarerTeamWins,
  };
}

function player(id: string, victoryEffect?: VictoryEffectId | null, isBot = false): PlayerInfo {
  return { id, username: id, nickname: id, color: '#4a9eff', avatar: 'cat', avatarImage: null, victoryEffect, isBot };
}

describe('result winner seats', () => {
  it('gives the whole winning Bridge partnership the win', () => {
    expect(resultWinnerSeats(bridge('N', true))).toEqual(['N', 'S']);
    expect(resultWinnerSeats(bridge('S', false))).toEqual(['E', 'W']);
    expect(resultWinnerSeats(bridge('E', true))).toEqual(['E', 'W']);
    expect(resultWinnerSeats(bridge('W', false))).toEqual(['N', 'S']);
  });

  it('reads single winners and tied winners for every other game', () => {
    const results: [MatchResult, GameSeat[]][] = [
      [gameSeatValues({ gameType: 'bigtwo', winnerSeat: 'E', dragon: false, cardsLeft: { N: 3, E: 0, S: 5, W: 2 },
        twosLeft: { N: 0, E: 0, S: 1, W: 0 }, scores: { N: 3, E: 0, S: 10, W: 2 } }), ['E']],
      [{ gameType: 'redpoints', points: { N: 80, E: 80, S: 20, W: 20 }, winners: ['N', 'E'] }, ['N', 'E']],
      [{ gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 }, ['W']],
      [{ gameType: 'ninetynine', seats: ['N', 'E', 'S', 'W', 'P5'], winners: ['S', 'P5'], eliminationOrder: ['N'],
        finalTotal: 97 }, ['S', 'P5']],
      [{ gameType: 'sevens', penalties: { N: 0, E: 4, S: 9, W: 0 }, covered: { N: [], E: [], S: [], W: [] },
        winners: ['N', 'W'] }, ['N', 'W']],
      [{ gameType: 'chinesepoker', winners: ['S'] } as unknown as MatchResult, ['S']],
      [{ gameType: 'liarsdeck', winnerSeat: 'S', eliminationOrder: ['N', 'E', 'W'], shots: { N: 1, E: 2, S: 0, W: 3 },
        rounds: 5 }, ['S']],
      [gameSeatValues({ gameType: 'blackjack', seats: ['N', 'P6'], chips: { N: 900, E: 0, S: 0, W: 0, P6: 1100 },
        hands: 10, winners: ['P6'] }), ['P6']],
      [gameSeatValues({ gameType: 'holdem', seats: ['E', 'W'], chips: { N: 0, E: 1000, S: 0, W: 1000 }, hands: 30,
        winners: ['E', 'W'], eliminationOrder: [] }), ['E', 'W']],
    ];
    for (const [result, winners] of results) expect(resultWinnerSeats(result)).toEqual(winners);
  });
});

describe('victory effect scheduling', () => {
  it('plays only for equipped human winners, once per seat', () => {
    const players: Partial<Record<GameSeat, PlayerInfo>> = {
      N: player('north', 'victory-ember'),
      E: player('east'),
      S: player('south', 'victory-frost'),
      W: player('bot', 'victory-dune', true),
      P5: player('legacy', 'victory-unknown' as VictoryEffectId),
    };
    expect(victoryPlays(['N', 'E', 'S', 'W', 'P5', 'N'], (seat) => players[seat])).toEqual([
      { seat: 'N', effect: 'victory-ember', series: 'ember' },
      { seat: 'S', effect: 'victory-frost', series: 'frost' },
    ]);
    expect(victoryPlays(['E'], (seat) => players[seat])).toEqual([]);
    expect(victoryPlays(['P8'], () => undefined)).toEqual([]);
  });

  it('starts each settlement once and resumes rather than replays within it', () => {
    const schedule = createVictorySchedule();
    expect(schedule.claim('room:1', 1000, VICTORY_DURATION_MS)).toBe(0);
    expect(schedule.claim('room:1', 1800, VICTORY_DURATION_MS)).toBe(800);
    expect(schedule.claim('room:1', 1000 + VICTORY_DURATION_MS, VICTORY_DURATION_MS)).toBeNull();
    expect(schedule.claim('room:1', 50_000, VICTORY_DURATION_MS)).toBeNull();
    expect(schedule.claim('room:2', 50_000, VICTORY_DURATION_MS)).toBe(0);
  });

  it('remembers played settlements across reloads through storage', () => {
    const values = new Map<string, string>();
    const store: VictoryStore = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    createVictorySchedule(store).claim('room:1', 1000, VICTORY_DURATION_MS);
    expect(createVictorySchedule(store).claim('room:1', 9000, VICTORY_DURATION_MS)).toBeNull();
    values.set('card-together.victoryEffects', 'not json');
    expect(createVictorySchedule(store).claim('room:1', 9000, VICTORY_DURATION_MS)).toBe(0);
  });

  it('keys a settlement by its room, log, and result', () => {
    const game = {
      gameType: 'liarsdeck', log: [{ type: 'eliminated', seat: 'N', timestamp: 5 }],
      result: { gameType: 'liarsdeck', winnerSeat: 'S', eliminationOrder: ['N'], shots: { N: 1, E: 0, S: 0, W: 0 }, rounds: 2 },
    } as unknown as PlayerVisibleGameState;
    const key = settlementKey('ROOM1', game);
    expect(key).toBe(settlementKey('ROOM1', { ...game }));
    expect(key).not.toBe(settlementKey('ROOM2', game));
    expect(key).not.toBe(settlementKey('ROOM1', { ...game, log: [...game.log, ...game.log] } as PlayerVisibleGameState));
    expect(settlementKey('ROOM1', { ...game, result: null } as PlayerVisibleGameState)).toBeNull();
    const bridgeGame = { gameType: 'bridge', log: [], result: bridge('N', true) } as unknown as PlayerVisibleGameState;
    expect(visibleMatchResult(bridgeGame)).toMatchObject({ gameType: 'bridge', declarerTeamWins: true });
  });
});

describe('victory designs', () => {
  it.each(VICTORY_EFFECTS.map((item) => item.design))('%s fits the effect window with a bounded particle count', (series) => {
    const design = VICTORY_DESIGNS[series];
    for (const density of [1, 0.3]) {
      const particles = design.spawn(seededRandom(series), density);
      expect(particles.length).toBeGreaterThan(0);
      expect(particles.length).toBeLessThanOrEqual(100);
      for (const item of particles) expect(item.delay + item.life).toBeLessThanOrEqual(VICTORY_DURATION_MS / 1000);
    }
    expect(design.wreath().length).toBeGreaterThan(0);
    expect(design.spawn(seededRandom('same'), 1)).toEqual(design.spawn(seededRandom('same'), 1));
  });
});
