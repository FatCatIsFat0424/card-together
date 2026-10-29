import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSeat, PlayerInfo, RoomInfo } from '@shared/types';
import { gomokuBoard, junqiBoard, reversiBoard, starBoard, xiangqiBoard } from '@shared/rules/board/boards';
import { sideRotation } from '@shared/rules/board/board-model';
import { NO_DRAW_OFFER } from '@shared/rules/board/match-controls';
import type { MatchControlAction } from '@shared/rules/board/match-controls';
import { coordinateNotation } from '@shared/rules/board/board-move';

const state = vi.hoisted(() => ({
  room: null as unknown,
  mySeat: 'S' as string | null,
  game: {} as Record<string, unknown>,
}));

vi.mock('../../../client/src/cosmetics/chip-styles/use-chip-style', () => ({ useChipStyle: () => null }));
vi.mock('../../../client/src/cosmetics/card-faces/use-card-face', () => ({
  useCardFaceUrl: () => () => '/card.svg', useJokerFaceUrl: () => null, useCardOrJokerFaceUrl: () => (card: object) => ('joker' in card ? '/joker.svg' : '/card.svg'),
}));
vi.mock('../../../client/src/media', () => ({ mediaUrl: (id: string) => `/api/media/${id}` }));
vi.mock('../../../client/src/socket', () => ({ socket: { emit: vi.fn() } }));
vi.mock('../../../client/src/stores/room-store', () => ({
  useRoomStore: (select: (value: { roomInfo: unknown; mySeat: string | null }) => unknown) =>
    select({ roomInfo: state.room, mySeat: state.mySeat }),
}));
vi.mock('../../../client/src/stores/game-store', () => ({
  useGameStore: (select: (value: Record<string, unknown>) => unknown) => select(state.game),
}));
vi.mock('../../../client/src/stores/god-view-store', () => ({
  useGodViewStore: (select: (value: Record<string, unknown>) => unknown) => select({ role: null, covered: null }),
}));
vi.mock('../../../client/src/stores/table-perspective-store', () => ({
  useTablePerspectiveStore: (select: (value: Record<string, unknown>) => unknown) =>
    select({ seat: 'S', chosen: false, selectSeat: () => undefined }),
}));
vi.mock('../../../client/src/cosmetics/board-styles/use-board-theme', async () => {
  const { DEFAULT_BOARD_THEME } = await import('../../../client/src/games/board/board-theme');
  return { useEquippedBoardTheme: () => DEFAULT_BOARD_THEME };
});
vi.mock('../../../client/src/cosmetics/dice-styles/use-dice-style', () => ({ useEquippedDiceTheme: () => null }));
vi.mock('../../../client/src/games/use-connection-ready', () => ({ useConnectionReady: () => true }));

import { BoardView } from '../../../client/src/games/board/BoardView';
import { StonePiece, TokenPiece } from '../../../client/src/games/board/BoardPieces';
import { BoardTable } from '../../../client/src/games/board/BoardTable';
import type { BoardTableProps } from '../../../client/src/games/board/BoardTable';
import { boardControls } from '../../../client/src/games/board/BoardControls';
import { boardMoveEntries, boardMoveRows } from '../../../client/src/games/board/BoardMoves';
import { boardAspect, boardGeometry } from '../../../client/src/games/board/board-view';
import { boardSeatPlaces } from '../../../client/src/games/board/board-table';
import { boardResultSummary, boardResultTitle } from '../../../client/src/games/board/board-result';
import { DEFAULT_BOARD_THEME, boardThemeStyle } from '../../../client/src/games/board/board-theme';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const t = (...args: Parameters<ReturnType<typeof useI18nStore.getState>['t']>) => useI18nStore.getState().t(...args);
const player = (id: string, nickname: string): PlayerInfo => ({
  id, username: id, nickname, color: '#4a9eff', avatar: 'cat', avatarImage: null,
});

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(MemoryRouter, null, element));
}

const translate = (html: string, key: string): string | undefined =>
  [...html.split(`data-piece="${key}"`)[0].matchAll(/translate\(([^)]+)\)/g)].at(-1)?.[1];

function boardHtml(props: Partial<Parameters<typeof BoardView>[0]> = {}): string {
  return render(createElement(BoardView, {
    board: xiangqiBoard(), surface: 'wood', label: 'Xiangqi',
    pieces: [{ node: '0,9', key: 'rook', piece: createElement('g', { 'data-piece': 'rook' },
      createElement(TokenPiece, { tone: 'red', label: '車' })) }],
    ...props,
  }));
}

beforeEach(() => useI18nStore.getState().setLocale('en'));

