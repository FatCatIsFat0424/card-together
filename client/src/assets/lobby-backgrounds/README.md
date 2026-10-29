# Lobby background artwork

Original decorative illustrations, one per game. The first ten were generated with the built-in
imagegen tool; the later ones with Canva image generation (see [Canva set](#canva-set)). They contain no interface elements and do not replace the licensed card
graphics.

- Encoded as WebP (quality 82) with the repository's Sharp dependency, keeping the
  original dimensions and composition.
- Each prompt is the common specification followed by the file's scene line.

`cards/` holds 480x270 WebP renditions (quality 76, cover crop) of the same files for the lobby game
cards, made with Sharp: `sharp(file).resize({ width: 480, height: 270, fit: 'cover' }).webp({ quality: 76 })`.
Regenerate a rendition whenever its background changes.

## Common specification

```text
Use case: stylized-concept
Asset type: original decorative website background for a card-game lobby, landscape 16:9.
Primary request: create a distinct, polished game-themed background.
Style/medium: cinematic digital illustration, believable materials, restrained atmosphere, cohesive with a modern card-game website.
Composition: wide full-bleed background; most recognizable game details and brighter highlights toward the outer edges, with broad quiet negative space in the middle behind existing UI. Visually useful even when center is covered by opaque interface panels; keep some soft color and texture across the entire canvas.
Constraints: background artwork only, no interface, no buttons, no labels, no typography, no logos, no watermarks, no people. Original generic playing-card designs, no copyrighted card artwork. Do not generate a screenshot or webpage.
```

## Scene prompts

- **bridge.webp** — Scene: Bridge: an elegant midnight-blue card salon, four subtle suit emblems and pairs of face-down playing-card fans around the outer edges, fine brass lines suggesting partnership and a bridge arch.
- **bigtwo.webp** — Scene: Big Two: a vivid violet and teal card-table atmosphere, ascending fans of playing cards and subtle flowing geometric streaks suggesting climbing combinations, energetic but sophisticated.
- **redpoints.webp** — Scene: Red Points: a rich crimson card-table atmosphere with red heart and diamond suit motifs, softly glowing red counters, layered ivory playing cards at the outer edges.
- **ninetynine.webp** — Scene: Ninety-Nine: a warm amber and copper card-table atmosphere, circular counting tracks with small counters and layered playing cards, a subtle rising spiral suggesting the running total.
- **sevens.webp** — Scene: Sevens: an emerald card-table atmosphere, four branching orderly trails of playing cards extending from a central starting point toward the outer edges, soft luminous green suit shapes.
- **chinesepoker.webp** — Scene: Chinese Poker: a rich jade and burgundy lacquer card-table atmosphere, playing cards arranged into three staggered fans at the outer edges, subtle gold geometric lattice details.
- **liarsdeck.webp** — Scene: Liar's Deck: a smoky teal and warm amber tavern table, face-down playing cards, one beer mug at an outer corner and faint candlelight, mysterious shadows suggesting bluffing.
- **blackjack.webp** — Scene: Blackjack: an elegant deep navy and champagne-gold casino atmosphere, two ivory cards showing an ace and a king near an outer corner, small neat chip stacks and smooth felt.
- **holdem.webp** — Scene: Texas Hold'em: a forest-green poker-table atmosphere, a row of five community cards near an outer edge, two face-down hole cards and red, blue and ivory chip stacks, soft casino lighting.
- **napoleon.webp** — Scene: Napoleon: an imperial midnight-blue and burgundy card salon, a black bicorne hat with restrained gold trim at an outer corner, antique brass laurel ornaments and a subtle eagle relief along the perimeter, ivory playing-card fans and two contrasting joker motifs near the outer edges, warm candlelit gold accents on dark felt; the broad central play area stays calm and uncluttered.

## Canva set

Generated with Canva at 1680x944 and encoded the same way. Each prompt is this common prefix, with the
scene line inserted:

```text
Original decorative website background for a game lobby, landscape 16:9. Cinematic photorealistic digital illustration, believable materials, restrained atmosphere, <lighting>. Composition: wide full-bleed background; recognizable game details and brighter highlights toward the outer edges, broad calm uncluttered negative space in the middle. Constraints: background only, no interface, no buttons, no labels, no typography, no logos, no watermarks, no people.
```

- **tenhalf.webp** — Jade-green felt, festive Taiwanese night mood, fan of face and low cards, dealer button, small chip stacks, red lantern glow
- **liarsdice.webp** — Smoky tavern table, leather dice cups, one lifted showing five dice, scattered dice, amber pendant light, whiskey glass
- **crazyeights.webp** — Teal and coral game room, draw and discard piles with an eight on top, swirling cards, four glowing suit shapes at corners
- **stud.webp** — Mahogany and oxblood-red card room, Hong Kong film mood, rows of five cards (four up, one down), chip stacks pushed all-in, smoky lamp light
- **reversi.webp** — Deep-green felt grid near one edge, black-and-white discs in clusters, one mid-flip, cool soft light
- **oldmaid.webp** — Plum and mustard living room at night, fan of face-down cards with one lifted, discarded pairs, joker peeking from the fan
- **gofish.webp** — Ocean-blue and sandy-beige seaside cabin, completed four-card sets, loose pond of face-down cards, brass lure and rope
- **doudizhu.webp** — Crimson and gold three-player table, hands at three edges, two jokers and three bonus cards, fanned four-card bomb, red paper-cut ornaments
- **jungle.webp** — Emerald jungle board, carved elephant, lion, tiger, rat pieces, blue river channel, den and traps, leaves at corners
- **gomoku.webp** — Wooden grid board with diagonal line of five black stones, stone bowls at corners, bamboo shadows, morning light
- **xiangqi.webp** — Dark lacquered table, carved Xiangqi board near one edge, round pieces with red and black engraved characters at corners, celadon teacup, folded silk cloth
- **banqi.webp** — 4×8 board on rosewood, face-down round pieces with blank backs, a few flipped red and black pieces, teacup, desk lamp, Taiwanese teahouse
- **chinesecheckers.webp** — Six-pointed star wooden board, six-color glass marbles in corner triangles, a few mid-hop, nostalgic afternoon window light
- **landbattle.webp** — Board with railway lines, camps and headquarters, upright tiles facing away, brass compass, folded map, small flag, war-room lamp
