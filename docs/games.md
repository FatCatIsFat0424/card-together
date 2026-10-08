# Game rules

These are the implemented house rules, not a claim of standard tournament rules.
Four players occupy N/E/S/W. Clockwise is N → E → S → W; counterclockwise is
N → W → S → E. The server controls legality, turns, and results; private hands are
visible only to their owner.

## Shared room lifecycle

A host chooses the game while waiting. Four occupied, ready seats start a match.
After scoring, continue returns to readiness. Leaving or failing to reconnect within
60 seconds aborts an unfinished match. Seated players can propose/vote to abort an
active game. Three yes votes out of four pass; with bots, the threshold is the smaller
of three and the number of human players. Bots do not vote; the starter votes yes
automatically, so a solo human can end the game immediately.
Votes last 60 seconds. Starting a proposal sets a three-minute cooldown; failed or
expired votes retain that cooldown. A successful vote returns the room to waiting
and clears the cooldown, allowing an immediate proposal in the next match.
Match history retains completed results independently
of current-room public action history.
Server presentation deadlines briefly gate actions between turns; see
[architecture](architecture.md#presentation-timeline).

### Turn timer

The default is **5 + 20 seconds**: each player gets a fresh five seconds each turn,
then draws from their own twenty-second reserve for the deal. Unused turn time is
not added to the reserve. While waiting, the host can change the turn allowance and
reserve within the [shared limits](../shared/src/time-control.ts); changing settings
clears human readiness. All players see the current settings; only their own reserve is displayed.

Presentation animations consume neither allowance nor reserve. Red Points' hand play
and flipped-card choice share one turn allowance, with animation time excluded.
Bridge bidding and redeal decisions also use the clock. A new deal refills reserves.
Disconnecting does not pause the clock or change the existing reconnect window.
At expiry the server makes a legal decision using the same private view as the player;
control remains with the player on subsequent turns. Redeal timeout declines the redeal.
Big Two forced passes retain their existing scheduler and do not consume decision time.

### Card controls

Bridge and ordinary Ninety-Nine cards play with one click/tap. Ninety-Nine keeps explicit
choices for plus/minus and the next player. Red Points plays immediately when there is
zero or one capture target; multiple matches require choosing a highlighted table card.
Red Points uses up to two rows of table cards, retaining one row when height is
insufficient for readable cards, and paginates crowded tables. Capture
highlights preserve the existing card order and current page; page buttons reveal the remaining table cards without scrolling the game page.

Big Two uses individual card selection and Play/Pass, without quick-play suggestions.
Drag cards with a mouse or touch to arrange the hand; manual order is retained as turns
advance and played cards leave the hand. Sorting by rank or suit replaces the manual
order. With a card focused, Alt + Left/Right Arrow also moves it.
Dragging only reorders cards; clicking or tapping still toggles selection.
There is no double-click or global Enter-to-play shortcut; standard button accessibility remains.

### Bots

While waiting, the host can add a bot to an empty seat, remove a bot, or fill available
capacity with bots. Room members who have not selected a seat still reserve capacity.
Bots are always ready; the match starts once all four seats are occupied and the humans
are ready. Bots remain for the next match and support all four games. Only humans can
host; the room is removed when its last human leaves.

Bots evaluate legal moves using only their own hand and public state. Scored move
candidates are selected randomly among near-best evaluations, weighted toward better choices; immediate Big Two
wins take priority over randomness. Randomness is injectable for reproducible tests.
They remain heuristic practice opponents without configurable difficulty or hidden-hand
search, and the evaluation scores do not guarantee optimal play.

| Game | Decision priorities |
| --- | --- |
| Bridge | Use the natural bidding heuristics below to describe hand strength and suit length, interpret a partner's public calls, and make bounded responses/rebids. Decline redeals. Use public played cards to identify established winners and opponents' voids; conserve trump/high cards and avoid overtaking a winning partner. |
| Big Two | Plan the smallest number of legal groups needed to shed the remaining hand, avoiding unnecessary splits of useful combinations. Conserve strong cards/bombs normally, and favor blocking plays when an opponent has one card left. |
| Red Points | Evaluate every legal capture, balancing immediate red points, future matches with the remaining hand, and the public table's exposure to unseen cards. |
| Ninety-Nine | Compare both legal plus/minus choices, balance pressure against remaining rescue cards and short-handed risk, and evaluate reverse/designation using public living seats and hand counts. Randomize among similarly rated surviving designation targets. |

The server waits for the previous presentation and a short thinking delay before each
bot action. Actions are saved before broadcast and resume after server restart. Existing
Big Two forced-pass timing still applies. Completed games with bots appear in human
participants' history; bots have no account profile or social/voice participation.

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
(inclusive).
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
