import type { Card, Rank, Suit } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { svgDataUrl } from './deck-art';

/** Diamonds turn blue and clubs green; hearts and spades keep the classic red and black. */
export const FOUR_COLOR_INKS = { diamonds: '#1565c0', clubs: '#17803a' } as const;

type RecolouredSuit = keyof typeof FOUR_COLOR_INKS;

// Raw classic SVGs are loaded on demand so players without this deck never download them.
const CLASSIC_SOURCES = import.meta.glob<string>('../../assets/cards/[2-9TJQKA][CD].svg', {
  query: '?raw', import: 'default',
});

const RANK_CODES: Readonly<Record<Rank, string>> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_FROM_CODE: Readonly<Record<string, RecolouredSuit>> = { D: 'diamonds', C: 'clubs' };

function isRecoloured(suit: Suit): suit is RecolouredSuit {
  return suit === 'diamonds' || suit === 'clubs';
}

/**
 * Swaps the suit ink in a classic cardsJS face. Diamonds use one red fill and clubs one black
 * fill for indices, pips, and court line art; the black card outline is a stroke and stays.
 */
export function recolorClassicFace(svg: string, suit: Suit): string {
  if (suit === 'diamonds') return svg.replace(/fill:#d40000\b/gi, `fill:${FOUR_COLOR_INKS.diamonds}`);
  if (suit === 'clubs') return svg.replace(/fill:#000\b/gi, `fill:${FOUR_COLOR_INKS.clubs}`);
  return svg;
}

const faces = new Map<string, string>();
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** Starts loading the recoloured faces once; classic faces stand in until they are ready. */
export function loadFourColorDeck(): Promise<void> {
  loading ??= Promise.all(Object.entries(CLASSIC_SOURCES).map(async ([path, load]) => {
    const code = path.slice(path.lastIndexOf('/') + 1, -'.svg'.length);
    const suit = SUIT_FROM_CODE[code.slice(-1)];
    if (suit) faces.set(code, svgDataUrl(recolorClassicFace(await load(), suit)));
  })).then(() => {
    resolver = (card) => fourColorFaceUrl(card);
    listeners.forEach((listener) => listener());
  }, () => {
    // A failed chunk keeps the classic faces for this session rather than retrying on every render.
  });
  return loading;
}

/** Notifies subscribers when the recoloured faces finish loading, for `useSyncExternalStore`. */
export function subscribeFourColorDeck(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function fourColorFaceUrl(card: Card): string {
  if (!isRecoloured(card.suit)) return cardImageUrl(card);
  const url = faces.get(`${RANK_CODES[card.rank]}${card.suit === 'diamonds' ? 'D' : 'C'}`);
  if (url) return url;
  void loadFourColorDeck();
  return cardImageUrl(card);
}

let resolver: (card: Card) => string = (card) => fourColorFaceUrl(card);

/** Face lookup whose identity changes once loading finishes, so hooks re-render with the new faces. */
export function fourColorResolver(): (card: Card) => string {
  return resolver;
}

let joker: string | null = null;

/** The classic joker, with its wings and bells in the four suit colours. */
export function fourColorJokerUrl(): string {
  if (joker) return joker;
  const letters = ['J', 'O', 'K', 'E', 'R'].map((letter, index) => `<text x="24" y="${40 + index * 24}">${letter}</text>`).join('');
  const corner = `<g fill="#b3261e" font-family="Georgia, serif" font-size="24" font-weight="700" text-anchor="middle">${letters}</g>`;
  joker = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg" width="224" height="313" viewBox="0 0 224 313">'
    + '<rect x="1" y="1" width="222" height="311" rx="14" fill="#fffdf7" stroke="#8a8a8a" stroke-width="2"/>'
    + `${corner}<g transform="rotate(180 112 156.5)">${corner}</g>`
    + '<g transform="translate(112 168)">'
    + '<path d="M-62 34 Q-52 -8 -74 -58 Q-30 -34 0 -74 L0 40 Q-30 44 -62 34Z" fill="#b3261e"/>'
    + `<path d="M62 34 Q52 -8 74 -58 Q30 -34 0 -74 L0 40 Q30 44 62 34Z" fill="${FOUR_COLOR_INKS.diamonds}"/>`
    + '<path d="M-64 32 Q0 50 64 32 L64 50 Q0 68 -64 50Z" fill="#e0a800"/>'
    + `<circle cx="-74" cy="-58" r="10" fill="${FOUR_COLOR_INKS.clubs}"/>`
    + '<circle cx="0" cy="-74" r="10" fill="#1a1a1a"/>'
    + `<circle cx="74" cy="-58" r="10" fill="${FOUR_COLOR_INKS.clubs}"/>`
    + '</g></svg>');
  return joker;
}
