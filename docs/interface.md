# Interface

Frontend page behavior and layout. Client architecture and connection handling:
[architecture](architecture.md#frontend). Component conventions:
[development](development.md#ui-conventions).

## Navigation and layout

- The app fills one dynamic viewport below a fixed top bar. Rooms and games never
  scroll the document; long account pages, chat, and history scroll internally.
- Navigation stays available during matches: top-bar links on desktop, a menu below 1024px.
  Account, friend, profile, and lobby pages keep room membership and offer a return link.
- Sign-out shows icon and label at ≥768px; on narrower screens it is the last menu item, in red.
- The owner's coin balance appears with a hint about the [completion reward](storage.md#game-coins).
- Info and chat sheets and top-bar popovers move focus inside on open and back to the
  trigger on close. Escape closes only the topmost layer.
- Route errors offer a reload. After a deployment, missing lazy chunks trigger at most
  one automatic reload per 30 seconds.

## Lobby and friends

- The top bar provides in-app notifications for incoming friend requests, accepted
  requests, and unread private messages. Opening the panel does not mark messages read.
- The chat icon beside top-bar notifications opens the independent `/messages` page.
  Friends retain only friend and invitation management. The message list and individual
  chats preserve room membership and provide
  a return-to-room link when applicable.
- On desktop, messages use a divided layout: an independently scrolling conversation
  list with avatars, names, last messages, and timestamps on the left, and the selected
  chat on the right. Mobile keeps separate list and conversation views.
- Private chat supports the existing emoji/sticker libraries, older-history pagination,
  and retry after a failed send. Only a visible conversation marks incoming messages read.
  Former-friend conversations are read-only; the latest 90 days are available.

| Width | Lobby layout |
| --- | --- |
| Desktop | Game picker beside a sidebar: selected game, Create, then join-by-code below a divider; online friends below the room actions |
| ≤52rem | Join-by-code, an "Or" divider, then a full-width Create that always creates Bridge; no selected-game panel; friends below the rules list |

- Lobby backgrounds preload, then crossfade over 600ms.
- The rules list opens game details without selecting a mode or changing the background.
- Online friends: hosts first, at most three visible rows with vertical scrolling,
  truncated names, and Join buttons for hosts. The list refreshes on focus and every
  30 seconds while visible.
- Creating or joining by code requires leaving the current room. Joining a friend's
  room asks for confirmation, then switches rooms in one commit.
- Friends page: above 52rem, tabs for friends, sent requests, and incoming requests,
  with live counts. Smaller screens stack these three sections. Private messages
  have their own page.
- Public profiles: avatar, colored nickname, username, and actions on the left; history
  and statistics on the right; stacked on small screens.

## Waiting room

| Width | Seats |
| --- | --- |
| Desktop | Equal-width portrait cards N/E/S/W without horizontal scrolling; Ninety-Nine, Blackjack, and Hold'em always use two rows of four |
| Compact | Two columns, smaller controls, up to four rows, vertical scrolling when needed |

- Empty seats are full-card buttons; bot controls stay separate.
- In Ninety-Nine, Blackjack, and Hold'em the host sees a plus cell after the last seat to
  add human seats up to eight; only the last empty extra seat can be removed. Start
  conditions: [games](games.md#shared-room-lifecycle).
- Seat artwork: the player's uploaded seat background, the
  [bot dealer artwork](../client/src/assets/room-backgrounds/README.md) for bots, or the
  theme surface.
- Readiness has its own row. Connected seated players can prepare before the player
  count is met. The host's separate Start button enables only when the game has enough
  players and every occupied seat is ready. Spectators are asked to sit first.
- The host can enable automatic seat shuffling for any game; it starts off.
- Ready and Cancel ready use the same button sizing as the other footer actions.
- A live start shows a skippable 2.9-second intro: the game's lobby artwork and name
  fade in, all occupied seats appear together with avatars and names, then the table
  is revealed. Reduced motion uses a one-second static reveal. The impact sound uses
  gesture-unlocked effects audio and follows the turn-sound toggle. Reconnects, page
  reloads, and starts received in background tabs do not replay the intro. Server play
  and clocks continue during this client presentation; Escape or Skip reveals the table.
- Room codes have a copy button. Timer settings expand inside a bounded panel; the
  Sevens Dragon Slaying option matches one game-picker row in height.
- Phones and short landscape windows use two-by-two seats and a chat toggle with an
  unread count.

**Host placement**

- The host drags humans between seats or into spectators, using mouse, touch, or a
  drag handle with click/keyboard selection then a destination; Escape cancels.
- Occupied seats swap. A spectator placed on a human's seat sends that player to spectators.
  Bots can swap with humans but stay in standard seats.
- Changes clear human readiness and persist before broadcast; a failed save restores the arrangement.

## Game table

- Seats and play area use separate grid cells: local player below, opposite seat above,
  others around the table, with corner positions for additional seats.
- The top-left header shows a copyable room code instead of repeated game-status tags.
- The local hand header holds identity, score, captured-card preview, status, errors,
  and the base + reserve clock at its right edge. Other seats show only the active allowance.
- Red Points measures the card area, paginates in card order, keeps the page during
  capture highlights, and enlarges sparse tables.
- Below 768px, Sevens shows suit end cards and next open positions instead of all thirteen.
- On phones and short landscape windows, abort voting sits at the table bottom.
- The result dialog stays below the top bar, focuses Back to room, and reports a pending return.
- Actions require a ready connection; local sorting still works while reconnecting.

Per-game controls: [games](games.md#card-controls).

## Rules dialog

- Opened from the lobby Rules link, the waiting-room Game rules button, the desktop match
  information rail, or compact table tools; available to players and spectators.
- Shows active options above the full rules: Sevens Dragon Slaying, Ninety-Nine two
  decks, Blackjack player dealer. Waiting rooms follow host changes; matches use game state.
- Reading does not pause play or timers; settlement closes the dialog.

## Account editor

| Tab | Contents |
| --- | --- |
| Profile | Identity and table appearance with one live table preview (stacked on small screens) |
| History | Match table, statistics, visibility setting |
| Emoji | Personal [emoji library](media.md#personal-emoji-library) |
| Password | Password change and sign-out options |

- Nickname, preset avatar, color, and opacity preview immediately. Nickname, preset,
  color, and avatar border save with **Save changes**; image settings save automatically.
- Switching tabs keeps unsaved profile edits.

**History and statistics** use all records from the [history API](api.md#http):

- Columns: date, room, game, result, players; the table scrolls within its container.
- Search (room code, nicknames, usernames, game, result), filters, and sorting run
  locally. Reset restores newest-first order.
- Results follow the viewed account, including Bridge partnerships and tied winners.
- Per-game summary: match count and win rate (wins / matches; ties counted separately;
  no percentage without matches), with a horizontal chart on larger screens.
- Donut chart: each game's share of matches, total in the center; the legend lists all games.
- Statistics ignore search and filters. Private or unavailable history shows no statistics.

## Shop and avatar borders

- `/shop` sells permanent avatar borders from the [catalog](../shared/src/constants/shop.ts)
  for 50–300 coins (5–30 completed games).
- Product cards preview each border on the player's preset or uploaded avatar.
  The shop header shows the coin balance; hovering or focusing this balance or the
  global header's coins explains the 10-coin reward per completed game.
  Purchase and coin rules: [storage](storage.md#avatar-borders).
- Buying opens a confirmation dialog with the chosen border, price, and remaining
  balance. Cancel leaves coins unchanged; confirmation is disabled for owned borders
  or insufficient coins, and the dialog cannot be dismissed during a purchase.
- Decorations (cat, rabbit, frog, bear, dog, antlers, tentacles) scale with the avatar.
  The original single-color ring has the same outer extent as shop borders.
- The account page selects an owned border or the original avatar. Equipped borders show
  in the lobby, profiles, friends, chat, and rooms without covering the avatar.
