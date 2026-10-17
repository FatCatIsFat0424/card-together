import { crownrealmDeck, ironfrontDeck, neoncityDeck, shrineDeck, starfleetDeck } from './campaign-decks';
import type { DeckTheme } from './deck-art';
import {
  bambooLeaf, bambooStalk, blossom, flame, lotus, num, petal, seededRandom, snowflake, sparkle, sunburst,
} from './svg-shapes';

export type DeckSeries =
  | 'aurora' | 'tide' | 'sakura' | 'constellation' | 'bamboo'
  | 'gilded' | 'ember' | 'lotus' | 'frost' | 'dune'
  | 'starfleet' | 'shrine' | 'ironfront' | 'neoncity' | 'crownrealm';

// Card images cannot load web fonts, so each deck names widely installed families.
const SANS = 'Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif';
const SERIF = 'Georgia, Times New Roman, serif';
const BOOK = 'Palatino Linotype, Palatino, Book Antiqua, Georgia, serif';
const DIDONE = 'Didot, Bodoni 72, Bodoni MT, Georgia, serif';

const HALF_TURN = 'rotate(180 112 156.5)';

function innerRule(stroke: string, width: number, opacity: number, inset = 8, radius = 7): string {
  return `<rect x="${inset}" y="${inset}" width="${224 - inset * 2}" height="${313 - inset * 2}" rx="${radius}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
}

/** Decorates the free top-right corner and mirrors it into the bottom-left. */
function pairedCorners(markup: string): string {
  return `${markup}<g transform="${HALF_TURN}">${markup}</g>`;
}

function aurora(): DeckTheme {
  const curtain = '<path d="M-10-4H234V40C196 58 168 22 128 40C88 58 52 26-10 48Z" fill="url(#aur)" opacity=".2"/>'
    + '<path d="M-10-4H234V22C190 38 160 6 118 22C76 38 40 10-10 28Z" fill="url(#aur)" opacity=".16"/>';
  const rays = Array.from({ length: 13 }, (_, index) => {
    const x = 52 + index * 10;
    const length = 60 + ((index * 37) % 50);
    return `<rect x="${x}" y="34" width="4" height="${length}" rx="2" fill="url(#aurRay)" opacity=".5"/>`;
  }).join('');
  return {
    stock: ['#f6fbfa', '#e9eff9'],
    edge: '#9fb3c4',
    ink: { red: '#c2185b', black: '#14384f' },
    sheen: { red: '#e45a91', black: '#2f6a8c' },
    metal: ['#8ff0d6', '#9a8cf0', '#4a4a9e'],
    panel: ['#e7f7f2', '#ece8fb'],
    panelEdge: '#7f74d6',
    medallion: '#fbfdff',
    font: SANS,
    defs: '<linearGradient id="aur" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fd3a8"/><stop offset=".55" stop-color="#58b8e7"/><stop offset="1" stop-color="#ab9cf2"/></linearGradient>'
      + '<linearGradient id="aurRay" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#58e7c2"/><stop offset="1" stop-color="#ab9cf2" stop-opacity="0"/></linearGradient>',
    backdrop: `${curtain}<g transform="${HALF_TURN}">${curtain}</g>`,
    frame: innerRule('url(#aur)', 1.6, 0.85)
      + pairedCorners(sparkle(196, 30, 7, '#7f74d6', 0.85) + sparkle(207, 48, 3.5, '#2fb894', 0.9) + sparkle(182, 22, 3, '#58b8e7', 0.8)),
    panelPattern: `${rays}<g transform="${HALF_TURN}">${rays}</g>`,
    halo: '<circle r="68" fill="none" stroke="url(#aur)" stroke-width="3" opacity=".75"/>'
      + '<circle r="60" fill="none" stroke="url(#aur)" stroke-width="1" opacity=".45"/>'
      + sparkle(0, -78, 8, '#7f74d6') + sparkle(0, 78, 8, '#2fb894') + sparkle(-78, 0, 6, '#58b8e7') + sparkle(78, 0, 6, '#58b8e7'),
  };
}

function tide(): DeckTheme {
  const wave = (y: number, amplitude: number): string => {
    let d = `M-12 ${y}`;
    for (let x = -12; x < 236; x += 24) d += `q6 ${-amplitude} 12 0t12 0`;
    return d;
  };
  const swell = `<path d="${wave(282, 5)}" stroke="#2aa5b0" stroke-width="1.6" fill="none" opacity=".55"/>`
    + `<path d="${wave(292, 5)}" stroke="#69d7de" stroke-width="1.6" fill="none" opacity=".6"/>`
    + `<path d="${wave(302, 5)}V320H-12Z" fill="#69d7de" opacity=".28"/>`;
  const rows = Array.from({ length: 16 }, (_, index) => `<path d="${wave(42 + index * 16, 4)}" stroke="#69d7de" stroke-width="1.3" fill="none" opacity=".45"/>`).join('');
  return {
    stock: ['#f4fbfb', '#e1f1f0'],
    edge: '#8fb9bf',
    ink: { red: '#cc3a50', black: '#0c3956' },
    sheen: { red: '#ec7486', black: '#2b6d8f' },
    metal: ['#d9f6f4', '#5fb8c2', '#1d6672'],
    panel: ['#effafa', '#d9efef'],
    panelEdge: '#2a8f9a',
    medallion: '#fbffff',
    font: SANS,
    defs: '',
    backdrop: `${swell}<g transform="${HALF_TURN}">${swell}</g>`,
    frame: innerRule('#2aa5b0', 1.2, 0.55)
      + pairedCorners('<g fill="#69d7de" opacity=".7"><circle cx="196" cy="30" r="3.2"/><circle cx="205" cy="41" r="2"/><circle cx="188" cy="44" r="1.5"/></g>'),
    panelPattern: rows,
    halo: '<g fill="none" stroke="#2aa5b0"><circle r="56" stroke-width="2.4" opacity=".55"/><circle r="68" stroke-width="1.8" opacity=".35"/><circle r="80" stroke-width="1.2" opacity=".2"/></g>',
  };
}

function sakura(): DeckTheme {
  const branch = '<path d="M226 6C206 14 196 26 184 34M204 18C204 30 210 38 214 44" stroke="#6b4a5e" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".55"/>'
    + blossom(186, 33, 10, '#f5aec3', '#c8305a', 12)
    + blossom(212, 46, 7.5, '#f8c5d3', '#c8305a', -20)
    + petal(170, 46, 4, 30, '#f5aec3', 0.8);
  const scatter = [[60, 108, 40], [168, 92, -20], [52, 204, 75], [176, 226, 10], [110, 290, -45]]
    .map(([x, y, angle]) => petal(x, y, 4.5, angle, '#f5aec3', 0.4)).join('');
  return {
    stock: ['#fff8f7', '#fbe8ec'],
    edge: '#d9a7b6',
    ink: { red: '#c22a55', black: '#3a2440' },
    sheen: { red: '#e8668d', black: '#6f4d79' },
    metal: ['#fbe0d2', '#d99a8e', '#8e5163'],
    panel: ['#fff3f5', '#f8dfe6'],
    panelEdge: '#c77b96',
    medallion: '#fffafb',
    font: BOOK,
    defs: '',
    backdrop: scatter,
    frame: innerRule('#8e5163', 1, 0.35) + pairedCorners(branch),
    panelPattern: '<path d="M46 270C80 250 96 214 132 196C150 186 170 186 178 176" stroke="#6b4a5e" stroke-width="2" fill="none" opacity=".25"/>'
      + blossom(64, 58, 9, '#f5aec3', '#c8305a', 0, 0.55) + blossom(162, 118, 8, '#f8c5d3', '#c8305a', 20, 0.55)
      + blossom(68, 214, 8, '#f8c5d3', '#c8305a', 40, 0.55) + blossom(160, 262, 9, '#f5aec3', '#c8305a', 10, 0.55)
      + petal(150, 54, 4, 20, '#f5aec3', 0.6) + petal(60, 134, 4, -30, '#f5aec3', 0.6) + petal(164, 206, 4, 60, '#f5aec3', 0.6),
    halo: blossom(0, 0, 74, '#f8c9d6', '#f2a3ba', 0, 0.6),
  };
}

function constellation(): DeckTheme {
  const random = seededRandom(7);
  const dust = Array.from({ length: 46 }, () => {
    const x = 6 + random() * 212;
    const y = 6 + random() * 301;
    return `<circle cx="${num(x)}" cy="${num(y)}" r="${num(0.5 + random() * 1)}" opacity="${num(0.35 + random() * 0.5)}"/>`;
  }).join('');
  const figure = (points: ReadonlyArray<readonly [number, number]>): string =>
    `<path d="M${points.map(([x, y]) => `${x} ${y}`).join('L')}" stroke="#93b5eb" stroke-width=".9" fill="none" opacity=".55"/>`
    + points.map(([x, y], index) => sparkle(x, y, index % 2 === 0 ? 4.5 : 3, '#f3e3b5', 0.95)).join('');
  return {
    stock: ['#1a2a55', '#0e1733'],
    edge: '#3d5288',
    ink: { red: '#ff8e86', black: '#f4e4b8' },
    sheen: { red: '#ffd0c8', black: '#fffaf0' },
    metal: ['#fff2c8', '#d0a75a', '#8a6a2c'],
    panel: ['#22346a', '#121d40'],
    panelEdge: '#ead5a2',
    medallion: '#16244d',
    font: SERIF,
    defs: '',
    backdrop: `<g fill="#cfe0ff">${dust}</g>`,
    frame: innerRule('#ead5a2', 1.2, 0.7) + innerRule('#ead5a2', 0.6, 0.35, 11, 5)
      + pairedCorners(figure([[178, 24], [192, 36], [206, 28], [204, 52]])),
    panelPattern: figure([[62, 52], [84, 70], [76, 98], [100, 112]]) + figure([[162, 210], [146, 236], [160, 258], [132, 266]])
      + '<circle cx="112" cy="160" r="66" fill="none" stroke="#93b5eb" stroke-width=".8" stroke-dasharray="2 5" opacity=".6"/>',
    halo: sunburst(0, 0, 50, 82, 16, '#ead5a2', 1.6, 0.55)
      + '<circle r="58" fill="none" stroke="#93b5eb" stroke-width="1" stroke-dasharray="2 4" opacity=".7"/>'
      + sparkle(0, -84, 7, '#f4e4b8') + sparkle(0, 84, 7, '#f4e4b8'),
  };
}

function bamboo(): DeckTheme {
  const grove = bambooStalk(206, -6, 214, 8, '#8bc6a3', '#5e9e78', 0.6)
    + bambooLeaf(202, 40, 30, -58, '#5e9e78', 0.75) + bambooLeaf(202, 40, 24, -95, '#8bc6a3', 0.85)
    + bambooLeaf(202, 128, 26, -70, '#5e9e78', 0.6);
  const fibres = '<path d="M0 70C70 66 150 78 224 72M0 160C80 154 140 168 224 162M0 250C60 246 160 258 224 252" stroke="#c9b98a" stroke-width=".8" fill="none" opacity=".35"/>';
  return {
    stock: ['#fbf7e8', '#efe6c9'],
    edge: '#b9ab80',
    ink: { red: '#b8352a', black: '#173a2e' },
    sheen: { red: '#da5f4f', black: '#3f6f5b' },
    metal: ['#f2e6bd', '#c3a35c', '#7a6230'],
    panel: ['#f6f2de', '#e3ecd6'],
    panelEdge: '#5e9e78',
    medallion: '#fdfaf0',
    font: BOOK,
    defs: '',
    backdrop: fibres,
    frame: innerRule('#5e9e78', 1, 0.45) + pairedCorners(grove),
    panelPattern: bambooStalk(60, 30, 290, 7, '#8bc6a3', '#5e9e78', 0.3) + bambooStalk(166, 20, 290, 6, '#8bc6a3', '#5e9e78', 0.3)
      + bambooLeaf(60, 120, 26, 60, '#5e9e78', 0.35) + bambooLeaf(166, 200, 26, -60, '#5e9e78', 0.35)
      + bambooLeaf(60, 250, 22, 75, '#8bc6a3', 0.4) + bambooLeaf(166, 64, 22, -75, '#8bc6a3', 0.4),
    // A brushed ring, thick on one side and fading to a gap, in the manner of an ink circle.
    halo: '<path d="M44-58C14-80-38-74-62-38C-84-4-70 44-32 64C4 82 52 70 70 28C80 4 76-22 62-40" stroke="#5e9e78" stroke-width="9" stroke-linecap="round" fill="none" opacity=".4"/>'
      + '<path d="M-58 30C-48 52-24 66 4 66" stroke="#8bc6a3" stroke-width="3" stroke-linecap="round" fill="none" opacity=".5"/>',
  };
}

function gilded(): DeckTheme {
  const fan = sunburst(112, 6, 8, 30, 15, '#b8863f', 1.4, 0.6, 90, 270)
    + '<path d="M86 6A26 26 0 0 0 138 6" stroke="#b8863f" stroke-width="1.2" fill="none" opacity=".7"/>';
  const step = '<path d="M216 30H198V16H184M216 42H190V24H176" stroke="#b8863f" stroke-width="1.2" fill="none" opacity=".75"/>'
    + '<path d="M204 24l4 4l-4 4l-4-4z" fill="#b8863f" opacity=".8"/>';
  return {
    stock: ['#fffaf0', '#f3e4c2'],
    edge: '#b89660',
    ink: { red: '#a3263a', black: '#211d2e' },
    sheen: { red: '#cf5065', black: '#4f4766' },
    metal: ['#fbe9b4', '#c08b3c', '#7c5418'],
    panel: ['#fdf5e0', '#efdcb2'],
    panelEdge: '#b8863f',
    medallion: '#fffbf1',
    font: DIDONE,
    defs: '',
    backdrop: `${fan}<g transform="${HALF_TURN}">${fan}</g>`,
    frame: innerRule('#b8863f', 1.6, 0.85, 7, 7) + innerRule('#b8863f', 0.7, 0.6, 11, 5) + pairedCorners(step),
    panelPattern: sunburst(112, 160, 50, 150, 36, '#c9975b', 1.2, 0.35)
      + '<path d="M58 52L112 40L166 52M58 268L112 280L166 268" stroke="#b8863f" stroke-width="1.2" fill="none" opacity=".6"/>',
    halo: sunburst(0, 0, 52, 84, 32, '#c08b3c', 1.6, 0.6)
      + '<circle r="48" fill="none" stroke="#c08b3c" stroke-width="1.6" opacity=".7"/><circle r="44" fill="none" stroke="#c08b3c" stroke-width=".7" opacity=".5"/>',
  };
}

function ember(): DeckTheme {
  const hearth = flame(84, 316, 30, 22, 'url(#flame)', 0.75, -3) + flame(112, 316, 40, 26, 'url(#flame)', 0.85, 2)
    + flame(140, 316, 28, 20, 'url(#flame)', 0.75, 4) + flame(66, 316, 18, 14, 'url(#flame)', 0.6, -2)
    + flame(158, 316, 18, 14, 'url(#flame)', 0.6, 3);
  const sparks = '<g fill="#e0703f"><circle cx="190" cy="30" r="2.4" opacity=".8"/><circle cx="202" cy="46" r="1.6" opacity=".7"/>'
    + '<circle cx="182" cy="52" r="1.2" opacity=".6"/><circle cx="208" cy="24" r="1.2" opacity=".6"/></g>';
  const corona = Array.from({ length: 12 }, (_, index) => `<g transform="rotate(${index * 30})">${flame(0, -54, 24, 14, 'url(#flame)', 0.55)}</g>`).join('');
  return {
    stock: ['#fff6ec', '#fbdfc8'],
    edge: '#d4a07c',
    ink: { red: '#c0281a', black: '#2b1b22' },
    sheen: { red: '#ec5a33', black: '#5b3a45' },
    metal: ['#ffe0a6', '#e0782e', '#8f3a14'],
    panel: ['#fff1e2', '#f9d0b0'],
    panelEdge: '#d9622b',
    medallion: '#fffaf4',
    font: SERIF,
    defs: '<linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#d9381e"/><stop offset=".6" stop-color="#f08a3c"/><stop offset="1" stop-color="#ffd38f"/></linearGradient>'
      + '<radialGradient id="glow" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="#ffb070" stop-opacity=".45"/><stop offset="1" stop-color="#ffb070" stop-opacity="0"/></radialGradient>',
    backdrop: `<rect width="224" height="313" fill="url(#glow)"/>${hearth}`,
    frame: innerRule('#d9622b', 1.1, 0.5) + pairedCorners(sparks),
    panelPattern: `<g opacity=".55">${flame(70, 282, 40, 24, 'url(#flame)', 1, -4)}${flame(112, 282, 58, 30, 'url(#flame)', 1, 3)}${flame(154, 282, 44, 24, 'url(#flame)', 1, 5)}</g>`
      + '<g fill="#e0703f" opacity=".6"><circle cx="66" cy="60" r="2"/><circle cx="158" cy="48" r="2.6"/><circle cx="150" cy="122" r="1.6"/><circle cx="70" cy="132" r="1.4"/></g>',
    halo: `${corona}<circle r="56" fill="#ffd9b0" opacity=".45"/>`,
  };
}

function lotusDeck(): DeckTheme {
  const pond = '<g fill="none" stroke="#3f7f7f" opacity=".3"><ellipse cx="112" cy="300" rx="70" ry="9" stroke-width="1.2"/><ellipse cx="112" cy="300" rx="44" ry="5" stroke-width="1"/></g>';
  const pad = '<path d="M200 30A14 9 0 1 1 186 22L194 29Z" fill="#7fb0a0" opacity=".55"/>';
  return {
    stock: ['#fcf8f0', '#eeeadb'],
    edge: '#a9b9ad',
    ink: { red: '#b52e5c', black: '#13343e' },
    sheen: { red: '#dc6993', black: '#3d6874' },
    metal: ['#f8e9c2', '#c19d53', '#73592a'],
    panel: ['#fbf1ea', '#e3eee8'],
    panelEdge: '#3f7f7f',
    medallion: '#fffcf6',
    font: BOOK,
    defs: '',
    backdrop: `${pond}<g transform="${HALF_TURN}">${pond}</g>`,
    frame: innerRule('#3f7f7f', 1, 0.5) + lotus(112, 34, 20, '#e5b3c3', '#f3d3dd', 0.8)
      + `<g transform="${HALF_TURN}">${lotus(112, 34, 20, '#e5b3c3', '#f3d3dd', 0.8)}</g>` + pairedCorners(pad),
    panelPattern: lotus(112, 284, 80, '#e5b3c3', '#f3d3dd', 0.45)
      + '<g fill="none" stroke="#3f7f7f" opacity=".3"><path d="M52 60Q82 48 112 60T172 60"/><path d="M52 72Q82 60 112 72T172 72"/></g>',
    halo: lotus(0, 50, 104, '#efc3d1', '#f7dde5', 0.6),
  };
}

function frost(): DeckTheme {
  const shard = '<path d="M224 0V70L196 40L170 0Z" fill="#cfe9f3" opacity=".55"/><path d="M224 0V40L206 22Z" fill="#ffffff" opacity=".7"/>';
  const random = seededRandom(31);
  const lattice = Array.from({ length: 9 }, (_, row) => Array.from({ length: 6 }, (_, column) => {
    const x = 46 + column * 26 + (row % 2) * 13;
    const y = 40 + row * 30;
    return `<path transform="translate(${x} ${y})" d="M0-10L9-5V5L0 10L-9 5V-5Z"/>`;
  }).join('')).join('');
  const flakes = [[70, 64], [154, 252], [60, 236], [164, 70]]
    .map(([x, y]) => snowflake(x, y, 8 + random() * 4, '#5aa9c4', 1.2, 0.55)).join('');
  return {
    stock: ['#f8fcff', '#e1eef6'],
    edge: '#9cbccc',
    ink: { red: '#bd2c4b', black: '#132d47' },
    sheen: { red: '#e0607b', black: '#3c6788' },
    metal: ['#ffffff', '#9fd0e2', '#3f7d97'],
    panel: ['#f2f9fd', '#d8e9f3'],
    panelEdge: '#5aa9c4',
    medallion: '#fbfeff',
    font: SANS,
    defs: '',
    backdrop: pairedCorners(shard),
    frame: innerRule('#5aa9c4', 1.1, 0.6) + pairedCorners(snowflake(194, 34, 11, '#5aa9c4', 1.4, 0.85) + snowflake(208, 56, 5, '#99d4e1', 1, 0.9)),
    panelPattern: `<g fill="none" stroke="#99d4e1" stroke-width=".9" opacity=".55">${lattice}</g>${flakes}`,
    halo: snowflake(0, 0, 80, '#99d4e1', 3, 0.7),
  };
}

function dune(): DeckTheme {
  const dunes = '<path d="M-10 276C40 262 80 284 130 270C170 260 200 272 234 264V320H-10Z" fill="#e7c08f" opacity=".45"/>'
    + '<path d="M-10 292C50 280 100 300 150 288C190 280 214 290 234 286V320H-10Z" fill="#d7a378" opacity=".45"/>';
  const sun = '<circle cx="196" cy="32" r="8" fill="#d7a378" opacity=".75"/><circle cx="196" cy="32" r="13" fill="none" stroke="#d7a378" stroke-width="1" opacity=".55"/>';
  return {
    stock: ['#fdf6e7', '#f2dfbb'],
    edge: '#c6a57a',
    ink: { red: '#ad3c26', black: '#33283d' },
    sheen: { red: '#d66848', black: '#65536f' },
    metal: ['#f8e2ae', '#c98e58', '#7a4f2c'],
    panel: ['#fcf0d8', '#ecd2a8'],
    panelEdge: '#b9824f',
    medallion: '#fffaf0',
    font: SERIF,
    defs: '',
    backdrop: `${dunes}<g transform="${HALF_TURN}" opacity=".6">${dunes}</g>`,
    frame: innerRule('#b9824f', 1, 0.5) + pairedCorners(sun),
    panelPattern: '<path d="M40 246C80 230 110 252 150 238C166 232 176 236 186 234V290H40Z" fill="#e7c08f" opacity=".55"/>'
      + '<path d="M40 264C76 254 120 272 160 260C172 256 180 258 186 258V290H40Z" fill="#d7a378" opacity=".5"/>'
      + '<circle cx="112" cy="60" r="12" fill="#e7c08f" opacity=".6"/>'
      + '<g fill="none" stroke="#c98e58" opacity=".4"><path d="M52 112C84 104 140 120 172 110"/><path d="M52 124C84 116 140 132 172 122"/></g>',
    halo: sunburst(0, 0, 60, 80, 24, '#c98e58', 2, 0.5)
      + '<circle r="54" fill="#f2d39f" opacity=".5"/><circle r="54" fill="none" stroke="#c98e58" stroke-width="1.4" opacity=".6"/>',
  };
}

const BUILDERS: Readonly<Record<DeckSeries, () => DeckTheme>> = {
  aurora, tide, sakura, constellation, bamboo, gilded, ember, lotus: lotusDeck, frost, dune,
  starfleet: starfleetDeck, shrine: shrineDeck, ironfront: ironfrontDeck, neoncity: neoncityDeck, crownrealm: crownrealmDeck,
};

const themes = new Map<DeckSeries, DeckTheme>();

/** Builds each theme once, on first use. */
export function deckTheme(series: DeckSeries): DeckTheme {
  let theme = themes.get(series);
  if (!theme) {
    theme = BUILDERS[series]();
    themes.set(series, theme);
  }
  return theme;
}

export const DECK_SERIES = Object.keys(BUILDERS) as readonly DeckSeries[];
