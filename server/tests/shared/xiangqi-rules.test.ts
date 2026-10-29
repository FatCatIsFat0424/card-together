import { describe, expect, it } from 'vitest';
import { inZone, neighbours, offsetNode } from '@shared/rules/board/board-model';
import type { NodeId } from '@shared/rules/board/board-model';
import { xiangqiBoard } from '@shared/rules/board/boards';
import {
  XQ_CELLS, XQ_NO_CAPTURE_PLIES, isXqBoard, xqApply, xqCell, xqGeneral, xqInCheck, xqIndex, xqInitialBoard, xqIsLegal,
  xqKindOf, xqLegalMoves, xqMoveFacts, xqNode, xqNotation, xqOpponent, xqPerft, xqPlies, xqQuietPlies, xqSideOf, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqCell, XqPly, XqSide } from '@shared/rules/xiangqi';
import { lcg, xqFen, xqPosition } from '../fixtures/xiangqi-positions';

const BOARD = xiangqiBoard();
const at = xqIndex;

function moveSet(board: XqBoard, side: XqSide): string[] {
  return xqLegalMoves(board, side).map((move) => `${xqNode(move.from)}>${xqNode(move.to)}`).sort();
}

function targetsOf(board: XqBoard, side: XqSide, from: number): string[] {
  return xqLegalMoves(board, side).filter((move) => move.from === from).map((move) => xqNode(move.to)).sort();
}

// ─── Independent reference generator built on the board kit's edges and zones ───

function referencePseudo(board: XqBoard, side: XqSide): [number, number][] {
  const moves: [number, number][] = [];
  const own = (cell: number): boolean => board[cell] !== null && xqSideOf(board[cell]!) === side;
  const add = (from: number, node: NodeId | undefined): void => {
    if (node === undefined) return;
    const to = xqCell(node)!;
    if (!own(to)) moves.push([from, to]);
  };
  const empty = (node: NodeId | undefined): boolean => node !== undefined && board[xqCell(node)!] === null;
  for (let from = 0; from < XQ_CELLS; from++) {
    const piece = board[from];
    if (!piece || xqSideOf(piece) !== side) continue;
    const id = xqNode(from);
    const ahead = side === 0 ? -1 : 1;
    switch (xqKindOf(piece)) {
      case 'k':
        for (const next of neighbours(BOARD, id, ['line'])) if (inZone(BOARD, next, 'palace', side)) add(from, next);
        break;
      case 'a':
        for (const next of neighbours(BOARD, id, ['diagonal'])) add(from, next);
        break;
      case 'e':
        for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const target = offsetNode(BOARD, id, 2 * dc, 2 * dr);
          if (target && empty(offsetNode(BOARD, id, dc, dr)) && inZone(BOARD, target, 'territory', side)) add(from, target);
        }
        break;
      case 'h':
        for (const [dc, dr] of [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]]) {
          const leg = Math.abs(dr) === 2 ? offsetNode(BOARD, id, 0, dr / 2) : offsetNode(BOARD, id, dc / 2, 0);
          if (empty(leg)) add(from, offsetNode(BOARD, id, dc, dr));
        }
        break;
      case 'r':
      case 'c':
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let screens = 0;
          for (let step = 1; ; step++) {
            const node = offsetNode(BOARD, id, dc * step, dr * step);
            if (!node) break;
            const occupied = !empty(node);
            if (xqKindOf(piece) === 'r') {
              add(from, node);
              if (occupied) break;
            } else if (screens === 0) {
              if (occupied) screens = 1;
              else add(from, node);
            } else if (occupied) {
              if (!own(xqCell(node)!)) add(from, node);
              break;
            }
          }
        }
        break;
      case 'p':
        add(from, offsetNode(BOARD, id, 0, ahead));
        if (!inZone(BOARD, id, 'territory', side)) {
          add(from, offsetNode(BOARD, id, 1, 0));
          add(from, offsetNode(BOARD, id, -1, 0));
        }
        break;
    }
  }
  return moves;
}

function referenceInCheck(board: XqBoard, side: XqSide): boolean {
  const general = xqGeneral(board, side);
  const enemy = xqGeneral(board, xqOpponent(side));
  const column = general % 9;
  if (enemy >= 0 && enemy % 9 === column) {
    const [low, high] = [Math.min(general, enemy), Math.max(general, enemy)];
    let open = true;
    for (let cell = low + 9; cell < high; cell += 9) if (board[cell] !== null) open = false;
    if (open) return true;
  }
  return referencePseudo(board, xqOpponent(side)).some(([, to]) => to === general);
}

