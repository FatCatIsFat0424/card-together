import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GameSeat, LandBattleGameState, LandBattleStoredPiece, LandBattleVisibleState, PlayerInfo, RoomCode,
} from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { parseGameAction } from '@shared/games/actions';
import { matchStanding } from '@shared/rules/match-standing';
import { LB_PRESETS, LB_QUIET_LIMIT, lbLayoutError, lbMirrorLayout } from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import { landBattleFacts } from '@shared/stats/landbattle';
import * as landbattle from '../../src/managers/games/landbattle-game';
import { landBattleAdapter } from '../../src/managers/games/landbattle-adapter';
import { coherentLandBattleGame, isLandBattleResult, landBattleGame } from '../../src/managers/games/landbattle-validation';
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
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const CODE = 'LANDB1';
const DEPLOY_MS = 360_000;
const BALANCED = LB_PRESETS[0];
const ASSAULT = LB_PRESETS[1];

function player(seat: GameSeat, isBot = false): PlayerInfo {
  return { id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    ...isBot ? { isBot: true } : {} };
}

function start(seats: readonly GameSeat[] = ['N', 'S'], bots = false): void {
  landbattle.startGame(CODE, Object.fromEntries(seats.map((seat) => [seat, player(seat, bots)])), DEPLOY_MS, 1_000);
}

function game(): LandBattleGameState {
  const state = landbattle.getGameState(CODE);
  if (!state) throw new Error('Expected a Land Battle Chess game');
  return state;
}

const view = (seat: GameSeat): LandBattleVisibleState => landbattle.getPlayerVisibleState(CODE, seat)!;
const coherent = (): boolean => coherentLandBattleGame(structuredClone(game()));

function deployBoth(first: readonly LbRank[] = BALANCED, second: readonly LbRank[] = ASSAULT): void {
  const [a, b] = landbattle.landBattleSeats(game());
  expect(landbattle.deploy(CODE, a, first, false, 2_000)).toEqual({ success: true });
  expect(landbattle.deploy(CODE, b, second, false, 2_000)).toEqual({ success: true });
}

/** Replaces the board with the given pieces (origin = node), for move-rule scenarios. */
function setPieces(pieces: readonly [node: string, side: LbSide, rank: LbRank][]): void {
  game().pieces = pieces.map(([node, side, rank]): LandBattleStoredPiece => ({ side, rank, origin: node, node }));
}

function apply(seat: GameSeat, action: BotAction | null): void {
  if (action?.type !== 'game-action' || action.request.gameType !== 'landbattle') throw new Error('Expected a Land Battle Chess action');
  const request = action.request.action;
  const result = request.type === 'deploy' ? landbattle.deploy(CODE, seat, request.layout, true, 3_000)
    : request.type === 'move' ? landbattle.move(CODE, seat, request.from, request.to, 3_000)
      : { success: false as const, reason: 'Unexpected control' };
  expect(result).toEqual({ success: true });
}

/** Opponent pieces in a seat's view carry no identity except a shown flag or after the match. */
function hiddenOpponents(visible: LandBattleVisibleState): boolean {
  const side = visible.seats.indexOf(visible.mySeat);
  return visible.pieces.filter((piece) => piece.side !== side)
    .every((piece) => piece.rank === undefined || (piece.rank === 'flag' && visible.flagsShown.includes(visible.seats[piece.side])));
}

afterEach(() => landbattle.abortGame(CODE));

