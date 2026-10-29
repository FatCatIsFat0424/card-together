import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, LandBattleGameState, LandBattleVisibleState, PlayerInfo } from '@shared/types';
import {
  LB_COUNTS, LB_NODES, LB_PRESETS, LB_QUIET_LIMIT, LB_RANKS, lbCell, lbIndex, lbLayoutError, lbLegalMoves, lbSwapSlots,
} from '@shared/rules/landbattle';
import type { LbRank, LbSide } from '@shared/rules/landbattle';
import type { BotAction } from '../../src/bots/bot-decisions';
import { gameBot } from '../../src/bots/bot-registry';
import { deploymentPrior, estimateOdds, landBattleKnowledge, movementKnowledge, sampleIdentities } from '../../src/bots/landbattle-knowledge';
import type { LbBotCell, LbKnowledge } from '../../src/bots/landbattle-knowledge';
import {
  flagOpenings, lbAttackers, landBattleSearch, recentMoves, scoreMove, searchMoves, templateLayout,
} from '../../src/bots/landbattle-search';
import type { World } from '../../src/bots/landbattle-search';
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
  for (const [node, rank] of own) board[lbCell(node)!] = { side: 0, rank, token: -1 };
  const allowed = new Map<number, Set<LbRank>>();
  for (const [node, ranks] of opponents) {
    board[lbCell(node)!] = { side: 1, token: lbCell(node)! };
    allowed.set(lbCell(node)!, new Set(ranks));
  }
  const tokens = [...allowed.keys()];
  return { side: 0, board, tokens, alive: new Set(tokens), allowed, odds: estimateOdds(tokens, allowed), ownLost: [] };
}

/** A fully known world for the search's own helpers. */
function worldOf(pieces: readonly [node: string, side: LbSide, rank: LbRank][]): World {
  const world: World = new Array(LB_NODES).fill(null);
  for (const [node, side, rank] of pieces) world[lbCell(node)!] = { side, rank };
  return world;
}

/** A search budget that stops after a fixed number of sampled worlds, so decisions depend only on the seed. */
function samples(count: number): { maxDepth: undefined; timeLeftMs: () => number; expired: () => boolean } {
  let checks = 0;
  return { maxDepth: undefined, timeLeftMs: () => 1_000, expired: () => ++checks >= count };
}

afterEach(() => landbattle.abortGame(CODE));

