import { describe, expect, it, vi } from 'vitest';
import type { XiangqiMatchResult, XiangqiVisibleState } from '@shared/types';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import { xqInitialBoard } from '@shared/rules/xiangqi';
import {
  XIANGQI_NOTATION, xiangqiCaptures, xiangqiCheck, xiangqiLastMove, xiangqiPendingText, xiangqiPieces, xiangqiSide,
  xiangqiTargets,
} from '../../../client/src/games/xiangqi/xiangqi-view';
import { clientGame } from '../../../client/src/games/registry';
import { gameUi } from '../../../client/src/games/ui-registry';
import { newBoardMoveCue } from '../../../client/src/games/board/board-move-sound';
import { boardMoveEntries } from '../../../client/src/games/board/BoardMoves';
import { xqPosition } from '../fixtures/xiangqi-positions';

// The UI registry reaches components that read the account.
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
}));

function game(overrides: Partial<XiangqiVisibleState> = {}): XiangqiVisibleState {
  return {
    gameType: 'xiangqi', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { handicap: 'none', handicapSide: 'red' },
    board: xqInitialBoard(), currentTurnSeat: 'N', drawOffer: NO_DRAW_OFFER, log: [], result: null, ...overrides,
  };
}

const t = ((key: string) => key) as never;

describe('Xiangqi view helpers', () => {
  it('draws every piece and assigns red to the first seat', () => {
    expect(xiangqiPieces(game().board)).toHaveLength(32);
    expect([xiangqiSide(game(), 'N'), xiangqiSide(game(), 'S')]).toEqual([0, 1]);
  });

  it('offers legal destinations by origin only to the seat on turn', () => {
    const targets = xiangqiTargets(game(), 'N');
    expect([...targets.values()].flat()).toHaveLength(44);
    expect([...targets.get('7,9')!].sort()).toEqual(['6,7', '8,7']);
    expect(xiangqiTargets(game(), 'S').size).toBe(0);
    expect(xiangqiTargets(game(), null).size).toBe(0);
    expect(xiangqiTargets(game({ phase: 'scoring' }), 'N').size).toBe(0);
  });

  it('marks the general in check while playing and after a checkmate', () => {
    const board = xqPosition(['R...k....', '........R', '.........', '.........', '.........', '.........', '.........',
      '.........', '.........', '...K.....']);
    const log = [{ seat: 'N' as const, from: '0,5', to: '0,0', piece: 'R' as const, check: true, timestamp: 1 }];
    expect(xiangqiCheck(game({ board, currentTurnSeat: 'S', log }))).toBe('4,0');
    const result: XiangqiMatchResult = { gameType: 'xiangqi', seats: ['N', 'S'], moves: 1, winners: ['N'], reason: 'checkmate' };
    expect(xiangqiCheck(game({ board, phase: 'scoring', currentTurnSeat: 'N', log, result }))).toBe('4,0');
    expect(xiangqiCheck(game({ board, phase: 'scoring', log, result: { ...result, reason: 'resign' } }))).toBeNull();
    expect(xiangqiCheck(game())).toBeNull();
  });

  it('lists captures per seat and the last move', () => {
    const log = [
      { seat: 'N' as const, from: '7,7', to: '7,0', piece: 'C' as const, captured: 'h' as const, capture: true, timestamp: 1 },
      { seat: 'S' as const, from: '8,0', to: '7,0', piece: 'r' as const, captured: 'C' as const, capture: true, timestamp: 2 },
    ];
    expect(xiangqiCaptures(game({ log }))).toEqual({ N: ['h'], S: ['C'] });
    expect(xiangqiLastMove(game({ log }))).toEqual({ from: '8,0', to: '7,0' });
    expect(xiangqiLastMove(game())).toBeNull();
  });

  it('writes moves and pending moves in Chinese or WXF notation', () => {
    const log = [{ seat: 'N' as const, from: '7,7', to: '4,7', piece: 'C' as const, timestamp: 1 }];
    expect(boardMoveEntries(log, XIANGQI_NOTATION, 'zh-TW', t)).toEqual([{ seat: 'N', text: '炮二平五', mark: undefined }]);
    expect(boardMoveEntries(log, XIANGQI_NOTATION, 'en', t)[0].text).toBe('C2=5');
    expect(xiangqiPendingText(game(), '7,0', '6,2', 'zh-TW')).toBe('馬8進7');
    expect(xiangqiPendingText(game(), '4,4', '4,5', 'en')).toBe('');
  });
});

describe('Xiangqi sounds and client module', () => {
  it('sounds check before capture, and capture before a plain move', () => {
    const cue = gameUi('xiangqi').boardMoveCue!;
    const base = { seat: 'N' as const, from: '7,7', to: '4,7', piece: 'C' as const, timestamp: 1 };
    expect(cue(base, game())).toBe('place');
    expect(cue({ ...base, captured: 'p', capture: true }, game())).toBe('capture');
    expect(cue({ ...base, captured: 'p', capture: true, check: true }, game())).toBe('check');
    expect(newBoardMoveCue(game(), game({ log: [{ ...base, check: true }] }))).toBe('check');
  });

  it('summarizes results and restores snapshots', () => {
    const client = clientGame('xiangqi');
    const win: XiangqiMatchResult = { gameType: 'xiangqi', seats: ['N', 'S'], moves: 41, winners: ['N'], reason: 'checkmate' };
    expect(client.result.winners(win)).toEqual(['N']);
    expect(client.result.summary(win, 'N', t)).toMatchObject({ kind: 'winners', winners: ['N'] });
    expect(client.result.summary({ ...win, winners: [], reason: 'repetition' }, 'N', t)).toMatchObject({ kind: 'text' });
    const retain = <T,>(_previous: T | null, next: T): T => next;
    expect(client.restoreSnapshot(game({ currentTurnSeat: 'S' }), { state: { xiangqi: null } as never, retain }))
      .toMatchObject({ phase: 'playing', currentTurnSeat: 'S' });
  });

  it('describes the handicap in the rules summary', () => {
    const client = clientGame('xiangqi');
    const translate = ((key: string, values?: Record<string, string>) => `${key}${values ? JSON.stringify(values) : ''}`) as never;
    const context = client.rules.matchContext(game({ options: { handicap: 'nine', handicapSide: 'black' } }));
    expect(context.option).toEqual({ label: 'xiangqi.handicap', enabled: true });
    expect(client.rules.summary(context, translate).at(-1)).toContain('xiangqi.handicapPieces.nine');
    expect(client.rules.summary(client.rules.matchContext(game()), translate)).toHaveLength(3);
  });
});
