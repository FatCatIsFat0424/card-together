import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  BOARD_STYLES, DICE_STYLES, EQUIPMENT_SLOTS, PIECE_STYLES, SHOP_SERIES, equipmentSlotFor, shopItemSeries,
} from '@shared/constants';
import { gomokuBoard } from '@shared/rules/board/boards';
import { nodeId } from '@shared/rules/board/board-model';

const equipped = vi.hoisted(() => ({ account: null as Record<string, unknown> | null }));
vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: Record<string, unknown> | null }) => unknown) => select(equipped),
}));

import { colourDistance, contrast } from '../../../client/src/cosmetics/colour';
import {
  PIECE_DESIGNS, PIECE_TEXT_CONTRAST, piecePalette, resolvePieceStyle,
} from '../../../client/src/cosmetics/piece-styles/piece-designs';
import {
  BOARD_DESIGNS, BOARD_GAP_CONTRAST, BOARD_LINE_CONTRAST, BOARD_TEXT_CONTRAST, resolveBoardStyle,
} from '../../../client/src/cosmetics/board-styles/board-designs';
import { boardThemeFor } from '../../../client/src/cosmetics/board-styles/board-theme-for';
import { DICE_DESIGNS, PIP_CONTRAST, PIP_ONE_CONTRAST, resolveDiceStyle } from '../../../client/src/cosmetics/dice-styles/dice-designs';
import { pieceStylesTranslations } from '../../../client/src/cosmetics/piece-styles/i18n';
import { boardStylesTranslations } from '../../../client/src/cosmetics/board-styles/i18n';
import { diceStylesTranslations } from '../../../client/src/cosmetics/dice-styles/i18n';
import { DEFAULT_BOARD_THEME, FIXED_PIECE_COLOURS, boardThemeStyle } from '../../../client/src/games/board/board-theme';
import type { BoardSurface } from '../../../client/src/games/board/board-theme';
import {
  CoveredToken, PieceFinishContext, TilePiece, TokenPiece,
} from '../../../client/src/games/board/BoardPieces';
import { BoardView } from '../../../client/src/games/board/BoardView';
import { SHOP_GROUPS, resolveShopView } from '../../../client/src/shop-filters';

const ANIMATED = new Set(['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm']);
const SURFACES: readonly BoardSurface[] = ['wood', 'green', 'meadow', 'field', 'star'];

describe('board, piece, and dice products', () => {
  it.each([
    ['pieceStyle', PIECE_STYLES, 160, 'pieces-', pieceStylesTranslations],
    ['boardStyle', BOARD_STYLES, 120, 'board-', boardStylesTranslations],
    ['diceStyle', DICE_STYLES, 80, 'dice-', diceStylesTranslations],
  ] as const)('sells one %s per native series with names in both languages', (type, items, price, prefix, translations) => {
    expect(items.map((item) => item.design)).toEqual([...SHOP_SERIES]);
    for (const item of items) {
      expect(item).toMatchObject({ type, price, id: `${prefix}${item.design}` });
      expect(shopItemSeries(item)).toBe(item.design);
      const key = `shop.item.${item.id}.name` as keyof typeof translations.en;
      expect(translations.en[key]).toBeTruthy();
      expect(translations['zh-TW'][key]).toBeTruthy();
    }
    expect(EQUIPMENT_SLOTS[type]).toBe(type);
    expect(equipmentSlotFor(type)).toBe(type);
  });

  it('shows board and dice shop groups once their products exist', () => {
    expect(SHOP_GROUPS.find((group) => group.id === 'chess')?.types).toEqual(['pieceStyle', 'boardStyle']);
    expect(SHOP_GROUPS.find((group) => group.id === 'dice')?.types).toEqual(['diceStyle']);
    const view = resolveShopView(new URLSearchParams('type=boardStyle'), [...PIECE_STYLES, ...BOARD_STYLES, ...DICE_STYLES]);
    expect(view).toMatchObject({ groups: ['chess', 'dice'], group: 'chess', types: ['pieceStyle', 'boardStyle'] });
  });

  it('treats unknown or missing equipment as the default style', () => {
    for (const resolve of [resolvePieceStyle, resolveBoardStyle, resolveDiceStyle]) {
      expect(resolve(undefined)).toBeNull();
      expect(resolve(null)).toBeNull();
      expect(resolve('pieces-removed')).toBeNull();
      expect(resolve('toString')).toBeNull();
    }
    expect(boardThemeFor(null, null)).toBe(DEFAULT_BOARD_THEME);
  });
});

