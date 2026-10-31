import { afterEach, describe, expect, it } from 'vitest';
import type { GameSeat, GoGameState, GoVisibleState, PlayerInfo } from '@shared/types';
import { goNode, goParsePoint } from '@shared/rules/go';
import type { GoSize } from '@shared/rules/go';
import { goBoard } from '@shared/rules/board/boards';
import { boardAspect, hitBox } from '../../../client/src/games/board/board-view';
import { clientGame } from '../../../client/src/games/registry';
import {
  goCount, goDeadStones, goFileLabels, goLastMove, goNotation, goRankLabels, goSideOf, goStones, goTargets,
} from '../../../client/src/games/go/go-view';
import { goHandicapChoices } from '../../../client/src/games/go/GoRoomOptions';
import * as go from '../../../server/src/managers/games/go-game';

const CODE = 'GOVW01';
const MARK_MS = 120_000;
const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
});

function start(size: GoSize = 9, handicap = 0): void {
  go.startGame(CODE, { N: player('N'), S: player('S') }, { size, handicap }, 1_000);
}

const game = (): GoGameState => go.getGameState(CODE)!;
const view = (seat: GameSeat = 'N'): GoVisibleState => go.getPlayerVisibleState(CODE, seat)!;
const name = (value: string, size: GoSize = 9): number => goParsePoint(size, value)!;
const node = (value: string, size: GoSize = 9): string => goNode(size, name(value, size));

function play(...steps: string[]): void {
  for (const step of steps) {
    const [seat, point] = step.split(':');
    const result = point === 'pass' ? go.pass(CODE, seat as GameSeat, MARK_MS, 2_000) : go.place(CODE, seat as GameSeat, node(point), MARK_MS, 2_000);
    expect(result, step).toEqual({ success: true });
  }
}

afterEach(() => go.abortGame(CODE));

