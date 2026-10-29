import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameOptions, GameType } from '@shared/types';
import { createJsonRepository } from '../../src/database/json-repository';
import { CURRENT_SCHEMA_VERSION, migrateDocument } from '../../src/database/migrations';
import { emptyDocument, validateDocument } from '../../src/database/schema';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import * as rooms from '../../src/managers/room-manager';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import type { Repository } from '../../src/database/repository';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { account, resetRuntime } from '../helpers/storage-fixture';

const CHOICES: GameOptions = {
  sevens: { closeOnEnd: true, slayEffect: 'fire' },
  ninetynine: { twoDecks: true },
  blackjack: { playerDealer: true },
  napoleon: { jokerSummon: false },
  // Added after schema v9, so migrated rooms take its default.
  crazyeights: { actionCards: false },
  doudizhu: { variant: 'score' },
  gomoku: { renju: false, swap: false },
  xiangqi: { handicap: 'none', handicapSide: 'red' },
};

function fixture(gameType: GameType = 'sevens'): {
  current: ReturnType<typeof emptyDocument>;
  legacy: Record<string, unknown>;
  legacyRoom: Record<string, unknown>;
} {
  const owner = account('owner');
  const info = players.toPlayerInfo(owner);
  const code = rooms.createRoom(gameType, owner.id);
  const room = structuredClone(rooms.exportRooms()[0]);
  const runtime: RuntimeSnapshot = {
    players: [{ info, currentRoomCode: code, disconnectedAt: null }], rooms: [room], games: [], chat: [],
  };
  const current = { ...emptyDocument(), accounts: [owner], runtime };
  const { gameOptions: _options, ...rest } = room.info;
  const legacyRoom = { ...room, info: {
    ...rest, sevensOptions: CHOICES.sevens, ninetyNineOptions: CHOICES.ninetynine,
    blackjackOptions: CHOICES.blackjack, napoleonOptions: CHOICES.napoleon,
  } };
  return { current, legacyRoom, legacy: { ...current, schemaVersion: 9, runtime: { ...runtime, rooms: [legacyRoom] } } };
}

afterEach(resetRuntime);

describe('room options document migration', () => {
  it.each(['sevens', 'ninetynine', 'blackjack', 'napoleon', 'bridge'] as const)(
    'preserves every configured game when the selected game is %s', (gameType) => {
      const { legacy } = fixture(gameType);
      const before = structuredClone(legacy);
      const migrated = migrateDocument(legacy) as ReturnType<typeof emptyDocument>;
      expect(() => validateDocument(migrated)).not.toThrow();
      expect(migrated.runtime?.rooms[0].info).toMatchObject({ gameType, gameOptions: CHOICES });
      for (const field of ['sevensOptions', 'ninetyNineOptions', 'blackjackOptions', 'napoleonOptions']) {
        expect(migrated.runtime?.rooms[0].info).not.toHaveProperty(field);
      }
      expect(legacy).toEqual(before);
      expect(migrateDocument(migrated)).toBe(migrated);
    },
  );

  it('uses legacy defaults when no room options existed and preserves non-room runtime data', () => {
    const { legacy, current } = fixture();
    const untouched = { ...current.runtime, games: [{ gameType: 'sevens', options: { closeOnEnd: true } }] };
    const withoutOptions = { ...legacy, runtime: { ...untouched, rooms: current.runtime!.rooms.map((room) => {
      const { gameOptions: _options, ...info } = room.info;
      return { ...room, info };
    }) } };
    const migrated = migrateDocument(withoutOptions) as ReturnType<typeof emptyDocument>;
    expect(migrated.runtime?.rooms[0].info.gameOptions).toEqual({
      sevens: { closeOnEnd: false }, ninetynine: { twoDecks: false },
      blackjack: { playerDealer: false }, napoleon: { jokerSummon: true }, crazyeights: { actionCards: false },
      doudizhu: { variant: 'score' },
      gomoku: { renju: false, swap: false }, xiangqi: { handicap: 'none', handicapSide: 'red' },
    });
    expect(migrated.runtime?.games).toEqual(untouched.games);
    expect(migrated.runtime?.players).toEqual(untouched.players);
    expect(migrated.runtime?.chat).toEqual(untouched.chat);
  });

  it('restores an active legacy match without changing its fixed rules or private state', () => {
    const { current, legacyRoom } = fixture();
    const code = current.runtime!.rooms[0].info.code;
    const owner = current.runtime!.rooms[0].info.hostId;
    expect(rooms.changeSeat(code, players.toPlayerInfo(current.accounts[0]), 'N').success).toBe(true);
    expect(rooms.fillBots(code, owner).success).toBe(true);
    rooms.setRoomStatus(code, 'playing');
    expect(games.startGame(code, 'sevens', rooms.getSeatPlayers(code)!, undefined, CHOICES).success).toBe(true);
    const match = structuredClone(games.exportGames());
    const room = rooms.exportRooms()[0];
    const legacy = { ...current, schemaVersion: 9, runtime: {
      ...current.runtime!, games: match, rooms: [{ ...room, info: {
        ...legacyRoom.info as object, status: 'playing', seats: room.info.seats,
      } }],
    } };
    const migrated = migrateDocument(legacy) as ReturnType<typeof emptyDocument>;
    expect(() => validateDocument(migrated)).not.toThrow();
    expect(migrated.runtime!.games).toEqual(match);
    rooms.restoreRooms(migrated.runtime!.rooms);
    games.restoreGames(migrated.runtime!.games);
    expect(games.exportGames()).toEqual(match);
    expect(rooms.getRoomInfo(code)?.gameOptions).toEqual(CHOICES);
    expect(games.getPlayerVisibleState(code, 'N')).toMatchObject({ gameType: 'sevens', options: CHOICES.sevens });
  });

  it('rejects invalid legacy options even when their game is not currently selected', () => {
    const { legacy, legacyRoom, current } = fixture('bridge');
    const invalid = { ...legacy, runtime: { ...current.runtime, rooms: [{ ...legacyRoom,
      info: { ...legacyRoom.info as object, napoleonOptions: { jokerSummon: 'yes' } },
    }] } };
    expect(() => migrateDocument(invalid)).toThrow('Invalid legacy room options');
    const newFormat = structuredClone(current);
    newFormat.runtime!.rooms[0].info = { ...newFormat.runtime!.rooms[0].info, sevensOptions: { closeOnEnd: true } } as never;
    expect(() => validateDocument(newFormat)).toThrow();
  });
});

