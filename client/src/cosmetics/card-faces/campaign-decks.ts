import type { DeckTheme } from './deck-art';

/** Ornament geometry stays outside the indices; the pip layout remains shared by all decks. */
const SHIP = '<path d="M0-24L10-3L27 13L9 9L5 22H-5L-9 9L-27 13L-10-3Z" fill="#78e6ff" stroke="#234d85" stroke-width="2"/><path d="M0-13L4 2H-4Z" fill="#174783"/><path d="M-5 23V32M5 23V32" stroke="#f7cf70" stroke-width="3"/>';
const TORII = '<path d="M-30-22Q0-14 30-22L28-15H-28Z M-25-8H25V-3H-25Z M-20-15H-14V27H-21Z M14-15H20L21 27H14Z" fill="#b53628" stroke="#f4cc7d" stroke-width="1"/><path d="M-7 13Q-16 1-6-7Q-8 3 0 0Q12-9 8-17Q23 1 7 15Z" fill="#2f9994" opacity=".75"/>';
const TANK = '<rect x="-30" y="6" width="60" height="18" rx="9" fill="#48543a" stroke="#d7b85c" stroke-width="2"/><path d="M-26 5L-19-6H19L27 5Z M-13-7V-18H10L17-7Z" fill="#7a8855" stroke="#35432f" stroke-width="2"/><path d="M12-15H36" stroke="#35432f" stroke-width="5"/><g fill="#b9b77b">' + [-19, -6, 7, 20].map((x) => `<circle cx="${x}" cy="15" r="4"/>`).join('') + '</g>';
const CITY = '<path d="M-34 28V-9H-21V-28H-8V8H3V-38H17V-13H31V28Z" fill="#183668" stroke="#df4bdd" stroke-width="2"/><path d="M-28 0V20M-14-20V20M10-29V20M24-5V20" stroke="#52f1f5" stroke-width="3" stroke-dasharray="4 5"/><path d="M-41 30H39M-32 35H27" stroke="#52f1f5" stroke-width="2"/>';
const LION = '<path d="M-29-22H29L25 12Q20 30 0 40Q-20 30-25 12Z" fill="#173e85" stroke="#b68a32" stroke-width="3"/><path d="M-16-20L-20-34L-8-28L0-41L8-28L20-34L16-20Z" fill="#e7bd57" stroke="#8b6424"/><path d="M-11-10L-7-16L0-13L7-16L14-8L10 0L15 10L8 24H-9L-16 9L-11 1Z" fill="#e7bd57"/><path d="M-5-5H-1M5-5H9M0 0L3 4L6 0M3 4V11L-3 15M3 11L9 15" fill="none" stroke="#173e85" stroke-width="2"/>';

function stamp(markup: string, x: number, y: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">${markup}</g>`;
}

function frame(color: string, markup: string): string {
  const corner = stamp(markup, 194, 31, 0.44);
  return `<path d="M44 9H180M215 63V250M44 304H180M9 101V212" fill="none" stroke="${color}" stroke-width="2"/>`
    + corner + `<g transform="rotate(180 112 156.5)">${corner}</g>`;
}

const sans = 'Segoe UI, Helvetica Neue, Arial, sans-serif';
const serif = 'Palatino Linotype, Georgia, serif';

export function starfleetDeck(): DeckTheme {
  const chart = '<g fill="none" stroke="#65cfe8" opacity=".22"><path d="M44 36L92 70L160 42M62 245L134 273L179 239"/><circle cx="112" cy="157" r="98" stroke-dasharray="3 9"/><path d="M46 290L178 23"/></g>';
  return {
    stock: ['#132b52', '#08182f'], edge: '#427ba5', ink: { red: '#ff9f9b', black: '#edf8ff' },
    sheen: { red: '#ffd3cc', black: '#ffffff' }, metal: ['#ffdf8a', '#c29943', '#705322'],
    panel: ['#203f69', '#112843'], panelEdge: '#5ccee8', medallion: '#0c2546', font: sans, defs: '',
    backdrop: chart, frame: frame('#65cfe8', SHIP),
    panelPattern: stamp(SHIP, 112, 256, 0.65) + '<path d="M53 45V264M171 45V264" stroke="#f7cf70" stroke-dasharray="2 9" opacity=".6"/>',
    halo: '<g fill="none" stroke="#65cfe8"><ellipse rx="77" ry="62" stroke-width="3"/><ellipse rx="84" ry="68" stroke-dasharray="9 14"/></g>' + stamp(SHIP, 0, -78, 0.55),
    courtCrest: SHIP,
  };
}

