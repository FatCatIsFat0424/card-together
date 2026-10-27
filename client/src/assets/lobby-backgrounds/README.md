# Lobby background artwork

Ten original decorative illustrations, one per game, generated with the built-in
imagegen tool. They contain no interface elements and do not replace the licensed card
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
