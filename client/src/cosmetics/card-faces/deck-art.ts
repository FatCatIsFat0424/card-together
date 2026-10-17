import type { Card, Rank, Suit } from '@shared/types';
import { SUIT_PATHS, isRedSuit, num, sparkle } from './svg-shapes';

/** Palette and ornament markup for one procedurally drawn deck. */
export interface DeckTheme {
  /** Card stock gradient, top to bottom. */
  readonly stock: readonly [string, string];
  readonly edge: string;
  /** Corner index and pip colours; both must keep strong contrast against the stock. */
  readonly ink: { readonly red: string; readonly black: string };
  /** Lighter tone at the top of each pip so pips keep the ink colour with a soft sheen. */
  readonly sheen: { readonly red: string; readonly black: string };
  /** Crown, bell, and medallion metal: highlight, body, outline. */
  readonly metal: readonly [string, string, string];
  readonly panel: readonly [string, string];
  readonly panelEdge: string;
  readonly medallion: string;
  readonly font: string;
  /** Extra gradients referenced by the ornament markup. */
  readonly defs: string;
  /** Texture under every face, in card coordinates. */
  readonly backdrop: string;
  /** Frame and edge motifs kept clear of the corner indices and pip area. */
  readonly frame: string;
  /** Pattern drawn inside the court card panel, clipped to it. */
  readonly panelPattern: string;
  /** Emblem behind the ace pip and the joker, centred on the origin. */
  readonly halo: string;
  /** Series emblem above the court rank, centred on the origin. */
  readonly courtCrest?: string;
}

export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 313;
const CENTRE_X = CARD_WIDTH / 2;
const CENTRE_Y = CARD_HEIGHT / 2;
const RANK_LABELS: Readonly<Record<Rank, string>> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

const LEFT = 70;
const MIDDLE = CENTRE_X;
const RIGHT = 154;
const TOP = 62;
const BOTTOM = 251;
const FOUR_ROWS = [TOP, TOP + (BOTTOM - TOP) / 3, TOP + (2 * (BOTTOM - TOP)) / 3, BOTTOM];
type PipSpot = readonly [number, number];
const CORNERS: readonly PipSpot[] = [[LEFT, TOP], [RIGHT, TOP], [LEFT, BOTTOM], [RIGHT, BOTTOM]];
const SIX: readonly PipSpot[] = [...CORNERS, [LEFT, CENTRE_Y], [RIGHT, CENTRE_Y]];
const EIGHT_COLUMN: readonly PipSpot[] = FOUR_ROWS.flatMap((y): PipSpot[] => [[LEFT, y], [RIGHT, y]]);
/** Traditional pip arrangements for the number cards. */
const PIP_LAYOUTS: Readonly<Record<number, readonly PipSpot[]>> = {
  2: [[MIDDLE, TOP], [MIDDLE, BOTTOM]],
  3: [[MIDDLE, TOP], [MIDDLE, CENTRE_Y], [MIDDLE, BOTTOM]],
  4: CORNERS,
  5: [...CORNERS, [MIDDLE, CENTRE_Y]],
  6: SIX,
  7: [...SIX, [MIDDLE, (TOP + CENTRE_Y) / 2]],
  8: [...SIX, [MIDDLE, (TOP + CENTRE_Y) / 2], [MIDDLE, (CENTRE_Y + BOTTOM) / 2]],
  9: [...EIGHT_COLUMN, [MIDDLE, CENTRE_Y]],
  10: [...EIGHT_COLUMN, [MIDDLE, (FOUR_ROWS[0] + FOUR_ROWS[1]) / 2], [MIDDLE, (FOUR_ROWS[2] + FOUR_ROWS[3]) / 2]],
};

const PANEL = { x: 46, y: 34, width: 132, height: 245 } as const;
const CARD_SHAPE = `x="1" y="1" width="${CARD_WIDTH - 2}" height="${CARD_HEIGHT - 2}" rx="11"`;
const HALF_TURN = `rotate(180 ${CENTRE_X} ${num(CENTRE_Y)})`;

function linear(id: string, top: string, bottom: string, extra = ''): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"${extra}><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
}

function inkFor(theme: DeckTheme, suit: Suit): string {
  return isRedSuit(suit) ? theme.ink.red : theme.ink.black;
}

function rankText(label: string, x: number, y: number): string {
  // Two-digit ranks are narrowed instead of shrunk so "10" keeps the same height as other ranks.
  return label === '10'
    ? `<text transform="translate(${num(x)} ${num(y)}) scale(.76 1)">10</text>`
    : `<text x="${num(x)}" y="${num(y)}">${label}</text>`;
}

/** Large rank and suit in the top-left corner, mirrored to the bottom-right. */
function cornerIndices(theme: DeckTheme, label: string, suit: Suit): string {
  const ink = inkFor(theme, suit);
  const corner = `<g fill="${ink}" font-family="${theme.font}" font-size="42" font-weight="700" text-anchor="middle">${rankText(label, 25, 50)}</g>`
    + `<use href="#suit" transform="translate(25 76) scale(.27)" fill="${ink}"/>`;
  return `${corner}<g transform="${HALF_TURN}">${corner}</g>`;
}