describe('Land Battle Chess setup and deployment', () => {
  it('registers a two-player flexible board game on the board timer with resign and draw offers', () => {
    expect(gameDefinition('landbattle')).toMatchObject({
      category: 'board', equipment: [], seats: { minPlayers: 2, maxPlayers: 2, flexible: true },
      matchControls: { resign: true, draw: true }, timeControl: { baseSeconds: 60, bankSeconds: 300 },
    });
  });

  it('starts with both seats deploying against one deadline and an empty board', () => {
    start(['E', 'W']);
    expect(game()).toMatchObject({ phase: 'deploying', deployDeadline: 1_000 + DEPLOY_MS, pieces: [], log: [], result: null });
    expect(landbattle.pendingSeats(game())).toEqual(['E', 'W']);
    expect(view('W')).toMatchObject({ seats: ['E', 'W'], mySeat: 'W', deployed: [], myLayout: null, pieces: [] });
    expect(coherent()).toBe(true);
  });

  it('shows a submitted deployment to its owner and only blank tiles to the opponent', () => {
    start();
    expect(landbattle.deploy(CODE, 'S', ASSAULT, false, 2_000)).toEqual({ success: true });
    expect(view('S')).toMatchObject({ deployed: ['S'], myLayout: ASSAULT });
    expect(view('S').pieces.every((piece) => piece.rank !== undefined)).toBe(true);
    expect(view('N').myLayout).toBeNull();
    expect(view('N').pieces).toHaveLength(25);
    expect(view('N').pieces.every((piece) => piece.rank === undefined)).toBe(true);
    expect(game().phase).toBe('deploying');
  });

  it('starts play with the first seat to move once both have deployed', () => {
    start();
    deployBoth();
    expect(game()).toMatchObject({ phase: 'playing', currentTurnSeat: 'N' });
    expect(game().pieces).toHaveLength(50);
    expect(landbattle.pendingSeats(game())).toEqual([]);
    expect(coherent()).toBe(true);
  });

  it('rejects invalid, repeated, outsider, and late manual deployments but accepts automatic late ones', () => {
    start();
    const flagForward = [...BALANCED];
    [flagForward[0], flagForward[BALANCED.indexOf('flag')]] = ['flag', flagForward[0]];
    expect(landbattle.deploy(CODE, 'N', flagForward, false, 2_000).success).toBe(false);
    expect(landbattle.deploy(CODE, 'E', BALANCED, false, 2_000).success).toBe(false);
    expect(landbattle.deploy(CODE, 'N', BALANCED, false, 2_000)).toEqual({ success: true });
    expect(landbattle.deploy(CODE, 'N', ASSAULT, false, 2_000).success).toBe(false);
    expect(landbattle.deploy(CODE, 'S', ASSAULT, false, 1_000 + DEPLOY_MS)).toMatchObject({ success: false });
    expect(landbattle.deploy(CODE, 'S', ASSAULT, true, 1_000 + DEPLOY_MS)).toEqual({ success: true });
    expect(game().autoDeployed).toEqual(['S']);
    expect(landbattle.move(CODE, 'S', '0,5', '0,4').success).toBe(false);
  });
});

