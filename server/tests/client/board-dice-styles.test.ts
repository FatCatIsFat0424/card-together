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

import { colourDistance, contrast, luminance, mix } from '../../../client/src/cosmetics/colour';
import {
  PIECE_BACK_CONTRAST, PIECE_DESIGNS, PIECE_TEXT_CONTRAST, piecePalette, resolvePieceStyle,
} from '../../../client/src/cosmetics/piece-styles/piece-designs';
import {
  BOARD_DESIGNS, BOARD_EDGE_WIDTH, BOARD_GAP_CONTRAST, BOARD_LINE_CONTRAST, BOARD_TEXT_CONTRAST, resolveBoardStyle,
} from '../../../client/src/cosmetics/board-styles/board-designs';
import { SERIES_TOKENS } from '../../../client/src/cosmetics/series-tokens';
import { boardThemeFor } from '../../../client/src/cosmetics/board-styles/board-theme-for';
import { DICE_DESIGNS, PIP_CONTRAST, PIP_ONE_CONTRAST, resolveDiceStyle } from '../../../client/src/cosmetics/dice-styles/dice-designs';
import { pieceStylesTranslations } from '../../../client/src/cosmetics/piece-styles/i18n';
import { boardStylesTranslations } from '../../../client/src/cosmetics/board-styles/i18n';
import { diceStylesTranslations } from '../../../client/src/cosmetics/dice-styles/i18n';
import {
  DEFAULT_BOARD_THEME, DEFAULT_PIECE_FINISH, FIXED_PIECE_COLOURS, GO_KAYA, boardThemeStyle,
} from '../../../client/src/games/board/board-theme';
import type { BoardSurface, PieceFinish } from '../../../client/src/games/board/board-theme';
import {
  CoveredToken, PieceFinishContext, TilePiece, TokenPiece,
} from '../../../client/src/games/board/BoardPieces';
import { BoardView } from '../../../client/src/games/board/BoardView';
import { SHOP_GROUPS, resolveShopView } from '../../../client/src/shop-filters';

const ANIMATED = new Set(['starfleet', 'shrine', 'ironfront', 'neoncity', 'crownrealm']);
const SURFACES: readonly BoardSurface[] = ['wood', 'green', 'meadow', 'field', 'star', 'go'];
/** Hidden Land Battle Chess tiles darken the side colour like `.tile.hidden` in BoardPieces.module.css. */
const hiddenTileBody = (tone: string): string => mix(tone, '#0b1020', 0.38);
/** Face-down pieces of one view under a finish: covered tokens and both sides' hidden tiles. */
const faceDown = (finish: PieceFinish): { covered: string; red: string; blue: string } => {
  const draw = (element: ReactElement): string => renderToStaticMarkup(
    createElement(PieceFinishContext.Provider, { value: finish }, element));
  return {
    covered: draw(createElement(CoveredToken)),
    red: draw(createElement(TilePiece, { tone: 'red' })),
    blue: draw(createElement(TilePiece, { tone: 'blue' })),
  };
};

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

  it('never changes the shadow, marbles, or markers', () => {
    for (const key of FIXED_PIECE_COLOURS) expect(palette[key]).toEqual(DEFAULT_BOARD_THEME.pieces[key]);
    const theme = boardThemeFor(null, id);
    expect(theme.markers).toBe(DEFAULT_BOARD_THEME.markers);
    const vars = boardThemeStyle(theme, 'wood') as Record<string, string>;
    const defaults = boardThemeStyle(DEFAULT_BOARD_THEME, 'wood') as Record<string, string>;
    expect(vars['--piece-shadow']).toBe(defaults['--piece-shadow']);
  });

  it('draws face-down pieces in the style, identical within it, with sides and backs apart', () => {
    const { finish } = PIECE_DESIGNS[id];
    const styled = faceDown(finish);
    // Nothing identity-dependent reaches the renderer, so a second drawing in the same style is identical.
    expect(faceDown({ ...finish })).toEqual(styled);
    expect(styled.covered).not.toBe(faceDown(DEFAULT_PIECE_FINISH).covered);
    expect(finish.back).toBe(SERIES_TOKENS[PIECE_STYLES.find((item) => item.id === id)!.design].back);
    // A covered token never passes for a revealed face, and its motif shows on it.
    expect(contrast(palette.back, palette.face)).toBeGreaterThanOrEqual(PIECE_BACK_CONTRAST);
    expect(contrast(palette.backPattern, palette.back)).toBeGreaterThanOrEqual(PIECE_BACK_CONTRAST);
    // Land Battle Chess: the owner of a hidden tile stays obvious; a hidden tile is darker than a shown one, which
    // also carries its rank.
    expect(styled.red).not.toBe(styled.blue);
    expect(colourDistance(hiddenTileBody(palette.backRed), hiddenTileBody(palette.backBlue))).toBeGreaterThan(30);
    for (const tone of [palette.red, palette.blue]) {
      expect(colourDistance(tone, hiddenTileBody(tone))).toBeGreaterThan(10);
    }
  });
});

