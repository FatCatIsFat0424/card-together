/** Run with: npx tsx --tsconfig tsconfig.json tests/database/repository-benchmark.ts */
import { performance } from 'node:perf_hooks';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayerInfo, Seat } from '@shared/types';
import { createJsonRepository } from '../../src/database/json-repository';
import { CURRENT_SCHEMA_VERSION } from '../../src/database/migrations';
import type { DatabaseDocument } from '../../src/database/schema';
import { validateDocument } from '../../src/database/schema';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { createDeck } from '../../src/engine/deck';
import { createBiddingState } from '../../src/engine/bidding';

const RECORDS = 10_000;
const SEATS: Seat[] = ['N', 'E', 'S', 'W'];
const TIMESTAMP = 1_700_000_000_000;
const PASSWORD_HASH = `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`;

function accountId(index: number): string {
  return `account-${index}`;
}
function sessionHash(index: number): string {
  return index.toString(16).padStart(64, '0');
}

function createFixture(): DatabaseDocument {
  const runtime: RuntimeSnapshot = { players: [], rooms: [], games: [], chat: [] };
  const document: DatabaseDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    runtime,
    accounts: Array.from({ length: RECORDS }, (_, index) => ({
      id: accountId(index),
      username: `player_${index}`,
      usernameNormalized: `player_${index}`,
      nickname: `Player ${index}`,
      color: '#123456',
      avatar: 'cat',
      avatarImage: null,
      tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100,
      matchesPublic: false,
      passwordHash: PASSWORD_HASH,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    })),
    sessions: Array.from({ length: RECORDS }, (_, index) => ({
      tokenHash: sessionHash(index),
      accountId: accountId(index),
      createdAt: TIMESTAMP,
      expiresAt: TIMESTAMP + 604_800_000,
    })),
    friendships: Array.from({ length: RECORDS }, (_, index) => ({
      id: `friend-${index}`,
      requesterId: accountId(index),
      recipientId: accountId((index + 1) % RECORDS),
      status: 'accepted',
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    })),
    matches: Array.from({ length: RECORDS }, (_, index) => ({
      id: `match-${index}`,
      roomCode: `R${index}`,
      accountIds: [0, 1, 2, 3].map((offset) => accountId((index * 4 + offset) % RECORDS)),
      finishedAt: TIMESTAMP + index,
      result: {
        gameType: 'bridge',
        contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7,
        defenderTeamTricks: 6,
        requiredTricks: 7,
        declarerTeamWins: true,
      },
    })),
    emojis: [],
  };
  const deck = createDeck();
  for (let table = 0; table < 25; table += 1) {
    const roomCode = `T${table.toString().padStart(5, '0')}`;
    const participants = SEATS.map((_seat, index): PlayerInfo => {
      const account = document.accounts[table * 4 + index];
      return {
        id: account.id,
        username: account.username,
        nickname: account.nickname,
        color: account.color,
        avatar: account.avatar,
        avatarImage: account.avatarImage,
      };
    });
    const players = {
      N: participants[0],
      E: participants[1],
      S: participants[2],
      W: participants[3],
    };
    runtime.players.push(
      ...participants.map((info) => ({ info, currentRoomCode: roomCode, disconnectedAt: null })),
    );
    runtime.rooms.push({
      info: {
        code: roomCode,
        gameType: 'bridge',
        status: 'playing',
        createdAt: TIMESTAMP,
        hostId: participants[0].id,
        abortVote: null,
        abortVoteCooldownUntil: null,
        seats: {
          N: { player: players.N, isReady: true },
          E: { player: players.E, isReady: true },
          S: { player: players.S, isReady: true },
          W: { player: players.W, isReady: true },
        },
      },
      memberIds: participants.map((entry) => entry.id),
    });
    runtime.games.push({
      gameType: 'bridge',
      id: `active-${table}`,
      roomCode,
      startedAt: TIMESTAMP,
      players,
      phase: 'bidding',
      dealerSeat: 'W',
      hands: {
        N: deck.slice(0, 13),
        E: deck.slice(13, 26),
        S: deck.slice(26, 39),
        W: deck.slice(39),
      },
      bidding: createBiddingState('N'),
      playing: null,
      contract: null,
      result: null,
      log: [],
      redealPendingSeat: null,
      redealDeclinedSeats: [],
    });
    runtime.chat.push({
      roomCode,
      messages: Array.from({ length: 20 }, (_, index) => ({
        id: `message-${table}-${index}`,
        sender: participants[index % 4],
        content: `Message ${index}`,
        timestamp: TIMESTAMP + index,
      })),
    });
  }
  return document;
}

async function measure(
  iterations: number,
  operation: (index: number) => Promise<unknown>,
): Promise<{ iterations: number; medianMs: number; samplesMs: number[] }> {
  for (let index = 0; index < Math.min(iterations, 100); index += 1) await operation(index);
  const samplesMs: number[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) await operation(index);
    samplesMs.push(Number((performance.now() - start).toFixed(2)));
  }
  return { iterations, medianMs: [...samplesMs].sort((a, b) => a - b)[1], samplesMs };
}

async function main(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bridge-repository-benchmark-'));
  const path = join(directory, 'database.json');
  const fixture = createFixture();
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`);
  const start = performance.now();
  const repository = await createJsonRepository(path);
  const openMs = Number((performance.now() - start).toFixed(2));
  try {
    const measurements = {
      accountById: await measure(10_000, (index) =>
        repository.getAccountById(accountId((index * 7919) % RECORDS)),
      ),
      accountByUsername: await measure(10_000, (index) =>
        repository.getAccountByUsername(`player_${(index * 7919) % RECORDS}`),
      ),
      sessionByHash: await measure(10_000, (index) =>
        repository.getSession(sessionHash((index * 7919) % RECORDS)),
      ),
      friendsByAccount: await measure(1_000, (index) =>
        repository.listFriendships(accountId((index * 7919) % RECORDS)),
      ),
      historyByAccount: await measure(1_000, (index) =>
        repository.listMatches(accountId((index * 7919) % RECORDS)),
      ),
      boundedSearch: await measure(500, () => repository.searchAccounts('player', '', 20)),
      cloneDocument: await measure(5, async () => structuredClone(fixture)),
      validateDocument: await measure(5, async () => validateDocument(fixture)),
      serializeDocument: await measure(5, async () => JSON.stringify(fixture, null, 2)),
      durableRuntimeWrites: await measure(5, (index) => {
        fixture.runtime!.chat[0].messages[0] = {
          ...fixture.runtime!.chat[0].messages[0],
          content: `Updated ${index}`,
        };
        return repository.saveRuntime(fixture.runtime!);
      }),
    };
    console.warn(
      JSON.stringify(
        {
          node: process.version,
          recordsPerTable: RECORDS,
          activeTables: 25,
          bytes: (await stat(path)).size,
          openMs,
          measurements,
        },
        null,
        2,
      ),
    );
  } finally {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
