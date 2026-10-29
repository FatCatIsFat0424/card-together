import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { gameDefinition } from '@shared/games/registry';
import { roomCompassSeats } from '@shared/rules/seats';
import { applyReplayPatch } from '@shared/replay-patch';
import type { AnyGameState, Card, GameType, ReplayRecording, ReplaySnapshot, Seat } from '@shared/types';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { isMatchReplay } from '../../src/database/match-replay';
import type { AccountRecord, Repository } from '../../src/database/repository';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { applyAutomatedAction, firstLegalAction } from '../../src/runtime/automated-action';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import type { RuntimeCoordinator } from '../../src/runtime/coordinator';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
/** Keys of private or transient state that must never reach a recorded snapshot. */
const PRIVATE_KEYS: ReadonlySet<string> = new Set(['deck', 'stock', 'bullets', 'chat', 'clock', 'replayRecording',
  'serverNow', 'seed', 'pendingAutoPass']);

function account(seat: Seat): AccountRecord {
  return {
    id: seat, username: `player_${seat.toLowerCase()}`, usernameNormalized: `player_${seat.toLowerCase()}`, nickname: seat,
    color: '#123456', avatar: 'cat', avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100,
    cardBack: null, cardBackOpacity: 100, matchesPublic: false, createdAt: 1, updatedAt: 1,
    passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
  };
}

async function startMatch(
  repository: Repository, gameType: GameType, bots = false,
): Promise<{ runtime: RuntimeCoordinator; code: string }> {
  const limit = Math.min(SEATS.length, gameDefinition(gameType).seats.maxPlayers);
  const offered = roomCompassSeats(gameType);
  const accounts = (bots ? SEATS.slice(0, 1) : SEATS.slice(0, limit)).map(account);
  for (const entry of accounts) await repository.createAccount(entry);
  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    code = rooms.createRoom(gameType, 'N');
    for (const [index, entry] of accounts.entries()) {
      const info = players.toPlayerInfo(entry);
      players.attachPlayer(`socket-${entry.id}`, info);
      if (index > 0) rooms.joinRoom(code, entry.id);
      players.setPlayerRoom(entry.id, code);
      rooms.changeSeat(code, info, offered[index]);
    }
    if (bots) expect(rooms.fillBots(code, 'N').success).toBe(true);
    rooms.setRoomStatus(code, 'playing');
    expect(games.startGame(code, gameType, rooms.getSeatPlayers(code)!).success).toBe(true);
  });
  return { runtime, code };
}

function act(code: string): void {
  const game = games.getGameState(code)!;
  delete game.presentation;
  const seat = game.gameType === 'chinesepoker'
    ? SEATS.find((pending) => game.arrangements[pending] === null)
    : game.gameType === 'blackjack' && game.phase === 'betting'
      ? SEATS.find((pending) => game.players[pending] && game.bets[pending] === null && game.chips[pending] >= 10)
      : game.gameType === 'tenhalf' && game.phase === 'betting'
        ? SEATS.find((pending) => game.players[pending] && game.pendingBets[pending] === null
          && pending !== game.banker && game.chips[pending] >= 10)
      : game.gameType === 'napoleon' && game.phase === 'reviewing'
        ? game.seats.find((pending) => pending !== game.contract?.napoleon && !game.reviewed.includes(pending))
        : getTurnSeat(game);
  if (!seat) throw new Error('Expected a pending action.');
  if (game.gameType === 'bridge' && game.phase === 'bidding' && !game.bidding?.highestBid) {
    expect(games.handleBid(code, seat as Seat, { type: 'bid', level: 1, suit: 'clubs' }, true).success).toBe(true);
  } else if (game.gameType === 'napoleon' && game.phase === 'bidding' && !game.bidding?.highestBid) {
    expect(games.handleNapoleonAction(code, seat, { type: 'bid', action: { type: 'bid', level: 9, suit: 'clubs' } }, true).success).toBe(true);
  } else {
    const action = firstLegalAction(games.getPlayerVisibleState(code, seat)!);
    if (!action) throw new Error('Expected a legal action.');
    expect(applyAutomatedAction(code, seat, action).success).toBe(true);
  }
}

async function finish(code: string, runtime: RuntimeCoordinator, afterStep?: () => void): Promise<void> {
  for (let step = 0; step < 5_000; step++) {
    if (games.getGameState(code)!.result) return;
    await runtime.mutate(() => act(code));
    afterStep?.();
  }
  throw new Error('Game did not finish.');
}

/** Computed independently of the recorder: the spectator view without clock or server time. */
function spectatorSnapshot(code: string): ReplaySnapshot {
  const { clock: _clock, presentation, ...rest } = games.getRecipientVisibleState(code, null)!;
  const view = presentation ? { ...rest, presentation: (({ serverNow: _now, ...kept }) => kept)(presentation) } : rest;
  return JSON.parse(JSON.stringify(view)) as ReplaySnapshot;
}