describe('board perspective', () => {
  it('should turn piece positions for the far side while text stays upright', () => {
    const own = boardHtml();
    const far = boardHtml({ rotation: sideRotation(xiangqiBoard(), 1) });
    expect(translate(own, 'rook')).toBe('0 9');
    expect(translate(far, 'rook')).toBe('8 0');
    for (const html of [own, far]) {
      expect(html).toContain('>車</text>');
      expect(html).not.toContain('rotate(');
    }
    // The river labels swap halves with the board instead of turning over.
    const label = (html: string, text: string) => html.match(new RegExp(`x="([\\d.]+)"[^>]*>${text}<`))?.[1];
    expect(Number(label(own, 'Chu River'))).toBeLessThan(Number(label(own, 'Han Border')));
    expect(Number(label(far, 'Chu River'))).toBeGreaterThan(Number(label(far, 'Han Border')));
  });

  it('should keep Reversi and Gomoku as drawn for both sides', () => {
    for (const board of [reversiBoard(), gomokuBoard()]) {
      expect(boardGeometry(board, sideRotation(board, 1)).point('0,0'))
        .toEqual(boardGeometry(board, sideRotation(board, 0)).point('0,0'));
    }
  });

  it('should size each board by its drawn aspect', () => {
    expect(boardAspect(gomokuBoard())).toBeCloseTo(1, 5);
    expect(boardAspect(xiangqiBoard())).toBeCloseTo(9.1 / 10.1, 5);
    expect(boardAspect(junqiBoard())).toBeGreaterThan(0.7);
    expect(boardAspect(starBoard())).toBeLessThan(1);
    expect(boardAspect(xiangqiBoard(), 0, true)).toBeGreaterThan(boardAspect(xiangqiBoard()));
  });
});

describe('board markers and input targets', () => {
  it('should draw the last move, selection, targets, captures, and a pending ghost', () => {
    const html = boardHtml({
      lastMove: { from: '8,0', to: '8,1' }, selected: '0,9', check: '4,0',
      targets: [{ node: '0,8' }, { node: '0,0', capture: true }],
      pending: { from: '0,9', to: '0,8', piece: createElement(TokenPiece, { tone: 'red', label: '車' }) },
      selectable: ['0,9'], onNodeClick: () => undefined,
    });
    expect(html.match(/class="[^"]*lastFrom/g)).toHaveLength(1);
    expect(html.match(/class="[^"]*lastTo/g)).toHaveLength(1);
    expect(html).toMatch(/class="[^"]*target/);
    expect(html).toMatch(/class="[^"]*capture/);
    expect(html).toMatch(/class="[^"]*ghost/);
    expect(html).toMatch(/class="[^"]*dimmed/);
    expect(html).toMatch(/class="[^"]*check/);
    expect(html).toContain('aria-label="Move to a2"');
    expect(html).toContain('aria-label="Move to a10"');
    expect(html).toContain('aria-label="Select the piece on a1"');
    expect(html.match(/role="button"/g)).toHaveLength(3);
  });

  it('should mark a placement with a dot and offer no taps on a read-only board', () => {
    const html = render(createElement(BoardView, {
      board: gomokuBoard(), surface: 'wood', label: 'Gomoku', lastMove: { to: '7,7' },
      pieces: [{ node: '7,7', key: 'k', piece: createElement(StonePiece, { tone: 'dark' }) }],
      targets: [{ node: '8,8' }],
    }));
    expect(html).toMatch(/class="[^"]*lastDot/);
    expect(html).not.toMatch(/class="[^"]*lastFrom/);
    expect(html).not.toContain('role="button"');
  });

  it('should tile intersection tap boxes edge to edge with square corners and draw no dot per point', () => {
    const html = render(createElement(BoardView, {
      board: gomokuBoard(), surface: 'wood', label: 'Gomoku', pieces: [], selectable: ['7,7', '8,7'], onNodeClick: () => undefined,
    }));
    const hits = [...html.matchAll(/<rect[^>]*data-board-node="(\d+),7"[^>]*>/g)].map((match) => match[0]);
    expect(hits).toHaveLength(2);
    const [left, right] = hits.map((hit) => ({
      x: Number(/ x="([-\d.]+)"/.exec(hit)![1]), width: Number(/ width="([\d.]+)"/.exec(hit)![1]), hit,
    }));
    expect(left.x + left.width).toBeCloseTo(right.x, 5);
    expect(left.hit).toContain('rx="0"');
    expect(html).not.toMatch(/class="[^"]*target/);
  });

  it('should draw coordinate labels along the viewer\'s edges', () => {
    const files = 'abcdefghi'.split('');
    const html = boardHtml({ fileLabels: files, rankLabels: Array.from({ length: 10 }, (_, row) => String(10 - row)) });
    expect(html).toContain('>a</text>');
    expect(html).toContain('>10</text>');
  });

  it('should expose every theme colour as a CSS variable', () => {
    const style = boardThemeStyle(DEFAULT_BOARD_THEME, 'meadow') as Record<string, string>;
    expect(style['--board-surface']).toBe('#4d6b3a');
    expect(style['--board-den-1']).toBeDefined();
    expect(style['--piece-marble-5']).toBeDefined();
    expect(style['--marker-last']).toBe('#2563eb');
  });
});

