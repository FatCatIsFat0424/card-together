import { afterEach, describe, expect, it } from 'vitest';
import type { ChineseCheckersGameState, GameSeat, PlayerInfo } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { matchStanding } from '@shared/rules/match-standing';
import { roomCanStart, roomPlayers } from '@shared/rules/seats';
import {
  CC_HOLES, CC_TRIANGLES, CC_TURN_LIMIT, ccIndex, ccMoves, ccNode, ccTarget,
} from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import { chineseCheckersAdapter } from '../../src/managers/games/chinesecheckers-adapter';
import * as checkers from '../../src/managers/games/chinesecheckers-game';
import {
  chineseCheckersGame, coherentChineseCheckersGame, isChineseCheckersResult,
} from '../../src/managers/games/chinesecheckers-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { gameBot } from '../../src/bots/bot-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import * as manager from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';

const CODE = 'CCHK01';
const ORDER: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6'];

function player(seat: GameSeat, isBot = false): PlayerInfo {
  return { id: seat.toLowerCase(), username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...isBot ? { isBot: true } : {} };
}

const table = (count: number): Partial<Record<GameSeat, PlayerInfo>> =>
  Object.fromEntries(ORDER.slice(0, count).map((seat) => [seat, player(seat)]));

function start(count = 2): void {
  expect(checkers.startGame(CODE, table(count), 1_000)).toEqual({ success: true });
}

function game(): ChineseCheckersGameState {
  const state = checkers.getGameState(CODE);
  if (!state) throw new Error('Expected a Chinese checkers game');
  return state;
}

/** Replaces the board with marbles at the given node ids, keyed by owner corner. */
function setBoard(marbles: Readonly<Record<string, number>>): void {
  const holes: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const [node, corner] of Object.entries(marbles)) holes[ccIndex(node)!] = corner;
  game().holes = holes;
}

const triangle = (corner: number): string[] => CC_TRIANGLES[corner].map(ccNode);
const coherent = (): boolean => coherentChineseCheckersGame(structuredClone(game()));

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Random legal moves until the match ends or `limit` moves were made. */
function playOut(seed: number, limit = Infinity): void {
  const random = seeded(seed);
  for (let made = 0; made < limit && game().phase === 'playing'; made++) {
    const seat = game().currentTurnSeat;
    const corner = checkers.chineseCheckersCorners(game())[checkers.chineseCheckersSeats(game()).indexOf(seat)];
    const moves = ccMoves(game().holes, corner);
    const move = moves[Math.floor(random() * moves.length)];
    expect(checkers.move(CODE, seat, ccNode(move.from), ccNode(move.to), 2_000 + made)).toEqual({ success: true });
  }
}

afterEach(() => checkers.abortGame(CODE));

