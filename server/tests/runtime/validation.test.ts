import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BridgeGameState, PlayerInfo, Seat } from '@shared/types';
import { createJsonRepository } from '../../src/database/json-repository';
import { createBiddingState, applyBid } from '../../src/engine/bidding';
import { createDeck } from '../../src/engine/deck';
import { completeTrick, createPlayingState } from '../../src/engine/playing';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function board(snapshot: RuntimeSnapshot): BridgeGameState {
  return snapshot.games[0] as BridgeGameState;
}

/** A full table waiting for its first bid, with all 52 distinct cards. */
function biddingSnapshot(): RuntimeSnapshot {
  const players = { N: player('north'), E: player('east'), S: player('south'), W: player('west') };
  const deck = createDeck();
  const game: BridgeGameState = {
    gameType: 'bridge',
    id: 'board-1',
    roomCode: 'ABC123',
    startedAt: 100,
    players,
    phase: 'bidding',
    hands: {
      N: deck.slice(0, 13),
      E: deck.slice(13, 26),
      S: deck.slice(26, 39),
      W: deck.slice(39),
    },
    dealerSeat: 'W',
    bidding: createBiddingState('N'),
    contract: null,
    playing: null,
    result: null,
    log: [],
    redealPendingSeat: null,
    redealDeclinedSeats: [],
  };
  return {
    players: SEATS.map((seat) => ({
      info: players[seat],
      currentRoomCode: 'ABC123',
      disconnectedAt: null,
    })),
    rooms: [
      {
        info: {
          code: 'ABC123',
          gameType: 'bridge',
          status: 'playing',
          createdAt: 100,
          hostId: 'north',
          abortVote: null,
          abortVoteCooldownUntil: null,
          seats: {
            N: { player: players.N, isReady: true },
            E: { player: players.E, isReady: true },
            S: { player: players.S, isReady: true },
            W: { player: players.W, isReady: true },
          },
        },
        memberIds: SEATS.map((seat) => players[seat].id),
      },
    ],
    games: [game],
    chat: [{ roomCode: 'ABC123', messages: [] }],
  };
}

function playingSnapshot(): RuntimeSnapshot {
  const snapshot = biddingSnapshot();
  const game = board(snapshot);
  let bids = createBiddingState('N');
  for (const seat of SEATS)
    bids = applyBid(
      bids,
      seat,
      seat === 'N' ? { type: 'bid', level: 1, suit: 'clubs' } : { type: 'pass' },
    );
  game.phase = 'playing';
  game.bidding = bids;
  game.contract = { declarer: 'N', level: 1, suit: 'clubs' };
  game.playing = createPlayingState('W');
  return snapshot;
}

function scoringSnapshot(): RuntimeSnapshot {
  const snapshot = playingSnapshot();
  const game = board(snapshot);
  let playing = game.playing!;
  for (let index = 0; index < 13; index += 1) {
    playing = completeTrick(
      playing,
      'N',
      {
        N: game.hands.N[index],
        E: game.hands.E[index],
        S: game.hands.S[index],
        W: game.hands.W[index],
      },
      index === 0 ? 'W' : 'N',
    );
  }
  game.phase = 'scoring';
  game.playing = playing;
  game.hands = { N: [], E: [], S: [], W: [] };
  game.result = {
    contract: game.contract!,
    declarerTeamTricks: 13,
    defenderTeamTricks: 0,
    requiredTricks: 7,
    declarerTeamWins: true,
  };
  snapshot.rooms[0].info = { ...snapshot.rooms[0].info, status: 'waiting' };
  return snapshot;
}