describe('board table helpers', () => {
  it('should place a two-player opponent on top and spread more players around the board', () => {
    expect(boardSeatPlaces(['N', 'S'], 'S')).toEqual({ N: 'top' });
    expect(boardSeatPlaces(['N', 'E', 'S', 'W'], 'S')).toEqual({ W: 'left', N: 'top', E: 'right' });
    expect(boardSeatPlaces(['N', 'E', 'S', 'W', 'P5', 'P6'], 'N'))
      .toEqual({ E: 'left', S: 'left', W: 'top', P5: 'right', P6: 'right' });
    expect(boardSeatPlaces(['N', 'E', 'S'], 'E')).toEqual({ S: 'left', N: 'right' });
  });

  it('should build controls from the game rules and draw state', () => {
    const sent: MatchControlAction[] = [];
    const context = { seats: ['N', 'S'] as GameSeat[], turnSeat: 'S' as GameSeat };
    const controls = boardControls({ resign: true, draw: true }, NO_DRAW_OFFER, 'S', context, (action) => sent.push(action))!;
    expect(controls.draw?.block).toBeNull();
    controls.draw?.offer();
    controls.resign?.();
    expect(sent).toEqual([{ type: 'offer-draw' }, { type: 'resign' }]);
    expect(controls.incoming).toBeNull();
    const answering = boardControls({ resign: true, draw: true }, { offeredBy: 'N', cooldown: {} }, 'S', context, (action) => sent.push(action))!;
    answering.incoming?.decline();
    expect(sent.at(-1)).toEqual({ type: 'answer-draw', accept: false });
    expect(answering.draw?.block).toBe('pending');
    expect(boardControls({ resign: true, draw: true }, NO_DRAW_OFFER, null, context, () => undefined)).toBeNull();
    expect(boardControls(undefined, NO_DRAW_OFFER, 'S', context, () => undefined)).toBeNull();
    const multi = boardControls({ resign: true, draw: true }, NO_DRAW_OFFER, 'S', { seats: ['N', 'E', 'S'], turnSeat: 'S' }, () => undefined)!;
    expect(multi.draw).toBeNull();
    expect(multi.resign).not.toBeNull();
  });

  it('should format moves with the notation hook and keep the newest rows for the phone strip', () => {
    const notation = coordinateNotation(gomokuBoard());
    const entries = boardMoveEntries([{ seat: 'N', to: '7,7' }, { seat: 'S' }, { seat: 'N', to: '8,8' }], notation, 'en', t);
    expect(entries.map((entry) => entry.text)).toEqual(['h8', 'Pass', 'i7']);
    const many = Array.from({ length: 11 }, (_, index) => ({ seat: (index % 2 ? 'S' : 'N') as GameSeat, text: String(index) }));
    const rows = boardMoveRows({ entries: many, columns: ['N', 'S'] }, 4);
    expect(rows.map((row) => row.number)).toEqual([3, 4, 5, 6]);
    expect(rows.at(-1)?.cells.map((cell) => cell?.entry.text ?? null)).toEqual(['10', null]);
    expect(boardMoveRows({ entries: many }, 5).map((row) => row.number)).toEqual([7, 8, 9, 10, 11]);
  });

  it('should title results from the viewer\'s side and list the reason in history', () => {
    const name = (seat: GameSeat) => `Player ${seat}`;
    expect(boardResultTitle({ winners: ['N'], reason: 'resign' }, 'N', name, t)).toEqual({ title: 'You win', tone: 'win' });
    expect(boardResultTitle({ winners: ['N'], reason: 'checkmate' }, 'S', name, t)).toEqual({ title: 'You lose', tone: 'lose' });
    expect(boardResultTitle({ winners: [], reason: 'agreed-draw' }, 'S', name, t)).toEqual({ title: 'Draw', tone: 'draw' });
    expect(boardResultTitle({ winners: ['N'], reason: 'timeout' }, null, name, t).title).toBe('Player N wins');
    expect(boardResultSummary({ winners: ['N'], reason: 'resign' }, t))
      .toEqual({ kind: 'winners', winners: ['N'], suffix: ' · Resigned' });
    useI18nStore.getState().setLocale('zh-TW');
    expect(boardResultSummary({ winners: [], reason: 'agreed-draw' }, t)).toEqual({ kind: 'text', text: '和局 · 雙方同意和局' });
  });
});