for (const engine of ['json', 'sqlite'] as const) {
  describe(`${engine} v9 room options restore`, () => {
    let directory: string;
    let repository: Repository | undefined;
    afterEach(async () => {
      await repository?.close();
      repository = undefined;
      if (directory) await rm(directory, { recursive: true, force: true });
    });

    async function prepare(invalid: boolean = false): Promise<{ path: string; legacyRoom: Record<string, unknown> }> {
      directory = await mkdtemp(join(tmpdir(), 'card-room-options-'));
      const path = join(directory, `database.${engine}`);
      const { current, legacy, legacyRoom } = fixture();
      if (invalid) (legacyRoom.info as Record<string, unknown>).blackjackOptions = { playerDealer: 'yes' };
      if (engine === 'json') await writeFile(path, JSON.stringify(legacy));
      else {
        repository = await createSqliteRepository(path);
        await repository.createAccount(current.accounts[0]);
        await repository.saveRuntime(current.runtime!);
        await repository.close();
        repository = undefined;
        const database = new DatabaseSync(path);
        try {
          database.prepare('UPDATE runtime_rooms SET data = ?').run(JSON.stringify(legacyRoom));
          database.exec('PRAGMA user_version = 9');
        } finally { database.close(); }
      }
      return { path, legacyRoom };
    }

    const open = (path: string): Promise<Repository> => engine === 'json'
      ? createJsonRepository(path) : createSqliteRepository(path);

    it('backs up v9 before migration and restores configured rules across reopening', async () => {
      const { path, legacyRoom } = await prepare();
      repository = await open(path);
      const snapshot = await repository.loadRuntime();
      expect(snapshot?.rooms[0].info.gameOptions).toEqual(CHOICES);
      rooms.restoreRooms(snapshot!.rooms);
      const code = snapshot!.rooms[0].info.code;
      const owner = snapshot!.rooms[0].info.hostId;
      expect(rooms.setGameType(code, owner, 'blackjack').success).toBe(true);
      expect(rooms.setGameType(code, owner, 'sevens').success).toBe(true);
      expect(rooms.getRoomInfo(code)?.gameOptions).toEqual(CHOICES);
      await repository.close();
      repository = undefined;
      if (engine === 'json') {
        const backup = JSON.parse(await readFile(`${path}.v9.bak`, 'utf8'));
        expect(backup.schemaVersion).toBe(9);
        expect(backup.runtime.rooms[0]).toEqual(legacyRoom);
      } else {
        const backup = new DatabaseSync(`${path}.v9.bak`, { readOnly: true });
        try {
          expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
          expect(JSON.parse(String(backup.prepare('SELECT data FROM runtime_rooms').get()?.data))).toEqual(legacyRoom);
        } finally { backup.close(); }
      }
      repository = await open(path);
      expect(await repository.loadRuntime()).toEqual(snapshot);
    });

    it('leaves the previous schema and room data intact if migration fails', async () => {
      const { path, legacyRoom } = await prepare(true);
      await expect(open(path)).rejects.toThrow('Invalid legacy room options');
      if (engine === 'json') {
        const saved = JSON.parse(await readFile(path, 'utf8'));
        expect(saved.schemaVersion).toBe(9);
        expect(saved.runtime.rooms[0]).toEqual(legacyRoom);
      } else {
        const saved = new DatabaseSync(path, { readOnly: true });
        try {
          expect(saved.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
          expect(JSON.parse(String(saved.prepare('SELECT data FROM runtime_rooms').get()?.data))).toEqual(legacyRoom);
        } finally { saved.close(); }
      }
      expect(CURRENT_SCHEMA_VERSION).toBe(10);
    });
  });
}