describe('Land Battle Chess bot deployment', () => {
  it('deploys legal templates on Hard and random legal layouts on Easy', () => {
    for (let seed = 1; seed <= 60; seed++) expect(lbLayoutError(templateLayout(seededRandom(seed)))).toBeNull();
    start([], []);
    for (const difficulty of ['hard', 'easy'] as const) {
      const action = gameBot('landbattle')[difficulty](view('N'), seededRandom(4));
      expect(action).toMatchObject({ type: 'game-action', request: { action: { type: 'deploy' } } });
      if (action?.type === 'game-action' && action.request.gameType === 'landbattle' && action.request.action.type === 'deploy') {
        expect(lbLayoutError(action.request.action.layout)).toBeNull();
      }
    }
    // The worker strategy answers a deployment straight away.
    const search = landBattleSearch(view('S'), { random: seededRandom(2), budget: { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true } });
    expect(search).toMatchObject({ request: { action: { type: 'deploy' } } });
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
    for (const odds of knowledge.odds.values()) {
      expect(LB_RANKS.reduce((sum, rank) => sum + odds[rank], 0)).toBeCloseTo(1, 6);
    }
    expect(knowledge.odds.get(lbIndex(0, 5))!.flag).toBe(0);
  });

  it('learns from a published battle outcome and from movement, and never from the hidden state', () => {
    start();
    // N's major-general meets S's piece on (0,5): both removed, so it was a major-general (no bomb on the front row).
    expect(landbattle.move(CODE, 'N', '0,6', '0,5').success).toBe(true);
    expect(landbattle.move(CODE, 'S', '2,4', '2,3').success).toBe(true);
    const knowledge = landBattleKnowledge(view('N'))!;
    expect([...knowledge.allowed.get(lbIndex(0, 5))!]).toEqual(['major-general']);
    expect(knowledge.alive.has(lbIndex(0, 5))).toBe(false);
    expect(knowledge.ownLost).toEqual(['major-general']);
    // S's piece from (2,4) moved, so it is neither a mine nor the flag.
    const moved = knowledge.allowed.get(lbIndex(2, 4))!;
    expect(moved.has('mine') || moved.has('flag')).toBe(false);
    expect(knowledge.board[lbIndex(2, 3)]).toMatchObject({ side: 1, token: lbIndex(2, 4) });
    // The easy bot only uses movement: the battle tells it nothing.
    expect(movementKnowledge(view('N'))!.allowed.get(lbIndex(0, 5))!.size).toBeGreaterThan(1);
  });

  it('pins the flag once the marshal falls', () => {
    start(ASSAULT, ASSAULT);
    expect(landbattle.move(CODE, 'N', '2,6', '2,5').success).toBe(true);
    const knowledge = landBattleKnowledge(view('N'))!;
    expect([...knowledge.allowed.get(lbIndex(2, 5))!]).toEqual(['marshal']);
    expect([...knowledge.allowed.get(lbIndex(1, 0))!]).toEqual(['flag']);
    expect(knowledge.allowed.get(lbIndex(3, 0))!.has('flag')).toBe(false);
    const sample = sampleIdentities(knowledge, seededRandom(3))!;
    expect(sample.get(lbIndex(1, 0))).toBe('flag');
    expect([...sample.values()].filter((rank) => rank === 'marshal')).toHaveLength(1);
  });

  it('expects mines around the headquarters and draws complete identities that respect every constraint', () => {
    start();
    const knowledge = landBattleKnowledge(view('N'))!;
    // (0,0) touches S's headquarters at (1,0); (0,1) is also in the last two rows but touches none.
    expect(deploymentPrior(lbIndex(0, 0), 'mine')).toBeGreaterThan(1);
    expect(deploymentPrior(lbIndex(0, 1), 'mine')).toBe(1);
    expect(knowledge.odds.get(lbIndex(0, 0))!.mine).toBeGreaterThan(knowledge.odds.get(lbIndex(0, 1))!.mine);
    // Once one headquarters is ruled out, every sample puts the flag in the other.
    const allowed = new Map(knowledge.allowed);
    allowed.set(lbIndex(3, 0), new Set([...allowed.get(lbIndex(3, 0))!].filter((rank) => rank !== 'flag')));
    const narrowed: LbKnowledge = { ...knowledge, allowed, odds: estimateOdds(knowledge.tokens, allowed, deploymentPrior) };
    for (let seed = 1; seed <= 20; seed++) {
      const sample = sampleIdentities(narrowed, seededRandom(seed))!;
      expect(sample.get(lbIndex(1, 0))).toBe('flag');
      for (const rank of LB_RANKS) expect([...sample.values()].filter((other) => other === rank)).toHaveLength(LB_COUNTS[rank]);
      for (const [token, rank] of sample) expect(narrowed.allowed.get(token)!.has(rank)).toBe(true);
    }
  });

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
        search: landBattleSearch(visible, { random: seededRandom(7), budget: samples(12) }),
        quick: searchMoves(landBattleKnowledge(visible)!, seededRandom(8), () => false, 6)?.move,
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
  });
});

