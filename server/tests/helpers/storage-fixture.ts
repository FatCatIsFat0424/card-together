import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { AccountRecord, MatchRecord, Repository } from '../../src/database/repository';
import * as chat from '../../src/managers/chat-manager';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';

/** Storage fixtures shared by tests that compare engines or move data between them. */
export const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;
export const NEW_HASH = PASSWORD_HASH.replace('ab'.repeat(16), '12'.repeat(16));
export const EMPTY_RUNTIME = { players: [], rooms: [], games: [], chat: [] };

export function account(username: string): AccountRecord {
  return {
    id: randomUUID(), username, usernameNormalized: username.toLowerCase(), nickname: username, color: '#123456',
    avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
    cardBackOpacity: 100, matchesPublic: true, passwordHash: PASSWORD_HASH, createdAt: 100, updatedAt: 100,
  };
}

export function match(id: string, accountIds: readonly string[], finishedAt: number): MatchRecord {
  return { id, roomCode: 'ABC123', accountIds, finishedAt, result: { gameType: 'bridge',
    contract: { level: 1, suit: 'nt', declarer: 'N' }, declarerTeamTricks: 7, defenderTeamTricks: 6,
    requiredTricks: 7, declarerTeamWins: true } };
}

export function resetRuntime(): void {
  players.restorePlayers([], true);
  rooms.restoreRooms([]);
  games.restoreGames([]);
  chat.restoreChat([]);
}

/** Plays a bot Red Points game to completion and leaves a second room mid-game with chat. */
export async function populate(repository: Repository): Promise<AccountRecord[]> {
  const [alice, bob, carol] = ['alice', 'Bob', 'carol'].map(account);
  for (const entry of [alice, bob, carol]) await repository.createAccount(entry);
  await repository.createSession({ tokenHash: 'ab'.repeat(32), accountId: alice.id, createdAt: Date.now(),
    expiresAt: Date.now() + 86_400_000 }, PASSWORD_HASH);
  await repository.createFriendship({ id: 'friends', requesterId: alice.id, recipientId: bob.id, status: 'pending',
    createdAt: 100, updatedAt: 100 });
  await repository.acceptFriendship('friends', bob.id);
  await repository.createFriendship({ id: 'pending', requesterId: carol.id, recipientId: alice.id, status: 'pending',
    createdAt: 101, updatedAt: 101 });
  await repository.createDirectMessage({ id: 'dm-1', clientId: 'client-1', senderId: alice.id, recipientId: bob.id,
    timestamp: Date.now(), content: 'hello' });
  await repository.markDirectMessagesRead(bob.id, alice.id, 'dm-1');
  await repository.createEmojis(alice.id, [{ name: 'wave', mediaId: `${'c'.repeat(64)}.webp` }], 100);
  await repository.saveMatch(match('legacy', [alice.id, bob.id, carol.id, `bot:${randomUUID()}`], 50));

  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    const human = players.toPlayerInfo(alice);
    players.attachPlayer('alice-socket', human);
    code = rooms.createRoom('redpoints', alice.id);
    players.setPlayerRoom(alice.id, code);
    rooms.changeSeat(code, human, 'N');
    rooms.fillBots(code, alice.id);
    rooms.setReady(code, alice.id, true);
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, 'redpoints', rooms.getSeatPlayers(code)!);
  });
  for (let actions = 0; games.getGameState(code)?.phase !== 'scoring' && actions < 60; actions++) {
    const game = games.getGameState(code)!;
    if (game.gameType !== 'redpoints') throw new Error('Expected Red Points');
    vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(game)));
    await runtime.mutate(() => {
      const action = getBotAction(games.getPlayerVisibleState(code, game.currentTurnSeat)!);
      if (action?.type === 'redpoints-play') games.handleRedPointsPlay(code, game.currentTurnSeat, action.card, action.capture);
      else if (action?.type === 'redpoints-flip') games.handleRedPointsChooseFlip(code, game.currentTurnSeat, action.capture);
    });
  }
  expect(games.getGameState(code)?.phase).toBe('scoring');
  await runtime.mutate(() => {
    const info = players.toPlayerInfo(bob);
    players.attachPlayer('bob-socket', info);
    const second = rooms.createRoom('bigtwo', bob.id);
    players.setPlayerRoom(bob.id, second);
    rooms.changeSeat(second, info, 'N');
    chat.initRoomChat(second);
    chat.addMessage(second, info, 'good luck');
  });
  await runtime.mutate(() => players.markDisconnected('bob-socket'));
  await repository.claimDailyReward(alice.id, 'check-in', (await repository.getDailyRewards(alice.id))!.day);
  return [alice, bob, carol];
}

export async function dtos(repository: Repository, accounts: readonly AccountRecord[]): Promise<unknown> {
  return {
    runtime: await repository.loadRuntime(),
    search: await repository.searchAccounts('', ''),
    session: await repository.getSession('ab'.repeat(32)),
    accounts: await Promise.all(accounts.map(async ({ id, usernameNormalized }) => ({
      byId: await repository.getAccountById(id), byName: await repository.getAccountByUsername(usernameNormalized),
      friendships: await repository.listFriendships(id), messages: await repository.listDirectMessages(id),
      reads: await repository.listMessageReads(id), notifications: await repository.listFriendNotifications(id),
      emojis: await repository.listEmojis(id), matches: await repository.listMatches(id),
      replays: await Promise.all((await repository.listMatches(id)).map((entry) => repository.getMatchReplay(entry.id))),
      daily: await repository.getDailyRewards(id), achievements: await repository.getAchievements(id),
    }))),
  };
}
