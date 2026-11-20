import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, LandBattleGameState, LandBattleVisibleState, PlayerInfo } from '@shared/types';
import {
  LB_COUNTS, LB_NODES, LB_PRESETS, LB_QUIET_LIMIT, LB_RANKS, lbApplyMove, lbBoardFromLayouts, lbCell, lbIndex, lbLayoutError,
  lbLegalMoves, lbRandomLayout, lbSlotIndex, lbSwapSlots,
} from '@shared/rules/landbattle';
import type { LbPiece, LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { botLayout } from '../../src/bots/landbattle-deploy';
import { createInference, estimateMarginals, sampleAssignment } from '../../src/bots/landbattle-inference';
import { landBattleKnowledge } from '../../src/bots/landbattle-knowledge';
import type { LbBehaviour, LbBotCell, LbKnowledge, LbOwnPublic } from '../../src/bots/landbattle-knowledge';
import { defaultParams, landBattleDecision, landBattleSearch, quickParams, recentMoves, searchMoves } from '../../src/bots/landbattle-search';
import {
  createWorld, defaultWeights, evaluate, generateMoves, makeMove, placePiece, unmakeMove,
} from '../../src/bots/landbattle-world';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { seededRandom } from '../../src/bots/search/seeded-random';
import * as landbattle from '../../src/managers/games/landbattle-game';

const CODE = 'LANDBT';
const [BALANCED, ASSAULT] = LB_PRESETS;
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

function start(first: readonly LbRank[] = BALANCED, second: readonly LbRank[] = ASSAULT): void {
  landbattle.startGame(CODE, { N: player('N'), S: player('S') }, 60_000, 1_000);
  if (first.length > 0) {
    expect(landbattle.deploy(CODE, 'N', first, true, 2_000).success).toBe(true);
    expect(landbattle.deploy(CODE, 'S', second, true, 2_000).success).toBe(true);
  }
}

const game = (): LandBattleGameState => landbattle.getGameState(CODE)!;
const view = (seat: GameSeat): LandBattleVisibleState => landbattle.getPlayerVisibleState(CODE, seat)!;

function moveOf(action: BotAction | null): { from: number; to: number } | null {
  if (action?.type !== 'game-action' || action.request.gameType !== 'landbattle' || action.request.action.type !== 'move') return null;
  return { from: lbCell(action.request.action.from)!, to: lbCell(action.request.action.to)! };
}

function legal(seat: GameSeat, action: BotAction | null): boolean {
  const move = moveOf(action);
  const side: LbSide = seat === 'N' ? 0 : 1;
  const board = new Array(LB_NODES).fill(null);
  for (const piece of game().pieces) board[lbCell(piece.node)!] = { side: piece.side, rank: piece.rank };
  return move !== null && lbLegalMoves(board, side).some((option) => option.from === move.from && option.to === move.to);
}

/** Knowledge for a hand-made position: own pieces with ranks, opponent tokens limited to `allowed`. */
function knowledgeOf(
  own: readonly [node: string, rank: LbRank][], opponents: readonly [node: string, allowed: readonly LbRank[]][],
): LbKnowledge {
  const board: (LbBotCell | null)[] = new Array(LB_NODES).fill(null);
  const ownPublic = new Map<number, LbOwnPublic>();
  for (const [node, rank] of own) {
    board[lbCell(node)!] = { side: 0, rank, token: lbCell(node)! };
    ownPublic.set(lbCell(node)!, { moved: false, turned: false, battles: [] });
  }
  const allowed = new Map<number, Set<LbRank>>();
  const behaviour = new Map<number, LbBehaviour>();
  for (const [node, ranks] of opponents) {
    board[lbCell(node)!] = { side: 1, token: lbCell(node)! };
    allowed.set(lbCell(node)!, new Set(ranks));
    behaviour.set(lbCell(node)!, { attacks: 0, moved: false, approached: [], fled: [] });
  }
  const tokens = [...allowed.keys()];
  return { side: 0, board, tokens, alive: new Set(tokens), allowed, behaviour, ownPublic, ownLost: [], opponentMoves: 0 };
}

/** A search clock that runs out after a fixed number of checks, so decisions depend only on the seed. */
function checks(count: number): () => boolean {
  let used = 0;
  return () => ++used >= count;
}

/** Plays `moves` moves of a seeded bot-against-bot match with a cheap search, from the given formations. */
function playSeeded(seed: number, moves: number, layouts?: readonly [readonly LbRank[], readonly LbRank[]]): void {
  const random = seededRandom(seed);
  start(layouts?.[0] ?? lbRandomLayout(random), layouts?.[1] ?? botLayout(random));
  const params = { ...quickParams(), depth: 1, quiescence: 1 };
  for (let move = 0; move < moves && game().phase === 'playing'; move++) {
    const seat = game().currentTurnSeat;
    const target = moveOf(landBattleDecision(view(seat), seededRandom(seed * 1_000 + move), checks(40), params));
    expect(target).not.toBeNull();
    const node = (index: number): string => `${index % 5},${Math.floor(index / 5)}`;
    expect(landbattle.move(CODE, seat, node(target!.from), node(target!.to)).success).toBe(true);
  }
}

afterEach(() => landbattle.abortGame(CODE));

describe('Land Battle Chess bot deployment', () => {
  it('deploys varied legal formations from both headquarters', () => {
    const seen = new Set<string>();
    const flags = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
      const layout = botLayout(seededRandom(seed));
      expect(lbLayoutError(layout)).toBeNull();
      seen.add(layout.join());
      flags.add(layout.indexOf('flag'));
    }
    expect(seen.size).toBe(200);
    expect(flags.size).toBe(2);
    start([], []);
    const action = gameBot('landbattle').decide(view('N'), seededRandom(4));
    expect(action).toMatchObject({ type: 'game-action', request: { action: { type: 'deploy' } } });
    if (action?.type === 'game-action' && action.request.gameType === 'landbattle' && action.request.action.type === 'deploy') {
      expect(lbLayoutError(action.request.action.layout)).toBeNull();
    }
    // The worker strategy answers a deployment straight away.
    const search = landBattleSearch(view('S'), { random: seededRandom(2), budget: { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true } });
    expect(search).toMatchObject({ request: { action: { type: 'deploy' } } });
  });
});