describe('Land Battle Chess Hard search', () => {
  it('captures a known flag and avoids attacking a known stronger piece', () => {
    const knowledge = knowledgeOf(
      [['3,1', 'engineer'], ['1,6', 'captain'], ['1,11', 'flag'], ['0,11', 'mine']],
      [['3,0', ['flag']], ['1,5', ['marshal']], ['4,4', ['lieutenant']]],
    );
    expect(searchMoves(knowledge, seededRandom(1), () => false, 8)?.move).toMatchObject({ from: lbIndex(3, 1), to: lbIndex(3, 0) });
    const noFlag = knowledgeOf(
      [['2,6', 'captain'], ['1,11', 'flag'], ['4,9', 'major']],
      [['2,5', ['marshal']], ['0,0', ['flag']], ['0,1', ['mine']]],
    );
    const choice = searchMoves(noFlag, seededRandom(2), () => false, 8)?.move;
    expect(choice?.to).not.toBe(lbIndex(2, 5));
  });

  it('finds the pieces that reach a station by step, straight railway, or an engineer turning along it', () => {
    const world = worldOf([
      ['4,10', 0, 'colonel'], ['0,9', 0, 'engineer'], ['0,8', 0, 'captain'], ['2,9', 0, 'lieutenant'], ['2,11', 0, 'mine'],
      ['1,9', 1, 'general'],
    ]);
    const sorted = (stations: number[]): number[] => [...stations].sort((a, b) => a - b);
    expect(sorted(lbAttackers(world, lbIndex(2, 10), 0))).toEqual(sorted([lbIndex(4, 10), lbIndex(0, 9), lbIndex(2, 9)]));
    expect(lbAttackers(world, lbIndex(2, 10), 1)).toEqual([lbIndex(1, 9)]);
  });

  it('keeps an engineer from clearing a mine beside its flag while an officer waits in the camp behind it', () => {
    const own: [string, LbRank][] = [
      ['1,11', 'flag'], ['0,11', 'mine'], ['2,11', 'mine'], ['1,10', 'mine'], ['0,10', 'lieutenant'], ['4,11', 'captain'],
      ['2,7', 'colonel'],
    ];
    const opponents: [string, LbRank[]][] = [
      ['4,6', ['engineer']], ['1,9', ['general']], ['1,0', ['flag']], ['0,0', ['mine']], ['2,0', ['mine']], ['1,1', ['mine']],
      ['3,3', ['major']],
    ];
    const world = worldOf([
      ...own.map(([node, rank]): [string, LbSide, LbRank] => [node, 0, rank]),
      ...opponents.map(([node, [rank]]): [string, LbSide, LbRank] => [node, 1, rank]),
    ]);
    // The engineer clears (1,10), the lieutenant takes it, and the general in the camp takes the lieutenant.
    expect(flagOpenings(world, lbIndex(1, 11), 0)).toBe(1);
    const choice = searchMoves(knowledgeOf(own, opponents), seededRandom(1), () => false, 6)!.move;
    const after = [...world];
    after[choice.to] = after[choice.from];
    after[choice.from] = null;
    expect(flagOpenings(after, lbIndex(1, 11), 0)).toBe(0);
  });

  it('scores a quiet move that reaches the quiet-move limit as a draw', () => {
    const world = worldOf([
      ['1,11', 0, 'flag'], ['2,6', 0, 'marshal'], ['0,9', 0, 'captain'], ['4,9', 0, 'captain'], ['0,8', 0, 'lieutenant'],
      ['1,0', 1, 'flag'], ['2,4', 1, 'lieutenant'], ['2,5', 1, 'captain'], ['0,2', 1, 'lieutenant'], ['4,2', 1, 'major'],
    ]);
    const quiet = { from: lbIndex(2, 6), to: lbIndex(1, 6), path: [] };
    const capture = { from: lbIndex(2, 6), to: lbIndex(2, 5), path: [] };
    expect(scoreMove(world, quiet, 0, LB_QUIET_LIMIT - 1)).toBe(0);
    expect(scoreMove(world, quiet, 0, 0)).not.toBe(0);
    // A battle restarts the count, so the limit does not touch it.
    expect(scoreMove(world, capture, 0, LB_QUIET_LIMIT - 1)).toBe(scoreMove(world, capture, 0, 0));
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

  it('keeps the synchronous Hard move cheap and legal', () => {
    start();
    const started = performance.now();
    const action = gameBot('landbattle').hard(view('N'), seededRandom(3));
    expect(performance.now() - started).toBeLessThan(400);
    expect(legal('N', action)).toBe(true);
  });

  it('stops within its time budget and still returns a legal move', () => {
    start();
    const started = performance.now();
    const action = landBattleSearch(view('N'), {
      random: seededRandom(9),
      budget: { maxDepth: undefined, timeLeftMs: () => 150, expired: () => performance.now() >= started + 150 },
    });
    expect(performance.now() - started).toBeLessThan(600);
    expect(legal('N', action)).toBe(true);
    expect(landBattleSearch(view('S'), { random: seededRandom(1), budget: { maxDepth: undefined, timeLeftMs: () => 0, expired: () => true } })).toBeNull();
  });

  it('declares the worker search with a one-second budget', () => {
    expect(gameBot('landbattle').search).toMatchObject({ budgetMs: 1000 });
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
    const outcome = await pool.run({ strategy: spec.strategy, visible: JSON.parse(JSON.stringify(view('N'))), budgetMs: 400, seed: 5 });
    expect(outcome.status).toBe('ok');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(legal('N', outcome.status === 'ok' ? outcome.action : null)).toBe(true);
  }, 20_000);
});
