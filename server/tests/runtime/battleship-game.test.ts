import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleshipGameState, BattleshipVisibleState, GameSeat, PlayerInfo, RoomCode } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import {
  BS_SHIPS, DEFAULT_BATTLESHIP_OPTIONS, bsFleetError, bsIndex, bsNode, bsRandomFleet, bsShipCells,
} from '@shared/rules/battleship';
import type { BattleshipOptions, BsFleet, BsPlacement } from '@shared/rules/battleship';
import { battleshipFacts } from '@shared/stats/battleship';
import * as battleship from '../../src/managers/games/battleship-game';
import { battleshipAdapter } from '../../src/managers/games/battleship-adapter';
import { battleshipGame, coherentBattleshipGame, isBattleshipResult } from '../../src/managers/games/battleship-validation';
import { gameValidator } from '../../src/managers/games/validation-registry';
import { getBotAction } from '../../src/bots/bot-decisions';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startSharedDeadlines } from '../../src/runtime/shared-deadline';
import { captureReplaySnapshot } from '../../src/runtime/replay-recording';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const CODE = 'BSHIP1';
const PLACE_MS = 360_000;
/** Each ship in its own even row from column A. */
const ROWS: BsPlacement[] = BS_SHIPS.map((_, index) => ({ cell: index * 20, vertical: false }));
/** Each ship in its own even column from row 1. */
const COLUMNS: BsPlacement[] = BS_SHIPS.map((_, index) => ({ cell: index * 2, vertical: true }));

function player(seat: GameSeat, isBot = false): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...isBot ? { isBot: true } : {} };
}

function start(seats: readonly GameSeat[] = ['N', 'S'], bots = false, options: BattleshipOptions = DEFAULT_BATTLESHIP_OPTIONS): void {
  battleship.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat, bots)])), options, PLACE_MS, 1_000);
}

function game(): BattleshipGameState {
  const state = battleship.getGameState(CODE);
  if (!state) throw new Error('Expected a Battleship game');
  return state;
}

const view = (seat: GameSeat): BattleshipVisibleState => battleship.getPlayerVisibleState(CODE, seat)!;
const coherent = (): boolean => coherentBattleshipGame(structuredClone(game()));
const node = (col: number, row: number): string => bsNode(bsIndex(col, row));

function placeBoth(first: BsFleet = ROWS, second: BsFleet = COLUMNS): void {
  const [a, b] = battleship.battleshipSeats(game());
  expect(battleship.placeFleet(CODE, a, first, false, 2_000)).toEqual({ success: true });
  expect(battleship.placeFleet(CODE, b, second, false, 2_000)).toEqual({ success: true });
}

/** Every cell of a fleet, ship by ship. */
const fleetCells = (fleet: BsFleet): number[] => fleet.flatMap((placement, index) => bsShipCells(BS_SHIPS[index], placement)!);

function apply(seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'battleship') throw new Error('Expected a Battleship action');
  const request = action.request.action;
  const result = request.type === 'place-fleet' ? battleship.placeFleet(CODE, seat, request.fleet, true, 3_000)
    : request.type === 'fire' ? battleship.fire(CODE, seat, request.to, 3_000)
      : { success: false as const, reason: 'Unexpected control' };
  expect(result).toEqual({ success: true });
}

/** A seated view never carries the opponent's fleet before the match is over. */
function hiddenFleet(visible: BattleshipVisibleState): boolean {
  if (visible.phase === 'scoring') return true;
  return Object.keys(visible.fleets).every((seat) => seat === visible.mySeat);
}

afterEach(() => battleship.abortGame(CODE));