describe('Land Battle Chess referee', () => {
  it('records only stations and the battle outcome, and moves the turn', () => {
    start();
    deployBoth();
    // N's major-general on (0,6) meets the major-general S deployed on (0,5): both are removed.
    expect(landbattle.move(CODE, 'N', '0,6', '0,5', 4_000)).toEqual({ success: true });
    const entry = game().log[0];
    expect(Object.keys(entry).sort()).toEqual(['battle', 'capture', 'from', 'seat', 'timestamp', 'to']);
    expect(entry).toMatchObject({ seat: 'N', from: '0,6', to: '0,5', capture: true, battle: 'tie' });
    expect(game().currentTurnSeat).toBe('S');
    expect(game().quietMoves).toBe(0);
    expect(coherent()).toBe(true);
  });

  it('rejects moves out of turn, of opponent pieces, of immobile pieces, and illegal destinations', () => {
    start();
    deployBoth();
    expect(landbattle.move(CODE, 'S', '0,5', '0,4').success).toBe(false);
    expect(landbattle.move(CODE, 'N', '0,5', '0,4').success).toBe(false);
    // The flag in a headquarters and the mines never move.
    expect(landbattle.move(CODE, 'N', '1,11', '0,11').success).toBe(false);
    expect(landbattle.move(CODE, 'N', '2,11', '2,10').success).toBe(false);
    expect(landbattle.move(CODE, 'N', '0,6', '0,3').success).toBe(false);
    expect(landbattle.move(CODE, 'N', '2,7', '2,8')).toEqual({ success: true });
    expect(game().log.at(-1)).toEqual({ seat: 'N', from: '2,7', to: '2,8', timestamp: expect.any(Number) });
  });

  it('shows both flags when the marshals remove each other', () => {
    start();
    deployBoth(ASSAULT, ASSAULT);
    expect(landbattle.move(CODE, 'N', '2,6', '2,5')).toEqual({ success: true });
    expect(game().log[0]).toMatchObject({ battle: 'tie', flagShown: ['N', 'S'] });
    expect(game().flagsShown).toEqual(['N', 'S']);
    const north = view('N');
    expect(north.pieces.filter((piece) => piece.side === 1 && piece.rank !== undefined)).toEqual([
      { side: 1, node: '1,0', origin: '1,0', rank: 'flag' },
    ]);
    expect(hiddenOpponents(north)).toBe(true);
    expect(coherent()).toBe(true);
  });

  it('ends with the flag captured, reveals everything, and credits the capturer', () => {
    start();
    deployBoth();
    setPieces([['3,1', 0, 'engineer'], ['3,0', 1, 'flag'], ['0,11', 0, 'flag'], ['4,4', 1, 'captain']]);
    expect(landbattle.move(CODE, 'N', '3,1', '3,0')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'flag-captured', remaining: { N: 2, S: 1 }, moves: 1 });
    expect(game().phase).toBe('scoring');
    expect(view('S').pieces.every((piece) => piece.rank !== undefined)).toBe(true);
    expect(isLandBattleResult(game().result)).toBe(true);
    const standing = matchStanding(game().result!, 'N');
    expect(standing).toMatchObject({ won: true, rank: 1 });
  });

  it('ends when the next side cannot move, and draws after the quiet-move limit', () => {
    start();
    deployBoth();
    setPieces([['2,6', 0, 'captain'], ['0,11', 0, 'flag'], ['1,0', 1, 'flag'], ['0,0', 1, 'mine'], ['3,0', 1, 'major']]);
    expect(landbattle.move(CODE, 'N', '2,6', '2,7')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'no-moves' });

    landbattle.abortGame(CODE);
    start();
    deployBoth();
    game().quietMoves = LB_QUIET_LIMIT - 1;
    expect(landbattle.move(CODE, 'N', '2,7', '2,8')).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'no-capture-limit' });
  });

  it('lets a seat resign while deploying or playing, and draws by agreement', () => {
    start();
    expect(landbattle.control(CODE, 'N', { type: 'offer-draw' }).success).toBe(false);
    expect(landbattle.control(CODE, 'S', { type: 'resign' })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: ['N'], reason: 'resign', remaining: { N: 0, S: 0 } });
    expect(coherent()).toBe(true);

    landbattle.abortGame(CODE);
    start();
    deployBoth();
    expect(landbattle.control(CODE, 'S', { type: 'offer-draw' }).success).toBe(false);
    expect(landbattle.control(CODE, 'N', { type: 'offer-draw' })).toEqual({ success: true });
    expect(landbattle.control(CODE, 'S', { type: 'answer-draw', accept: true })).toEqual({ success: true });
    expect(game().result).toMatchObject({ winners: [], reason: 'agreed-draw' });
    expect(coherent()).toBe(true);
  });
});