function pip(x: number, y: number, scale: number, upright = false): string {
  // Pips below the centre line face the other way, as on a printed card.
  const flip = !upright && y > CENTRE_Y + 1 ? ' rotate(180)' : '';
  return `<use href="#suit" transform="translate(${num(x)} ${num(y)}) scale(${scale})${flip}" fill="url(#pip)"/>`;
}

function crown(rank: Rank, ink: string): string {
  const outline = 'stroke="url(#metalEdge)" stroke-width="1.6" stroke-linejoin="round"';
  if (rank === 13) {
    return `<path d="M-36 16L-39-17L-20 1L0-27L20 1L39-17L36 16Z" fill="url(#metal)" ${outline}/>`
      + `<rect x="-39" y="12" width="78" height="13" rx="3" fill="url(#metal)" ${outline}/>`
      + `<g fill="url(#metal)" ${outline}><circle cx="-39" cy="-18" r="5"/><circle cx="0" cy="-28" r="5.5"/><circle cx="39" cy="-18" r="5"/></g>`
      + `<path d="M0-12L6-3L0 6L-6-3Z" fill="${ink}"/>`
      + `<g fill="${ink}"><circle cx="-24" cy="18.5" r="3.4"/><circle cx="0" cy="18.5" r="3.4"/><circle cx="24" cy="18.5" r="3.4"/></g>`;
  }
  if (rank === 12) {
    return `<path d="M-36 16C-37 2-31-9-24-13C-20-3-12 1-8-7C-6-16-2-22 0-28C2-22 6-16 8-7C12 1 20-3 24-13C31-9 37 2 36 16Z" fill="url(#metal)" ${outline}/>`
      + `<rect x="-38" y="12" width="76" height="11" rx="5.5" fill="url(#metal)" ${outline}/>`
      + `<g fill="#fffdf6" ${outline}><circle cx="-24" cy="-14" r="4"/><circle cx="0" cy="-30" r="4.5"/><circle cx="24" cy="-14" r="4"/></g>`
      + `<path d="M0-13C5-5 6 1 0 6C-6 1-5-5 0-13Z" fill="${ink}"/>`
      + `<g fill="${ink}"><circle cx="-20" cy="17.5" r="2.6"/><circle cx="-7" cy="17.5" r="2.6"/><circle cx="7" cy="17.5" r="2.6"/><circle cx="20" cy="17.5" r="2.6"/></g>`;
  }
  // The jack wears a plumed beret.
  return `<path d="M8-10C14-30 30-46 56-54C52-44 46-36 38-30C46-30 50-28 52-26C42-20 30-14 16-8Z" fill="${ink}" ${outline}/>`
    + '<path d="M12-10C22-26 36-40 52-50" stroke="#ffffff" stroke-opacity=".6" stroke-width="1.2" fill="none"/>'
    + `<path d="M-42 8C-44-6-24-15 0-15C26-15 44-8 42 4C40 12-38 16-42 8Z" fill="url(#metal)" ${outline}/>`
    + `<rect x="-34" y="8" width="68" height="14" rx="4" fill="url(#metal)" ${outline}/>`
    + `<circle cx="10" cy="-6" r="5.5" fill="${ink}" ${outline}/>`
    + `<path d="M-24 15H24" stroke="${ink}" stroke-width="2.4" stroke-dasharray="5 4" stroke-linecap="round"/>`;
}

function courtBody(theme: DeckTheme, rank: Rank, suit: Suit): string {
  const ink = inkFor(theme, suit);
  const { x, y, width, height } = PANEL;
  const panelShape = `x="${x}" y="${y}" width="${width}" height="${height}" rx="10"`;
  return `<rect ${panelShape} fill="url(#panel)"/>`
    + `<g clip-path="url(#panelClip)">${theme.panelPattern}</g>`
    + `<rect ${panelShape} fill="none" stroke="${theme.panelEdge}" stroke-width="1.6"/>`
    + `<rect x="${x + 4}" y="${y + 4}" width="${width - 8}" height="${height - 8}" rx="7" fill="none" stroke="${theme.panelEdge}" stroke-width=".8" opacity=".55"/>`
    + `<g transform="translate(${CENTRE_X} 86)">${theme.courtCrest ?? crown(rank, ink)}</g>`
    + `<circle cx="${CENTRE_X}" cy="160" r="44" fill="${theme.medallion}" stroke="url(#metalEdge)" stroke-width="2.4"/>`
    + `<circle cx="${CENTRE_X}" cy="160" r="38.5" fill="none" stroke="${theme.panelEdge}" stroke-width=".9" opacity=".7"/>`
    + `<text x="${CENTRE_X}" y="181" fill="${ink}" font-family="${theme.font}" font-size="60" font-weight="700" text-anchor="middle">${RANK_LABELS[rank]}</text>`
    + pip(CENTRE_X, 234, 0.42, true);
}

