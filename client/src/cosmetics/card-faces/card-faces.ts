import type { Card, CardFaceStyleId } from '@shared/types';
import { CARD_FACES } from '@shared/constants';
import { cardImageUrl } from '../../cards';
import { renderDeckCard, renderDeckJoker, svgDataUrl } from './deck-art';
import { deckTheme, type DeckSeries } from './deck-themes';
import { fourColorFaceUrl, fourColorJokerSvg, fourColorJokerUrl } from './four-color';

const FOUR_COLOR: CardFaceStyleId = 'card-face-four-color';

// Each face is generated on first use and reused for the rest of the session.
const generated = new Map<string, string>();

function deckSeries(style: CardFaceStyleId): DeckSeries | null {
  const design = CARD_FACES.find((item) => item.id === style)?.design;
  return design && design !== 'four-color' ? design : null;
}

function cached(key: string, render: () => string): string {
  let url = generated.get(key);
  if (!url) {
    url = svgDataUrl(render());
    generated.set(key, url);
  }
  return url;
}

/** Face image for `card` in the equipped deck; null keeps the bundled classic deck. */
export function cardFaceUrl(card: Card, style: CardFaceStyleId | null | undefined): string {
  if (!style) return cardImageUrl(card);
  if (style === FOUR_COLOR) return fourColorFaceUrl(card);
  const series = deckSeries(style);
  if (!series) return cardImageUrl(card);
  return cached(`${series}:${card.rank}:${card.suit}`, () => renderDeckCard(deckTheme(series), card));
}

/** Joker image for the equipped deck; null means the built-in classic joker. */
export function jokerFaceUrl(style: CardFaceStyleId | null | undefined): string | null {
  if (!style) return null;
  if (style === FOUR_COLOR) return fourColorJokerUrl();
  const series = deckSeries(style);
  if (!series) return null;
  return cached(`${series}:joker`, () => renderDeckJoker(deckTheme(series)));
}

/** Removes all colour from an SVG document by filtering everything inside its root element. */
export function grayscaleSvg(svg: string): string {
  const start = svg.indexOf('>', svg.indexOf('<svg')) + 1;
  const end = svg.lastIndexOf('</svg>');
  return `${svg.slice(0, start)}<defs><filter id="napoleon-grayscale"><feColorMatrix type="saturate" values="0"/></filter></defs>`
    + `<g filter="url(#napoleon-grayscale)">${svg.slice(start, end)}</g></svg>`;
}

/**
 * Napoleon needs two distinguishable jokers: the deck's own joker is the big joker and a greyscale copy
 * is the small one. Null means the built-in classic deck, whose Napoleon jokers are bundled art.
 */
export function napoleonJokerFaceUrls(
  style: CardFaceStyleId | null | undefined,
): { readonly big: string; readonly small: string } | null {
  if (!style) return null;
  if (style === FOUR_COLOR) {
    return { big: fourColorJokerUrl(), small: cached('four-color:small-joker', () => grayscaleSvg(fourColorJokerSvg())) };
  }
  const series = deckSeries(style);
  if (!series) return null;
  return {
    big: jokerFaceUrl(style)!,
    small: cached(`${series}:small-joker`, () => grayscaleSvg(renderDeckJoker(deckTheme(series)))),
  };
}