describe('persisted runtime validation', () => {
  it('should retain official sticker IDs and reject mixed or untrusted persisted sticker content', () => {
    const snapshot = biddingSnapshot();
    const message = { id: 'official-sticker', sender: player('north'), content: '', timestamp: 101,
      shopSticker: 'table-hello' as const };
    snapshot.chat[0].messages = [message];
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    for (const patch of [
      { shopSticker: 'unknown' }, { shopSticker: '../outside.svg' }, { shopSticker: { id: 'table-hello' } },
      { content: 'mixed' }, { emojis: {} }, { providedEmojis: {} }, { system: true },
      { providedSticker: { name: 'wave', file: `wave-${'a'.repeat(24)}.png` } },
      { sticker: { id: 'x', name: 'wave', mediaId: `${'a'.repeat(64)}.png` } },
      { url: 'https://example.com/a.svg' },
    ]) {
      snapshot.chat[0].messages = [{ ...message, ...patch } as unknown as typeof message];
      expect(isRuntimeSnapshot(snapshot)).toBe(false);
    }
  });

  it('should accept empty, bidding, playing, and finished snapshots produced by the game lifecycle', () => {
    expect(isRuntimeSnapshot({ players: [], rooms: [], games: [], chat: [] })).toBe(true);
    expect(isRuntimeSnapshot(biddingSnapshot())).toBe(true);
    expect(isRuntimeSnapshot(playingSnapshot())).toBe(true);
    expect(isRuntimeSnapshot(scoringSnapshot())).toBe(true);
  });

  it('should reject a player pointing to a room that does not list them as a member', () => {
    const snapshot = biddingSnapshot();
    snapshot.games = [];
    snapshot.rooms[0].info = {
      ...snapshot.rooms[0].info,
      status: 'waiting',
      seats: { ...snapshot.rooms[0].info.seats, N: { player: null, isReady: false } },
    };
    snapshot.rooms[0].memberIds = snapshot.rooms[0].memberIds.filter((id) => id !== 'north');
    expect(isRuntimeSnapshot(snapshot)).toBe(false);
  });

  it('should reject a room member whose player state points elsewhere or is missing', () => {
    for (const mutate of [
      (snapshot: RuntimeSnapshot): void => {
        snapshot.players[0].currentRoomCode = null;
      },
      (snapshot: RuntimeSnapshot): void => {
        snapshot.players.splice(0, 1);
      },
    ]) {
      const snapshot = biddingSnapshot();
      mutate(snapshot);
      expect(isRuntimeSnapshot(snapshot)).toBe(false);
    }
  });

  it('should reject duplicate room memberships and duplicate occupied seats', () => {
    const duplicateMember = biddingSnapshot();
    const extraRoom = structuredClone(duplicateMember.rooms[0]);
    extraRoom.info = { ...extraRoom.info, code: 'SECOND', status: 'waiting' };
    duplicateMember.rooms.push(extraRoom);
    expect(isRuntimeSnapshot(duplicateMember)).toBe(false);
    const duplicateSeat = biddingSnapshot();
    duplicateSeat.rooms[0].info = {
      ...duplicateSeat.rooms[0].info,
      seats: {
        ...duplicateSeat.rooms[0].info.seats,
        E: { player: duplicateSeat.games[0].players.N ?? null, isReady: true },
      },
    };
    expect(isRuntimeSnapshot(duplicateSeat)).toBe(false);
  });

  it('should reject playing rooms with no active game and active games in waiting rooms', () => {
    const missingGame = biddingSnapshot();
    missingGame.games = [];
    expect(isRuntimeSnapshot(missingGame)).toBe(false);
    const waitingRoom = playingSnapshot();
    waitingRoom.rooms[0].info = { ...waitingRoom.rooms[0].info, status: 'waiting' };
    expect(isRuntimeSnapshot(waitingRoom)).toBe(false);
    const finishedRoom = scoringSnapshot();
    finishedRoom.rooms[0].info = { ...finishedRoom.rooms[0].info, status: 'playing' };
    expect(isRuntimeSnapshot(finishedRoom)).toBe(false);
  });

  it('should require every active game participant to remain in their original seat', () => {
    const switched = playingSnapshot();
    const seatMap = switched.rooms[0].info.seats;
    switched.rooms[0].info = {
      ...switched.rooms[0].info,
      seats: { ...seatMap, N: seatMap.E, E: seatMap.N },
    };
    expect(isRuntimeSnapshot(switched)).toBe(false);
    const repeated = playingSnapshot();
    repeated.games[0].players.N = repeated.games[0].players.E;
    expect(isRuntimeSnapshot(repeated)).toBe(false);
  });

  it('should reject phase state that cannot resume a legal game action', () => {
    for (const mutate of [
      (game: BridgeGameState): void => {
        game.bidding = null;
      },
      (game: BridgeGameState): void => {
        game.contract = null;
      },
      (game: BridgeGameState): void => {
        game.playing = null;
      },
      (game: BridgeGameState): void => {
        game.redealPendingSeat = 'N';
      },
      (game: BridgeGameState): void => {
        game.phase = 'scoring';
      },
      (game: BridgeGameState): void => {
        game.phase = 'bidding';
      },
      (game: BridgeGameState): void => {
        game.contract = { level: 2, suit: 'hearts', declarer: 'S' };
      },
    ]) {
      const snapshot = playingSnapshot();
      mutate(board(snapshot));
      expect(isRuntimeSnapshot(snapshot)).toBe(false);
    }
    const noBids = biddingSnapshot();
    board(noBids).bidding = null;
    expect(isRuntimeSnapshot(noBids)).toBe(false);
  });

  it('should require a pending redeal seat that has not already declined', () => {
    const snapshot = biddingSnapshot();
    const game = board(snapshot);
    game.phase = 'redeal_pending';
    game.bidding = null;
    game.redealPendingSeat = 'N';
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    game.redealDeclinedSeats = ['N'];
    expect(isRuntimeSnapshot(snapshot)).toBe(false);
    game.redealDeclinedSeats = [];
    game.redealPendingSeat = null;
    expect(isRuntimeSnapshot(snapshot)).toBe(false);
  });

  it('should permit a completed board to retain participants after they leave or change seats', () => {
    const snapshot = scoringSnapshot();
    snapshot.players = snapshot.players.filter((entry) => entry.info.id !== 'north');
    snapshot.rooms[0].memberIds = snapshot.rooms[0].memberIds.filter((id) => id !== 'north');
    const original = snapshot.rooms[0].info.seats;
    snapshot.rooms[0].info = {
      ...snapshot.rooms[0].info,
      hostId: 'east',
      seats: {
        ...original,
        N: { player: original.E.player, isReady: false },
        E: { player: null, isReady: false },
      },
    };
    snapshot.chat[0].messages.push({
      id: 'historical-message',
      sender: player('north'),
      content: 'Good game',
      timestamp: 100,
    });
    expect(isRuntimeSnapshot(snapshot)).toBe(true);
    expect(snapshot.games[0].players.N?.id).toBe('north');
  });

  it('should reject incomplete or contradictory finished results', () => {
    for (const mutate of [
      (game: BridgeGameState): void => {
        game.result = null;
      },
      (game: BridgeGameState): void => {
        game.playing = { ...game.playing!, trickCountNS: 12 };
      },
      (game: BridgeGameState): void => {
        game.hands.N = [{ suit: 'clubs', rank: 2 }];
      },
      (game: BridgeGameState): void => {
        game.result = { ...game.result!, declarerTeamWins: false };
      },
      (game: BridgeGameState): void => {
        game.result = { ...game.result!, contract: { level: 1, suit: 'nt', declarer: 'N' } };
      },
    ]) {
      const snapshot = scoringSnapshot();
      mutate(board(snapshot));
      expect(isRuntimeSnapshot(snapshot)).toBe(false);
    }
  });

  it('should refuse to open inconsistent persisted runtime without modifying the database file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-runtime-validation-'));
    const path = join(directory, 'database.json');
    try {
      const runtime = biddingSnapshot();
      runtime.players[0].currentRoomCode = null;
      const content = JSON.stringify({
        schemaVersion: 1,
        runtime,
        accounts: [],
        sessions: [],
        friendships: [],
        matches: [],
      });
      await writeFile(path, content);
      await expect(createJsonRepository(path)).rejects.toThrow(
        'Invalid or unsupported database schema',
      );
      expect(await readFile(path, 'utf8')).toBe(content);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