describe.each(PIECE_STYLES)('$id piece readability', ({ id }) => {
  const palette = piecePalette(id);

  it('keeps lettering legible and the two sides of every game distinct', () => {
    // Engraved tokens (Xiangqi, Banqi): side-coloured text on the face.
    for (const tone of [palette.red, palette.black]) expect(contrast(tone, palette.face)).toBeGreaterThanOrEqual(PIECE_TEXT_CONTRAST);
    // Solid tokens and tiles (Jungle, Land Battle Chess): light text on the side colour.
    for (const tone of [palette.red, palette.blue, palette.black]) {
      expect(contrast(palette.onSolid, tone)).toBeGreaterThanOrEqual(PIECE_TEXT_CONTRAST);
    }
    expect(colourDistance(palette.red, palette.black)).toBeGreaterThan(35);
    expect(colourDistance(palette.red, palette.blue)).toBeGreaterThan(35);
    // Reversi and Gomoku.
    expect(contrast(palette.darkStone, palette.lightStone)).toBeGreaterThanOrEqual(10);
    expect(contrast(palette.lightStoneRim, palette.lightStone)).toBeGreaterThanOrEqual(2);
    for (const board of [null, ...BOARD_STYLES.map((item) => item.id)]) {
      const felt = boardThemeFor(board, null).surfaces.green.cell;
      expect(contrast(palette.darkStone, felt), `${board} felt`).toBeGreaterThanOrEqual(2);
      expect(contrast(palette.lightStone, felt), `${board} felt`).toBeGreaterThanOrEqual(2);
    }
  });

  it('never changes face-down pieces, marbles, or markers', () => {
    for (const key of FIXED_PIECE_COLOURS) expect(palette[key]).toEqual(DEFAULT_BOARD_THEME.pieces[key]);
    const theme = boardThemeFor(null, id);
    expect(theme.markers).toBe(DEFAULT_BOARD_THEME.markers);
    const vars = boardThemeStyle(theme, 'wood') as Record<string, string>;
    const defaults = boardThemeStyle(DEFAULT_BOARD_THEME, 'wood') as Record<string, string>;
    for (const name of ['--piece-back', '--piece-back-pattern', '--piece-back-rim', '--piece-back-red', '--piece-back-black',
      '--piece-back-blue', '--piece-shadow']) {
      expect(vars[name]).toBe(defaults[name]);
    }
    const hidden = (finish: typeof PIECE_DESIGNS[typeof id]['finish'] | undefined): string => renderToStaticMarkup(
      createElement(PieceFinishContext.Provider, { value: finish ?? DEFAULT_PIECE_FINISH },
        createElement('g', null, createElement(CoveredToken), createElement(TilePiece, { tone: 'red' }),
          createElement(TilePiece, { tone: 'blue' }))));
    expect(hidden(PIECE_DESIGNS[id].finish)).toBe(hidden(undefined));
  });
});

const DEFAULT_PIECE_FINISH = { rim: 'plain', gloss: 0 } as const;

describe.each(BOARD_STYLES)('$id board readability', ({ id, design }) => {
  const { surfaces, motion } = BOARD_DESIGNS[id];

  it('keeps lines, cells, and board text visible on every layout', () => {
    for (const surface of SURFACES) {
      const palette = surfaces[surface];
      expect(contrast(palette.ink, palette.surface), `${surface} ink`).toBeGreaterThanOrEqual(BOARD_TEXT_CONTRAST);
      if (surface === 'green' || surface === 'meadow') {
        expect(contrast(palette.line, palette.cell), `${surface} gaps`).toBeGreaterThanOrEqual(BOARD_GAP_CONTRAST);
      } else if (surface !== 'star') {
        for (const ground of [palette.surface, palette.cell]) {
          expect(contrast(palette.line, ground), `${surface} lines`).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
        }
      }
      expect(palette.homes).toEqual(DEFAULT_BOARD_THEME.surfaces[surface].homes);
    }
    expect(contrast(surfaces.wood.ink, surfaces.wood.mountain)).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
    expect(contrast(surfaces.field.line, surfaces.field.station)).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
    expect(contrast(surfaces.star.holeRim, surfaces.star.cell)).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
    expect(motion !== null).toBe(ANIMATED.has(design));
  });
});

describe.each(DICE_STYLES)('$id dice readability', ({ id, design }) => {
  it('keeps pips legible and the wild one distinct', () => {
    const theme = DICE_DESIGNS[id];
    expect(contrast(theme.pip, theme.body)).toBeGreaterThanOrEqual(PIP_CONTRAST);
    expect(contrast(theme.pipOne, theme.body)).toBeGreaterThanOrEqual(PIP_ONE_CONTRAST);
    expect(colourDistance(theme.pipOne, theme.pip)).toBeGreaterThan(25);
    expect(theme.cupGlow !== null).toBe(ANIMATED.has(design));
  });
});

describe('equipped board styles on the shared board view', () => {
  const board = gomokuBoard();
  const render = (element: ReactElement): string => renderToStaticMarkup(element);
  const view = (): string => render(createElement(BoardView, {
    board, surface: 'wood', label: 'Board', pieces: [
      { node: nodeId(3, 3), key: 'token', piece: createElement(TokenPiece, { tone: 'red', label: '帥' }) },
      { node: nodeId(4, 4), key: 'covered', piece: createElement(CoveredToken) },
    ], targets: [{ node: nodeId(5, 5) }],
  }));

  it('follows only the viewer\'s own equipment and keeps face-down pieces identical', () => {
    const covered = (html: string): string => html.match(/<g class="[^"]*covered[^"]*">.*?<\/g>/)![0];
    equipped.account = null;
    const plain = view();
    equipped.account = { pieceStyle: 'pieces-sakura', boardStyle: 'board-frost' };
    const styled = view();
    expect(styled).not.toBe(plain);
    expect(styled).toContain(`--board-surface:${BOARD_DESIGNS['board-frost'].surfaces.wood.surface}`);
    expect(styled).toContain(`--piece-red:${PIECE_DESIGNS['pieces-sakura'].palette.red}`);
    expect(covered(styled)).toBe(covered(plain));
    equipped.account = null;
  });

  it('animates animated boards in a layer under the pieces and move targets', () => {
    equipped.account = { boardStyle: 'board-starfleet' };
    const html = view();
    equipped.account = null;
    const motion = html.indexOf('data-board-motion');
    const layer = html.indexOf('aria-hidden="true"', html.indexOf('drift'));
    expect(motion).toBeGreaterThanOrEqual(0);
    // Surface first, then the moving light layer, then the interactive layer with lettering and markers.
    expect(html.indexOf('drift')).toBeLessThan(html.indexOf('帥'));
    expect(layer).toBeLessThan(html.indexOf('role="group"'));
    expect(html.indexOf('role="group"')).toBeLessThan(html.indexOf('帥'));
  });
});
