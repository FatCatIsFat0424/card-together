import { resolve } from 'node:path';
import { ESLint, Linter } from 'eslint';
import { parser } from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const eslint = new ESLint({ cwd: ROOT });

async function lint(code: string, file = 'client/src/player-stats.ts'): Promise<Linter.LintMessage[]> {
  const config = await eslint.calculateConfigForFile(resolve(ROOT, file)) as Linter.Config | undefined;
  return new Linter().verify(code, {
    languageOptions: { parser },
    rules: { 'no-restricted-syntax': config?.rules?.['no-restricted-syntax'] ?? 'off' },
  });
}

describe('literal gameType dispatch guard', () => {
  it.each(['===', '!==', '==', '!='])('rejects %s in either operand order', async (operator) => {
    for (const target of ['gameType', 'game.gameType', 'game["gameType"]', 'game?.gameType', '(game.gameType as string)', 'game.gameType!']) {
      for (const expression of [`${target} ${operator} 'bridge'`, `'bridge' ${operator} ${target}`]) {
        const messages = await lint(`const match = ${expression};`);
        expect(messages.map((entry) => entry.ruleId), expression).toEqual(['no-restricted-syntax']);
      }
    }
  });

  it('also rejects a future game literal without updating a list of game names', async () => {
    expect(await lint("game.gameType === 'sample-dice';")).toHaveLength(1);
  });

  it('checks static templates while permitting dynamic templates', async () => {
    expect(await lint('gameType === `sample-dice`;')).toHaveLength(1);
    expect(await lint('`sample-dice` !== game.gameType;')).toHaveLength(1);
    expect(await lint('gameType === `all`;')).toEqual([]);
    expect(await lint('gameType === `${selected}`;')).toEqual([]);
  });

  it('permits registry lookups, filter sentinels, and non-game fields', async () => {
    expect(await lint(`
      game.gameType === definition.gameType;
      gameType !== 'all';
      filters.gameType !== 'all';
      gameType === undefined;
      typeof game.gameType === 'string';
      game.phase === 'bridge';
    `)).toEqual([]);
  });

  it.each([
    'client/src/games/sample/sample-client.ts',
    'shared/src/games/sample/definition.ts',
    'server/src/managers/games/sample-adapter.ts',
    'server/src/database/games/sample-stats.ts',
    'client/src/games/registry.ts',
    'shared/src/rules/holdem.ts',
    'shared/src/stats/napoleon.ts',
    'server/src/bots/holdem-bot.ts',
    'server/tests/shared/game-registry.test.ts',
  ])('permits per-game modules, registries, and tests: %s', async (file) => {
    expect(await lint("game.gameType === 'bridge';", file)).toEqual([]);
  });

  it.each([
    'client/src/pages/RoomPage.tsx',
    'server/src/runtime/validate.ts',
    'server/src/database/json-repository.ts',
    'shared/src/rules/match-standing.ts',
  ])('does not allowlist common files: %s', async (file) => {
    expect(await lint("game.gameType === 'bridge';", file)).toHaveLength(1);
  });
});