describe('Land Battle Chess search worlds', () => {
  it('generates exactly the rules\' moves and restores every move it unmakes', () => {
    const world = createWorld();
    const out = new Int16Array(512);
    for (let seed = 1; seed <= 12; seed++) {
      const random = seededRandom(seed);
      let board: (LbPiece | null)[] = lbBoardFromLayouts([lbRandomLayout(random), botLayout(random)]);
      let side: LbSide = 0;
      for (let ply = 0; ply < 150; ply++) {
        world.rank.fill(-1);
        world.side.fill(-1);
        world.origin.fill(-1);
        world.flag.fill(-1);
        board.forEach((cell, at) => { if (cell) placePiece(world, at, cell.side, LB_RANKS.indexOf(cell.rank), cell.origin); });
        const expected = lbLegalMoves(board, side).map((move) => move.from | (move.to << 6)).sort((a, b) => a - b);
        const count = generateMoves(world, side, out, 0);
        expect(Array.from(out.subarray(0, count)).sort((a, b) => a - b)).toEqual(expected);
        if (expected.length === 0) break;
        const move = expected[Math.floor(random() * expected.length)];
        const before = [world.rank.join(), world.side.join(), world.origin.join(), world.flag.join()];
        makeMove(world, move);
        const applied = lbApplyMove(board, move & 63, move >> 6)!;
        expect(Array.from(world.rank)).toEqual(applied.board.map((cell) => (cell ? LB_RANKS.indexOf(cell.rank) : -1)));
        unmakeMove(world);
        expect([world.rank.join(), world.side.join(), world.origin.join(), world.flag.join()]).toEqual(before);
        if (applied.flagCaptured) break;
        board = applied.board;
        side = side === 0 ? 1 : 0;
      }
    }
  }, 30_000);

  it('evaluates symmetrically', () => {
    const world = createWorld();
    lbBoardFromLayouts([BALANCED, ASSAULT]).forEach((cell, at) => {
      if (cell) placePiece(world, at, cell.side, LB_RANKS.indexOf(cell.rank), cell.origin);
    });
    const weights = defaultWeights();
    expect(evaluate(world, 0, weights)).toBeCloseTo(-evaluate(world, 1, weights), 6);
  });
});

