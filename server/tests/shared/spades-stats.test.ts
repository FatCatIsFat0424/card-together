import { describe, expect, it } from 'vitest';
import type { SpadesMatchResult } from '@shared/games/spades/types';
import { scoreSpadesHand } from '@shared/rules/spades';
import { matchStanding } from '@shared/rules/match-standing';
import { favoriteTaskFor } from '@shared/constants/daily-rewards';
import { spadesFacts } from '@shared/stats/spades';
import { isSpadesResult } from '../../src/managers/games/spades-validation';
import { dailyGameProgress, taskProgress } from '../../src/database/daily-rewards';

function result(): SpadesMatchResult {
  const hand = scoreSpadesHand({ N: 0, S: 4, E: 3, W: 3 }, { N: 0, S: 5, E: 4, W: 4 }, { NS: 0, EW: 0 });
  return { gameType: 'spades', scores: { NS: 564, EW: 248 }, bags: { NS: 4, EW: 8 },
    hands: Array.from({ length: 4 }, (_, index) => ({ ...hand, teams: {
      NS: { ...hand.teams.NS, bags: index + 1 }, EW: { ...hand.teams.EW, bags: (index + 1) * 2 },
    } })), winners: ['N', 'S'] };
}
describe('Spades result consumers', () => {
  it('counts a partnership win for both partners and tracks successful individual nils', () => {
    const finished = result();
    expect(isSpadesResult(finished)).toBe(true);
    for (const seat of ['N', 'S'] as const) expect(matchStanding(finished, seat))
      .toMatchObject({ won: true, side: 'NS', score: 564, role: null, tied: false });
    expect(matchStanding(finished, 'E')).toMatchObject({ won: false, side: 'EW', score: 248 });
    expect(matchStanding(finished, 'P5')).toBeNull();
    expect(spadesFacts(finished, 'N')).toMatchObject({ counts: { nilsMade: 4 }, values: { topScore: 564 } });
    expect(spadesFacts(finished, 'S')).toMatchObject({ counts: {}, values: { topScore: 564 } });
  });
  it('validates the scoring history, carry bags, winners and terminal threshold', () => {
    const finished = result();
    expect(isSpadesResult({ ...finished, scores: { NS: 500, EW: 248 } })).toBe(false);
    expect(isSpadesResult({ ...finished, bags: { NS: 3, EW: 8 } })).toBe(false);
    expect(isSpadesResult({ ...finished, winners: ['N'] })).toBe(false);
    expect(isSpadesResult({ ...finished, hands: [...finished.hands, finished.hands[0]] })).toBe(false);
    expect(isSpadesResult({ ...finished, hands: [] })).toBe(false);
  });
  it('registers a favorite daily task and advances human partner wins only', () => {
    const player = (id: string) => ({ id, username: id, nickname: id, color: '#123456', avatar: 'cat' as const, avatarImage: null });
    const game = { gameType: 'spades' as const, players: { N: player('N'), E: player('E'), S: player('S'), W: player('W') }, result: result() };
    expect(favoriteTaskFor('spades')).toBe('play-spades');
    const first = dailyGameProgress(undefined, game, 'N', 1, () => ({ spades: 4 }));
    expect(first).toMatchObject({ wins: 1, matches: 1, gameCounts: { spades: 1 } });
    const second = dailyGameProgress(first, game, 'N', 1, () => ({ spades: 4 }));
    expect(taskProgress(first, 'play-spades')).toBe(1);
    expect(taskProgress(second, 'play-spades')).toBe(1);
    expect(dailyGameProgress(undefined, game, 'S', 1, () => ({})).wins).toBe(1);
    expect(dailyGameProgress(undefined, game, 'E', 1, () => ({})).wins).toBe(0);
    expect(dailyGameProgress(undefined, game, 'viewer', 1, () => ({})).matches).toBe(0);
  });
});
