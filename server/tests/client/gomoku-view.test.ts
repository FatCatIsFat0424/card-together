import { describe, expect, it } from 'vitest';
import type { GomokuMove, GomokuVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { gmInitialStones, gmNode } from '@shared/rules/gomoku';
import type { GmCell } from '@shared/rules/gomoku';
import { boardAspect, hitBox } from '../../../client/src/games/board/board-view';
import { gomokuBoard } from '@shared/rules/board/boards';
import { clientGame } from '../../../client/src/games/registry';
import { confirmsMove, tapBoard } from '../../../client/src/games/board/board-input';
import {
  gomokuBlackSeat, gomokuLastMove, gomokuMoves, gomokuNextSide, gomokuNotation, gomokuSide, gomokuStageOf,
  gomokuStones, gomokuWinningNodes,
} from '../../../client/src/games/gomoku/gomoku-view';

const at = (name: string): number => (15 - Number(name.slice(1))) * 15 + name.charCodeAt(0) - 97;
const node = (name: string): string => gmNode(at(name));

/** Black and white stones from coordinate lists, with a log that alternates black first. */
function game(black: string, white: string, overrides: Partial<GomokuVisibleState> = {}): GomokuVisibleState {
  const stones = gmInitialStones();
  const log: GomokuMove[] = [];
  const blacks = black.split(' ').filter(Boolean);
  const whites = white.split(' ').filter(Boolean);
  for (let step = 0; step < blacks.length + whites.length; step++) {
    const side = step % 2 === 0 ? 0 : 1;
    const name = (side === 0 ? blacks : whites)[Math.floor(step / 2)];
    stones[at(name)] = side as GmCell;
    log.push({ seat: side === 0 ? 'N' : 'S', to: node(name), timestamp: 1 });
  }
  return {
    gameType: 'gomoku', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { renju: false, swap: false }, stones,
    currentTurnSeat: blacks.length > whites.length ? 'S' : 'N', drawOffer: NO_DRAW_OFFER, log, result: null, ...overrides,
  };
}

describe('Gomoku view helpers', () => {
  it('draws one piece per stone with its colour, and shows the latest stone', () => {
    const view = game('h8 g7', 'i9');
    expect(gomokuStones(view.stones)).toEqual(expect.arrayContaining([
      { node: node('h8'), side: 0 }, { node: node('g7'), side: 0 }, { node: node('i9'), side: 1 },
    ]));
    expect(gomokuStones(view.stones)).toHaveLength(3);
    expect(gomokuLastMove(view)).toEqual({ to: node('g7') });
    expect(gomokuLastMove(game('', ''))).toBeNull();
  });

  it('offers every empty point to the seat on turn and none to anyone else', () => {
    const view = game('h8', 'i9', { currentTurnSeat: 'N' });
    const { targets, forbidden } = gomokuMoves(view, 'N');
    expect(targets).toHaveLength(225 - 2);
    expect(targets).not.toContain(node('h8'));
    expect(forbidden).toEqual([]);
    expect(gomokuMoves(view, 'S').targets).toEqual([]);
    expect(gomokuMoves(view, null).targets).toEqual([]);
    expect(gomokuMoves({ ...view, phase: 'scoring' }, 'N').targets).toEqual([]);
  });

  it('marks forbidden points for black under Renju, and leaves white and free-style play alone', () => {
    const renju = { renju: true, swap: false };
    const black = game('f8 g8 h9 h10', 'a1 a3 a5 a7', { options: renju });
    const mine = gomokuMoves(black, 'N');
    expect(mine.forbidden).toContain(node('h8'));
    expect(mine.targets).not.toContain(node('h8'));
    expect(mine.targets).toContain(node('a2'));
    // Free-style and white see no forbidden points.
    expect(gomokuMoves({ ...black, options: { renju: false, swap: false } }, 'N').forbidden).toEqual([]);
    const white = game('f8 g8 h9 h10 o15', 'a1 a3 a5 a7', { options: renju, mySeat: 'S' });
    expect(gomokuMoves(white, 'S').forbidden).toEqual([]);
  });

  it('gives no target while the second seat chooses a colour in the swap opening', () => {
    const swap = { renju: false, swap: true };
    const opening = game('h8 g7', 'i9', { options: swap, currentTurnSeat: 'S', mySeat: 'S' });
    expect(gomokuStageOf(opening)).toBe('choosing');
    expect(gomokuMoves(opening, 'S').targets).toEqual([]);
    const placing = game('h8', 'i9', { options: swap, currentTurnSeat: 'N' });
    expect(gomokuStageOf(placing)).toBe('placing');
    expect(gomokuMoves(placing, 'N').targets).toHaveLength(223);
    expect(gomokuNextSide(placing)).toBe(0);
  });

  it('follows the colours through a swap', () => {
    const kept = game('h8 g7', 'i9', { options: { renju: false, swap: true } });
    expect([gomokuSide(kept, 'N'), gomokuSide(kept, 'S')]).toEqual([0, 1]);
    const swapped = {
      ...kept, log: [...kept.log, { seat: 'S' as const, swap: true, timestamp: 2 }], currentTurnSeat: 'N' as const,
    };
    expect(gomokuBlackSeat(swapped)).toBe('S');
    expect([gomokuSide(swapped, 'N'), gomokuSide(swapped, 'S')]).toEqual([1, 0]);
    expect(gomokuNextSide(swapped)).toBe(1);
    expect(gomokuStageOf(swapped)).toBe('playing');
  });

  it('highlights the winning line only after a win by five', () => {
    const won = game('e8 f8 g8 h8 i8', 'a1 a3 a5 a7', {
      phase: 'scoring',
      result: { gameType: 'gomoku', seats: ['N', 'S'], blackSeat: 'N', moves: 9, winners: ['N'], reason: 'five-in-row',
        options: { renju: false, swap: false } },
    });
    expect(gomokuWinningNodes(won).sort()).toEqual(['e8', 'f8', 'g8', 'h8', 'i8'].map(node).sort());
    expect(gomokuWinningNodes({ ...won, result: { ...won.result!, reason: 'resign' } })).toEqual([]);
    expect(gomokuWinningNodes(game('h8', ''))).toEqual([]);
  });

  it('writes moves as coordinates and the colour choice in words', () => {
    expect(gomokuNotation({ seat: 'N', to: node('h8'), timestamp: 1 }, 'en')).toBe('h8');
    expect(gomokuNotation({ seat: 'N', to: node('o15'), timestamp: 1 }, 'zh-TW')).toBe('o15');
    expect(gomokuNotation({ seat: 'S', swap: true, timestamp: 1 }, 'en')).toBe('Takes black');
    expect(gomokuNotation({ seat: 'S', swap: false, timestamp: 1 }, 'zh-TW')).toBe('維持執白');
  });
});

describe('Gomoku board input', () => {
  const rules = { movable: [], targets: (from: string | null) => (from === null ? [node('h8'), node('i9')] : []) };

  it('plays a point at once with a mouse and waits for confirmation on touch', () => {
    const state = { selected: null, pending: null };
    expect(tapBoard(state, node('h8'), rules, confirmsMove('mouse', false))).toMatchObject({ submit: { to: node('h8') } });
    const touched = tapBoard(state, node('h8'), rules, confirmsMove('touch', false));
    expect(touched.submit).toBeNull();
    expect(touched.state.pending).toEqual({ to: node('h8') });
    // Tapping a different point moves the pending stone; the same point again plays it.
    expect(tapBoard(touched.state, node('i9'), rules, true).state.pending).toEqual({ to: node('i9') });
    expect(tapBoard(touched.state, node('h8'), rules, true).submit).toEqual({ to: node('h8') });
  });
});

describe('Gomoku board geometry', () => {
  it('tiles the intersections exactly so a tap lands on the nearest one', () => {
    expect(hitBox('points')).toEqual({ width: 1, height: 1 });
    expect(hitBox('cells').width).toBeLessThan(1);
  });

  it('fits a 706 by 336 phone at about 20 pixels between intersections', () => {
    // The board frame takes the full height minus the table padding (24 px).
    const aspect = boardAspect(gomokuBoard(), 0, true);
    const height = 336 - 24;
    const width = height * aspect;
    const units = 14 + 2 * 0.55 + 0.42;
    expect(width).toBeLessThan(706 - 2 * 148 - 40);
    expect(height / units).toBeGreaterThan(19);
  });
});

describe('Gomoku client registration', () => {
  it('lists both room rules in the rules context and the summary', () => {
    const context = clientGame('gomoku').rules.matchContext(game('', '', { options: { renju: true, swap: true } }));
    expect(context.option).toEqual({ label: 'gomoku.renju', enabled: true });
    expect(context.moreOptions).toEqual([{ label: 'gomoku.swap', enabled: true }]);
    const t = (key: string): string => key;
    expect(clientGame('gomoku').rules.summary(context, t)).toEqual([
      'gomoku.rulesFive', 'gomoku.rulesRenju', 'gomoku.rulesSwap', 'gomoku.rulesDraw',
    ]);
    expect(clientGame('gomoku').rules.summary(undefined, t)).toEqual(['gomoku.rulesFive', 'gomoku.rulesDraw']);
  });
});
