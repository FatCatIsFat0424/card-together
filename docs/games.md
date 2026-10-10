# Game rules

These are the implemented house rules, not a claim of standard tournament rules.
Four players occupy N/E/S/W. Clockwise is N → E → S → W; counterclockwise is
N → W → S → E. The server controls legality, turns, and results; private hands are
visible only to their owner.

## Shared room lifecycle

A host chooses the game while waiting. Four occupied, ready seats start a match.
After scoring, each player returns to the room individually with continue while the others
keep the result; the finished board is removed once every human has returned or the next
match starts. Leaving or failing to reconnect within
60 seconds aborts an unfinished match. Seated players can propose/vote to abort an
active game. Three yes votes out of four pass; with bots, the threshold is the smaller
of three and the number of human players. Bots do not vote; the starter votes yes
automatically, so a solo human can end the game immediately.
Votes last 60 seconds. Starting a proposal sets a three-minute cooldown; failed or
expired votes retain that cooldown. A successful vote returns the room to waiting
and clears the cooldown, allowing an immediate proposal in the next match.
Match history retains completed results independently
of current-room public action history.

### Spectators and god view

Besides the four seats a room holds up to eight spectators
([`MAX_SPECTATORS`](../shared/src/constants/game-rules.ts)): every member without a seat. Players
join as spectators, also during a match or through an invite, and take any empty seat while
waiting; seated players can stand up while waiting. Spectators watch from South's side without
controls (only Leave room, in the game info panel), never vote, and leaving or disconnecting never
aborts the match. They keep the finished
board until they press continue or it is removed.

