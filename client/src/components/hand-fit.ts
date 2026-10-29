// ─── Hand fit: card size and overlap that show every card of a hand inside the width it has ───

/** Face width over height of every playing card image. */
export const CARD_ASPECT = 224 / 313;
/** Share of a card's width that stays visible when neighbours overlap it the most. */
export const HAND_MIN_VISIBLE = 0.34;
/** Share of a card's width that stays visible when a landscape phone hand has room to spare. */
export const HAND_MAX_VISIBLE = 0.62;
/** Same for larger screens, where a short hand fans out less. */
export const HAND_ROOMY_VISIBLE = 0.58;
/** Smallest and largest card width a landscape phone hand uses. */
const CARD_WIDTH_RANGE = [44, 72] as const;
/** Card width as a share of the viewport height: a full hand then takes about a third of the screen. */
const CARD_WIDTH_PER_HEIGHT = 0.165;

export interface HandFit {
  /** Width of one card in px */
  readonly cardWidth: number;
  /** Share of each card hidden under its right neighbour, 0 to 1 */
  readonly overlap: number;
}

/** Largest card width a hand may use on a screen of the given height. */
export function handCardLimit(viewportHeight: number): number {
  const [min, max] = CARD_WIDTH_RANGE;
  return Math.min(max, Math.max(min, viewportHeight * CARD_WIDTH_PER_HEIGHT));
}

/**
 * Sizes `count` cards for a row `width` px wide. Cards keep `maxCardWidth` and overlap only as much as
 * needed (never more than the minimum visible share allows); a row that still cannot fit shrinks the cards.
 */
export function fitHand(width: number, count: number, maxCardWidth: number, maxVisible = HAND_MAX_VISIBLE): HandFit {
  if (!(width > 0) || count <= 1) return { cardWidth: maxCardWidth, overlap: 1 - maxVisible };
  const gaps = count - 1;
  const cardWidth = Math.min(maxCardWidth, width / (1 + gaps * HAND_MIN_VISIBLE));
  const visible = Math.min(maxVisible, (width - cardWidth) / gaps / cardWidth);
  return { cardWidth: Math.floor(cardWidth * 100) / 100, overlap: Math.ceil((1 - visible) * 1000) / 1000 };
}

/** Height of a card of the given width. */
export function cardHeight(cardWidth: number): number {
  return cardWidth / CARD_ASPECT;
}
