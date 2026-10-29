import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { GAME_ADAPTERS, allGameAdapters, gameAdapter } from '../../src/managers/games/registry';
import { GAME_BOTS } from '../../src/bots/bot-registry';

describe('server game registries', () => {
  it('registers one adapter per game type under its own key, in lobby order', () => {
    expect(Object.keys(GAME_ADAPTERS).sort()).toEqual([...GAME_TYPES].sort());
    for (const gameType of GAME_TYPES) expect(gameAdapter(gameType).gameType).toBe(gameType);
    expect(allGameAdapters().map((adapter) => adapter.gameType)).toEqual(GAME_TYPES);
  });

  it('registers one bot per game type', () => {
    expect(Object.keys(GAME_BOTS).sort()).toEqual([...GAME_TYPES].sort());
  });

  it('gives shared deadlines only to the simultaneous-decision games', () => {
    expect(GAME_TYPES.filter((gameType) => gameAdapter(gameType).sharedDeadline))
      .toEqual(['chinesepoker', 'blackjack', 'napoleon', 'tenhalf', 'landbattle']);
  });
});