describe('board table layout', () => {
  const room = (): RoomInfo => ({
    code: 'BOARD1', gameType: 'redpoints', status: 'playing', createdAt: 1, hostId: 'alice',
    abortVote: null, abortVoteCooldownUntil: null,
    seats: {
      N: { player: player('bob', 'Bob'), isReady: true }, E: { player: null, isReady: false },
      S: { player: player('alice', 'Alice'), isReady: true }, W: { player: null, isReady: false },
    },
  });

  beforeEach(() => {
    state.room = room();
    state.mySeat = 'S';
    state.game = { visible: { log: [] }, presentationReceivedAt: 0, phase: 'playing', currentTurnSeat: 'S' };
  });
  afterEach(() => useI18nStore.getState().setLocale('en'));

  const props = (overrides: Partial<BoardTableProps> = {}): BoardTableProps => ({
    seats: ['N', 'S'], bottomSeat: 'S', aspect: 0.9, board: createElement('svg', { 'data-test-board': '' }),
    moves: { entries: [{ seat: 'N', text: 'h8' }, { seat: 'S', text: 'i7' }], columns: ['N', 'S'], heads: ['Black', 'White'] },
    controls: boardControls({ resign: true, draw: true }, NO_DRAW_OFFER, 'S', { seats: ['N', 'S'], turnSeat: 'S' }, () => undefined),
    pending: null, seatStats: (seat) => createElement('span', { 'data-stat': seat }, seat === 'N' ? 'Black' : 'White'),
    ...overrides,
  });

  it('should seat the opponent above the board and the viewer below with the controls', () => {
    const html = render(createElement(BoardTable, props()));
    const [left, rest] = html.split('data-test-board');
    expect(left).toContain('Bob');
    expect(left).toContain('data-table-seat="top"');
    expect(rest).toContain('data-table-seat="bottom"');
    expect(rest).toContain('Alice');
    expect(html).toContain('data-stat="N"');
    expect(html).toContain('>Offer draw</button>');
    expect(html).toContain('>Resign</button>');
    expect(html).not.toContain('Confirm');
    // The phone strip lists the moves; card counts never appear on board seats.
    expect(left).toContain('>h8</span>');
    expect(html).not.toMatch(/\d+ cards/);
    expect(html).toContain('--board-aspect:0.9');
  });

  it('should show the pending move with the fixed confirm button', () => {
    const html = render(createElement(BoardTable, props({
      pending: { text: '車一進六', confirm: () => undefined, cancel: () => undefined },
    })));
    expect(html).toContain('Pending: <strong>車一進六</strong>');
    expect(html).toContain('>Confirm</button>');
    expect(html).toContain('>Cancel</button>');
  });

  it('should replace the confirm area with the opponent\'s draw offer', () => {
    const controls = boardControls({ resign: true, draw: true }, { offeredBy: 'N', cooldown: {} }, 'S',
      { seats: ['N', 'S'], turnSeat: 'S' }, () => undefined);
    const html = render(createElement(BoardTable, props({
      controls, pending: { text: 'h9', confirm: () => undefined, cancel: () => undefined },
    })));
    expect(html).toContain('Draw offered</strong>');
    expect(html).toContain('>Accept</button>');
    expect(html).toContain('>Decline</button>');
    expect(html).not.toContain('>Confirm</button>');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Draw offered; waiting for the reply\."|title="Draw offered; waiting for the reply\."[^>]*disabled=""/);
  });

  it('should disable a draw offer outside the viewer\'s turn and say why', () => {
    state.game = { ...state.game, currentTurnSeat: 'N' };
    const controls = boardControls({ resign: true, draw: true }, NO_DRAW_OFFER, 'S', { seats: ['N', 'S'], turnSeat: 'N' }, () => undefined);
    const html = render(createElement(BoardTable, props({ controls })));
    expect(html).toContain('title="You can offer a draw on your own turn."');
    expect(html).toContain('Opponent is thinking…');
  });

  it('should leave spectators without controls', () => {
    const html = render(createElement(BoardTable, props({ controls: null })));
    expect(html).not.toContain('Resign');
    expect(html).not.toContain('Offer draw');
  });
});
