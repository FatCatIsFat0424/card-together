import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { createJsonRepository } from '../../src/database/json-repository';
import type { AccountRecord } from '../../src/database/repository';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { getBotAction } from '../../src/bots/bot-decisions';

it('persists a completed mixed bot match and preserves human history after reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'card-bot-history-'));
  const path = join(directory, 'database.json');
  let repository = await createJsonRepository(path);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(10000);
  try {
    const account: AccountRecord = {
      id: randomUUID(), username: 'tester', usernameNormalized: 'tester', nickname: 'Tester',
      color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null,
      tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
      passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
      createdAt: 1, updatedAt: 1,
    };
    await repository.createAccount(account);
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      const human = players.toPlayerInfo(account);
      players.attachPlayer('human-socket', human);
      code = rooms.createRoom('redpoints', account.id);
      players.setPlayerRoom(account.id, code);
      rooms.changeSeat(code, human, 'N');
      rooms.fillBots(code, account.id);
      rooms.setReady(code, account.id, true);
      rooms.setRoomStatus(code, 'playing');
      games.startGame(code, 'redpoints', rooms.getSeatPlayers(code)!);
    });
    for (let actions = 0; games.getGameState(code)?.phase !== 'scoring' && actions < 60; actions++) {
      const game = games.getGameState(code)!;
      if (game.gameType !== 'redpoints') throw new Error('Expected Red Points');
      vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(game)));
      await runtime.mutate(() => {
        const action = getBotAction(games.getPlayerVisibleState(code, game.currentTurnSeat)!);
        if (action?.type === 'redpoints-play') {
          expect(games.handleRedPointsPlay(code, game.currentTurnSeat, action.card, action.capture).success).toBe(true);
        } else if (action?.type === 'redpoints-flip') {
          expect(games.handleRedPointsChooseFlip(code, game.currentTurnSeat, action.capture).success).toBe(true);
        } else throw new Error('Expected a legal Red Points decision');
      });
    }
    expect(games.getGameState(code)?.phase).toBe('scoring');
    const history = await repository.listMatches(account.id);
    expect(history).toHaveLength(1);
    expect(history[0].accountIds[0]).toBe(account.id);
    expect(history[0].accountIds.slice(1).every((id) => id.startsWith('bot:'))).toBe(true);
    await runtime.mutate(() => { rooms.removeBot(code, account.id, 'E'); });
    await repository.close();
    repository = await createJsonRepository(path);
    expect(await repository.listMatches(account.id)).toEqual(history);
    expect((await repository.loadRuntime())?.games[0].phase).toBe('scoring');
    await expect(repository.saveMatch({ ...history[0], id: randomUUID(),
      accountIds: [account.id, randomUUID(), ...history[0].accountIds.slice(2)] })).rejects.toThrow('invalid references');
    await expect(repository.saveMatch({ ...history[0], id: randomUUID(),
      accountIds: [account.id, 'bot:invalid', ...history[0].accountIds.slice(2)] })).rejects.toThrow('invalid references');
  } finally {
    vi.useRealTimers();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});
