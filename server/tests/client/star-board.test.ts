import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BOARD_STYLES, PIECE_STYLES } from '@shared/constants';
import { CC_BOARD, ccInitialHoles, ccNode } from '@shared/rules/chinesecheckers';

vi.mock('../../../client/src/stores/account-store', () => ({
  useAccountStore: (select: (state: { account: null }) => unknown) => select({ account: null }),
  selectConnectionReady: () => true,
}));

import { contrast } from '../../../client/src/cosmetics/colour';
import { BOARD_DESIGNS, BOARD_GAP_CONTRAST } from '../../../client/src/cosmetics/board-styles/board-designs';
import { boardThemeFor } from '../../../client/src/cosmetics/board-styles/board-theme-for';
import { PIECE_DESIGNS } from '../../../client/src/cosmetics/piece-styles/piece-designs';
import { DEFAULT_BOARD_THEME, DEFAULT_PIECE_FINISH } from '../../../client/src/games/board/board-theme';
import type { BoardTheme } from '../../../client/src/games/board/board-theme';
import { BoardView } from '../../../client/src/games/board/BoardView';
import { MARBLE_HOLE_CONTRAST, MARBLE_RIM_CONTRAST, marbleShades } from '../../../client/src/games/board/marble-finish';
import { MarblePiece } from '../../../client/src/games/board/StarBoard';

const HUES = DEFAULT_BOARD_THEME.pieces.marbles;
const YELLOW = HUES[1];

describe('star board contrast', () => {
  const stars = [
    ['default', DEFAULT_BOARD_THEME.surfaces.star],
    ...BOARD_STYLES.map((item) => [item.id, BOARD_DESIGNS[item.id].surfaces.star] as const),
  ] as const;

  it.each(stars)('%s keeps every marble hue apart from the hole bottom and the holes apart from the wood', (_, star) => {
    for (const hue of HUES) expect(contrast(hue, star.holeRim), hue).toBeGreaterThanOrEqual(MARBLE_HOLE_CONTRAST);
    expect(contrast(star.holeRim, star.cell)).toBeGreaterThanOrEqual(BOARD_GAP_CONTRAST);
    // Corner colours stay fixed, so every style names the same corners.
    expect(star.homes).toEqual(DEFAULT_BOARD_THEME.surfaces.star.homes);
  });

  it.each(PIECE_STYLES)('$id keeps the rim visible on every marble hue, gold on yellow included', ({ id }) => {
    const { palette, finish } = PIECE_DESIGNS[id];
    for (const hue of HUES) {
      const shades = marbleShades(hue, palette.accent, finish);
      expect(shades.body, 'hue never changes').toBe(hue);
      expect(contrast(shades.rim, hue), hue).toBeGreaterThanOrEqual(MARBLE_RIM_CONTRAST);
      expect(contrast(shades.outline, hue), hue).toBeGreaterThan(2);
    }
    if (id === 'pieces-gilded' || id === 'pieces-crownrealm') {
      expect(marbleShades(YELLOW, palette.accent, finish).rim).not.toBe(palette.accent);
    }
  });
});

describe('star board rendering', () => {
  const holes = ccInitialHoles([0, 3]);
  const pieces = holes.flatMap((corner, index) => corner === null ? [] : [{
    node: ccNode(index), key: `m${index}`, piece: createElement(MarblePiece, { corner }),
  }]);
  const render = (theme: BoardTheme, activeHomes?: readonly number[]): string => renderToStaticMarkup(createElement(BoardView, {
    board: CC_BOARD, surface: 'star', label: 'Star', theme, pieces, activeHomes,
  }));

  it('draws the star outline instead of a square plate, with shared holes and one marble per hue', () => {
    const html = render(DEFAULT_BOARD_THEME, [0, 3]);
    expect(html).toContain('data-board-surface="star"');
    expect(html).not.toMatch(/<rect[^>]*class="[^"]*surface/);
    expect(html.match(/data-board-hole=""/g)).toHaveLength(CC_BOARD.nodes.length);
    // Six marble definitions, then twenty marbles that only reference them.
    expect(html.match(/<g id="[^"]*-marble-\d"/g)).toHaveLength(6);
    expect(html.match(/<use href="#[^"]*-marble-[03]"/g)).toHaveLength(20);
    // The turn glow follows the outline; active corners are tinted more strongly than empty ones.
    expect(html).toMatch(/<path class="[^"]*turnGlow[^"]*" d="M[^"]+Z"/);
    expect(html.match(/opacity="0.26"/g)).toHaveLength(2);
    expect(html.match(/opacity="0.08"/g)).toHaveLength(4);
  });

  it('changes the marble finish with the piece style but never the hue', () => {
    const plain = render(DEFAULT_BOARD_THEME);
    const styled = render(boardThemeFor(null, 'pieces-gilded'));
    expect(styled).not.toBe(plain);
    for (const hue of HUES) expect(styled).toContain(`stop-color="${hue}"`);
    expect(DEFAULT_PIECE_FINISH.material).toBeUndefined();
    expect(PIECE_DESIGNS['pieces-gilded'].finish.material).toBe('ivory');
  });

  it('clips an animated board light to the star', () => {
    const html = render(boardThemeFor('board-neoncity', null));
    expect(html).toContain('data-board-motion="pulse"');
    expect(html).toMatch(/clip-path:polygon\(/);
  });
});
