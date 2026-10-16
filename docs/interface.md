# Interface

Frontend page behavior and layout. Client architecture and connection handling:
[architecture](architecture.md#frontend). Component conventions:
[development](development.md#ui-conventions).

## Navigation and layout

- The app fills one dynamic viewport below a fixed top bar. Rooms and games never
  scroll the document; long account pages, chat, and history scroll internally.
- Navigation stays available during matches: top-bar links on desktop, a menu below 1280px.
  Account, friend, profile, and lobby pages keep room membership and offer a return link.
- Sign-out shows icon and label at ≥768px; on narrower screens it is the last menu item, in red.
- The owner's coin balance appears with a hint about the [completion reward](storage.md#game-coins).
- Info and chat sheets and top-bar popovers move focus inside on open and back to the
  trigger on close. Escape closes only the topmost layer.
- Route errors offer a reload. After a deployment, missing lazy chunks trigger at most
  one automatic reload per 30 seconds.

## Lobby and friends

- The top-bar notification button and panel cover incoming friend requests and
  accepted requests; private messages do not contribute to their count or list.
- The chat icon beside top-bar notifications opens the independent `/messages` page
  and shows the total unread private-message count. Both top-bar badges hide at zero
  and display `99+` above 99, with exact counts in their accessible names.
- On `/messages` or `/achievements`, the matching top-bar button is marked current and
  returns to the last page outside those sections (the lobby if none).
  The messages window animates open and, when closed from its close button or the
  top-bar button, animates out before leaving.
- Top-bar switches and the active nav link use a sliding highlight; popovers animate
  open and closed. Reduced motion makes these instant.
  Friends retain only friend and invitation management. The message list and individual
  chats preserve room membership. Game results retain their return-to-room button;
  the top bar, message toolbar, and player profiles omit separate return buttons.
  While still in a room, other pages (including the lobby) show a compact floating
  room card at bottom left. It shows the variant, room code, seated players, ready
  counts or match status, and spectator count from live room snapshots. Clicking it
  returns to the waiting room or active/result table. It hides on room/game pages,
  after leaving the room, and on authentication pages; reconnecting is marked explicitly.
  The lobby uses this card instead of a separate current-room banner.
  The panel's top-right Close control returns
  to the current room or game, or the lobby when no room is joined.
  Refresh, retention information, and loading errors share
  the panel's title bar and wrap on narrow screens. Refresh updates both the list and
  the selected conversation; matching list and conversation errors appear only once.
- On desktop, messages use a divided layout: an independently scrolling conversation
  list with avatars, names, last messages, and timestamps on the left, and the selected
  chat on the right. The desktop panel fills the available viewport with 32px outer
  padding; the conversation list uses 28% of the width, bounded to 15–20rem. Each row
  shows the avatar, the name with the time on the right (today: time only; earlier:
  month/day; full timestamp on hover), and the last message below. Sticker bubbles
  shrink to the displayed sticker size regardless of the image's pixel size. Mobile keeps separate list
  and conversation views. Both layouts keep the header and composer visible within
  the available viewport; conversation lists and message history scroll independently.
- The conversation list includes every current friend: conversations (including
  read-only former friends) newest first, then friends without retained history by
  nickname in the current locale. Selecting one of those opens an empty conversation.
  New messages reorder it live; the friend list reloads on friendship changes,
  reconnects, and refocus, but not when a conversation is marked read. With no friends or conversations, the list
  shows "No friends yet".
- Private chat supports the existing emoji/sticker libraries, older-history pagination,
  and retry after a failed send. Only a visible conversation marks incoming messages read.
  Former-friend conversations are read-only; the latest 90 days are available.

| Width | Lobby layout |
| --- | --- |
| Desktop | Game picker beside a sidebar: selected game, Create, then join-by-code below a divider; online friends below the room actions |
| ≤52rem | Join-by-code, an "Or" divider, then a full-width Create that always creates Bridge; no selected-game panel; friends below the rules list |

- Each game has its own [lobby artwork](../client/src/assets/lobby-backgrounds/README.md),
  also used for its game-start intro. Backgrounds preload, then crossfade over 600ms.
- Lobby entry starts with the player greeting and daily rewards, then room actions,
  staggered game choices, and online friends. Each reveal lasts 200ms and the full
  sequence finishes in 520ms. Friend/reward refreshes and game selection do not
  replay it. System and in-app reduced-motion preferences skip these reveals.
- The rules list opens game details without selecting a mode or changing the background.
- Online friends: hosts first, up to three complete rows sized for nickname, title,
  and username; additional friends scroll vertically. Names truncate and hosts have
  Join buttons. The list refreshes on focus and every
  30 seconds while visible.
- Creating or joining by code requires leaving the current room. Joining a friend's
  room asks for confirmation, then switches rooms in one commit.
- Friends page: above 52rem, tabs for friends, sent requests, and incoming requests,
  with live counts, and the tab names serve as section headings. Smaller screens
  stack these three sections with their own headings. Private messages have their
  own page.
- Public profiles: avatar, colored nickname, username, and actions on the left; history
  and statistics on the right; stacked on small screens.

## Waiting room

| Width | Seats |
| --- | --- |
| Desktop | Equal-width portrait cards N/E/S/W without horizontal scrolling; Ninety-Nine, Blackjack, and Hold'em always use two rows of four |
| Compact | Two columns, smaller controls, up to four rows, vertical scrolling when needed |

- Empty seats are full-card buttons; bot controls stay separate.
  Pending room actions lock seat input without dimming empty seats or the add-seat button.
- When a server update fills an empty seat with a human player, their artwork and
  identity fade upward 8px and settle from 96% through 102% to 100% over 300ms.
  The frame stays still. Initial loading, readiness updates and occupied-seat swaps
  do not trigger this animation; reduced motion disables it.
- On entry, room controls fade upward first, seats follow with a small staggered
  bounce, then spectators, footer actions and desktop chat appear. Each animation
  lasts 200ms; the full sequence finishes in 480ms. It runs once per room visit,
  skips reduced motion, and does not replay for readiness or seat changes.
- The seated host has a dark, gold-lettered badge in the top-left corner of their seat card.
- While waiting, the host can drag human players from anywhere on their seat card or
  spectator item, including the avatar and name, using mouse or touch. Movement beyond
  the drag threshold starts placement; ordinary taps still open profiles or activate controls.
- Bot identities show Easy or Hard. Waiting-room hosts edit each bot's difficulty
  beside its remove control, both 44px tall; guests see the selected difficulty. Defaults and strategy
  behavior are documented in [games](games.md#bots).
- In Ninety-Nine, Blackjack, Hold'em, and Napoleon the host sees a plus cell after the last seat to
  add human seats up to eight (six for Napoleon); only the last empty extra seat can be removed. Start
  conditions: [games](games.md#shared-room-lifecycle).
- Napoleon names every seat "Player 1"–"Player 6" in play order (seat badges show the number) instead
  of compass names and "Seat 5"; the waiting room, table, presentation, and match history agree.
  Bots are named after their current seat ("Bot 3" in Napoleon, "Bot S" elsewhere) and renamed when
  the host moves them, the game changes, or the room is restored.
- Seat artwork: the player's uploaded seat background, the
  [bot dealer artwork](../client/src/assets/room-backgrounds/README.md) for bots, or the
  theme surface.
- Readiness has its own row. Connected seated players can prepare before the player
  count is met. The host's separate Start button enables only when the game has enough
  players and every occupied seat is ready. Spectators are asked to sit first.
- The host can enable automatic seat shuffling for any game; it starts off.
  The Settings button beside the game picker opens the turn timer, seat shuffling and
  the selected game's options. The timer shows two MUI number fields directly, with
  an Apply button and no nested disclosure. Guests can inspect these settings; only the waiting-room host can
  change them. Game rules sits immediately to the right of Settings beside the game picker.
  Compact layouts place the chat toggle to the right of Game rules in the same action group.
  The waiting-room chat slides up to open and down to close over 200ms, respecting
  reduced-motion preferences. The seats remain visible behind the sliding chat;
  covered seat controls and closed chat controls cannot receive input.
  The Settings popover uses a 200ms transition.
  The game picker row matches the Settings button height; selection colors transition
  over 180ms, respecting the system reduced-motion preference.
- Ready and Cancel ready use the same button sizing as the other footer actions.
- A live start shows a skippable 2.9-second intro: the game's lobby artwork and name
  fade in, all occupied seats appear together with avatars and names, then the table
  is revealed. Reduced motion uses a one-second static reveal. The impact sound uses
  gesture-unlocked effects audio and follows the game sound effects switch. Reconnects, page
  reloads, and starts received in background tabs do not replay the intro. Server play
  and clocks continue during this client presentation. A click or tap anywhere on the intro,
  Escape, Enter, or Space reveals the table; a quiet line at the bottom says so.
- Room codes have a copy button. Timer settings expand inside a bounded panel; the
  Sevens Dragon Slaying option matches one game-picker row in height.
- Phones and short landscape windows use two-by-two seats and a chat toggle with an
  unread count.

**Host placement**

- The host drags humans between seats or into spectators, using mouse, touch, or a
  keyboard-focused drag handle to select a player then a destination; Escape cancels.
  The six-dot handle stays visually hidden unless focused by keyboard.
- Occupied seats swap. A spectator placed on a human's seat sends that player to spectators.
  Bots can swap seats with humans but never move to spectators.
- Changes clear human readiness and persist before broadcast; a failed save restores the arrangement.

## Game table

Special-card feedback plays for up to one second inside the existing presentation
frame, without extending turn deadlines or intercepting input. Everyone, including
spectators, sees the same public trigger; private hands never influence it.

- Big Two: only four of a kind and straight flushes. Singles, pairs, ordinary straights,
  and full houses have no decorative effect, including plays containing 2s.
- Napoleon: the secretary card, then big and small jokers before the final three tricks.
  A weakened joker has no effect unless it is the secretary card; ordinary trumps have none.
- Ninety-Nine: only the spade ace. The presentation keeps the total change, direction
  symbol, and selected player's name, without effect descriptions.
- Red Points: only a successful capture containing a red ace, in either card position.
  Other captures and unmatched red aces have no effect.
- Bridge and standard Sevens: no decorative card effects. Sevens Dragon Slaying keeps
  its existing slay effect after the play frame; ordinary 7s and A/K endpoints have none.

Effects resume at the current frame's elapsed time after refresh, and expired effects
are skipped. Effects contain no text, labels, or floating card symbols. Saved or system
reduced motion replaces animation with a static ring. Card faces, names, and scores
remain visible.

- Seats and play area use separate grid cells: local player below, opposite seat above,
  others around the table, with corner positions for additional seats.
- In Bridge, Sevens, Liar's Deck, Ninety-Nine and Napoleon the opposite hand sits to the right of
  its plate at the top, so the top row stays one plate tall and the centre gets the height; below
  600px wide they stack again. Their centre cards size from the table, and Sevens rows may exceed the
  usual centre width cap. Top-row plates line up at their top edge. When the side cells are empty
  (six players), the top corner seats reach down into them with their hands below their plates, so
  the top row is one plate tall; when there is no opposite seat (five players), the centre rises
  between the top corner seats. Neither layout applies below 768px wide. Napoleon lifts the usual centre
  width cap like Sevens. Napoleon trick cards and its play boxes size from the table too; a
  finished trick's box widens and shrinks its four to six cards to fit. Napoleon's trick lays its
  cards around a rounded rectangle, so seats between the axes join the top and bottom rows (six
  players form two rows of three) and the cards can be large.
- On desktop, the game info panel shows a copyable room code directly above the
  abort-vote button, and the global header omits it. Compact layouts retain the original
  header room code and omit it from the info drawer.
- The local hand header holds identity, score, captured-card preview, status, errors,
  and the base + reserve clock at its right edge. Other seats show only the active allowance.
- The local turn retains its text hint without a glowing frame around the hand area.
  The reduced-motion control is temporarily not rendered; saved preferences and motion
  handling remain active.
- Red Points measures the card area, paginates in card order, keeps the page during
  capture highlights, and enlarges sparse tables.
- Below 768px, Sevens shows suit end cards and next open positions instead of all thirteen.
- On phones and short landscape windows, abort voting sits at the table bottom.
- Compact table toolbars use matching 44px square buttons for rules, info, and chat.
- The mobile game chat slides up to open and down to close over 200ms, respecting
  reduced-motion preferences. Its controls become inactive as soon as it closes.
- On phones and short landscape windows, a matching icon-only abort-vote button sits
  at the left of the table toolbar; the info drawer omits its duplicate. Starting an
  abort vote requires confirmation on all layouts. The confirmation uses the same
  200ms opening and shrinking fade-out animations as the rules dialog, respecting
  reduced motion. Cancelling does not start a vote; confirmation is disabled during exit.
- The result dialog stays below the top bar, focuses Back to room, and reports a pending return.
- Napoleon: the picked-up cards are starred while exchanging; exchange, follow-suit, and
  summon controls sit in the overlay panel to keep 44px touch targets. The secretary picker
  dashes cards the Napoleon holds or discarded and warns that they mean no secretary. The
  secretary's confirmation is stored per room and announcement in local storage, so a reload
  shows it once. Seat labels and notices follow [Napoleon visibility](games.md#napoleon).
  The auction table has one column per player and labels it with the seat number (the full
  name is the tooltip and accessible label) so six players fit the info rail.
  Auction tables (Bridge too) write a pass as "P", with "Pass" as its tooltip. The trick history
  heads its columns with seat numbers too, keeping player names as their tooltips.
- Actions require a ready connection; local sorting still works while reconnecting.

Per-game controls: [games](games.md#card-controls).

## Rules dialog

The dialog opens from its center with a 200ms scale animation (70% to 105% to 100%).
Closing via its button, Escape or the backdrop shrinks it to 70% and fades it out
over 200ms; it remains mounted until the exit finishes. Reduced motion skips the exit.
Saved and system reduced-motion preferences disable this animation.

- Opened from the lobby Rules link, the waiting-room Game rules button, the desktop match
  information rail, or compact table tools; available to players and spectators.
- Opens with a short summary (every game except Bridge), then active options, then the
  full rules: Sevens Dragon Slaying, Ninety-Nine two decks, Blackjack player dealer.
  Summary lines and Blackjack match length follow the same options; waiting rooms follow
  host changes, matches use game state, and the lobby shows defaults. Tables have no
  separate rules summary in the information rail.
- Reading does not pause play or timers; settlement closes the dialog.

## Account editor

| Tab | Contents |
| --- | --- |
| Profile | Identity and appearance with a live preview of every equippable type, each labeled private or public (stacked on small screens) |
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

## Daily rewards

- The lobby has two compact controls at the upper right of its welcome area, separate
  from the global navigation: daily tasks and daily check-in. Both open dialogs.
  Closing preserves the selected content and dialog width through the exit animation;
  reward controls become inactive as closing starts.
- Each account receives three distinct tasks from the ten-task [pool](../shared/src/constants/daily-rewards.ts),
  fixed for the Taiwan calendar day across refreshes and restarts. Task rows show a coin
  reward tile, description/progress, and replace/claim controls; the heading counts down
  to the next reset. The same game can advance multiple tasks.
- One free replacement per day is shared across all tasks and sessions. Only assigned,
  unclaimed tasks can be replaced, including completed tasks. The replacement is absent
  from the original three; today's previous activity counts toward it. Claimed tasks
  stay visible until reset. Claim each completed task in its dialog. Progress resets at 00:00 Asia/Taipei;
  unclaimed rewards expire. Bot games count, unfinished/aborted games do not, and tied
  winners do not count as wins. Bridge wins follow partnerships.
- The first time the lobby loads an unchecked Taiwan date, it opens the check-in dialog
  and then claims today's +10 coins automatically; later visits that day do not.
  The dialog shows the current month's calendar with today highlighted and claimed dates
  checked. If the automatic claim fails, today's date remains clickable as a fallback.
- The server supplies the date and progress. Opening a dialog, returning to the page,
  account updates, and midnight refresh them. Claim failures offer a retry; balances
  and claims synchronize across the owner's connected sessions after durable storage.

## Achievements

- The trophy icon immediately left of notifications opens `/achievements`. Desktop
  uses a category sidebar and milestone list; mobile places the two categories above
  the list. Each category shows completed-item progress and its exclusive title reward.
- Newly completed milestones show the same card at the top of any page: slide down
  for 200ms, remain for 3 seconds, then slide up for 200ms. Simultaneous completions
  queue individually. Notifications ignore pointer input and respect reduced motion.
  Initial sign-in establishes a silent baseline; account revisions, reconnects and
  refocus refresh progress without repeating completed notices. Signing out or
  changing accounts clears the queue. This does not automatically claim title rewards.
- The [catalog](../shared/src/constants/achievements.ts) defines two categories:
  Master of the Card Seas (牌海縱橫), with 11 milestones for games, variety and wins;
  and Drops Carve Stone (水滴石穿), with 12 milestones for check-ins and claimed daily tasks.
  Game milestones include 100/200/500/1,000 completions and 50/100/250 wins.
  Daily milestones add cumulative 30/60/90/180 check-in days and 45/90/135/270 claimed
  tasks. The month labels are cumulative goals, not deadlines or consecutive streaks.
  Progress never resets. Check-in days need not be consecutive.
- Finish every milestone to claim a category's permanent title. Earned titles
  cannot be purchased, do not cost coins, and can be equipped in account settings.
  Claiming preserves the current equipped title. Progress refreshes on account changes
  and window focus; repeated claims cannot duplicate inventory.
- Achievement titles share the gold palette and a thicker 2px border
  in both previews and equipped displays.
- The table category and its title both display 牌海縱橫 (Master of the Card Seas).
  The daily category and its title both display 水滴石穿 (Drops Carve Stone).
  Already claimed titles remain owned and equipped after the rename and expansion.
- Retained game history is backfilled once on upgrade; see [storage](storage.md#achievements)
  for limits on recovering old bot games. Historical check-in dates count immediately.
  Game eligibility follows daily rewards: complete
  participant games including bots, no spectators, ties are not wins, and Bridge
  partners win together. Blackjack and Hold'em count complete matches, not hands.

## Cosmetic shop

- `/shop` sells permanent, cosmetic-only products from the
  [catalog](../shared/src/constants/shop.ts): avatar borders, titles/nameplates, chat
  frames, sticker packs, card backs, card faces, table backgrounds, chip styles, seat
  backgrounds, seat frames, victory effects, and sound packs. Each type offers at least
  ten products; each sticker pack includes four original stickers. Prices are in game coins.
- The category sidebar shows catalog counts; the catalog header repeats a count only
  for a border series filter. `type` selects a product type and
  `series` filters avatar borders into Playful, Metal, or Glow. Legacy series-only
  URLs still select borders. Reload and browser Back/Forward retain filters;
  unknown filters show all products. At ≤52rem categories become a horizontally
  scrollable row above products.
- Product cards preview the actual artwork, border on the player's avatar, title,
  or all stickers in a pack. Selecting a non-border category shows where its products
  are visible as a subtitle under the category heading.
  The shop header shows the coin balance; hovering or focusing this balance or the
  global header's coins explains the 10-coin reward per completed game.
  Purchase and coin rules: [storage](storage.md#cosmetic-inventory).
- Buying opens a confirmation dialog with the chosen product, price, and remaining
  balance. Cancel leaves coins unchanged; confirmation is disabled for owned products
  or insufficient coins, and the dialog cannot be dismissed during a purchase.
- Decorations (cat, rabbit, frog, bear, dog, antlers, tentacles) scale with the avatar.
  The original single-color ring has the same outer extent as shop borders.
- The account page selects an owned border or the original avatar. Equipped borders show
  in the lobby, profiles, friends, chat, and rooms without covering the avatar.
- Owned appearance products can be equipped from the shop or account editor. Account
  equipment selectors save immediately; removing an official image style restores the
  retained upload or theme. Nameplates pair a fixed localized cosmetic title with its
  own mark and color treatment, separate from earned achievements. Equipped nameplates
  appear beside the nickname in player identities and room chat, but not in the compact
  spectator list. The shop preview uses the same title styling as the equipped nameplate. Table backgrounds and card
  backs are private; seat backgrounds show in the waiting room. Account selectors offer "Default" for
  the types below. Existing uploads,
  themes, and emoji remain free.
- Newer equipment falls back to the built-in design when unequipped or unknown:

  | Type | Who sees it | Where |
  | --- | --- | --- |
  | Card faces | Owner | Every face-up card, including Liar's Deck jokers and Napoleon's big joker, whose greyscale copy is the small joker (the classic deck uses bundled Napoleon jokers); the four-color deck loads its recolored faces on demand and shows classic faces until then |
  | Sound packs | Owner | Turn, join, card, pass, elimination, start, Sevens slash and collapse cues; the sound switches still apply, shop previews play on click |
  | Chip styles | Owner | Every chip icon (Hold'em, Blackjack, round history, seats) |
  | Seat frames | Everyone | In-game seat plates and waiting-room seats; the frame's glow replaces the theme turn glow |
  | Victory effects | Everyone, including spectators | About 3 s from each winning human seat when settlement appears, once per settlement; never covers or blocks the result dialog. Reduced motion shows a static glow |
  | Chat frames | Everyone | Sender's room chat and private messages; system lines are never framed |

- Purchased packs appear in the sticker picker for room chat and private messages;
  no equipment step is required. Receiving a sticker does not require ownership.
- The emoji/sticker picker shows one horizontal tab row (owned packs, My emoji, Site
  emoji) with a Browse sticker packs link; it opens the first tab with content, and a
  search with no hits in the chosen tab switches to the first tab that has matches.