function jokerBody(theme: DeckTheme): string {
  const bell = (cx: number, cy: number): string => `<circle cx="${cx}" cy="${cy}" r="7.5" fill="url(#metal)" stroke="url(#metalEdge)" stroke-width="1.4"/>`
    + `<path d="M${cx - 3} ${cy + 2.5}H${cx + 3}" stroke="url(#metalEdge)" stroke-width="1.4" stroke-linecap="round"/>`;
  const outline = 'stroke="url(#metalEdge)" stroke-width="1.6" stroke-linejoin="round"';
  const hat = `<path d="M-42 22C-48-4-60-22-58-46C-38-30-22-10-14 22Z" fill="${theme.ink.red}" ${outline}/>`
    + `<path d="M42 22C48-4 60-22 58-46C38-30 22-10 14 22Z" fill="${theme.ink.black}" ${outline}/>`
    + `<path d="M-17 23C-15-12-8-42 0-68C8-42 15-12 17 23Z" fill="url(#metal)" ${outline}/>`
    + `<path d="M-46 20Q0 34 46 20L46 36Q0 50-46 36Z" fill="url(#metal)" ${outline}/>`
    + `<g fill="${theme.ink.red}"><path d="M-28 32l5-6l5 6l-5 6z"/><path d="M18 32l5 6l5-6l-5-6z"/></g>`
    + `<path d="M-5 35l5-6l5 6l-5 6z" fill="${theme.ink.black}"/>`
    + bell(-58, -47) + bell(0, -69) + bell(58, -47);
  return `<g transform="translate(${CENTRE_X} ${num(CENTRE_Y)})">${theme.halo}</g>`
    + `<g transform="translate(${CENTRE_X} 166)">${hat}</g>`
    + sparkle(CENTRE_X, 236, 9, theme.ink.red)
    + sparkle(CENTRE_X - 24, 230, 5, theme.ink.black, 0.8)
    + sparkle(CENTRE_X + 24, 230, 5, theme.ink.black, 0.8);
}

function jokerIndices(theme: DeckTheme): string {
  const letters = (fill: string): string => `<g fill="${fill}" font-family="${theme.font}" font-size="23" font-weight="700" text-anchor="middle">`
    + ['J', 'O', 'K', 'E', 'R'].map((letter, index) => `<text x="24" y="${38 + index * 24}">${letter}</text>`).join('')
    + '</g>';
  return `${letters(theme.ink.red)}<g transform="${HALF_TURN}">${letters(theme.ink.black)}</g>`;
}

function cardDocument(theme: DeckTheme, suit: Suit | null, body: string): string {
  const ink = suit ? inkFor(theme, suit) : theme.ink.black;
  const sheen = suit ? (isRedSuit(suit) ? theme.sheen.red : theme.sheen.black) : theme.sheen.black;
  const defs = linear('stock', theme.stock[0], theme.stock[1])
    + linear('panel', theme.panel[0], theme.panel[1])
    + linear('metal', theme.metal[0], theme.metal[1])
    + linear('metalEdge', theme.metal[2], theme.metal[2])
    + `<linearGradient id="pip" gradientUnits="userSpaceOnUse" x1="0" y1="-50" x2="0" y2="50"><stop offset="0" stop-color="${sheen}"/><stop offset=".55" stop-color="${ink}"/></linearGradient>`
    + `<clipPath id="card"><rect ${CARD_SHAPE}/></clipPath>`
    + `<clipPath id="panelClip"><rect x="${PANEL.x}" y="${PANEL.y}" width="${PANEL.width}" height="${PANEL.height}" rx="10"/></clipPath>`
    + (suit ? `<path id="suit" d="${SUIT_PATHS[suit]}"/>` : '')
    + theme.defs;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"><defs>${defs}</defs>`
    + `<rect ${CARD_SHAPE} fill="url(#stock)"/>`
    + `<g clip-path="url(#card)">${theme.backdrop}${theme.frame}</g>`
    + body
    + `<rect ${CARD_SHAPE} fill="none" stroke="${theme.edge}" stroke-width="2"/></svg>`;
}

/** Complete SVG document for one card of a themed deck. */
export function renderDeckCard(theme: DeckTheme, card: Card): string {
  const label = RANK_LABELS[card.rank];
  let body: string;
  if (card.rank === 14) {
    body = `<g transform="translate(${CENTRE_X} ${num(CENTRE_Y)})">${theme.halo}</g>${pip(CENTRE_X, CENTRE_Y, 0.94)}`;
  } else if (card.rank >= 11) {
    body = courtBody(theme, card.rank, card.suit);
  } else {
    body = (PIP_LAYOUTS[card.rank] ?? []).map(([x, y]) => pip(x, y, 0.36)).join('');
  }
  return cardDocument(theme, card.suit, body + cornerIndices(theme, label, card.suit));
}

/** Complete SVG document for the deck's joker. */
export function renderDeckJoker(theme: DeckTheme): string {
  return cardDocument(theme, null, jokerBody(theme) + jokerIndices(theme));
}

/** Encodes generated markup as an image URL usable by `<img>`. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