describe('Land Battle Chess identity inference', () => {
  it('starts from the deployment rules: no mine, bomb or flag on the front row, flags only in headquarters', () => {
    start();
    const knowledge = landBattleKnowledge(view('N'))!;
    const front = knowledge.allowed.get(lbIndex(0, 5))!;
    expect(['mine', 'bomb', 'flag'].some((rank) => front.has(rank as LbRank))).toBe(false);
    expect(knowledge.allowed.get(lbIndex(1, 0))!.has('flag')).toBe(true);
    expect(knowledge.allowed.get(lbIndex(0, 0))!.has('flag')).toBe(false);
    expect(knowledge.allowed.get(lbIndex(0, 0))!.has('mine')).toBe(true);
  });

  it('learns from a published battle outcome and from movement', () => {
    start();
    // N's major-general meets S's piece on (0,5): both removed, so it was a major-general (no bomb on the front row).
    expect(landbattle.move(CODE, 'N', '0,6', '0,5').success).toBe(true);
    expect(landbattle.move(CODE, 'S', '2,4', '2,3').success).toBe(true);
    const knowledge = landBattleKnowledge(view('N'))!;
    expect([...knowledge.allowed.get(lbIndex(0, 5))!]).toEqual(['major-general']);
    expect(knowledge.alive.has(lbIndex(0, 5))).toBe(false);
    expect(knowledge.ownLost).toEqual(['major-general']);
    expect(knowledge.ownPublic.get(lbIndex(0, 6))).toMatchObject({ moved: true, battles: [{ token: lbIndex(0, 5), attacked: true, outcome: 'tie' }] });
    // S's piece from (2,4) moved, so it is neither a mine nor the flag.
    const moved = knowledge.allowed.get(lbIndex(2, 4))!;
    expect(moved.has('mine') || moved.has('flag')).toBe(false);
    expect(knowledge.behaviour.get(lbIndex(2, 4))).toMatchObject({ moved: true, attacks: 0 });
    expect(knowledge.board[lbIndex(2, 3)]).toMatchObject({ side: 1, token: lbIndex(2, 4) });
  });

  it('pins the flag once the marshal falls', () => {
    start(ASSAULT, ASSAULT);
    expect(landbattle.move(CODE, 'N', '2,6', '2,5').success).toBe(true);
    const knowledge = landBattleKnowledge(view('N'))!;
    expect([...knowledge.allowed.get(lbIndex(2, 5))!]).toEqual(['marshal']);
    expect([...knowledge.allowed.get(lbIndex(1, 0))!]).toEqual(['flag']);
    expect(knowledge.allowed.get(lbIndex(3, 0))!.has('flag')).toBe(false);
    const inference = createInference(knowledge);
    for (let draw = 0; draw < 10; draw++) {
      const sample = sampleAssignment(inference, seededRandom(draw))!;
      expect(sample[knowledge.tokens.indexOf(lbIndex(1, 0))]).toBe(LB_RANKS.indexOf('flag'));
      expect([...sample].filter((rank) => rank === 0)).toHaveLength(1);
    }
  });

  it('recognises a screen preset from a few battles and expects mines around the flag', () => {
    start(BALANCED, BALANCED);
    const knowledge = landBattleKnowledge(view('N'))!;
    const inference = createInference(knowledge);
    const odds = estimateMarginals(inference, seededRandom(1), 200)!;
    const index = (node: string): number => knowledge.tokens.indexOf(lbCell(node)!);
    const mine = LB_RANKS.indexOf('mine');
    // (0,0) touches a headquarters; (4,1) does not.
    expect(odds[index('0,0') * LB_RANKS.length + mine]).toBeGreaterThan(odds[index('4,1') * LB_RANKS.length + mine]);
  });

  it('draws joint identities that keep every count and constraint, and the truth stays possible, over seeded games', () => {
    let truthOdds = 0;
    let truthCount = 0;
    for (let seed = 1; seed <= 3; seed++) {
      playSeeded(seed, 50);
      for (const seat of ['N', 'S'] as const) {
        const visible = view(seat);
        if (visible.phase !== 'playing') continue;
        const knowledge = landBattleKnowledge(visible)!;
        const opponentSeat = seat === 'N' ? 'S' : 'N';
        const opponentSide: LbSide = seat === 'N' ? 1 : 0;
        const truth = game().layouts[opponentSeat]!;
        const trueRank = (token: number): LbRank => truth[truth.findIndex((_, slot) => lbSlotIndex(opponentSide, slot) === token)];
        for (const token of knowledge.tokens) expect(knowledge.allowed.get(token)!.has(trueRank(token))).toBe(true);
        const inference = createInference(knowledge);
        for (let draw = 0; draw < 10; draw++) {
          const sample = sampleAssignment(inference, seededRandom(seed * 100 + draw))!;
          LB_RANKS.forEach((rank, index) => expect([...sample].filter((other) => other === index)).toHaveLength(LB_COUNTS[rank]));
          knowledge.tokens.forEach((token, index) => expect(knowledge.allowed.get(token)!.has(LB_RANKS[sample[index]])).toBe(true));
        }
        const odds = estimateMarginals(inference, seededRandom(seed), 100)!;
        knowledge.tokens.forEach((token, index) => {
          truthOdds += odds[index * LB_RANKS.length + LB_RANKS.indexOf(trueRank(token))];
          truthCount++;
        });
      }
      landbattle.abortGame(CODE);
    }
    // A uniform guess among the 12 identities would give 1/12 on average.
    expect(truthOdds / truthCount).toBeGreaterThan(0.2);
  }, 60_000);

  it('decides the same way whatever the hidden identities behind the same public history', () => {
    const [first, second] = [ASSAULT, lbSwapSlots(ASSAULT, 9, 10)!];
    expect(first[9]).not.toBe(first[10]);
    const decide = (hidden: readonly LbRank[]): { view: string; search: unknown; quick: unknown } => {
      start(BALANCED, hidden);
      expect(landbattle.move(CODE, 'N', '1,6', '1,7', 5_000).success).toBe(true);
      expect(landbattle.move(CODE, 'S', '1,5', '1,4', 6_000).success).toBe(true);
      const visible = view('N');
      const result = {
        view: JSON.stringify(visible),
        search: landBattleDecision(visible, seededRandom(7), checks(120), defaultParams()),
        quick: searchMoves(landBattleKnowledge(visible)!, seededRandom(8), checks(40), quickParams())?.move,
      };
      landbattle.abortGame(CODE);
      return result;
    };
    const [a, b] = [decide(first), decide(second)];
    expect(a.view).toBe(b.view);
    const opponents = (JSON.parse(a.view) as LandBattleVisibleState).pieces.filter((piece) => piece.side === 1);
    expect(opponents).toHaveLength(25);
    expect(opponents.every((piece) => piece.rank === undefined)).toBe(true);
    expect(a.search).toEqual(b.search);
    expect(a.quick).toEqual(b.quick);
  }, 30_000);
});