describe.each(BOARD_STYLES)('$id board readability', ({ id, design }) => {
  const { surfaces, motion } = BOARD_DESIGNS[id];

  it('draws palace diagonals in the accent, a legible river, and the go board as tinted kaya', () => {
    const { wood, go } = surfaces;
    for (const ground of [wood.surface, wood.cell]) expect(contrast(wood.palace, ground)).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
    expect(contrast(wood.ink, wood.river)).toBeGreaterThanOrEqual(BOARD_TEXT_CONTRAST);
    expect(contrast(wood.line, wood.river)).toBeGreaterThanOrEqual(BOARD_LINE_CONTRAST);
    expect(wood.pattern).not.toBe('none');
    expect(go.pattern).toBe('grain');
    expect(go.edge).toBe(SERIES_TOKENS[design].accent);
    expect(colourDistance(go.surface, GO_KAYA.surface)).toBeLessThan(colourDistance(go.surface, SERIES_TOKENS[design].board));
    expect(go.surface).not.toBe(DEFAULT_BOARD_THEME.surfaces.go.surface);
  });

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
    expect(motion !== null).toBe(ANIMATED.has(design));
  });

  it('keeps the edge line thin when the accent is bright', () => {
    for (const surface of SURFACES) {
      const { edge, edgeWidth } = surfaces[surface];
      expect(edgeWidth, surface).toBeGreaterThanOrEqual(BOARD_EDGE_WIDTH.min);
      expect(edgeWidth, surface).toBeLessThanOrEqual(BOARD_EDGE_WIDTH.max);
      if (luminance(edge) >= BOARD_EDGE_WIDTH.loudLuminance) expect(edgeWidth, surface).toBe(BOARD_EDGE_WIDTH.min);
    }
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
  const view = (surface: BoardSurface = 'wood'): string => render(createElement(BoardView, {
    board, surface, label: 'Board', pieces: [
      { node: nodeId(3, 3), key: 'token', piece: createElement(TokenPiece, { tone: 'red', label: '帥' }) },
      { node: nodeId(4, 4), key: 'covered', piece: createElement(CoveredToken) },
      { node: nodeId(6, 6), key: 'covered2', piece: createElement(CoveredToken) },
    ], targets: [{ node: nodeId(5, 5) }],
  }));

  it('follows only the viewer\'s own equipment and draws every face-down piece alike in it', () => {
    const covered = (html: string): string[] => [...html.matchAll(/<g class="[^"]*covered[^"]*">.*?<\/g><\/g>/g)].map((match) => match[0]);
    equipped.account = null;
    const plain = view();
    equipped.account = { pieceStyle: 'pieces-sakura', boardStyle: 'board-frost' };
    const styled = view();
    expect(styled).not.toBe(plain);
    expect(styled).toContain(`--board-surface:${BOARD_DESIGNS['board-frost'].surfaces.wood.surface}`);
    expect(styled).toContain(`--piece-red:${PIECE_DESIGNS['pieces-sakura'].palette.red}`);
    expect(styled).toContain(`--piece-back:${PIECE_DESIGNS['pieces-sakura'].palette.back}`);
    const [first, second] = covered(styled);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(first).not.toBe(covered(plain)[0]);
    equipped.account = null;
  });

  it('draws Gomoku on the kaya surface, tinted and textured by the board style', () => {
    equipped.account = null;
    const plain = view('go');
    expect(plain).toContain(`--board-surface:${GO_KAYA.surface}`);
    expect(plain).toContain('<pattern');
    equipped.account = { boardStyle: 'board-sakura' };
    const styled = view('go');
    equipped.account = null;
    expect(styled).toContain(`--board-surface:${BOARD_DESIGNS['board-sakura'].surfaces.go.surface}`);
    expect(styled).toContain(`--board-edge:${SERIES_TOKENS.sakura.accent}`);
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
