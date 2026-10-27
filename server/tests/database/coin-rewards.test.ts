import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import type { AccountRecord, MatchRecord, Repository } from '../../src/database/repository';
import { createDeck } from '../../src/engine/deck';
import * as chinesepoker from '../../src/managers/games/chinesepoker-game';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

describe.each(REPOSITORY_ADAPTERS)('compound completed-game writes ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'coin-rewards-'));
    path = join(directory, adapter.fileName);
    repository = await adapter.open(path);
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    chinesepoker.restoreGames([]);
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function fixture(overrides: Partial<AccountRecord> = {}, suffix = '') {
    const code = suffix ? `COIN${suffix}` : 'COIN01';
    const accounts: AccountRecord[] = SEATS.map((seat) => ({
      id: `${seat}${suffix}`, username: `user_${seat}${suffix}`, usernameNormalized: `user_${seat.toLowerCase()}${suffix}`,
      nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null,
      tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
      passwordHash: `scrypt$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(128)}`,
      coins: 50, coinRevision: 2, createdAt: 1, updatedAt: 1,
      ...(seat === 'N' ? overrides : {}),
    }));
    for (const account of accounts) await repository.createAccount(account);
    const players = Object.fromEntries(accounts.map((account, index) => [SEATS[index], {
      id: account.id, username: account.username, nickname: account.nickname, color: account.color,
      avatar: account.avatar, avatarImage: null,
    }])) as Record<Seat, PlayerInfo>;
    chinesepoker.startGame(code, players, 60_000, createDeck());
    const game = chinesepoker.getGameState(code)!;
    for (const seat of SEATS) expect(chinesepoker.arrange(code, seat, cpGreedyArrangement(game.hands[seat]), true).success).toBe(true);
    const snapshot: RuntimeSnapshot = {
      players: SEATS.map((seat) => ({ info: players[seat], currentRoomCode: code, disconnectedAt: null })),
      rooms: [{ info: { code, gameType: 'chinesepoker', status: 'waiting', createdAt: 1,
        hostId: players.N.id, abortVote: null, abortVoteCooldownUntil: null,
        seats: Object.fromEntries(SEATS.map((seat) => [seat, { player: players[seat], isReady: false }])) as RuntimeSnapshot['rooms'][number]['info']['seats'],
      }, memberIds: accounts.map((account) => account.id) }],
      games: [structuredClone(game)], chat: [{ roomCode: code, messages: [] }],
    };
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    const match: MatchRecord = { id: game.id, roomCode: code, accountIds: accounts.map((account) => account.id), result: game.result!, finishedAt: Date.now() };
    return { accounts, snapshot, match, id: game.id };
  }

  it('commits runtime, history, balances, revisions and receipts together; replay remains idempotent after reopening', async () => {
    const { accounts, snapshot, match, id } = await fixture();
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('compound save failed'));
    await expect(repository.saveRuntime(snapshot, [match], [id])).rejects.toThrow('compound save failed');
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.loadRuntime()).toBeNull();
    for (const account of accounts) {
      expect(await repository.getAccountById(account.id)).toEqual(account);
      expect(await repository.listMatches(account.id)).toEqual([]);
    }
    await repository.saveRuntime(snapshot, [match], [id, id]);
    await repository.close();
    repository = await adapter.open(path);
    await Promise.all([
      repository.saveRuntime(snapshot, [match], [id]), repository.saveRuntime(snapshot, [match], [id, id]),
    ]);
    expect(await repository.loadRuntime()).toEqual(snapshot);
    for (const account of accounts) {
      expect(await repository.getAccountById(account.id)).toMatchObject({ coins: 60, coinRevision: 3 });
      const result = snapshot.games[0].result!;
      const won = 'winners' in result && result.winners.length === 1 && result.winners[0] === account.id;
      expect(await repository.getDailyRewards(account.id)).toMatchObject({ gameTypes: ['chinesepoker'], wins: Number(won) });
      expect((await repository.getAccountById(account.id))!.achievements).toEqual({ games: 1, wins: Number(won),
        gameTypes: ['chinesepoker'], dailyTasks: 0 });
      expect(await repository.listMatches(account.id)).toEqual([match]);
    }
    expect((await adapter.readDocument(path)).rewardedGameIds).toEqual([id]);
  });

  it('serializes a reward and purchase without losing either revision', async () => {
    const { snapshot, match, id } = await fixture();
    await Promise.all([
      repository.saveRuntime(snapshot, [match], [id]), repository.purchaseAvatarBorder('N', 'copper', Date.now()),
    ]);
    expect(await repository.getAccountById('N')).toMatchObject({ coins: 10, coinRevision: 4, ownedAvatarBorders: ['copper'] });
    for (const seat of ['E', 'S', 'W']) expect(await repository.getAccountById(seat)).toMatchObject({ coins: 60, coinRevision: 3 });
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.getAccountById('N')).toMatchObject({ coins: 10, coinRevision: 4, ownedAvatarBorders: ['copper'] });
    expect(await repository.listMatches('N')).toEqual([match]);
  });

  it.each([false, true])('handles distinct completed IDs atomically when the second reward overflows=%s', async (overflow) => {
    const { snapshot, match, id } = await fixture();
    const other = await fixture(overflow ? { coins: Number.MAX_SAFE_INTEGER - 5 } : {}, '02');
    const before = await adapter.persisted(path);
    snapshot.players.push(...other.snapshot.players);
    snapshot.rooms.push(...other.snapshot.rooms);
    snapshot.games.push(...other.snapshot.games);
    snapshot.chat.push(...other.snapshot.chat);
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    if (overflow) {
      await expect(repository.saveRuntime(snapshot, [match, other.match], [id, other.id, id])).rejects.toThrow('Coin balance exceeds');
      expect(await adapter.persisted(path)).toBe(before);
      expect(await repository.loadRuntime()).toBeNull();
      for (const account of other.accounts) expect(await repository.getAccountById(account.id)).toEqual(account);
      for (const seat of SEATS) expect(await repository.getAccountById(seat)).toMatchObject({ coins: 50, coinRevision: 2 });
      expect(await repository.listMatches('N')).toEqual([]);
      expect(await repository.listMatches('N02')).toEqual([]);
      return;
    }
    await repository.saveRuntime(snapshot, [match, other.match], [id, other.id, id]);
    for (const seat of SEATS) {
      expect(await repository.getAccountById(seat)).toMatchObject({ coins: 60, coinRevision: 3 });
      expect(await repository.getAccountById(`${seat}02`)).toMatchObject({ coins: 60, coinRevision: 3 });
    }
    expect(await repository.listMatches('N')).toEqual([match]);
    expect(await repository.listMatches('N02')).toEqual([other.match]);
    expect((await adapter.readDocument(path)).rewardedGameIds).toEqual([id, other.id]);
  });

  it.each([
    { name: 'coin balance', overrides: { coins: Number.MAX_SAFE_INTEGER - 5 } },
    { name: 'coin revision', overrides: { coinRevision: Number.MAX_SAFE_INTEGER } },
  ])('rejects overflowing $name atomically', async ({ overrides }) => {
    const { accounts, snapshot, match, id } = await fixture(overrides);
    const before = await adapter.persisted(path);
    await expect(repository.saveRuntime(snapshot, [match], [id])).rejects.toThrow();
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.loadRuntime()).toBeNull();
    for (const account of accounts) expect(await repository.getAccountById(account.id)).toEqual(account);
    expect(await repository.listMatches('N')).toEqual([]);
    await repository.close();
    repository = await adapter.open(path);
    expect(await repository.getAccountById('N')).toEqual(accounts[0]);
  });

  it.each(['missing-id', 'unfinished', 'missing-account'] as const)('rejects %s completion without leaving history or rewards', async (failure) => {
    const { accounts, snapshot, match, id } = await fixture();
    let completedId = id;
    if (failure === 'missing-id') completedId = 'missing-game';
    else if (failure === 'unfinished') {
      const players = snapshot.games[0].players as Record<Seat, PlayerInfo>;
      chinesepoker.startGame('COIN01', players, 60_000, createDeck());
      snapshot.games[0] = structuredClone(chinesepoker.getGameState('COIN01')!);
      Object.assign(snapshot.rooms[0].info, { status: 'playing' });
      completedId = snapshot.games[0].id;
    } else {
      Object.assign(snapshot.players[0].info, { id: 'missing-account' });
      Object.assign(snapshot.games[0].players.N!, { id: 'missing-account' });
      Object.assign(snapshot.rooms[0].info, { hostId: 'missing-account' });
      snapshot.rooms[0].memberIds[0] = 'missing-account';
    }
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    const before = await adapter.persisted(path);
    await expect(repository.saveRuntime(snapshot, [match], [completedId])).rejects.toThrow(
      failure === 'missing-account' ? 'Coin reward account does not exist' : 'Coin rewards require a completed game',
    );
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.loadRuntime()).toBeNull();
    expect(await repository.listMatches('N')).toEqual([]);
    for (const account of accounts) expect(await repository.getAccountById(account.id)).toEqual(account);
  });
});
