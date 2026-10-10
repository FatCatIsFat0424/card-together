import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import type { MatchRecord } from '../../src/database/repository';
import * as chat from '../../src/managers/chat-manager';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import { getTurnSeat } from '../../src/managers/game-clock';
import { AUTOMATED_ABORT_MESSAGE, MAX_AUTOMATED_FAILURES, performAutomatedTurn } from '../../src/runtime/automated-action';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function human(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function bot(seat: Seat): PlayerInfo {
  return { ...human(`bot:${seat}`), isBot: true };
}

describe('bots-only tables', () => {
  beforeEach(() => {
    rooms.restoreRooms([]);
    games.restoreGames([]);
  });

  it('should keep one seat for a player while no human is seated', () => {
    const code = rooms.createRoom('holdem', 'host');
    expect(rooms.fillBots(code, 'host').success).toBe(true);
    expect(SEATS.filter((seat) => rooms.getRoomInfo(code)!.seats[seat].player?.isBot)).toHaveLength(3);
    const empty = SEATS.find((seat) => !rooms.getRoomInfo(code)!.seats[seat].player)!;
    expect(rooms.addBot(code, 'host', empty)).toEqual({ success: false, reason: 'Leave a seat for a player.' });
    expect(rooms.isAllReady(code)).toBe(false);
    expect(rooms.changeSeat(code, human('host'), empty).success).toBe(true);
    expect(rooms.setReady(code, 'host', true).success).toBe(true);
    expect(rooms.isAllReady(code)).toBe(true);
  });

  it('should finish a bots-only match without a match record', async () => {
    const saved: (readonly MatchRecord[] | undefined)[] = [];
    const runtime = await createRuntimeCoordinator({
      loadRuntime: async () => null,
      saveRuntime: async (_state, matches) => { saved.push(matches); },
    });
    const code = rooms.createRoom('bridge', 'host');
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, 'bridge', { N: bot('N'), E: bot('E'), S: bot('S'), W: bot('W') });
    await runtime.mutate(() => {
      // Stands in for the final action of the match.
      games.getGameState(code)!.result = { contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true };
    });
    expect(saved).toEqual([[]]);
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
  });
});

describe('automated turns that never commit', () => {
  const code = 'STUCK1';

  beforeEach(() => {
    rooms.restoreRooms([]);
    games.restoreGames([]);
    chat.restoreChat([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('should abort the match once the fallback also keeps failing, reporting about a human seat', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rooms.createRoom('bridge', 'host');
    const [created] = rooms.exportRooms();
    rooms.restoreRooms([{ ...created, info: { ...created.info, code, status: 'playing' } }]);
    chat.initRoomChat(code);
    games.startGame(code, 'bridge', { N: human('host'), E: bot('E'), S: bot('S'), W: bot('W') });
    const seat = getTurnSeat(games.getGameState(code)!) ?? 'E';
    const choose = vi.fn(() => null);
    performAutomatedTurn(code, seat, MAX_AUTOMATED_FAILURES * 2, choose);
    expect(choose).not.toHaveBeenCalled();
    expect(games.getGameState(code)).toBeNull();
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(chat.getChatHistory(code)).toMatchObject([{ system: true, content: AUTOMATED_ABORT_MESSAGE,
      sender: { id: 'host' } }]);
  });
});

describe('abandoned rooms', () => {
  beforeEach(() => rooms.restoreRooms([]));

  it('should find rooms whose human members have all gone', () => {
    const kept = rooms.createRoom('bridge', 'host');
    const orphan = rooms.createRoom('bridge', 'ghost');
    rooms.changeSeat(orphan, human('ghost'), 'N');
    rooms.addBot(orphan, 'ghost', 'E');
    const present = (id: string, room: string): boolean => id === 'host' && room === kept;
    expect(rooms.findAbandonedRooms(present)).toEqual([orphan]);
    rooms.removeRoom(orphan);
    expect(rooms.getRoomInfo(orphan)).toBeNull();
    expect(rooms.findAbandonedRooms(present)).toEqual([]);
  });
});