describe('Land Battle Chess hidden identities', () => {
  it('never puts an opponent identity in a seated view, its piece order, or its move list', () => {
    const views: string[] = [];
    for (const opponent of [ASSAULT, lbMirrorLayout(LB_PRESETS[2])]) {
      start();
      deployBoth(BALANCED, opponent);
      for (let step = 0; step < 30 && game().phase === 'playing'; step++) {
        const seat = game().currentTurnSeat;
        apply(seat, gameBot('landbattle').easy(view(seat), seededRandom(step + 1)));
      }
      const north = view('N');
      expect(hiddenOpponents(north)).toBe(true);
      expect(hiddenOpponents(view('S'))).toBe(true);
      expect(north).not.toHaveProperty('layouts');
      expect(north).not.toHaveProperty('replayRecording');
      for (const entry of north.log) {
        expect(Object.keys(entry).every((key) => ['seat', 'from', 'to', 'path', 'capture', 'battle', 'flagShown', 'timestamp'].includes(key))).toBe(true);
      }
      // Before any move the opponent's blank tiles look the same whatever it deployed.
      landbattle.abortGame(CODE);
      start();
      deployBoth(BALANCED, opponent);
      views.push(JSON.stringify(view('N').pieces.filter((piece) => piece.side === 1)));
      landbattle.abortGame(CODE);
    }
    expect(views[0]).toBe(views[1]);
  });

  it('gives unseated spectators every identity but never seated players', () => {
    start();
    deployBoth();
    const spectator = landBattleAdapter.withObserverView(view('S'), game(), 'spectator');
    expect(spectator.observer).toBe('spectator');
    expect(spectator.pieces.every((piece) => piece.rank !== undefined)).toBe(true);
    expect(hiddenOpponents(view('S'))).toBe(true);
    // A seat outside the match (the spectator base view) sees no identity at all.
    expect(view('E').pieces.every((piece) => piece.rank === undefined)).toBe(true);
    expect(view('E').myLayout).toBeNull();
  });

  it('feeds bots only their own filtered view', () => {
    start(['N', 'S'], true);
    const seen: LandBattleVisibleState[] = [];
    const strategy = gameBot('landbattle');
    const record = (visible: LandBattleVisibleState): LandBattleVisibleState => {
      seen.push(structuredClone(visible));
      return visible;
    };
    apply('N', strategy.hard(record(view('N')), seededRandom(1)));
    apply('S', strategy.hard(record(view('S')), seededRandom(2)));
    for (let step = 0; step < 20 && game().phase === 'playing'; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, strategy.hard(record(view(seat)), seededRandom(step + 3)));
    }
    expect(seen.every(hiddenOpponents)).toBe(true);
    expect(seen.every((visible) => !('layouts' in visible) && !('replayRecording' in visible))).toBe(true);
  });

  it('builds statistics from public facts only', () => {
    start();
    deployBoth(ASSAULT, ASSAULT);
    expect(landbattle.move(CODE, 'N', '2,6', '2,5')).toEqual({ success: true });
    setPieces([['3,1', 0, 'engineer'], ['3,0', 1, 'flag'], ['0,11', 0, 'flag'], ['4,4', 1, 'captain']]);
    expect(landbattle.move(CODE, 'S', '4,4', '4,5')).toEqual({ success: true });
    expect(landbattle.move(CODE, 'N', '3,1', '3,0')).toEqual({ success: true });
    const full = landBattleAdapter.withObserverView(view('N'), game(), 'spectator');
    const stripped = { ...full, pieces: full.pieces.map(({ rank: _rank, ...piece }) => piece) };
    const facts = landBattleFacts(game().result!, 'N', full);
    const publicFacts = landBattleFacts(game().result!, 'N', stripped);
    expect([publicFacts.counts, publicFacts.values]).toEqual([facts.counts, facts.values]);
    expect(facts).toMatchObject({ counts: { flagCaptures: 1, battlesWon: 1 }, values: { fastestWin: 3, mostSurvivors: 2 } });
    expect(landBattleFacts(game().result!, 'S', full).counts).toEqual({});
  });
});

describe('Land Battle Chess bots and stored state', () => {
  it.each(['easy', 'hard'] as const)('plays only legal deployments and moves to the end on %s', (difficulty) => {
    start(['N', 'S'], true);
    const random = seededRandom(difficulty === 'easy' ? 11 : 12);
    for (const seat of ['N', 'S'] as const) apply(seat, getBotAction(view(seat), random, difficulty));
    expect(lbLayoutError(game().layouts.N)).toBeNull();
    for (let step = 0; step < 3_000 && game().phase === 'playing'; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, getBotAction(view(seat), random, difficulty));
    }
    expect(game().phase).toBe('scoring');
    expect(coherent()).toBe(true);
    expect(landBattleGame(structuredClone(game()) as never, () => true)).toBe(true);
  }, 60_000);

  it('returns nothing when the seat owes nothing, and the fallback is legal', () => {
    start(['N', 'S'], true);
    const bot = gameBot('landbattle');
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
    for (let step = 0; step < 80 && game().phase === 'playing'; step++) {
      const seat = game().currentTurnSeat;
      apply(seat, getBotAction(view(seat), seededRandom(step), 'easy'));
    }
    const validator = gameValidator('landbattle');
    const stored = structuredClone(game());
    expect(validator.shape(stored as never, () => true)).toBe(true);
    expect(validator.coherent(stored)).toBe(true);
    const battle = stored.log.findIndex((entry) => entry.battle !== undefined);
    expect(battle).toBeGreaterThanOrEqual(0);
    const tampered: LandBattleGameState[] = [
      { ...structuredClone(stored), log: stored.log.map((entry, index) => (index === battle
        ? { ...entry, battle: entry.battle === 'win' ? 'lose' : 'win' } : entry)) },
      { ...structuredClone(stored), pieces: stored.pieces.map((piece, index) => (index === 0 ? { ...piece, rank: piece.rank === 'marshal' ? 'general' : 'marshal' } : piece)) },
      { ...structuredClone(stored), quietMoves: stored.quietMoves + 1 },
      { ...structuredClone(stored), flagsShown: ['N'] },
      { ...structuredClone(stored), layouts: { N: [...ASSAULT], S: stored.layouts.S } },
    ];
    for (const state of tampered) expect(validator.coherent(state)).toBe(false);
    expect(validator.shape({ ...structuredClone(stored), layouts: { N: ['flag'], S: null } } as never, () => true)).toBe(false);
    expect(validator.shape({ ...structuredClone(stored), log: [{ seat: 'N', from: '9,9', to: '0,0', timestamp: 1 }] } as never, () => true)).toBe(false);
  });

  it('parses deployments, moves on stations, and the match controls', () => {
    expect(parseGameAction({ gameType: 'landbattle', action: { type: 'deploy', layout: BALANCED } })).toMatchObject({ gameType: 'landbattle' });
    expect(parseGameAction({ gameType: 'landbattle', action: { type: 'move', from: '0,6', to: '0,5' } })).toMatchObject({ gameType: 'landbattle' });
    expect(parseGameAction({ gameType: 'landbattle', action: { type: 'deploy', layout: ['flag'] } })).toBe('Invalid deployment.');
    expect(parseGameAction({ gameType: 'landbattle', action: { type: 'move', from: '5,6', to: '0,5' } })).toBe('Invalid action.');
    expect(parseGameAction({ gameType: 'landbattle', action: { type: 'resign' } })).toMatchObject({ action: { type: 'resign' } });
  });
});

