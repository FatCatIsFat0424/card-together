import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { Card, CardFaceStyleId, Rank, Suit } from '../../../shared/src/types';
import { CARD_FACES } from '../../../shared/src/constants';
import { cardImageUrl } from '../../../client/src/cards';
import { cardFaceUrl, jokerFaceUrl } from '../../../client/src/cosmetics/card-faces/card-faces';
import {
  FOUR_COLOR_INKS, fourColorFaceUrl, fourColorResolver, loadFourColorDeck, recolorClassicFace,
} from '../../../client/src/cosmetics/card-faces/four-color';

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const DECK: readonly Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
const SERIES_DECKS = CARD_FACES.filter((item) => item.design !== 'four-color').map((item) => item.id);
const CLASSIC_DIR = path.resolve(__dirname, '../../../client/src/assets/cards');

function decodeSvg(url: string): string {
  const prefix = 'data:image/svg+xml;charset=utf-8,';
  expect(url.startsWith(prefix)).toBe(true);
  return decodeURIComponent(url.slice(prefix.length));
}

/** Every opened element is closed in order, so the markup parses as XML. */
function expectWellFormed(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('viewBox="0 0 224 313"');
  const stack: string[] = [];
  for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)(?:\s[^<>]*?)?(\/?)>/g)) {
    if (closing) expect(stack.pop()).toBe(name);
    else if (!selfClosing) stack.push(name);
  }
  expect(stack).toEqual([]);
  expect(svg).not.toMatch(/NaN|undefined/);
}

function classicSource(code: string): string {
  return readFileSync(path.join(CLASSIC_DIR, `${code}.svg`), 'utf8');
}

describe('card face decks', () => {
  it('keeps the bundled classic faces and joker when no deck is equipped', () => {
    for (const card of DECK) {
      expect(cardFaceUrl(card, null)).toBe(cardImageUrl(card));
      expect(cardFaceUrl(card, undefined)).toBe(cardImageUrl(card));
    }
    expect(jokerFaceUrl(null)).toBeNull();
  });

  it('draws a distinct, well-formed face for all 52 cards and the joker in every series deck', () => {
    const seen = new Set<string>();
    for (const style of SERIES_DECKS) {
      const urls = [...DECK.map((card) => cardFaceUrl(card, style)), jokerFaceUrl(style)];
      for (const url of urls) {
        expect(url).not.toBeNull();
        expectWellFormed(decodeSvg(url ?? ''));
        expect(seen.has(url ?? '')).toBe(false);
        seen.add(url ?? '');
      }
    }
    expect(seen.size).toBe(SERIES_DECKS.length * 53);
  });

  it('reuses the generated face for repeated requests', () => {
    const card: Card = { rank: 12, suit: 'hearts' };
    expect(cardFaceUrl(card, 'card-face-gilded')).toBe(cardFaceUrl({ ...card }, 'card-face-gilded'));
  });

  it('colours red and black suits differently in every series deck', () => {
    for (const style of SERIES_DECKS) {
      const heart = decodeSvg(cardFaceUrl({ rank: 5, suit: 'hearts' }, style));
      const spade = decodeSvg(cardFaceUrl({ rank: 5, suit: 'spades' }, style));
      const indexInk = (svg: string): string | undefined => svg.match(/<g fill="(#[0-9a-f]{6})" font-family/)?.[1];
      expect(indexInk(heart)).toBeDefined();
      expect(indexInk(heart)).not.toBe(indexInk(spade));
    }
  });
});

describe('four-colour deck', () => {
  it('recolours only the diamond and club inks', () => {
    const diamond = classicSource('KD');
    const recolouredDiamond = recolorClassicFace(diamond, 'diamonds');
    expect(recolouredDiamond).not.toMatch(/fill:#d40000/i);
    expect(recolouredDiamond.replaceAll(`fill:${FOUR_COLOR_INKS.diamonds}`, 'fill:#d40000')).toBe(diamond);

    const club = classicSource('7C');
    const recolouredClub = recolorClassicFace(club, 'clubs');
    expect(recolouredClub).not.toMatch(/fill:#000\b/i);
    expect(recolouredClub).toContain('stroke:#000');
    expect(recolouredClub.replaceAll(`fill:${FOUR_COLOR_INKS.clubs}`, 'fill:#000')).toBe(club);

    for (const code of ['QH', '7S']) {
      const source = classicSource(code);
      expect(recolorClassicFace(source, code.endsWith('H') ? 'hearts' : 'spades')).toBe(source);
    }
  });

  it('serves recoloured diamonds and clubs once loaded and classic hearts and spades throughout', async () => {
    const style: CardFaceStyleId = 'card-face-four-color';
    const before = fourColorResolver();
    expect(cardFaceUrl({ rank: 9, suit: 'clubs' }, style)).toBe(cardImageUrl({ rank: 9, suit: 'clubs' }));
    await loadFourColorDeck();
    expect(fourColorResolver()).not.toBe(before);
    const urls = new Set<string>();
    for (const card of DECK) {
      const url = cardFaceUrl(card, style);
      expect(url).toBe(fourColorFaceUrl(card));
      if (card.suit === 'hearts' || card.suit === 'spades') {
        expect(url).toBe(cardImageUrl(card));
      } else {
        const svg = decodeSvg(url);
        expect(svg).toContain(`fill:${card.suit === 'diamonds' ? FOUR_COLOR_INKS.diamonds : FOUR_COLOR_INKS.clubs}`);
        expect(svg).not.toMatch(card.suit === 'diamonds' ? /fill:#d40000/i : /fill:#000\b/i);
      }
      urls.add(url);
    }
    expect(urls.size).toBe(52);
    const joker = jokerFaceUrl(style);
    expectWellFormed(decodeSvg(joker ?? ''));
    expect(urls.has(joker ?? '')).toBe(false);
  });
});