function referenceLegal(board: XqBoard, side: XqSide): string[] {
  return referencePseudo(board, side)
    .filter(([from, to]) => !referenceInCheck(xqApply(board, from, to), side))
    .map(([from, to]) => `${xqNode(from)}>${xqNode(to)}`).sort();
}

describe('Xiangqi start position and handicaps', () => {
  it('sets up the standard position with red on the bottom rows', () => {
    const board = xqInitialBoard();
    expect(isXqBoard(board)).toBe(true);
    expect(board.slice(0, 9).join('')).toBe('rheakaehr');
    expect(board.slice(81, 90).join('')).toBe('RHEAKAEHR');
    expect([board[at(1, 2)], board[at(7, 7)], board[at(4, 3)], board[at(8, 6)]]).toEqual(['c', 'C', 'p', 'P']);
    expect(board.filter(Boolean)).toHaveLength(32);
  });

  it('removes the giver’s own left pieces and keeps the receiver whole', () => {
    const count = (board: XqBoard, side: XqSide): number => board.filter((cell) => cell && xqSideOf(cell) === side).length;
    const horse = xqInitialBoard('horse', 'red');
    expect([horse[at(1, 9)], horse[at(7, 9)], count(horse, 0), count(horse, 1)]).toEqual([null, 'H', 15, 16]);
    const blackHorse = xqInitialBoard('horse', 'black');
    // Black's left hand is the board's right as red sees it.
    expect([blackHorse[at(7, 0)], blackHorse[at(1, 0)], count(blackHorse, 1)]).toEqual([null, 'h', 15]);
    expect(xqInitialBoard('horses', 'red').filter((cell) => cell === 'H')).toHaveLength(0);
    const chariot = xqInitialBoard('chariot', 'black');
    expect([chariot[at(8, 0)], chariot[at(0, 0)], count(chariot, 1)]).toEqual([null, 'r', 15]);
    const nine = xqInitialBoard('nine', 'red');
    expect(nine.filter((cell) => cell && xqSideOf(cell) === 0).sort()).toEqual(['C', 'C', 'H', 'H', 'K', 'R', 'R']);
    expect(count(nine, 1)).toBe(16);
    expect(xqInitialBoard('none', 'black')).toEqual(xqInitialBoard());
  });

  it('keeps every handicap start legal for both sides to play', () => {
    for (const handicap of ['horse', 'horses', 'chariot', 'nine'] as const) {
      for (const giver of ['red', 'black'] as const) {
        const board = xqInitialBoard(handicap, giver);
        expect(xqInCheck(board, 0)).toBe(false);
        expect(moveSet(board, 0)).toEqual(referenceLegal(board, 0));
        expect(moveSet(board, 1)).toEqual(referenceLegal(board, 1));
      }
    }
  });
});

describe('Xiangqi move generation (perft)', () => {
  it('counts the known leaf totals from the start position', () => {
    const board = xqInitialBoard();
    expect([1, 2, 3].map((depth) => xqPerft(board, 0, depth))).toEqual([44, 1920, 79666]);
    expect(xqPerft(board, 0, 4)).toBe(3290240);
  });

  it('counts the known leaf totals of published middlegame positions', () => {
    expect([1, 2, 3].map((depth) => xqPerft(
      xqFen('r1ba1a3/4kn3/2n1b4/pNp1p1p1p/4c4/6P2/P1P2R2P/1CcC5/9/2BAKAB2 w'), 0, depth,
    ))).toEqual([38, 1128, 43929]);
    expect([1, 2, 3].map((depth) => xqPerft(
      xqFen('1rbaka2R/5r3/6n2/2p1p1p2/4P1bP1/PpC3Bc1/1nPR2P2/2N2AN2/1c2K1p2/2BAC4 w'), 0, depth,
    ))).toEqual([49, 2265, 100326]);
  });

  it('agrees with an independent generator over seeded random games', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const random = lcg(seed);
      let board: XqBoard = xqInitialBoard(seed % 3 === 0 ? 'nine' : 'none', seed % 2 === 0 ? 'red' : 'black');
      let side: XqSide = 0;
      for (let ply = 0; ply < 120; ply++) {
        const moves = xqLegalMoves(board, side);
        expect(moveSet(board, side)).toEqual(referenceLegal(board, side));
        if (moves.length === 0) break;
        const move = moves[Math.floor(random() * moves.length)];
        board = xqApply(board, move.from, move.to);
        side = xqOpponent(side);
      }
    }
  });
});