describe('Chinese checkers setup', () => {
  it('registers a flexible board game for up to six seats on the board timer', () => {
    expect(gameDefinition('chinesecheckers')).toMatchObject({
      category: 'board', equipment: [],
      seats: { minPlayers: 2, maxPlayers: 6, playerCounts: [2, 3, 4, 6], flexible: true, expandable: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
    });
  });

  it.each([[2, [0, 3]], [3, [0, 2, 4]], [4, [0, 1, 3, 4]], [6, [0, 1, 2, 3, 4, 5]]])(
    'starts %i players in their fixed corners with the first seat moving', (count, corners) => {
      start(count);
      const view = checkers.getPlayerVisibleState(CODE, 'E')!;
      expect(view).toMatchObject({ seats: ORDER.slice(0, count), corners, currentTurnSeat: 'N', resigned: [], log: [] });
      for (const corner of corners) expect(triangle(corner).every((node) => game().holes[ccIndex(node)!] === corner)).toBe(true);
      expect(game().holes.filter((hole) => hole !== null)).toHaveLength(count * 10);
      expect(coherent()).toBe(true);
    });

  it('refuses five players', () => {
    expect(checkers.startGame(CODE, table(5))).toEqual({ success: false, reason: expect.stringContaining('2, 3, 4, or 6') });
    expect(checkers.getGameState(CODE)).toBeNull();
  });
});

describe('Chinese checkers moves', () => {
  it('moves a marble, logs the jump chain the server found, and passes the turn', () => {
    start();
    expect(checkers.move(CODE, 'N', '-2,14', '0,12', 1_500)).toEqual({ success: true });
    expect(game().log).toEqual([{ seat: 'N', from: '-2,14', to: '0,12', jump: true, timestamp: 1_500 }]);
    expect(game().currentTurnSeat).toBe('E');
    setBoard({ '0,12': 0, '1,11': 3, '3,9': 0, '0,0': 3 });
    game().currentTurnSeat = 'N';
    expect(checkers.move(CODE, 'N', '0,12', '4,8', 1_600)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({ seat: 'N', from: '0,12', to: '4,8', path: ['2,10'], jump: true, timestamp: 1_600 });
  });

  it('rejects moves out of turn, of other marbles, to unreachable holes, and after the end', () => {
    start();
    expect(checkers.move(CODE, 'E', '1,3', '2,4')).toMatchObject({ success: false, reason: 'Not your turn' });
    expect(checkers.move(CODE, 'N', '1,3', '2,4')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(checkers.move(CODE, 'N', '-3,13', '0,8')).toMatchObject({ success: false, reason: 'Illegal move' });
    expect(checkers.move(CODE, 'N', 'x', '0,8')).toMatchObject({ success: false, reason: 'Illegal move' });
    checkers.control(CODE, 'N', { type: 'resign' });
    expect(checkers.move(CODE, 'N', '-3,13', '-4,12')).toMatchObject({ success: false, reason: 'The game is over' });
  });

  it('wins a two-player race by filling the opposite corner', () => {
    start();
    // North fills its target except 3,3 and steps into it from 4,4.
    setBoard({ ...Object.fromEntries(triangle(3).filter((node) => node !== '3,3').map((node) => [node, 0])), '4,4': 0,
      ...Object.fromEntries(triangle(0).map((node) => [node, 3])) });
    expect(checkers.move(CODE, 'N', '4,4', '3,3')).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', result: { winners: ['N'], reason: 'all-home', ranks: { N: 1, E: 2 } } });
    expect(game().result).toMatchObject({ remaining: { N: 0 }, arrived: { N: 10 } });
  });

  it('counts opposing marbles left in the target as arrived (anti-spoiling)', () => {
    start();
    const top = triangle(3);
    expect(top.slice(0, 2)).toEqual(['0,0', '-1,1']);
    // East never left two holes of its corner; North fills every other hole.
    const marbles: Record<string, number> = { '0,0': 3, '-1,1': 3, '0,6': 3, '4,4': 0 };
    for (const node of top.slice(2).filter((node) => node !== '3,3')) marbles[node] = 0;
    setBoard(marbles);
    expect(checkers.move(CODE, 'N', '4,4', '3,3')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'all-home', arrived: { N: 8 } });
  });

  it('ends a multi-player race at the first finisher and places the rest by distance left', () => {
    start(3);
    const marbles: Record<string, number> = { '4,4': 0 };
    for (const node of triangle(ccTarget(0)).filter((node) => node !== '3,3')) marbles[node] = 0;
    // East is one marble short of home; South has not left its corner.
    const eastTarget = triangle(ccTarget(2));
    for (const node of eastTarget.slice(1)) marbles[node] = 2;
    marbles['0,8'] = 2;
    for (const node of triangle(4)) marbles[node] = 4;
    setBoard(marbles);
    expect(checkers.move(CODE, 'N', '4,4', '3,3')).toEqual({ success: true });
    const result = game().result!;
    expect(result.winners).toEqual(['N']);
    expect(result.ranks).toEqual({ N: 1, E: 2, S: 3 });
    expect(result.remaining.E).toBeLessThan(result.remaining.S!);
    expect(result.remaining.S).toBe(120);
    expect(matchStanding(result, 'E')).toMatchObject({ rank: 2, won: false, players: 3 });
    expect(matchStanding(result, 'N')).toMatchObject({ rank: 1, won: true });
  });

  it('skips a seat whose marbles are all blocked and logs the pass', () => {
    start(3);
    setBoard({ '0,16': 2, '-1,15': 0, '1,15': 0, '-2,14': 0, '2,14': 0, '0,8': 0, '0,0': 4 });
    expect(checkers.move(CODE, 'N', '0,8', '0,6')).toEqual({ success: false, reason: 'Illegal move' });
    expect(checkers.move(CODE, 'N', '0,8', '2,8')).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ seat: 'E' });
    expect(game().log.at(-1)!.to).toBeUndefined();
    expect(game().currentTurnSeat).toBe('S');
    expect(checkers.getPlayerVisibleState(CODE, 'S')!.log).toHaveLength(2);
  });

  it('decides the match on progress once the turn limit is reached', () => {
    start();
    for (let turn = 0; turn < CC_TURN_LIMIT; turn++) {
      game().log.push({ seat: 'N', timestamp: 1 }, { seat: 'E', timestamp: 1 });
    }
    game().log.pop();
    game().currentTurnSeat = 'E';
    expect(checkers.move(CODE, 'E', '1,3', '2,4')).toEqual({ success: true });
    expect(game().result).toMatchObject({ reason: 'move-limit', winners: ['E'] });
  });

  it('plays seeded random matches with a coherent log at every step', () => {
    for (const [count, seed] of [[2, 3], [3, 5], [4, 7], [6, 11]] as const) {
      start(count);
      for (let step = 0; step < 6 && game().phase === 'playing'; step++) {
        playOut(seed + step, 12);
        expect(coherent()).toBe(true);
      }
      checkers.abortGame(CODE);
    }
  });
});