function fold(recording: ReplayRecording): ReplaySnapshot {
  return recording.steps.reduce<ReplaySnapshot>((snapshot, step) => applyReplayPatch(snapshot, step), recording.initial);
}

function privateKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) privateKeys(item, found);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(key)) found.push(key);
      privateKeys(child, found);
    }
  }
  return found;
}

function cards(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) cards(item, found);
  else if (typeof value === 'object' && value !== null) {
    if ('suit' in value && 'rank' in value) found.push(`${String(value.suit)}${String(value.rank)}`);
    for (const child of Object.values(value)) cards(child, found);
  }
  return found;
}

/** Cards nobody has seen yet; Hold'em and Blackjack decks are checked before any reshuffle. */
function undealt(game: AnyGameState): readonly Card[] {
  if (game.gameType === 'redpoints' || game.gameType === 'ninetynine' || game.gameType === 'crazyeights') return game.stock;
  if (game.gameType === 'holdem' || game.gameType === 'blackjack' || game.gameType === 'stud') return game.deck;
  return [];
}

/** Applies each new step as it is recorded, so any drift from the live view fails at once. */
function follower(code: string): { check: () => void; folded: () => ReplaySnapshot[] } {
  const recording = games.getGameState(code)!.replayRecording!;
  const snapshots = [recording.initial];
  return {
    check: (): void => {
      const { steps } = games.getGameState(code)!.replayRecording!;
      for (const step of steps.slice(snapshots.length - 1)) snapshots.push(applyReplayPatch(snapshots.at(-1)!, step));
      expect(snapshots.at(-1)).toEqual(spectatorSnapshot(code));
    },
    folded: (): ReplaySnapshot[] => snapshots,
  };
}