describe('Xiangqi piece rules', () => {
  const lone = (rows: string[]): XqCell[] => xqPosition(rows);

  it('confines the general and advisors to the palace', () => {
    const board = lone(['...k.....', '.........', '.........', '.........', '.........', '.........', '.........',
      '...A.....', '.........', '.....K...']);
    expect(targetsOf(board, 0, at(5, 9))).toEqual(['4,9', '5,8']);
    expect(targetsOf(board, 0, at(3, 7))).toEqual(['4,8']);
  });

  it('blocks elephants at the eye and keeps them on their own side', () => {
    const board = lone(['...k.....', '.........', '.........', '.........', '.........', '..E......', '...P.....',
      '.........', '.........', '.....K...']);
    // From c5 the elephant may only go back: across the river is forbidden and the eye at d6 is blocked.
    expect(targetsOf(board, 0, at(2, 5))).toEqual(['0,7']);
  });

  it('blocks a horse at its leg', () => {
    const board = lone(['...k.....', '.........', '.........', '.........', '.........', '.........', '....P....',
      '....H....', '.........', '.....K...']);
    expect(targetsOf(board, 0, at(4, 7))).toEqual(['2,6', '2,8', '3,9', '6,6', '6,8']);
  });

  it('lets a cannon capture only over exactly one screen', () => {
    const board = lone(['...k.....', '.........', '....r....', '.........', '....p....', '.........', '.........',
      '....C....', '.........', '.....K...']);
    const targets = targetsOf(board, 0, at(4, 7));
    expect(targets).toContain('4,2');
    expect(targets).toContain('4,5');
    expect(targets).not.toContain('4,4');
    expect(targets).not.toContain('4,3');
  });

  it('moves soldiers forward, and sideways only after crossing the river', () => {
    const board = lone(['...k.....', '.........', '.........', '..P......', '.........', '.........', '......P..',
      '.........', '.........', '.....K...']);
    expect(targetsOf(board, 0, at(6, 6))).toEqual(['6,5']);
    expect(targetsOf(board, 0, at(2, 3))).toEqual(['1,3', '2,2', '3,3']);
  });

  it('forbids the generals from facing on an open file', () => {
    const board = lone(['....k....', '.........', '.........', '.........', '....R....', '.........', '.........',
      '.........', '.........', '....K....']);
    // The chariot is the only screen between the generals, so it can only move along the file.
    const along = targetsOf(board, 0, at(4, 4));
    expect(along).toContain('4,2');
    expect(along.every((node) => node.startsWith('4,'))).toBe(true);
    const open = lone(['....k....', '.........', '.........', '.........', '.........', '.........', '.........',
      '.........', '.........', '...K.....']);
    expect(xqIsLegal(open, 0, at(3, 9), at(4, 9))).toBe(false);
    expect(xqIsLegal(open, 0, at(3, 9), at(3, 8))).toBe(true);
  });

  it('rejects moves that leave the own general in check', () => {
    const board = lone(['...k.....', '.........', '.........', '.........', '.........', '.........', '.........',
      '....r....', '....A....', '....K....']);
    expect(xqInCheck(board, 0)).toBe(false);
    // The advisor is pinned against the chariot on the file.
    expect(targetsOf(board, 0, at(4, 8))).toEqual([]);
  });
});