describe('Land Battle Chess through the runtime', () => {
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
    state: () => LandBattleGameState;
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
      code = rooms.createRoom('landbattle', 'N');
      for (const seat of SEATS) {
        players.attachPlayer(seat, player(seat));
        players.setPlayerRoom(seat, code);
        rooms.joinRoom(code, seat);
        rooms.changeSeat(code, player(seat), seat);
      }
      rooms.setRoomStatus(code, 'playing');
      expect(games.startGame(code, 'landbattle', rooms.getSeatPlayers(code)!, { baseSeconds: 60, bankSeconds: 300 }).success).toBe(true);
    });
    const state = (): LandBattleGameState => games.getGameState(code) as LandBattleGameState;
    return { code, runtime, saved: () => saved!, state };
  }

  it('runs no turn clock while deploying and starts the first mover clock with full reserves', async () => {
    const { code, runtime, state } = await fixture();
    expect(state().clock?.turn).toBeNull();
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'S', { gameType: 'landbattle', action: { type: 'deploy', layout: [...ASSAULT] } }).success).toBe(true);
      expect(games.handleGameAction(code, 'N', { gameType: 'landbattle', action: { type: 'deploy', layout: [...BALANCED] } }).success).toBe(true);
    });
    expect(state().phase).toBe('playing');
    expect(state().clock?.turn).toMatchObject({ seat: 'N', baseRemainingMs: 60_000 });
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'N', { gameType: 'landbattle', action: { type: 'move', from: '2,7', to: '2,8' } }).success).toBe(true);
    });
    expect(state().clock?.turn?.seat).toBe('S');
  });

  it('deploys automatically for a human who misses the deadline, also after a restart', async () => {
    const { code, runtime, saved, state } = await fixture();
    await runtime.mutate(() => {
      expect(games.handleGameAction(code, 'S', { gameType: 'landbattle', action: { type: 'deploy', layout: [...ASSAULT] } }).success).toBe(true);
    });
    // Restart mid-deployment: the restored game keeps its deadline and the scheduler picks it up.
    const restored = saved();
    games.restoreGames([]);
    games.restoreGames(restored.games);
    expect(state()).toMatchObject({ phase: 'deploying', layouts: { N: null, S: ASSAULT } });
    vi.setSystemTime(state().deployDeadline);
    const publish = vi.fn();
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(state()).toMatchObject({ phase: 'playing', autoDeployed: ['N'], currentTurnSeat: 'N' });
    expect(lbLayoutError(state().layouts.N)).toBeNull();
    expect(state().clock?.turn?.seat).toBe('N');
  });
});