describe.each(REPOSITORY_ADAPTERS)('live-table match recordings ($name)', (adapter) => {
  afterEach(() => {
    vi.restoreAllMocks();
    rooms.restoreRooms([]);
    games.restoreGames([]);
    players.restorePlayers([]);
  });

  it.each(GAME_TYPES.flatMap((gameType) => [false, true].map((bots) => ({ gameType, bots }))))(
    'records $gameType (bots: $bots) across restart, rollback and room removal', async ({ gameType, bots }) => {
    let seed = 17;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    const directory = await mkdtemp(join(tmpdir(), 'card-replay-'));
    const path = join(directory, adapter.fileName);
    let repository = await adapter.open(path);
    try {
      const { runtime, code } = await startMatch(repository, gameType, bots);
      const initial = games.getGameState(code)!;
      expect(initial.replayRecording).toEqual({ initial: spectatorSnapshot(code), steps: [] });
      const unseen = undealt(initial).map((card) => `${card.suit}${card.rank}`);
      expect(cards(initial.replayRecording!.initial).filter((card) => unseen.includes(card))).toEqual([]);
      for (const seat of [...SEATS, null]) {
        expect(JSON.stringify(games.getRecipientVisibleState(code, seat))).not.toContain('replayRecording');
      }
      expect(JSON.stringify(rooms.getRoomInfo(code))).not.toContain('replayRecording');

      // Server time alone never produces a step.
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
      await runtime.mutate(() => undefined, { skipUnchanged: true });
      vi.mocked(Date.now).mockRestore();
      expect(games.getGameState(code)!.replayRecording!.steps).toEqual([]);

      const live = follower(code);
      await runtime.mutate(() => act(code));
      live.check();
      expect(games.getGameState(code)!.replayRecording!.steps).toHaveLength(1);
      expect(isRuntimeSnapshot(runtime.snapshot())).toBe(true);
      const recording = structuredClone(games.getGameState(code)!.replayRecording);
      await repository.close();
      const disk = await adapter.readDocument(path);
      if (gameType === 'bridge') {
        const damaged = structuredClone(disk) as { runtime: RuntimeSnapshot };
        Object.assign(damaged.runtime.games[0].replayRecording!.steps[0][0], { path: ['__proto__'] });
        await adapter.writeUnchecked(path, damaged);
        const corrupt = await adapter.persisted(path);
        await expect(adapter.open(path)).rejects.toThrow('schema');
        expect(await adapter.persisted(path)).toBe(corrupt);
        await adapter.writeUnchecked(path, disk);
        // Frequent writes check recording structure only; loading applies every step and drops a
        // recording that no longer applies, so the match continues unrecorded.
        const inapplicable = structuredClone(disk) as { runtime: RuntimeSnapshot };
        const steps = inapplicable.runtime.games[0].replayRecording!.steps as unknown[][];
        steps.push([{ op: 'set', path: ['missing', 'child'], value: 0 }]);
        repository = await adapter.open(path);
        await repository.saveRuntime(inapplicable.runtime);
        await repository.close();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        repository = await adapter.open(path);
        expect((await repository.loadRuntime())!.games[0].replayRecording).toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unplayable replay recording'));
        warn.mockRestore();
        await repository.close();
        await adapter.writeUnchecked(path, disk);
      }
      repository = await adapter.open(path);
      const resumed = await createRuntimeCoordinator(repository);
      expect(games.getGameState(code)!.replayRecording).toEqual(recording);

      // A failed commit discards its step; the retry records from the committed snapshot.
      const failing = vi.spyOn(repository, 'saveRuntime').mockRejectedValueOnce(new Error('Write failed'));
      const committed = resumed.snapshot();
      await expect(resumed.mutate(() => act(code))).rejects.toThrow('Write failed');
      expect(resumed.snapshot()).toEqual(committed);
      failing.mockRestore();
      await resumed.mutate(() => act(code));
      live.check();
      expect(games.getGameState(code)!.replayRecording!.steps).toHaveLength(recording!.steps.length + 1);

      if (gameType === 'holdem') {
        let before = resumed.snapshot();
        const save = repository.saveRuntime.bind(repository);
        const spy = vi.spyOn(repository, 'saveRuntime').mockImplementation(async (...args) => {
          if (args[1]?.length) throw new Error('Archive write failed');
          await save(...args);
        });
        await expect(finish(code, resumed, () => { before = resumed.snapshot(); })).rejects.toThrow('Archive write failed');
        expect(resumed.snapshot()).toEqual(before);
        expect(await repository.loadRuntime()).toEqual(before);
        expect(await repository.listMatches('N')).toEqual([]);
        spy.mockRestore();
      }
      await finish(code, resumed, live.check);
      const completed = games.getGameState(code)!;
      const history = await repository.listMatches('N');
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ hasReplay: true });
      expect(history[0]).not.toHaveProperty('replay');
      // The archive lives in its own file beside the database, read and validated on demand.
      expect(JSON.parse(await readFile(join(directory, 'replays', `${history[0].id}.json`), 'utf8')))
        .toEqual(await repository.getMatchReplay(history[0].id));
      const archive = (await repository.getMatchReplay(history[0].id))!;
      expect(Object.keys(archive).sort()).toEqual(['gameType', 'initial', 'startedAt', 'steps', 'version']);
      expect(archive).toEqual({ version: 1, gameType, startedAt: completed.startedAt,
        ...completed.replayRecording });
      expect(isMatchReplay(archive, history[0].result, history[0].finishedAt)).toBe(true);
      expect(fold(archive)).toEqual(spectatorSnapshot(code));
      expect(archive.steps.every((step) => step.length > 0)).toBe(true);
      for (const snapshot of live.folded()) expect(privateKeys(snapshot)).toEqual([]);
      // Patches stay proportional to each step, so a full Bridge board stays well below raw snapshots.
      if (gameType === 'bridge') expect(JSON.stringify(archive).length).toBeLessThan(100_000);

      // Finished boards are archived once and stop recording.
      const steps = completed.replayRecording!.steps.length;
      await resumed.mutate(() => games.returnFromResult(code, 'N'));
      if (bots) expect(games.getGameState(code)).toBeNull();
      else expect(games.getGameState(code)!.replayRecording!.steps).toHaveLength(steps);

      // Retained history does not depend on runtime rooms, private hands, or connected players.
      await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] });
      await repository.close();
      repository = await adapter.open(path);
      const restarted = await createRuntimeCoordinator(repository);
      expect(restarted.snapshot()).toEqual({ players: [], rooms: [], games: [], chat: [] });
      expect(await repository.listMatches('N')).toEqual(history);
    } finally {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(['legacy', 'bots'] as const)('keeps %s games unrecorded after restart and completion', async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'card-replay-legacy-'));
    const path = join(directory, adapter.fileName);
    let repository = await adapter.open(path);
    try {
      const { runtime, code } = await startMatch(repository, 'bridge', mode === 'bots');
      expect(games.getGameState(code)!.replayRecording).toBeDefined();
      const old = runtime.snapshot();
      delete old.games[0].replayRecording;
      await repository.saveRuntime(old);
      await repository.close();
      repository = await adapter.open(path);
      const resumed = await createRuntimeCoordinator(repository);
      expect(games.getGameState(code)!.replayRecording).toBeUndefined();
      await finish(code, resumed);
      expect(games.getGameState(code)!.replayRecording).toBeUndefined();
      const history = await repository.listMatches('N');
      expect(history).toHaveLength(1);
      expect(history[0]).not.toHaveProperty('replay');
      expect(history[0]).not.toHaveProperty('hasReplay');
    } finally {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts a recording on a bot game at restore', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'card-replay-bot-'));
    const repository = await adapter.open(join(directory, adapter.fileName));
    try {
      const { runtime, code } = await startMatch(repository, 'bridge', true);
      const snapshot = runtime.snapshot();
      expect(isRuntimeSnapshot(snapshot)).toBe(true);
      snapshot.games[0].replayRecording = { initial: spectatorSnapshot(code), steps: [] };
      expect(isRuntimeSnapshot(snapshot)).toBe(true);
    } finally {
      await repository.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