describe('Battleship setup and placement', () => {
  it('registers a two-player flexible board game with room rules, resignation, and no draw offers', () => {
    expect(gameDefinition('battleship')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: false }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
      options: { defaults: { noTouching: false, hitAgain: false } },
    });
  });

  it('starts with both seats placing against one deadline', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'placing', placeDeadline: 1_000 + PLACE_MS, log: [], result: null, currentTurnSeat: 'E' });
    expect(battleship.pendingSeats(game())).toEqual(['E', 'W']);
    expect(view('W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', placed: [], fleets: {} });
    expect(coherent()).toBe(true);
  });

  it('shows a placed fleet only to its owner and starts play with the first seat once both are placed', () => {
    start();
    expect(battleship.placeFleet(CODE, 'S', COLUMNS, false, 2_000)).toEqual({ success: true });
    expect(view('S')).toMatchObject({ placed: ['S'], fleets: { S: COLUMNS } });
    expect(view('N')).toMatchObject({ placed: ['S'], fleets: {} });
    expect(game().phase).toBe('placing');
    expect(battleship.placeFleet(CODE, 'N', ROWS, false, 2_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'N' });
    expect(coherent()).toBe(true);
  });

  it('rejects illegal, repeated, outsider, and late manual fleets but accepts automatic late ones', () => {
    start(['N', 'S'], false, { noTouching: true, hitAgain: false });
    const touching = [...ROWS.slice(0, 4), { cell: 10, vertical: false }];
    expect(battleship.placeFleet(CODE, 'N', touching, false, 2_000)).toMatchObject({ success: false, reason: 'Ships may not touch in this room.' });
    expect(battleship.placeFleet(CODE, 'E', ROWS, false, 2_000).success).toBe(false);
    expect(battleship.placeFleet(CODE, 'N', ROWS, false, 2_000).success).toBe(true);
    expect(battleship.placeFleet(CODE, 'N', COLUMNS, false, 2_000).success).toBe(false);
    expect(battleship.placeFleet(CODE, 'S', COLUMNS, false, 1_000 + PLACE_MS).success).toBe(false);
    expect(battleship.fire(CODE, 'N', node(0, 0)).success).toBe(false);
    expect(battleship.placeFleet(CODE, 'S', COLUMNS, true, 1_000 + PLACE_MS)).toEqual({ success: true });
    expect(game().autoPlaced).toEqual(['S']);
    expect(coherent()).toBe(true);
  });
});