describe('Go notation and labels', () => {
  it('names points in Go notation, skipping I, and appends the number of captured stones', () => {
    const notation = goNotation(19);
    expect(notation({ seat: 'N', to: goNode(19, goParsePoint(19, 'D4')!), timestamp: 1 }, 'en')).toBe('D4');
    expect(notation({ seat: 'N', to: goNode(19, goParsePoint(19, 'T19')!), timestamp: 1 }, 'zh-TW')).toBe('T19');
    expect(notation({ seat: 'N', to: goNode(19, goParsePoint(19, 'J10')!), capture: true, captured: 3, timestamp: 1 }, 'en')).toBe('J10×3');
    expect(notation({ seat: 'S', timestamp: 1 }, 'en')).toBe('Pass');
    expect(notation({ seat: 'S', timestamp: 1 }, 'zh-TW')).toBe('停一手');
  });

  it('labels the columns A to T without I and counts rows down from the size', () => {
    expect(goFileLabels(9)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J']);
    expect(goFileLabels(19).join('')).toBe('ABCDEFGHJKLMNOPQRST');
    expect(goRankLabels(13)[0]).toBe('13');
    expect(goRankLabels(13).at(-1)).toBe('1');
  });
});

describe('Go table state', () => {
  it('lists the stones with their side and gives the first seat black', () => {
    start();
    play('N:E5', 'S:D5');
    expect(goStones(view()).map((stone) => [stone.node, stone.side])).toEqual([[node('D5'), 1], [node('E5'), 0]]);
    expect(goSideOf(view(), 'N')).toBe(0);
    expect(goSideOf(view(), 'S')).toBe(1);
    expect(goLastMove(view())).toEqual({ to: node('D5') });
    play('N:pass');
    expect(goLastMove(view())).toBeNull();
  });

  it('offers every empty point on the own turn, minus suicide and the ko retake, and nothing otherwise', () => {
    start();
    expect(goTargets(view('N'), 'N')).toHaveLength(81);
    expect(goTargets(view('S'), 'S')).toEqual([]);
    expect(goTargets(view('E'), null)).toEqual([]);
    play('N:E5');
    expect(goTargets(view('S'), 'S')).toHaveLength(80);
    play('S:A2', 'N:A9', 'S:B1');
    // Black's A1 would be suicide: both neighbours are white and the corner has no other liberty.
    expect(goTargets(view('N'), 'N')).not.toContain(node('A1'));
    expect(goTargets(view('N'), 'N')).toContain(node('A3'));
  });

  it('leaves out the point a ko would retake', () => {
    start();
    play('N:E6', 'S:F6', 'N:D5', 'S:E5', 'N:E4', 'S:F4', 'N:A1', 'S:G5', 'N:F5');
    expect(goTargets(view('S'), 'S')).not.toContain(node('E5'));
    play('S:J9', 'N:J1');
    expect(goTargets(view('S'), 'S')).toContain(node('E5'));
  });

  it('offers nothing while marking or after the match', () => {
    start();
    play('N:E5', 'S:pass', 'N:pass');
    expect(game().phase).toBe('marking');
    expect(goTargets(view('S'), 'S')).toEqual([]);
  });

  it('shows the proposal while marking and the settled count afterwards', () => {
    start();
    play('N:E5', 'S:A1', 'N:pass', 'S:pass');
    game().dead = [name('A1')];
    expect(goDeadStones(view())).toEqual([name('A1')]);
    const marking = goCount(view())!;
    expect(marking).toMatchObject({ area: [81, 0], komi: 7.5, winner: 0, margin: 73.5 });
    expect(marking.owner[name('A1')]).toBe(0);
    go.confirmScore(CODE, 'N', [name('A1')], false, 3_000);
    go.confirmScore(CODE, 'S', [name('A1')], false, 3_000);
    expect(goDeadStones(view())).toEqual([name('A1')]);
    expect(goCount(view())).toMatchObject({ area: [81, 0], margin: 73.5 });
  });

  it('counts nothing while playing or after a resignation, and uses the handicap komi', () => {
    start(9, 2);
    expect(goCount(view())).toBeNull();
    play('S:pass', 'N:pass');
    expect(goCount(view())).toMatchObject({ komi: 0.5 });
    go.control(CODE, 'S', { type: 'resign' });
    expect(goCount(view())).toBeNull();
    expect(goDeadStones(view())).toEqual([]);
  });
});

describe('Go client module', () => {
  it('summarises a counted result by its margin and a resignation by its reason', () => {
    const t = ((key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}`);
    const summary = clientGame('go').result.summary;
    const counted = {
      gameType: 'go', seats: ['N', 'S'], options: { size: 9, handicap: 0 }, moves: 90, captured: { N: 0, S: 0 }, dead: [],
      area: { N: 50, S: 31 }, komi: 7.5, margin: 11.5, winners: ['N'], reason: 'score',
    } as const;
    expect(summary({ ...counted, seats: [...counted.seats], dead: [] }, 'N', t as never))
      .toEqual({ kind: 'winners', winners: ['N'], suffix: ' · go.resultMargin{"n":"11.5"}' });
    expect(summary({ ...counted, seats: [...counted.seats], dead: [], area: {}, margin: 0, reason: 'resign' }, 'N', t as never))
      .toEqual({ kind: 'winners', winners: ['N'], suffix: ' · board.reason.resign' });
  });

  it('describes the handicap in the rules summary and keeps the turn out of the marking snapshot', () => {
    const t = ((key: string, params?: Record<string, string>) => `${key}${params ? JSON.stringify(params) : ''}`);
    const { summary } = clientGame('go').rules;
    expect(summary({ option: null, goOptions: { size: 9, handicap: 0 } }, t as never)).toContain('go.rulesScore{"komi":"7.5"}');
    expect(summary({ option: null, goOptions: { size: 9, handicap: 3 } }, t as never)).toContain('go.rulesHandicap{"n":"3","komi":"0.5"}');
    start();
    play('N:pass', 'S:pass');
    const snapshot = clientGame('go').restoreSnapshot(view(), { state: {} as never, retain: (_previous, next) => next });
    expect(snapshot).toMatchObject({ phase: 'playing', currentTurnSeat: null });
  });

  it('limits handicap choices to the board: up to 5 stones on 9 × 9 and 9 on the larger boards', () => {
    expect(goHandicapChoices(9)).toEqual([0, 2, 3, 4, 5]);
    expect(goHandicapChoices(13)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(goHandicapChoices(19)).toEqual(goHandicapChoices(13));
  });

  it('keeps every intersection tap box a full cell wide, so the 19 × 19 grid is as tappable as Gomoku', () => {
    for (const size of [9, 13, 19] as const) {
      const board = goBoard(size);
      expect(hitBox(board.layout)).toEqual({ width: 1, height: 1 });
      expect(board.nodes).toHaveLength(size * size);
      expect(boardAspect(board, 0, true)).toBeCloseTo(1, 0);
    }
  });
});