describe('Xiangqi verdicts', () => {
  function play(board: XqBoard, side: XqSide, moves: readonly [number, number][]): { board: XqBoard; side: XqSide; plies: XqPly[] } {
    let current = board;
    let toMove = side;
    const plies: XqPly[] = [];
    for (const [from, to] of moves) {
      expect(xqIsLegal(current, toMove, from, to)).toBe(true);
      const facts = xqMoveFacts(current, from, to);
      plies.push({ from, to, piece: facts.piece, captured: facts.captured ?? null, check: facts.check === true });
      current = xqApply(current, from, to);
      toMove = xqOpponent(toMove);
    }
    return { board: current, side: toMove, plies };
  }

  it('ends in checkmate when the side in check has no legal move', () => {
    const board = xqPosition(['....k....', '........R', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    const after = play(board, 0, [[at(0, 5), at(0, 0)]]);
    expect(after.plies[0].check).toBe(true);
    expect(xqVerdict(after.board, after.side, after.plies)).toEqual({ reason: 'checkmate', loser: 1 });
  });

  it('counts stalemate (no legal move without check) as a loss', () => {
    const board = xqPosition(['....k....', '........R', '.........', '.........', '.........', '.....R...', '.........',
      '.........', '.........', '...K.....']);
    expect(xqInCheck(board, 1)).toBe(false);
    expect(xqLegalMoves(board, 1)).toEqual([]);
    expect(xqVerdict(board, 1, [])).toEqual({ reason: 'stalemate', loser: 1 });
  });

  it('draws the third occurrence of a position without perpetual check', () => {
    const start = xqInitialBoard();
    const shuffle: [number, number][] = [
      [at(1, 9), at(2, 7)], [at(1, 0), at(2, 2)], [at(2, 7), at(1, 9)], [at(2, 2), at(1, 0)],
    ];
    const twice = play(start, 0, shuffle);
    expect(xqVerdict(twice.board, twice.side, twice.plies)).toBeNull();
    const thrice = play(start, 0, [...shuffle, ...shuffle]);
    expect(xqVerdict(thrice.board, thrice.side, thrice.plies)).toEqual({ reason: 'repetition', loser: null });
  });

  it('makes the side giving perpetual check lose on the third occurrence', () => {
    const board = xqPosition(['....k....', '.........', '.........', '.........', '.........', 'R........', '.........',
      '.........', '.........', '...K.....']);
    const cycle: [number, number][] = [[at(4, 0), at(4, 1)], [at(0, 0), at(0, 1)], [at(4, 1), at(4, 0)], [at(0, 1), at(0, 0)]];
    const opening = play(board, 0, [[at(0, 5), at(0, 0)], ...cycle]);
    expect(xqVerdict(opening.board, opening.side, opening.plies)).toBeNull();
    const result = play(board, 0, [[at(0, 5), at(0, 0)], ...cycle, ...cycle]);
    expect(result.plies.filter((ply) => xqSideOf(ply.piece) === 0).every((ply) => ply.check)).toBe(true);
    expect(xqVerdict(result.board, result.side, result.plies)).toEqual({ reason: 'perpetual-check', loser: 0 });
  });

  it('draws after 120 plies without a capture and counts only plies since the last capture', () => {
    const quiet = (count: number, capture = false): XqPly[] => Array.from({ length: count }, (_, index) => ({
      from: 0, to: 1, piece: 'R', captured: capture && index === 0 ? 'p' : null, check: false,
    }));
    expect(xqQuietPlies([...quiet(1, true), ...quiet(5)])).toBe(5);
    expect(xqQuietPlies(quiet(1, true))).toBe(0);
    const random = lcg(99);
    let board: XqBoard = xqInitialBoard();
    let side: XqSide = 0;
    const plies: XqPly[] = [];
    // Quiet, non-repeating play until the limit.
    while (plies.length < XQ_NO_CAPTURE_PLIES) {
      const options = xqLegalMoves(board, side).filter((move) => board[move.to] === null).filter((move) => {
        const facts = xqMoveFacts(board, move.from, move.to);
        const next = [...plies, { ...move, piece: facts.piece, captured: null, check: facts.check === true }];
        const verdict = xqVerdict(xqApply(board, move.from, move.to), xqOpponent(side), next);
        return plies.length === XQ_NO_CAPTURE_PLIES - 1 ? verdict?.reason === 'no-capture-limit' : verdict === null;
      });
      expect(options.length).toBeGreaterThan(0);
      const move = options[Math.floor(random() * options.length)];
      const facts = xqMoveFacts(board, move.from, move.to);
      plies.push({ ...move, piece: facts.piece, captured: null, check: facts.check === true });
      board = xqApply(board, move.from, move.to);
      side = xqOpponent(side);
    }
    expect(xqVerdict(board, side, plies)).toEqual({ reason: 'no-capture-limit', loser: null });
  });

  it('reads the verdict history from public move records', () => {
    expect(xqPlies([{ from: '1,9', to: '2,7', piece: 'H' }, { from: '7,2', to: '7,9', piece: 'c', captured: 'H', check: true }]))
      .toEqual([
        { from: at(1, 9), to: at(2, 7), piece: 'H', captured: null, check: false },
        { from: at(7, 2), to: at(7, 9), piece: 'c', captured: 'H', check: true },
      ]);
  });
});

describe('Xiangqi notation', () => {
  /** Notation of a move on `board`, in both locales. */
  function notate(board: XqBoard, from: [number, number], to: [number, number]): [string | null, string | null] {
    const origin = at(...from);
    const target = at(...to);
    const facts = xqMoveFacts(board, origin, target);
    const move = { from: xqNode(origin), to: xqNode(target), piece: facts.piece, line: facts.line };
    return [xqNotation(move, 'zh-TW'), xqNotation(move, 'en')];
  }
  const start = xqInitialBoard();

  it('writes the opening moves of both sides', () => {
    expect(notate(start, [7, 7], [4, 7])).toEqual(['炮二平五', 'C2=5']);
    expect(notate(start, [7, 0], [6, 2])).toEqual(['馬8進7', 'H8+7']);
    expect(notate(start, [7, 9], [6, 7])).toEqual(['傌二進三', 'H2+3']);
    expect(notate(start, [8, 0], [8, 1])).toEqual(['車9進1', 'R9+1']);
    expect(notate(start, [0, 9], [0, 8])).toEqual(['俥九進一', 'R9+1']);
    expect(notate(start, [6, 6], [6, 5])).toEqual(['兵三進一', 'P3+1']);
    expect(notate(start, [0, 3], [0, 4])).toEqual(['卒1進1', 'P1+1']);
    expect(notate(start, [1, 2], [1, 9])).toEqual(['包2進7', 'C2+7']);
    expect(notate(start, [3, 9], [4, 8])).toEqual(['仕六進五', 'A6+5']);
    expect(notate(start, [5, 0], [4, 1])).toEqual(['士6進5', 'A6+5']);
    expect(notate(start, [2, 9], [4, 7])).toEqual(['相七進五', 'E7+5']);
    expect(notate(start, [6, 0], [4, 2])).toEqual(['象7進5', 'E7+5']);
    expect(notate(start, [4, 9], [4, 8])).toEqual(['帥五進一', 'K5+1']);
  });

  it('writes retreats by points for straight movers and by file for diagonal movers', () => {
    const board = xqPosition(['...k.....', '.........', '.........', '.........', 'R........', '.........', '.........',
      '....E....', '....K....', '.........']);
    expect(notate(board, [0, 4], [0, 8])).toEqual(['俥九退四', 'R9-4']);
    expect(notate(board, [4, 7], [6, 9])).toEqual(['相五退三', 'E5-3']);
    expect(notate(board, [4, 8], [3, 8])).toEqual(['帥五平六', 'K5=6']);
    expect(notate(board, [3, 0], [3, 1])).toEqual(['將4進1', 'K4+1']);
  });

  it('marks front and rear for two identical pieces on one file', () => {
    const board = xqPosition(['...k.....', '.........', '..h......', 'R........', '.........', '..h......', '.........',
      'R........', '.........', '....K....']);
    expect(notate(board, [0, 3], [4, 3])).toEqual(['前俥平五', 'R+=5']);
    expect(notate(board, [0, 7], [0, 8])).toEqual(['後俥退一', 'R--1']);
    // Black advances towards row 9, so its front horse is the lower one.
    expect(notate(board, [2, 5], [3, 7])).toEqual(['前馬進4', 'H++4']);
    expect(notate(board, [2, 2], [3, 0])).toEqual(['後馬退4', 'H--4']);
  });

  it('names stacked soldiers by front, middle, and rear or by number', () => {
    const two = xqPosition(['...k.....', '.........', '....P....', '....P....', '.........', '.........', '.........',
      '.........', '.........', '.....K...']);
    expect(notate(two, [4, 2], [3, 2])).toEqual(['前兵平六', 'P+=6']);
    const three = xqPosition(['...k.....', '....P....', '....P....', '....P....', '.........', '.........', '.........',
      '.........', '.........', '.....K...']);
    expect(notate(three, [4, 2], [3, 2])).toEqual(['中兵平六', '25=6']);
    expect(notate(three, [4, 3], [5, 3])).toEqual(['後兵平四', '35=4']);
    const four = xqPosition(['...k.P...', '....P....', '....P....', '....P....', '....P....', '.........', '.........',
      '.........', '.........', '.....K...']);
    expect(notate(four, [4, 2], [3, 2])).toEqual(['二兵平六', '25=6']);
    const crowded = xqPosition(['...k.....', '.........', '....P....', '..P.P....', '..P......', '.........', '.........',
      '.........', '.........', '.....K...']);
    expect(notate(crowded, [4, 2], [5, 2])).toEqual(['前兵五平四', '15=4']);
    expect(notate(crowded, [2, 3], [1, 3])).toEqual(['前兵七平八', '17=8']);
  });

  it('formats black soldiers with Arabic digits', () => {
    const board = xqPosition(['...k.....', '.........', '.........', '.........', '.........', '..p......', '..p......',
      '.........', '.........', '.....K...']);
    expect(notate(board, [2, 6], [1, 6])).toEqual(['前卒平2', 'P+=2']);
    expect(notate(board, [2, 5], [3, 5])).toEqual(['後卒平4', 'P-=4']);
  });

  it('returns null for an unknown point', () => {
    expect(xqNotation({ from: 'x', to: '0,0', piece: 'R' }, 'en')).toBeNull();
  });
});
