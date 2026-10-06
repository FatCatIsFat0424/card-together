# Game rules

These are the implemented house rules, not a claim of standard tournament rules.
Four players occupy N/E/S/W. Clockwise is N → E → S → W; counterclockwise is
N → W → S → E. The server controls legality, turns, and results; private hands are
visible only to their owner.

## Shared room lifecycle

A host chooses the game while waiting. Four occupied, ready seats start a match.
After scoring, continue returns to readiness. Leaving or failing to reconnect within
60 seconds aborts an unfinished match. Seated players can propose/vote to abort an
active game. Three yes votes out of four pass; the starter votes yes automatically.
Votes last 60 seconds, with a three-minute cooldown between proposals. A successful
vote returns the room to waiting. Match history retains completed results independently
of current-room public action history.
Server presentation deadlines briefly gate actions between turns; see
[architecture](architecture.md#presentation-timeline).

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
pass after the previous presentation plus one sampled integer delay of 0–3,000 ms.
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