export function shrineDeck(): DeckTheme {
  const lanterns = '<path d="M47 18Q112 45 177 18" fill="none" stroke="#ae803e"/>'
    + [62, 87, 137, 162].map((x, i) => `<g transform="translate(${x} ${27 + (i % 2) * 6})"><path d="M0-8V-1M0 15V20" stroke="#986c30"/><rect x="-5" width="10" height="14" rx="4" fill="#c84a2e"/><path d="M-4 3H4M-4 10H4" stroke="#e3b559"/></g>`).join('');
  return {
    stock: ['#fff8e6', '#efdfbd'], edge: '#b68a50', ink: { red: '#aa2924', black: '#163f42' },
    sheen: { red: '#ca5941', black: '#326865' }, metal: ['#ffe1a1', '#c0974d', '#79562a'],
    panel: ['#faedcc', '#eed8b6'], panelEdge: '#b4492c', medallion: '#fff8e9', font: serif, defs: '',
    backdrop: lanterns + `<g transform="rotate(180 112 156.5)">${lanterns}</g>`, frame: frame('#b4492c', TORII),
    panelPattern: stamp(TORII, 112, 255, 0.8) + '<path d="M51 52Q112 79 173 52M51 60Q112 87 173 60" fill="none" stroke="#2f9994" opacity=".35"/>',
    halo: stamp(TORII, 0, -49, 1.85) + '<path d="M-75 26Q-94 0-79-20Q-83-2-69 3Q-57 18-75 26M75 26Q57 18 69 3Q83-2 79-20Q94 0 75 26" fill="#2f9994" opacity=".65"/>',
    courtCrest: TORII,
  };
}

export function ironfrontDeck(): DeckTheme {
  const rivets = [18, 54, 90, 126, 162, 198, 234, 270, 300].flatMap((y) => [13, 211].map((x) => `<circle cx="${x}" cy="${y}" r="2" fill="#9c9b68" stroke="#48543a"/>`)).join('');
  const radar = '<g fill="none" stroke="#687650" opacity=".22"><circle cx="112" cy="157" r="83"/><circle cx="112" cy="157" r="57"/><path d="M45 157H179M112 74V240M52 96L172 218"/></g>';
  return {
    stock: ['#f2efd6', '#d8d8b7'], edge: '#596746', ink: { red: '#a73129', black: '#26382c' },
    sheen: { red: '#bf5642', black: '#4b6349' }, metal: ['#e4d69a', '#a9a16a', '#49503a'],
    panel: ['#e5e4c8', '#bec6a2'], panelEdge: '#596746', medallion: '#f5f0d7', font: sans, defs: '',
    backdrop: radar, frame: rivets + frame('#596746', TANK),
    panelPattern: stamp(TANK, 112, 252, 0.9) + '<path d="M52 43H172M52 49H172" stroke="#596746" stroke-dasharray="10 5"/>',
    halo: '<g fill="none" stroke="#65744b"><circle r="75" stroke-width="2"/><circle r="64" stroke-dasharray="2 6"/><path d="M-87 0H-62M62 0H87M0-87V-62M0 62V87" stroke-width="3"/></g>' + stamp(TANK, 0, -77, 0.55),
    courtCrest: TANK,
  };
}

export function neoncityDeck(): DeckTheme {
  const circuit = '<g fill="none" stroke="#36cbd7" opacity=".4"><path d="M53 18H92L105 31H168M171 55V86L193 108V194M53 296H132L146 282H169M31 109V194L51 214V258"/><path d="M60 21V35H83M192 211V259H175" stroke="#df4bdd"/><circle cx="92" cy="18" r="3"/><circle cx="146" cy="282" r="3"/></g>';
  return {
    stock: ['#191d3e', '#0b1029'], edge: '#963d9f', ink: { red: '#ffa7e6', black: '#a5fcfa' },
    sheen: { red: '#ffe4f6', black: '#e2fffd' }, metal: ['#ffd4fa', '#c344cc', '#61356f'],
    panel: ['#2b2453', '#121d3d'], panelEdge: '#4bdfe4', medallion: '#151d3a', font: sans, defs: '',
    backdrop: circuit, frame: frame('#df4bdd', CITY),
    panelPattern: stamp(CITY, 112, 247, 1.4) + '<path d="M52 44H156L172 60M52 64H128" fill="none" stroke="#df4bdd" opacity=".65"/>',
    halo: '<path d="M-77-47L-47-77H47L77-47V47L47 77H-47L-77 47Z" fill="none" stroke="#df4bdd" stroke-width="3"/><path d="M-67-40V40L-40 67H40M67 40V-40L40-67H-40" fill="none" stroke="#4bdfe4" stroke-width="2"/>' + stamp(CITY, 0, -75, 0.55),
    courtCrest: CITY,
  };
}

export function crownrealmDeck(): DeckTheme {
  const braid = '<path d="M49 10Q58 2 67 10T85 10T103 10T121 10T139 10T157 10T175 10" fill="none" stroke="#b68a32" stroke-width="1.6"/>';
  return {
    stock: ['#fff9e9', '#eee0bf'], edge: '#a88945', ink: { red: '#a52539', black: '#17396d' },
    sheen: { red: '#c45561', black: '#416598' }, metal: ['#fff0ae', '#d0a34b', '#806024'],
    panel: ['#eee5ca', '#cfdbdf'], panelEdge: '#a88945', medallion: '#fff9e9', font: serif, defs: '',
    backdrop: braid + `<g transform="rotate(180 112 156.5)">${braid}</g>`, frame: frame('#b68a32', LION),
    panelPattern: stamp(LION, 112, 251, 0.55) + '<path d="M51 42H63V115L57 124L51 115Z M161 42H173V115L167 124L161 115Z" fill="#173e85" opacity=".7"/>',
    halo: '<g opacity=".12">' + stamp(LION, 0, 0, 2.1) + '</g>' + stamp(LION, 0, -78, 0.55), courtCrest: LION,
  };
}