Spectators and permanently eliminated players (Ninety-Nine bust, Liar's Deck death, Hold'em out
of chips, Blackjack unable to cover the minimum; not a Hold'em fold) have god view: every seat's
hand appears face up beside its plate (two overlapping rows for long hands), and Blackjack's hole card and Hold'em hole cards
appear face up with a dashed outline. Stock order, bullets, and other undealt cards stay hidden.
In Sevens, spectators also see every seat's covered cards and penalty in the info panel,
and can click any seat's covered-count badge to inspect its complete pile on the table;
playing seats see only their own covered cards until settlement.
God view keeps its previous hands and Sevens covered cards while a presentation plays,
and an eliminated player's view opens only after the frame that eliminates them.

During a match, messages from these observers carry `audience: 'observers'` and reach only other
observers; seats still playing see only their own channel, and everyone sees the full history once
the match ends. A player still in the match also stops hearing observers in voice chat. An
elimination moves the player to the observer channels only after its presentation ends.
Server presentation deadlines briefly gate actions between turns; see
[architecture](architecture.md#presentation-timeline).

### Turn timer

The default is **5 + 20 seconds**: each player gets a fresh five seconds each turn,
then draws from their own twenty-second reserve for the deal. Unused turn time is
not added to the reserve. While waiting, the host can change the turn allowance and
reserve within the [shared limits](../shared/src/time-control.ts); changing settings
clears human readiness. All players see the current settings; only their own reserve is displayed:
the own seat plate always shows "turn + reserve" seconds, and other seats show only their turn
allowance while it is their turn.

Chinese Poker has no turns: all four seats arrange at once against one shared deadline of
turn allowance + reserve, but at least 60 seconds (`cpArrangeSeconds` in
[the rules](../shared/src/rules/chinesepoker.ts)). Only the own seat shows that countdown,
and only until it submits. At the deadline the server arranges every missing seat with the
bot algorithm (never fouled) and marks human seats "Auto-played".

Blackjack bets work the same way: every seat that can bet does so at once against one shared
deadline of twice the turn allowance, but at least 15 seconds (`bjBetSeconds` in
[the rules](../shared/src/rules/blackjack.ts)), counted from the end of the previous hand's
settlement. At the deadline a missing human bet becomes the 10-chip minimum and is marked "Auto";
bots bet on their own. Hit/stand/double/split decisions use the ordinary turn clock, and each
deal refills every reserve.

Hold'em decisions use the ordinary turn clock and each hand refills every reserve. A human whose
time runs out checks when nothing is owed and otherwise folds; the bot strategy never stakes their
chips.

Presentation animations consume neither allowance nor reserve. Red Points' hand play
and flipped-card choice share one turn allowance, with animation time excluded.
Bridge bidding and redeal decisions also use the clock. A new deal refills reserves,
including every new Liar's Deck round.
Disconnecting does not pause the clock or change the existing reconnect window.
At expiry the server makes a legal decision using the same private view as the player;
control remains with the player on subsequent turns. Redeal timeout declines the redeal.
The seat shows an "Auto-played" badge until its next turn begins; a bot's seat shows
"Thinking…" while it is the bot's turn. Each seat plate has a single status slot, so when
several apply it shows Ninety-Nine bust, Liar's Deck death, or Hold'em "Out", then Big Two pass lock or Hold'em
"Folded"/"All-in", then thinking, then auto-played, then Chinese Poker "Arranged" or Blackjack "Bet placed".
Big Two forced passes retain their existing scheduler and do not consume decision time.
Their clock is published like any other turn, so other seats cannot tell a forced pass apart.

### Card controls

Bridge calls are chosen first and then confirmed: pick a level and suit (or Pass), then
press Confirm or choose the same call again; Cancel clears the choice. The bidding panel
overlays the table so its buttons stay at least 44px tall on touch screens, and it shows
the latest calls wherever the auction table sits in a closed info drawer.

Bridge, Ninety-Nine, and Red Points hand cards play with one mouse click or keyboard
activation. On touch, the first tap lifts and enlarges the card (and previews Red Points
captures); a second tap on the same card plays it, tapping another card moves the lift,
and tapping outside the hand clears it. Ninety-Nine keeps explicit
choices for plus/minus and the next player. Red Points plays immediately when there is
zero or one capture target; multiple matches require choosing a highlighted table card.
Red Points uses up to two rows of table cards, retaining one row when height is
insufficient for readable cards, and paginates crowded tables. Capture
highlights preserve the existing card order and current page; page buttons reveal the remaining table cards without scrolling the game page.
Each seat's red-point score is a button that lists every card that seat captured; the
tray beside the seat previews only the latest red cards, overlapping them to fit narrow seats.

Sevens plays legal cards like Ninety-Nine and Red Points. When no card is playable, every
hand card becomes selectable and covering needs a separate Cover button showing the card's
penalty, because a cover cannot be undone. Chinese Poker selects cards and places them into
the front, middle, or back row; a full arrangement shows each row's hand, and a fouled
arrangement must be confirmed twice.

Blackjack bets with chip buttons (10/20/50/100/200) and −/+ steps, then Bet; amounts above
the seat's limit are disabled. While betting, seat plates show "Bet placed" or, for bots,
"Thinking…", and the previous hand stays on the table. During play the acting hand is highlighted
and Hit/Stand/Double/Split follow the legal actions. The table, seat chips, and round history follow
the presentation, so a hole card, settlement, or next deal never appears before its frame.

Big Two uses individual card selection and Play/Pass, without quick-play suggestions.
Drag cards with a mouse or touch to arrange the hand; manual order is retained as turns
advance and played cards leave the hand. Sorting by rank or suit replaces the manual
order. With a card focused, Alt + Left/Right Arrow also moves it.
Dragging only reorders cards; clicking or tapping still toggles selection.
There is no double-click or global Enter-to-play shortcut; standard button accessibility remains.
Hand cards form a labelled group and stay focusable while unplayable (`aria-disabled`), and
a polite live region announces whose turn it is.

### Bots

While waiting, the host can add a bot to an empty seat, remove a bot, or fill every empty
seat with bots; members without a seat stay spectators. While no human is seated, the last
empty seat stays open for a player: a match needs a seated human, who can vote to end it.
Bots are always ready; the match starts once all four seats are occupied and the humans
are ready. Bots remain for the next match and support every game. Only humans can
host; the room is removed when its last human leaves.

Bots evaluate legal moves using only their own hand and public state. Scored move
candidates are selected randomly among near-best evaluations, weighted toward better choices; immediate Big Two
wins take priority over randomness. Randomness is injectable for reproducible tests.
They remain heuristic practice opponents without configurable difficulty or hidden-hand
search, and the evaluation scores do not guarantee optimal play.

| Game | Decision priorities |
| --- | --- |
| Bridge | Use the natural bidding heuristics below to describe hand strength and suit length, interpret a partner's public calls, and make bounded responses/rebids. Decline redeals. Use public played cards to identify established winners and opponents' voids; conserve trump/high cards and avoid overtaking a winning partner. |
| Big Two | Plan the smallest number of legal groups needed to shed the remaining hand, avoiding unnecessary splits of useful combinations. When responding, play any ordinary answer (no bomb or 2, and the rest of the hand still fits a minimal plan); passing is considered only when every answer would spend a bomb or 2 or split a planned combination, and it is weighed as keeping the plan but giving up tempo. Bombs and 2s are strongly conserved while opponents and the bot's own plan are far from finishing. Once any opponent holds 5 or fewer cards, 2s and bombs are no longer saved and the bot never passes by choice. When an opponent who has not passed this round holds one card, also favor blocking plays. Leads are always plays. Timed-out human Big Two turns use the same decision. |
| Red Points | Evaluate every legal capture, balancing immediate red points, future matches with the remaining hand, and the public table's exposure to unseen cards. |
| Ninety-Nine | Treat 4, 5, 10, J, Q, K and ♠A as rescue cards and keep them while number cards are safe, spending large number cards first. Compare both legal plus/minus choices and penalize leaving no card that fits the total expected when the bot acts again, more so in a duel. Model the next player's chance of being forced or eliminated only when the total is within 9 of 99, using unseen cards: the bot's own hand and public plays since the last reshuffle are excluded. Evaluate reverse/designation by who acts next and how many opponent turns pass before the bot acts again; near 99 it avoids shortening its own rotation. Pressure on the next player is discounted when that seat's latest play spent a rescue card while any number card was still safe, which suggests a hand without number cards. Randomize among similarly rated surviving designation targets. |
| Sevens | Must play: favor cards that continue into the bot's own cards and 7s of suits it holds many of; penalize opening directions it cannot follow, especially toward heavy cards. Must cover: weigh the card's penalty against own cards stranded beyond it, preferring cards an earlier cover already cut off. |
| Liar's Deck | Must call when it is the last seat holding cards. Otherwise score each option by the bot's own chance of dying on its next pull: calling risks a pull if the previous play was honest, estimated from the truths the bot cannot see (its own hand and plays this round are excluded, and earlier claims this round are assumed partly honest); lying risks a call that grows with the cards played and is certain when emptying the hand leaves one opponent holding cards. Small bonuses favor shedding cards and making an opponent pull. Honest plays spend non-joker truths first. |
| Blackjack | Play standard basic strategy for a dealer who stands on soft 17 and peeks, with doubling after splits and no surrender: split aces and eights, never tens or fives, and double soft and hard totals against weak up cards; when doubling is unavailable, fall back to hitting (or standing on soft 18). Bet a random 3–8% of the current chips in table steps. |
| Texas Hold'em | Preflop, score the hole cards with the Chen formula: raise premium hands to about 3 big blinds, call playable ones up to a few big blinds, limp marginal ones, and shove strong hands with 10 big blinds or less. After the flop, estimate equity by dealing random hands to each unfolded opponent and completing the board (150 runs). Equity times the players in the hand measures strength: strong hands bet or raise about 60% of the pot, playable hands call when the price is below their equity (more strength is required to commit half the stack), and occasional small bluffs are made against one or two opponents. Opponents are not modeled. |
| Chinese Poker | Search every non-fouled 3/5/5 split, estimating each row's chance of beating a random opponent's row, the row values, and sweep risk; choose among the closest top candidates. The "Auto arrange" button and deadline arrangements use the same search. |

The server waits for the previous presentation and a short thinking delay before each
bot action. Actions are saved before broadcast and resume after server restart. Existing
Big Two forced-pass timing still applies. Games with any bot are practice and do not enter
personal or public match history; their current state and result remain resumable.
Bots have no account profile or social/voice participation.

## Bridge

Deal a 52-card deck into four 13-card hands. Display suits ♠, ♥, ♣, ♦ and ranks
A down to 2. HCP is A=4, K=3, Q=2, J=1. A hand with no ace and HCP ≤4 may request
redeal. Check eligible players clockwise from the randomly selected auction starter;
accepting redeals all hands, declining checks the next player. Declined seats are not
asked again for the same deal; redealing clears that record.

Auction runs clockwise. A bid is level 1–7 plus ♣/♦/♥/♠/NT, or pass. Higher level
wins; equal levels rank NT > ♠ > ♥ > ♦ > ♣. Each non-pass must exceed the highest
bid. Four opening passes redeal; three consecutive passes after a bid end the auction.
The **last non-pass bidder** is declarer in this implementation. Its bid defines trump,
or none for NT. There is no double/redouble or standard dummy-hand mechanism.

Declarer's counterclockwise neighbor leads the first trick. Play runs clockwise;
follow the lead suit when possible, otherwise any card is legal. Highest trump wins,
or highest card of the led suit if no trump was played; rank A > K > … > 2.
The winner leads the next trick. Play all 13 tricks.
EW and NS are partners. Declarer's team wins with at least `6 + contract level` tricks;
otherwise defenders win. Results use this win condition rather than duplicate-Bridge
vulnerability/bonus scoring.

### Bot bidding agreements

Bots use a simplified natural system, implemented in
[`bridge-bidding.ts`](../server/src/bots/bridge-bidding.ts). They infer a partner's
minimum HCP, announced suit lengths, and balanced shape from the full public auction,
including calls before an opponent overcalls. Human calls are interpreted as estimates;
the server does not enforce these agreements on players or disclose private hands.

- Ordinary openings need 12 HCP; a major opening shows five cards. Minor openings
  prefer the longest eligible suit. After three opening passes, the fourth seat still
  makes a low opening with a weak hand to keep practice games moving.
- Balanced means 4333, 4432, or 5332. A 1NT opening shows 15–17 HCP; 2NT shows
  20–21. A 1NT overcall additionally needs a stopper in the opponent's announced suit.
- New-suit responses show four cards and at least six HCP at the one level or ten
  at the two level. Raises seek at least eight combined cards in a suit.
- Combined estimated strength limits contract height: NT invites at 23 HCP and bids
  3NT at 25; majors use 18/23/25 for levels 2/3/4; minors use 18/23/26/29 for 2/3/4/5.
  A 2NT response to 1NT is interpreted as an invitation with at least eight HCP.
- A bot can rebid when the partner's response establishes support or enough strength
  for NT. It stops repeating unsupported descriptions and does not explore slams.

## Big Two

Deal 13 cards each. Rank 2 > A > K > Q > J > 10 > … > 3; suit ♠ > ♥ > ♦ > ♣.
The holder of ♣3 leads every deal, and the first play must include ♣3. Play counterclockwise.
Responses must have the same size/type and beat the preceding play, except bombs.
Passing locks that player out until the round ends. Three opponents passed/locked grants
the last player a free lead and clears locks. No last-card announcement or compulsory
highest-single rule applies.

| Cards | Legal type | Comparison |
| --- | --- | --- |
| 1 | Single | Rank, then suit |
| 2 | Pair | Higher card |
| 5 | Straight | Ending card's rank, then its suit |
| 5 | Full house | Triple rank |
| 5 | Four-of-a-kind + kicker | Quad rank |
| 5 | Straight flush | Straight comparison |

Standalone triples, ordinary flushes, and four-card plays are illegal.
Straight order: A2345 < 23456 < 34567 < … < 910JQK < 10JQKA.
Compare the ending 5/6/…/A card, not another member; JQKA2/QKA23/KA234 are invalid.
Ordinary straights only beat straights; full houses only beat full houses.
Four-of-a-kind and straight flushes are bombs that beat any ordinary group, including
singles/pairs. Straight flush > four-of-a-kind; equal bomb types use their usual comparison.

A responding player with no legal play (including bombs) receives a server automatic
pass after the previous presentation plus one sampled integer delay of 0–5,000 ms
(inclusive), capped by the room's turn allowance so it never appears as a timeout.
No lock/turn/log changes appear before that committed pass. Manual pass is permitted
once presentation ends. Free leads are never auto-passed. Each forced pass has a separate
saved private deadline; restart preserves the sampled deadline and overdue work resumes
through the serialized runtime coordinator without browser participation.

A hand containing one of every rank 3 through 2 wins immediately (dragon).
Otherwise first empty hand wins. Each loser scores
`remaining cards × 2^(remaining twos)`; a dragon settles opponents' original hands
with the same formula. Scores do not accumulate across matches.

## Red Points

Four players receive six cards each; four cards face up on the table and 24 remain
in stock. Redeal if the opening table has at least three cards of one rank. Random
first player; counterclockwise turns.

A–9 capture a table card summing to 10 (ace=1); 10/J/Q/K capture only equal rank.
Each turn plays one hand card, then flips one stock card. Each card must capture one
matching table card if possible; choose when several matches exist. Without a match it
stays on the table. Captured pairs join that player's score pile. After all 24 stock
cards are flipped and hands exhausted, score the captured piles.

Only hearts/diamonds score: ace=20, 2–9=face value, 10/J/Q/K=10. The deck contains
208 red points; highest captured score wins, ties shared. Uncaptured table cards do
not add to a player's pile. Each match scores independently.

On your Red Points turn, hovering a hand card with a mouse or focusing it with the
keyboard previews its legal captures with a glow transition. The existing table order and current page stay unchanged. Previewing does not select, submit, or enable a
capture; clicking still follows the normal play/capture-choice rules.

## Ninety-Nine

Deal five cards each, remainder stock; total begins at zero. Random first player;
counterclockwise initially. Play one legal card, then replenish one. Total cannot exceed
99. When stock empties, reshuffle discards except the top card.

| Card | Effect |
| --- | --- |
| A | +1, except ♠A resets to zero |
| 2, 3, 6, 7, 8, 9 | Add face value |
| 4 | Reverse direction, unchanged total |
| 5 | Select another surviving player next, unchanged total |
| 10 | Choose +10 or −10; subtraction floors at zero |
| J | Pass, unchanged total |
| Q | Choose +20 or −20; subtraction floors at zero |
| K | Set total to 99 |

A player whose entire hand would exceed 99 is eliminated and discards its hand.
The next surviving player acts in the current direction with unchanged total.
Last survivor wins; reverse elimination order determines the remaining ranks.

## Sevens

Deal 13 cards each. The holder of ♠7 starts and must play ♠7; play continues
counterclockwise. Each suit forms one row from its 7: A…6 below and 8…K above, with A at
the low end and no wrap-around. A legal card is any 7, which opens its suit, or the card
directly below a row's lowest card or above its highest card.

The host can enable **Dragon Slaying (close suit on A or K)**, labelled **斬龍** in
Traditional Chinese, in a waiting Sevens room. It is off by default. When enabled,
playing either A or K closes that entire suit row immediately:
neither end accepts another card, while other suits remain playable. Closed rows are
marked on the table. Changing the option clears human readiness; the setting is fixed
for the match and survives server restarts. Legacy snapshots without the setting use
standard rules.

A player with any legal card must play one. Only a player with no legal card covers: they
place one chosen hand card face down. Other players see how many cards each seat has
covered, never which. After every card is played or covered, each seat's penalty is the
sum of its covered cards (A=1, 2–10 face value, J=11, Q=12, K=13), revealed at settlement.
The lowest penalty wins; ties share the win. Scores do not accumulate across matches.

## Chinese Poker

Deal 13 cards each. Every player arranges them at the same time into a front row of 3
and middle and back rows of 5, then confirms; a submitted arrangement is final and stays
hidden until all four have submitted. Players can sort the hand, move cards between rows,
or apply the same automatic arrangement the bots use before confirming.

| Rows | Hands, high to low |
| --- | --- |
| Middle, back | Straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card |
| Front | Three of a kind, pair, high card |

Ranks run A > K > … > 2; suits never break ties, so equal ranks tie. A2345 is the lowest
straight and 10JQKA the highest; straights do not wrap. A back row weaker than the middle,
or a middle weaker than the front, is a foul (倒水). The server accepts fouls; the client
warns and asks for a second confirmation.

Each pair of players compares row by row. The row's winner gains and the loser loses the
winner's row value: 1, except front three of a kind 3, middle full house 2, middle four of
a kind 8, middle straight flush 10, back four of a kind 4, and back straight flush 5. A foul
loses every row to a non-fouled opponent, who scores its own row values; two fouled players
score 0 against each other. Winning all three rows against one opponent (a sweep, 打槍)
doubles that pairing; sweeping all three opponents (home run, 全壘打) doubles those three
pairings again. Scores sum to zero; the highest score wins, ties shared. Special
declared hands (報到, such as a 13-card dragon or six pairs) are not used. Scores do not
accumulate across matches.

## Liar's Deck

Based on the Liar's Deck mode of *Liar's Bar*. The deck has 20 cards: six each of K, Q, and A
plus two jokers. Each player owns a revolver with one bullet in six chambers; the chamber is
chosen at random when the game starts and never resets, so the n-th trigger pull fires with
chance 1/(7 − n) and the sixth always fires. Trigger pull counts are public; bullet
positions never leave the server.

Each round deals five cards to every surviving seat and reveals a random table card from
K/Q/A. The table face and jokers are truths; any other card is a lie. A random seat opens
the first round; turns run counterclockwise and skip seats with empty hands. On a turn,
play one to three cards face down, claiming they all match the table card, or call LIAR on
the previous play. The opening play of a round cannot be called, and the only seat still
holding cards must call.

A call reveals only the previous play. If any revealed card is a lie, the seat that played it
pulls its trigger; otherwise the caller does. The pull resolves automatically and ends the
round. Unchallenged plays are never revealed, even after the game. A surviving shooter opens
the next round; if the shooter dies, the next surviving seat does. The last survivor wins and
earlier eliminations rank lower. Scores do not accumulate across matches.

Players select one to three hand cards and press Play, or press LIAR. Cards matching the
table card carry a check mark, and cards the player has already played this round are listed
below the hand. The table shows each seat's hand size and pulls (🔫 n/6) and keeps a pull's
outcome, the next round's cards, and eliminations hidden until their presentation frames.
Devil and Chaos variants are not implemented.

## Blackjack

The server is the dealer; each seat plays only against it. Every seat starts with 1000 chips,
which exist only within the match, and a match is eight hands. Each hand uses a freshly
shuffled 52-card deck; hands that stop at 21 or bust can never use it up.

Each hand opens with simultaneous betting (see [turn timer](#turn-timer)): 10–200 chips in steps
of 10, within the seat's chips. Bets stay hidden until the deal. A seat with fewer than 10 chips
sits out and only watches. The deal gives each bettor two face-up cards and the dealer one up
card and one face-down hole card. With an ace or ten-value up card the dealer checks the hole
card first: a dealer blackjack ends the hand at once, and only player blackjacks push.

Bettors then act in N, E, S, W order. Hit draws a card; stand ends the hand; double (first two
cards only) stakes the bet again and draws exactly one card; split (two cards of equal value,
once per seat) stakes the bet again and plays the two hands in order, each completed with one
new card at once. Split aces receive only that card. A split two-card 21 is not a blackjack.
Doubling and splitting require chips to cover the extra stake. Reaching 21, busting, and
naturals end a hand automatically. There is no insurance or surrender.

The dealer then reveals the hole card and draws while below 17, standing on every 17 including
soft 17; it does not draw when every hand has busted or is a blackjack. Blackjack pays 3:2, a win
1:1, and a push returns the bet. After the eighth hand, or once no seat can cover the minimum,
the most chips win, ties shared. Scores do not accumulate across matches.

## Texas Hold'em

No-limit Hold'em for the four seats. Every seat starts with 1000 chips, which exist only within
the match. Blinds start at 10/20 and rise every four hands to 15/30, 25/50, 40/80, and 60/120
([`HE_BLIND_LEVELS`](../shared/src/rules/holdem.ts)). The match ends once one seat holds every chip,
or after the twentieth hand; the most chips win, ties shared, and seats that lost every chip rank
by elimination order. Scores do not accumulate across matches.

A random seat holds the button for the first hand; it then moves clockwise to the next seat with
chips. Each hand is shuffled from a full deck and deals two private hole cards to every seat with
chips, starting left of the button. The next two seats post the small and big blinds; heads-up the
button posts the small blind. A seat short of a blind posts what it has and is all-in. There are
no antes and no burn cards.

Action runs clockwise. Preflop the seat after the big blind acts first and the big blind may still
raise when everyone has only called; on the flop (three cards), turn, and river (one card each)
the first unfolded seat after the button acts first. A seat may fold, check when nothing is owed,
call (all-in when short), or bet/raise to a street total of at least the current bet plus the
last raise increment (the big blind when nothing has been raised), up to all its chips. An all-in
below a full raise must be called but does not let seats that already acted raise again. Raising
is unavailable when every other seat is all-in. A street ends when every seat that can still act
has acted since the last full raise and matched the bet.

When one seat remains the pot goes to it without a showdown. When betting closes with at most one
seat able to act, the remaining board is dealt at once. At showdown every unfolded seat reveals its
hole cards and plays the best five of its seven cards, ranked as in
[Chinese Poker](#chinese-poker) (suits never break ties; A2345 is the lowest straight). Stakes form
a main pot and side pots by contribution level; each pot goes to the best eligible hand, split
evenly, with odd chips going clockwise from the button. Chips beyond what anyone else staked return
to their owner.

Players act with Fold, Check/Call, and a Bet/Raise control (slider, amount, and minimum, half-pot,
pot, and all-in shortcuts). The table shows the board, the pot and side pots, every seat's stake on
the street, the button and blinds, and revealed hands with their categories at showdown; it follows
the presentation, so the board, showdown, and the next hand's hole cards appear only with their
frames.