describe('Battleship shots', () => {
  it('records misses, hits, and sinkings with the ship name, and alternates turns', () => {
    start();
    placeBoth();
    // N shoots at S's columns: A1–A5 is S's carrier, C1–C4 its battleship.
    expect(battleship.fire(CODE, 'N', node(1, 0), 5_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({ seat: 'N', to: node(1, 0), result: 'miss', timestamp: 5_000 });
    expect(game().currentTurnSeat).toBe('S');
    expect(battleship.fire(CODE, 'S', node(0, 8), 5_000)).toEqual({ success: true });
    expect(battleship.fire(CODE, 'N', node(8, 0), 5_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toMatchObject({ result: 'hit' });
    expect(game().log.at(-1)).not.toHaveProperty('ship');
    expect(battleship.fire(CODE, 'S', node(1, 8), 5_000)).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({
      seat: 'S', to: node(1, 8), result: 'sunk', ship: 'destroyer', sunkCells: [node(0, 8), node(1, 8)], timestamp: 5_000,
    });
    expect(coherent()).toBe(true);
  });

  it('rejects shots out of turn, repeated cells, and off the sea', () => {
    start();
    placeBoth();
    expect(battleship.fire(CODE, 'S', node(0, 0)).success).toBe(false);
    expect(battleship.fire(CODE, 'N', node(0, 0)).success).toBe(true);
    expect(battleship.fire(CODE, 'S', node(0, 0)).success).toBe(true);
    expect(battleship.fire(CODE, 'N', node(0, 0))).toMatchObject({ success: false, reason: 'That cell was already shot' });
    expect(battleship.fire(CODE, 'N', '10,0').success).toBe(false);
  });

  it('gives another shot after a hit only when the room allows it', () => {
    start(['N', 'S'], false, { noTouching: false, hitAgain: true });
    placeBoth();
    expect(battleship.fire(CODE, 'N', node(0, 0)).success).toBe(true);
    expect(game().currentTurnSeat).toBe('N');
    expect(battleship.fire(CODE, 'N', node(1, 0)).success).toBe(true);
    expect(game().currentTurnSeat).toBe('S');
    expect(coherent()).toBe(true);
  });

  it('ends when the last ship sinks, credits the shooter, and reveals both fleets', () => {
    start(['N', 'S'], false, { noTouching: false, hitAgain: true });
    placeBoth();
    for (const cell of fleetCells(COLUMNS)) expect(battleship.fire(CODE, 'N', bsNode(cell), 6_000)).toEqual({ success: true });
    expect(game()).toMatchObject({ phase: 'scoring', result: {
      gameType: 'battleship', seats: ['N', 'S'], winners: ['N'], reason: 'fleet-sunk',
      shots: { N: 17, S: 0 }, hits: { N: 17, S: 0 }, sunk: { N: 5, S: 0 },
    } });
    expect(view('S').fleets).toEqual({ N: ROWS, S: COLUMNS });
    expect(matchStanding(game().result!, 'N')).toMatchObject({ rank: 1 });
    expect(isBattleshipResult(structuredClone(game().result))).toBe(true);
    expect(coherent()).toBe(true);
  });

  it('lets a seat resign while placing or playing but refuses draw offers', () => {
    start();
    expect(battleship.control(CODE, 'N', { type: 'offer-draw' }).success).toBe(false);
    expect(battleship.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', shots: { N: 0, S: 0 } });
    expect(coherent()).toBe(true);
    battleship.abortGame(CODE);
    start();
    placeBoth();
    expect(battleship.fire(CODE, 'N', node(0, 0)).success).toBe(true);
    expect(battleship.control(CODE, 'N', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['S'], reason: 'resign', shots: { N: 1, S: 0 }, hits: { N: 1 } });
    expect(coherent()).toBe(true);
  });
});

describe('Battleship hidden fleets', () => {
  it('never puts the opponent fleet in a seated view or its shot log before the end', () => {
    const logs: string[] = [];
    for (const opponent of [COLUMNS, bsRandomFleet(seededRandom(9), DEFAULT_BATTLESHIP_OPTIONS)]) {
      start();
      placeBoth(ROWS, opponent);
      for (let step = 0; step < 30 && game().phase === 'playing'; step++) {
        const seat = game().currentTurnSeat;
        apply(seat, gameBot('battleship').easy(view(seat), seededRandom(step + 1)));
      }
      for (const seat of ['N', 'S'] as const) {
        const visible = view(seat);
        expect(hiddenFleet(visible)).toBe(true);
        expect(visible).not.toHaveProperty('replayRecording');
        expect(JSON.stringify(visible)).not.toContain(JSON.stringify(seat === 'N' ? opponent : ROWS));
        for (const entry of visible.log) {
          expect(Object.keys(entry).every((key) => ['seat', 'to', 'result', 'ship', 'sunkCells', 'timestamp'].includes(key))).toBe(true);
          if (entry.result !== 'sunk') expect(entry.ship ?? entry.sunkCells).toBeUndefined();
        }
      }
      battleship.abortGame(CODE);
      // Before any shot the opponent's side of a view is the same whatever it placed.
      start();
      placeBoth(ROWS, opponent);
      logs.push(JSON.stringify(view('N')));
      battleship.abortGame(CODE);
    }
    expect(logs[0]).toBe(logs[1]);
  });

  it('gives unseated spectators and replays both fleets but never seated players', () => {
    start();
    placeBoth();
    expect(battleship.fire(CODE, 'N', node(0, 0)).success).toBe(true);
    const spectator = battleshipAdapter.withObserverView(view('S'), game(), 'spectator');
    expect(spectator).toMatchObject({ observer: 'spectator', fleets: { N: ROWS, S: COLUMNS } });
    expect(view('S').fleets).toEqual({ S: COLUMNS });
    // A seat outside the match (the spectator base view) sees no fleet at all.
    expect(view('E').fleets).toEqual({});
    // Replays record what an unseated spectator receives.
    expect(captureReplaySnapshot(game())).toMatchObject({ gameType: 'battleship', fleets: { N: ROWS, S: COLUMNS } });
  });

  it('feeds bots only their own filtered view', () => {
    start(['N', 'S'], true);
    const seen: BattleshipVisibleState[] = [];
    const strategy = gameBot('battleship');
    const record = (visible: BattleshipVisibleState): BattleshipVisibleState => {
      seen.push(structuredClone(visible));
      return visible;
    };
    apply('N', strategy.hard(record(view('N')), seededRandom(1)));
    apply('S', strategy.hard(record(view('S')), seededRandom(2)));
    for (let step = 0; step < 60 && game().phase === 'playing'; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, strategy.hard(record(view(seat)), seededRandom(step + 3)));
    }
    expect(seen.every(hiddenFleet)).toBe(true);
    expect(seen.every((visible) => !('replayRecording' in visible))).toBe(true);
  });

  it('builds statistics from the public shot totals only', () => {
    start(['N', 'S'], false, { noTouching: false, hitAgain: true });
    placeBoth();
    expect(battleship.fire(CODE, 'N', node(9, 9)).success).toBe(true);
    for (const cell of fleetCells(ROWS).slice(0, 3)) expect(battleship.fire(CODE, 'S', bsNode(cell)).success).toBe(true);
    expect(battleship.fire(CODE, 'S', node(9, 9)).success).toBe(true);
    for (const cell of fleetCells(COLUMNS)) expect(battleship.fire(CODE, 'N', bsNode(cell)).success).toBe(true);
    const result = game().result!;
    expect(battleshipFacts(result, 'N')).toMatchObject({
      counts: { fleetsSunk: 1, shipsSunk: 5 }, sums: { shotsFired: 18, shotsHit: 17 }, values: { fewestShots: 18 },
    });
    const loser = battleshipFacts(result, 'S');
    expect([loser.counts, loser.sums, loser.values]).toEqual([{}, { shotsFired: 4, shotsHit: 3 }, {}]);
  });
});

describe('Battleship bots and stored state', () => {
  it.each(['easy', 'hard'] as const)('places legal fleets and shoots only new cells to the end on %s', (difficulty) => {
    for (const options of [DEFAULT_BATTLESHIP_OPTIONS, { noTouching: true, hitAgain: true }]) {
      start(['N', 'S'], true, options);
      const random = seededRandom(difficulty === 'easy' ? 11 : 12);
      for (const seat of ['N', 'S'] as const) apply(seat, getBotAction(view(seat), random, difficulty));
      expect(bsFleetError(game().fleets.N, options)).toBeNull();
      for (let step = 0; step < 200 && game().phase === 'playing'; step++) {
        const seat = game().currentTurnSeat;
        apply(seat, getBotAction(view(seat), random, difficulty));
      }
      expect(game().phase).toBe('scoring');
      expect(coherent()).toBe(true);
      expect(battleshipGame(structuredClone(game()) as never, () => true)).toBe(true);
      battleship.abortGame(CODE);
    }
  });

  it('returns nothing when the seat owes nothing, and the fallback is legal', () => {
    start(['N', 'S'], true, { noTouching: true, hitAgain: false });
    const bot = gameBot('battleship');
    apply('N', bot.firstLegal(view('N')));
    expect(bot.firstLegal(view('N'))).toBeNull();
    expect(bot.hard(view('N'), Math.random)).toBeNull();
    apply('S', bot.firstLegal(view('S')));
    expect(bot.easy(view('S'), Math.random)).toBeNull();
    apply('N', bot.firstLegal(view('N')));
    expect(game().log).toHaveLength(1);
  });

  it('accepts a played game as stored state and rejects tampering', () => {
    start(['N', 'S'], true);
    for (const seat of ['N', 'S'] as const) apply(seat, getBotAction(view(seat), seededRandom(5), 'easy'));
    for (let step = 0; step < 60 && game().phase === 'playing'; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, getBotAction(view(seat), seededRandom(step), 'easy'));
    }
    const validator = gameValidator('battleship');
    const stored = structuredClone(game());
    expect(validator.shape(stored as never, () => true)).toBe(true);
    expect(validator.coherent(stored)).toBe(true);
    const hit = stored.log.findIndex((entry) => entry.result === 'hit');
    expect(hit).toBeGreaterThanOrEqual(0);
    const tampered: BattleshipGameState[] = [
      { ...structuredClone(stored), log: stored.log.map((entry, index) => (index === hit ? { ...entry, result: 'miss' } : entry)) },
      { ...structuredClone(stored), log: [...stored.log, { ...stored.log[0] }] },
      { ...structuredClone(stored), fleets: { N: COLUMNS, S: stored.fleets.S } },
      { ...structuredClone(stored), currentTurnSeat: stored.currentTurnSeat === 'N' ? 'S' : 'N' },
      { ...structuredClone(stored), options: { noTouching: false, hitAgain: true } },
    ];
    for (const state of tampered) expect(validator.coherent(state)).toBe(false);
    expect(validator.shape({ ...structuredClone(stored), fleets: { N: ROWS.slice(0, 4), S: null } } as never, () => true)).toBe(false);
    expect(validator.shape({ ...structuredClone(stored), log: [{ seat: 'N', to: '10,0', result: 'miss', timestamp: 1 }] } as never, () => true)).toBe(false);
    expect(validator.shape({ ...structuredClone(stored), log: [{ seat: 'N', to: '0,0', result: 'hit', ship: 'carrier', timestamp: 1 }] } as never, () => true)).toBe(false);
  });

  it('parses fleets, shots on the sea, and resignation', () => {
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'place-fleet', fleet: ROWS } })).toMatchObject({ gameType: 'battleship' });
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'fire', to: '3,4' } })).toMatchObject({ gameType: 'battleship' });
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'place-fleet', fleet: ROWS.slice(1) } })).toBe('Invalid fleet.');
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'place-fleet', fleet: [...ROWS.slice(1), { cell: 100, vertical: false }] } })).toBe('Invalid fleet.');
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'fire', to: '3,10' } })).toBe('Invalid action.');
    expect(parseGameAction({ gameType: 'battleship', action: { type: 'resign' } })).toMatchObject({ action: { type: 'resign' } });
  });
});