describe('Land Battle Chess search', () => {
  it('captures a known flag and avoids attacking a known stronger piece', () => {
    const knowledge = knowledgeOf(
      [['3,1', 'engineer'], ['1,6', 'captain'], ['1,11', 'flag'], ['0,11', 'mine']],
      [['3,0', ['flag']], ['1,5', ['marshal']], ['4,4', ['lieutenant']]],
    );
    expect(searchMoves(knowledge, seededRandom(1), checks(200))?.move).toMatchObject({ from: lbIndex(3, 1), to: lbIndex(3, 0) });
    const noFlag = knowledgeOf(
      [['2,6', 'captain'], ['1,11', 'flag'], ['4,9', 'major']],
      [['2,5', ['marshal']], ['0,0', ['flag']], ['0,1', ['mine']]],
    );
    expect(searchMoves(noFlag, seededRandom(2), checks(200))?.move.to).not.toBe(lbIndex(2, 5));
  }, 20_000);

  it('removes a piece that stands next to its flag', () => {
    const knowledge = knowledgeOf(
      [['1,11', 'flag'], ['0,11', 'mine'], ['2,11', 'mine'], ['2,10', 'general'], ['4,6', 'captain']],
      [['1,10', ['colonel']], ['3,0', ['flag']], ['0,0', ['mine']], ['4,0', ['major']]],
    );
    expect(searchMoves(knowledge, seededRandom(3), checks(200))?.move).toMatchObject({ from: lbIndex(2, 10), to: lbIndex(1, 10) });
  });

  it('scores a quiet move that reaches the quiet-move limit as a draw', () => {
    const knowledge = knowledgeOf(
      [['1,11', 'flag'], ['2,6', 'captain'], ['0,9', 'lieutenant']],
      [['1,0', ['flag']], ['2,2', ['marshal']], ['4,2', ['general']]],
    );
    // Material is behind, so the bot heads for the draw when the limit is one quiet move away.
    const found = searchMoves(knowledge, seededRandom(4), checks(200), defaultParams(), LB_QUIET_LIMIT - 1);
    expect(found?.score).toBe(0);
  });

  it('lists its own last moves, newest first, so it does not shuffle a piece back and forth', () => {
    start();
    expect(landbattle.move(CODE, 'N', '1,6', '1,7').success).toBe(true);
    expect(landbattle.move(CODE, 'S', '1,5', '1,4').success).toBe(true);
    expect(landbattle.move(CODE, 'N', '1,7', '1,6').success).toBe(true);
    expect(landbattle.move(CODE, 'S', '1,4', '1,5').success).toBe(true);
    expect(recentMoves(view('N'))).toEqual([
      { from: lbIndex(1, 7), to: lbIndex(1, 6) }, { from: lbIndex(1, 6), to: lbIndex(1, 7) },
    ]);
  });

  it('keeps the synchronous move cheap and legal and leaves the view untouched', () => {
    start();
    const visible = view('N');
    const before = JSON.stringify(visible);
    const started = performance.now();
    const action = gameBot('landbattle').decide(visible, seededRandom(3));
    expect(performance.now() - started).toBeLessThan(400);
    expect(legal('N', action)).toBe(true);
    expect(JSON.stringify(visible)).toBe(before);
  });

  it('plays legal moves deep into a seeded match within its time budget', () => {
    playSeeded(11, 40);
    const seat = game().currentTurnSeat;
    const visible = view(seat);
    const before = JSON.stringify(visible);
    const started = performance.now();
    const action = landBattleSearch(visible, {
      random: seededRandom(9),
      budget: { maxDepth: undefined, timeLeftMs: () => 150, expired: () => performance.now() >= started + 150 },
    });
    expect(performance.now() - started).toBeLessThan(600);
    expect(legal(seat, action)).toBe(true);
    expect(JSON.stringify(visible)).toBe(before);
    const other = seat === 'N' ? 'S' : 'N';
    expect(landBattleSearch(view(other), { random: seededRandom(1), budget: { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true } })).toBeNull();
  }, 30_000);

  it('declares the worker search with a two-second budget', () => {
    expect(gameBot('landbattle').search).toMatchObject({ budgetMs: 2000 });
  });
});

describe('Land Battle Chess search in the bot worker pool', () => {
  const pools: SearchPool[] = [];
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('answers with a legal move inside its budget', async () => {
    start();
    const pool = createSearchPool({ workers: 1, memoryMb: 256, queueLimit: 2 });
    pools.push(pool);
    const spec = gameBot('landbattle').search!;
    const started = Date.now();
    const outcome = await pool.run({ strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: spec.budgetMs, seed: 5 });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(legal('N', outcome.status === 'ok' ? outcome.action : null)).toBe(true);
  }, 20_000);
});