describe('Chinese checkers resignation and draw offers', () => {
  it('gives a two-player match to the opponent when a seat resigns, even off turn', () => {
    start();
    expect(checkers.control(CODE, 'E', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', ranks: { N: 1, E: 2 } });
    expect(coherent()).toBe(true);
  });

  it('offers draws only between two players', () => {
    start();
    expect(checkers.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(checkers.control(CODE, 'E', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw', ranks: { N: 1, E: 1 } });
    expect(coherent()).toBe(true);
    checkers.abortGame(CODE);
    start(3);
    expect(checkers.control(CODE, 'N', { type: 'offer-draw' })).toMatchObject({ success: false });
  });

  it('takes a resigning seat and its marbles out of a multi-player match while the rest play on', () => {
    start(3);
    expect(checkers.control(CODE, 'E', { type: 'resign' }, 1_200)).toEqual({ success: true });
    expect(game().phase).toBe('playing');
    expect(game().resigned).toEqual(['E']);
    expect(game().holes.some((hole) => hole === 2)).toBe(false);
    expect(game().log).toEqual([{ seat: 'E', resigned: true, timestamp: 1_200 }]);
    expect(chineseCheckersAdapter.eliminationIndex!(game(), 'E')).toBe(0);
    expect(chineseCheckersAdapter.eliminationIndex!(game(), 'S')).toBe(-1);
    expect(checkers.control(CODE, 'E', { type: 'resign' })).toMatchObject({ success: false });
    // North moves; East is skipped for good.
    expect(checkers.move(CODE, 'N', '-3,13', '-4,12')).toEqual({ success: true });
    expect(game().currentTurnSeat).toBe('S');
    expect(coherent()).toBe(true);
    // South resigns on turn: North is left alone and wins; later resignations place higher.
    expect(checkers.resignationMovesTurn(CODE, 'S')).toBe(true);
    expect(checkers.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', ranks: { N: 1, S: 2, E: 3 } });
    expect(game().result!.remaining).toEqual({ N: expect.any(Number) });
    expect(coherent()).toBe(true);
  });

  it('hands the turn on when the seat on turn resigns', () => {
    start(4);
    expect(checkers.control(CODE, 'N', { type: 'resign' })).toEqual({ success: true });
    expect(game().currentTurnSeat).toBe('E');
    expect(coherent()).toBe(true);
  });
});

describe('Chinese checkers adapter and stored state', () => {
  it('routes moves and turn-moving resignations through the clock, other controls without it', () => {
    start(3);
    const timed: string[] = [];
    const context = {
      automatic: false, settings: { baseSeconds: 60, bankSeconds: 300 },
      timed: (operation: () => { success: boolean }) => { timed.push('timed'); return operation(); },
      present: (operation: () => { success: boolean }) => { timed.push('present'); return operation(); },
      simultaneous: (operation: () => { success: boolean }) => operation(),
      resetClock: () => undefined,
    };
    expect(chineseCheckersAdapter.applyAction(CODE, 'E', { type: 'resign' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual([]);
    expect(chineseCheckersAdapter.applyAction(CODE, 'N', { type: 'move', from: '-3,13', to: '-4,12' }, context as never))
      .toEqual({ success: true });
    expect(timed).toEqual(['timed']);
    expect(chineseCheckersAdapter.applyAction(CODE, 'S', { type: 'resign' }, context as never)).toEqual({ success: true });
    expect(timed).toEqual(['timed', 'timed']);
    expect(chineseCheckersAdapter.turnSeat(game())).toBeNull();
    expect(chineseCheckersAdapter.matchResult(game())).toMatchObject({ winners: ['N'] });
  });

  it('gives spectators the same public position with only the observer flag added', () => {
    start();
    checkers.move(CODE, 'N', '-3,13', '-4,12');
    const own = checkers.getPlayerVisibleState(CODE, 'E')!;
    const spectator = chineseCheckersAdapter.withObserverView(checkers.getPlayerVisibleState(CODE, 'S')!, game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', holes: own.holes, log: own.log, seats: own.seats });
    expect(Object.keys(own).sort()).toEqual(['corners', 'currentTurnSeat', 'drawOffer', 'gameType', 'holes', 'log', 'mySeat',
      'phase', 'resigned', 'result', 'seats']);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start(3);
    playOut(9, 20);
    checkers.control(CODE, 'S', { type: 'resign' }, 3_000);
    const stored = JSON.parse(JSON.stringify(game())) as Record<string, unknown>;
    const accepts = (value: unknown): boolean => gameValidator('chinesecheckers').shape(value as never, () => true)
      && gameValidator('chinesecheckers').coherent(value as ChineseCheckersGameState);
    expect(accepts(stored)).toBe(true);
    expect(chineseCheckersGame(stored, () => true)).toBe(true);

    const moved = structuredClone(stored) as { holes: (number | null)[] };
    moved.holes[moved.holes.indexOf(null)] = 0;
    expect(accepts(moved)).toBe(false);

    const wrongTurn = { ...structuredClone(stored), currentTurnSeat: game().currentTurnSeat === 'N' ? 'E' : 'N' };
    expect(accepts(wrongTurn)).toBe(false);

    const badMove = structuredClone(stored) as { log: { to?: string }[] };
    badMove.log[0].to = '0,8';
    expect(accepts(badMove)).toBe(false);

    const lostPath = structuredClone(stored) as { log: { path?: string[]; jump?: boolean }[] };
    const chain = lostPath.log.find((entry) => entry.jump);
    if (chain) {
      chain.jump = undefined;
      expect(accepts(lostPath)).toBe(false);
    }

    const unresigned = { ...structuredClone(stored), resigned: [] };
    expect(accepts(unresigned)).toBe(false);
    expect(accepts({ ...structuredClone(stored), result: { gameType: 'chinesecheckers' } })).toBe(false);
    expect(accepts({ ...structuredClone(stored), phase: 'scoring' })).toBe(false);
    const five = structuredClone(stored) as { players: Record<string, unknown> };
    five.players.W = player('W');
    five.players.P5 = player('P5');
    expect(accepts(five)).toBe(false);
  });

  it('keeps stored results consistent with their reason', () => {
    const result = {
      gameType: 'chinesecheckers', seats: ['N', 'S'], corners: { N: 0, S: 3 }, remaining: { N: 0, S: 40 },
      arrived: { N: 10, S: 2 }, ranks: { N: 1, S: 2 }, moves: 80, winners: ['N'], reason: 'all-home',
    };
    expect(isChineseCheckersResult(result)).toBe(true);
    expect(isChineseCheckersResult({ ...result, winners: [] })).toBe(false);
    expect(isChineseCheckersResult({ ...result, ranks: { N: 2, S: 1 } })).toBe(false);
    expect(isChineseCheckersResult({ ...result, corners: { N: 0, S: 2 } })).toBe(false);
    expect(isChineseCheckersResult({ ...result, reason: 'agreed-draw' })).toBe(false);
    expect(isChineseCheckersResult({ ...result, reason: 'agreed-draw', winners: [], ranks: { N: 1, S: 1 } })).toBe(true);
    expect(isChineseCheckersResult({ ...result, reason: 'disc-count' })).toBe(false);
    expect(isChineseCheckersResult({ ...result, seats: ['N'] })).toBe(false);
    expect(isChineseCheckersResult({ ...result, seats: ['N', 'E', 'S', 'W', 'P5'] })).toBe(false);
  });
});

describe('Chinese checkers bots through the registry', () => {
  it.each([2, 3, 6])('plays only legal moves in a full %i-player bot match on both difficulties', (count) => {
    start(count);
    for (let guard = 0; guard < 2_000 && game().phase === 'playing'; guard++) {
      const seat = game().currentTurnSeat;
      const view = checkers.getPlayerVisibleState(CODE, seat)!;
      const action = getBotAction(view, seeded(guard), ORDER.indexOf(seat) % 2 === 0 ? 'hard' : 'easy');
      expect(action).toMatchObject({ type: 'game-action', request: { gameType: 'chinesecheckers', action: { type: 'move' } } });
      const request = (action as { request: { action: { from: string; to: string } } }).request.action;
      expect(checkers.move(CODE, seat, request.from, request.to)).toEqual({ success: true });
    }
    expect(game().result).toMatchObject({ reason: 'all-home' });
    expect(coherent()).toBe(true);
  });

  it('returns nothing off turn or after the end, and the fallbacks are legal moves', () => {
    start();
    expect(getBotAction(checkers.getPlayerVisibleState(CODE, 'E')!, Math.random, 'easy')).toBeNull();
    const bot = gameBot('chinesecheckers');
    expect(bot.firstLegal(checkers.getPlayerVisibleState(CODE, 'E')!)).toBeNull();
    const first = bot.firstLegal(checkers.getPlayerVisibleState(CODE, 'N')!);
    const request = (first as { request: { action: { from: string; to: string } } }).request.action;
    expect(checkers.move(CODE, 'N', request.from, request.to)).toEqual({ success: true });
    const timeout = bot.turnTimeout!(checkers.getPlayerVisibleState(CODE, 'E')!, { isBot: false, strategy: () => null });
    const timed = (timeout as { request: { action: { from: string; to: string } } }).request.action;
    expect(checkers.move(CODE, 'E', timed.from, timed.to)).toEqual({ success: true });
    checkers.control(CODE, 'N', { type: 'resign' });
    expect(getBotAction(checkers.getPlayerVisibleState(CODE, 'E')!, Math.random, 'hard')).toBeNull();
  });

  it('never moves for a seat that resigned', () => {
    start(3);
    checkers.control(CODE, 'N', { type: 'resign' });
    const view = checkers.getPlayerVisibleState(CODE, 'N')!;
    expect(getBotAction({ ...view, currentTurnSeat: 'N' }, Math.random, 'hard')).toBeNull();
  });
});

describe('Chinese checkers through the game manager and rooms', () => {
  const MANAGED = 'CCHKM1';
  let room = '';
  afterEach(() => {
    manager.removeGame(MANAGED);
    if (room) {
      manager.removeGame(room);
      rooms.removeRoom(room);
      room = '';
    }
  });

  it('refuses to start five players and runs the turn clock for the seat on move', () => {
    expect(manager.startGame(MANAGED, 'chinesecheckers', table(5))).toMatchObject({ success: false });
    expect(manager.startGame(MANAGED, 'chinesecheckers', table(3))).toEqual({ success: true });
    manager.initializeClock(MANAGED);
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'N' });
    expect(manager.handleGameAction(MANAGED, 'N', { gameType: 'chinesecheckers', action: { type: 'move', from: '-3,13', to: '-4,12' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'E' });
    // East resigns on turn: the clock moves to South.
    expect(manager.handleGameAction(MANAGED, 'E', { gameType: 'chinesecheckers', action: { type: 'resign' } }))
      .toEqual({ success: true });
    expect(manager.getGameState(MANAGED)?.clock?.turn).toMatchObject({ seat: 'S' });
    expect(manager.getRecipientVisibleState(MANAGED, 'E')).toMatchObject({ observer: 'eliminated' });
    const state = JSON.parse(JSON.stringify(manager.getGameState(MANAGED))) as ChineseCheckersGameState;
    expect(gameValidator('chinesecheckers').shape(state as never, () => true)).toBe(true);
    expect(gameValidator('chinesecheckers').coherent(state)).toBe(true);
  });

  it('ends without a record when aborted', () => {
    expect(manager.startGame(MANAGED, 'chinesecheckers', table(6))).toEqual({ success: true });
    manager.abortGame(MANAGED);
    expect(manager.getGameState(MANAGED)).toBeNull();
  });

  it('restores an exported match unchanged after a restart', () => {
    start(4);
    playOut(4, 10);
    const exported = JSON.parse(JSON.stringify(checkers.exportGames())) as ChineseCheckersGameState[];
    checkers.restoreGames(exported);
    expect(checkers.getGameState(CODE)).toEqual(exported[0]);
    expect(coherent()).toBe(true);
    playOut(5, 4);
    expect(coherent()).toBe(true);
  });

  it('starts a waiting room only with 2, 3, 4, or 6 seated players', () => {
    const human = player('N');
    players.attachPlayer('socket-cc', human);
    room = rooms.createRoom('chinesecheckers', human.id);
    players.setPlayerRoom(human.id, room);
    expect(rooms.changeSeat(room, human, 'N')).toEqual({ success: true });
    expect(rooms.addBot(room, human.id, 'S')).toEqual({ success: true });
    expect(roomCanStart(rooms.getRoomInfo(room)!)).toBe(true);
    expect(rooms.fillBots(room, human.id)).toEqual({ success: true });
    expect(Object.keys(roomPlayers(rooms.getRoomInfo(room)!))).toEqual(['N', 'E', 'S', 'W']);
    expect(roomCanStart(rooms.getRoomInfo(room)!)).toBe(true);
    expect(rooms.addSeat(room, human.id)).toEqual({ success: true });
    expect(rooms.addBot(room, human.id, 'P5')).toEqual({ success: true });
    expect(roomCanStart(rooms.getRoomInfo(room)!)).toBe(false);
    expect(rooms.addSeat(room, human.id)).toEqual({ success: true });
    expect(rooms.addBot(room, human.id, 'P6')).toEqual({ success: true });
    expect(roomCanStart(rooms.getRoomInfo(room)!)).toBe(true);
    expect(rooms.addSeat(room, human.id)).toMatchObject({ success: false });
  });
});