describe('Battleship through the runtime', () => {
  const SEATS = ['N', 'S'] as const;
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function fixture(): Promise<{
    code: RoomCode; runtime: Awaited<ReturnType<typeof createRuntimeCoordinator>>; saved: () => RuntimeSnapshot;
    state: () => BattleshipGameState;
  }> {
    let saved: RuntimeSnapshot | null = null;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
      saveRuntime: vi.fn(async (snapshot: RuntimeSnapshot): Promise<void> => {
        expect(isRuntimeSnapshot(snapshot)).toBe(true);
        saved = structuredClone(snapshot);
      }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      code = rooms.createRoom('battleship', 'N');
      for (const seat of SEATS) {
        players.attachPlayer(seat, player(seat));
        players.setPlayerRoom(seat, code);
        rooms.joinRoom(code, seat);
        rooms.changeSeat(code, player(seat), seat);
      }
      rooms.setRoomStatus(code, 'playing');
      expect(games.startGame(code, 'battleship', rooms.getSeatPlayers(code)!, { baseSeconds: 60, bankSeconds: 300 },
        { battleship: { noTouching: true, hitAgain: false } }).success).toBe(true);
    });
    const state = (): BattleshipGameState => games.getGameState(code) as BattleshipGameState;
    return { code, runtime, saved: () => saved!, state };
  }

  it('runs no turn clock while placing and starts the first shooter clock with full reserves', async () => {
    const { code, runtime, state } = await fixture();
    expect(state()).toMatchObject({ phase: 'placing', options: { noTouching: true, hitAgain: false } });
    expect(state().clock?.turn).toBeNull();
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'S', { gameType: 'battleship', action: { type: 'place-fleet', fleet: COLUMNS } }).success).toBe(true);
      expect(games.handleGameAction(code, 'N', { gameType: 'battleship', action: { type: 'place-fleet', fleet: ROWS } }).success).toBe(true);
    });
    expect(state().phase).toBe('playing');
    expect(state().clock?.turn).toMatchObject({ seat: 'N', baseRemainingMs: 60_000 });
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'N', { gameType: 'battleship', action: { type: 'fire', to: '5,5' } }).success).toBe(true);
    });
    expect(state().clock?.turn?.seat).toBe('S');
  });

  it('places a random fleet for a human who misses the deadline, also after a restart', async () => {
    const { code, runtime, saved, state } = await fixture();
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'S', { gameType: 'battleship', action: { type: 'place-fleet', fleet: COLUMNS } }).success).toBe(true);
    });
    const restored = saved();
    games.restoreGames([]);
    games.restoreGames(restored.games);
    expect(state()).toMatchObject({ phase: 'placing', fleets: { N: null, S: COLUMNS } });
    vi.setSystemTime(state().placeDeadline);
    const publish = vi.fn();
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ phase: 'playing', autoPlaced: ['N'], currentTurnSeat: 'N' });
    expect(bsFleetError(state().fleets.N, state().options)).toBeNull();
    expect(state().clock?.turn?.seat).toBe('N');
  });
});
