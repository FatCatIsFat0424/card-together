import { describe, expect, it } from 'vitest';
import { backfillAchievementCounts } from '../../src/database/migrate-achievements';

describe('achievement history recovery', () => {
  it('recovers totals beyond old caps, deduplicates history/runtime and counts retained bot games', () => {
    const input = {
      accounts: [{ id: 'alice', coins: 70, achievements: { games: 20, wins: 5, gameTypes: ['bridge'], dailyTasks: 3 },
        nameplate: 'nameplate-table-traveler', ownedAchievementNameplates: ['nameplate-table-traveler'] }, { id: 'spectator' }],
      matches: Array.from({ length: 100 }, (_, i) => ({ id: `match-${i}`, accountIds: ['alice', 'bot:opponent'],
        result: { gameType: 'holdem', seats: ['N', 'P8'], winners: ['N'] } })),
      rewardedGameIds: ['match-0', 'bot-match'],
      runtime: { games: [
        { id: 'match-0', gameType: 'holdem', result: { winners: ['N'] }, players: { N: { id: 'alice' } } },
        { id: 'bot-match', gameType: 'bigtwo', result: { winnerSeat: 'N' },
          players: { N: { id: 'alice' }, E: { id: 'bot:opponent', isBot: true } } },
        { id: 'uncommitted', gameType: 'bigtwo', result: { winnerSeat: 'N' }, players: { N: { id: 'alice' } } },
      ] },
    };
    const before = structuredClone(input);
    const migrated = backfillAchievementCounts(input);
    expect(input).toEqual(before);
    expect(migrated).toMatchObject({ accounts: [{ ...input.accounts[0],
      achievements: { games: 101, wins: 101, gameTypes: ['bridge', 'holdem', 'bigtwo'], dailyTasks: 3 } }, { id: 'spectator' }],
    rewardedGameIds: input.rewardedGameIds, matches: input.matches, runtime: input.runtime });
    expect(backfillAchievementCounts(migrated)).toEqual(migrated);
  });

  it('keeps legacy progress when missing bot history cannot be recovered', () => {
    const account = { id: 'alice', achievements: { games: 20, wins: 5, gameTypes: ['bigtwo'], dailyTasks: 0 } };
    expect(backfillAchievementCounts({ accounts: [account], matches: [
      { id: 'one', accountIds: ['alice'], result: { gameType: 'bigtwo', winnerSeat: 'N' } },
    ] })).toMatchObject({ accounts: [account] });
  });

  it('uses occupied seat order, excludes tied leaders and credits both winning Bridge partners', () => {
    const result = backfillAchievementCounts({ accounts: ['a', 'b', 'c', 'd'].map((id) => ({ id })), matches: [
      { id: 'bridge', accountIds: ['a', 'b', 'c', 'd'], result: { gameType: 'bridge',
        contract: { declarer: 'E' }, declarerTeamWins: false } },
      { id: 'tied', accountIds: ['a', 'c'], result: { gameType: 'holdem', seats: ['N', 'P8'], winners: ['N', 'P8'] } },
      { id: 'sparse', accountIds: ['a', 'd'], result: { gameType: 'blackjack', seats: ['S', 'P8'], winners: ['P8'] } },
    ] });
    expect(result).toMatchObject({ accounts: [
      { id: 'a', achievements: { games: 3, wins: 1 } }, { id: 'b', achievements: { games: 1, wins: 0 } },
      { id: 'c', achievements: { games: 2, wins: 1 } }, { id: 'd', achievements: { games: 2, wins: 1 } },
    ] });
  });
});
