# Game rules

Implemented house rules; tournament rules may differ. The server decides legality,
turns, and results.

- Standard seats N/E/S/W. Clockwise is N → E → S → W; counterclockwise is N → W → S → E.
- Seated players see only their own hand; [observers](#spectators-and-god-view) see more.

## Shared room lifecycle

| Stage | Behavior |
| --- | --- |
| Waiting | Everyone seated, including the host, can prepare at any player count. Readiness never starts a match; the host separately presses Start after all occupied seats are ready and the player count is valid |
| Player counts | Ninety-Nine, Blackjack, and Hold'em support 2–8 occupied seats; other games require N/E/S/W. At least one seated human is required. Empty configured seats do not block a flexible game |
| Extra seats | Flexible rooms can add P5/P6/P7/P8. Turn order continues after W and skips unoccupied seats; empty seats receive no cards, chips, turns, results, or history entries |
| Shuffle seats | Available for every game, off by default. At start, shuffle humans among their occupied positions; bots keep their standard seats and empty seats remain empty. Seat changes and the game commit together |
| Readiness | Sitting, standing, leaving, adding or removing bots, and option changes clear human readiness; changing only the Sevens effect keeps it |
| Finished | Each human returns with Continue; others keep the result until everyone returns or the next match starts |
| Leave or reconnect expiry | Leaving, or not reconnecting within 60 seconds, aborts an unfinished match |
| History | Completed human-only results persist separately from room state |

**Abort votes**

- Seated humans propose and vote; the proposer votes yes automatically. Bots never vote.
- Passing needs `min(3, seated humans)` votes, including humans in additional seats;
  a lone human ends the match immediately.
- A vote lasts 60 seconds. Starting one sets a three-minute cooldown that remains after
  failure or expiry. Success returns the room to waiting and clears the cooldown.

## Spectators and god view

- Up to [eight spectators](../shared/src/constants/game-rules.ts) besides the seats. Any
  member without a seat is a spectator; joining and invitations work during a match.
- While waiting, spectators may take an empty seat and seated humans may stand up.
- Spectators have no play or vote controls and leave via game info. Their departure never
  aborts a match; Continue dismisses their finished board.
- Observers choose which seat sits at the bottom (click a plate, avatar, or name, or focus
  it and press Enter or Space). This rotates only their view until they leave.

| Observer | God view |
| --- | --- |
| Spectator | All hands |
| Permanently eliminated player | All hands: Ninety-Nine bust, Liar's Deck death, Hold'em out of chips, house-dealer Blackjack unable to cover the minimum |
| Hold'em folded player | None |

- Observed hands appear face up beside each plate, in two overlapping rows when long.
  Blackjack dealer and Hold'em hole cards use dashed outlines.
- Stock order, bullet position, and undealt cards stay hidden from everyone.
- Sevens observers see every covered pile and penalty; seated players see only their own
  covers until settlement.
- Elimination grants god view, and switches chat and voice channels, only after its
  presentation frame ([timeline](architecture.md#presentation-timeline)).
- Observer chat (`audience: 'observers'`) reaches observers only. Seated players have
  their own channel and do not hear observers in voice; all chat becomes visible after settlement.

## Turn timer

| Clock | Rule |
| --- | --- |
| Default | A fresh 5 seconds per turn, then the player's 20-second reserve for the deal |
| Unused allowance | Never added to the reserve |
| Settings | Host only, while waiting: 1–300 seconds allowance plus 0–300 seconds reserve ([shared limits](../shared/src/time-control.ts)) |
| Display | Own plate shows allowance and reserve; others show allowance only while acting |
| Animations | Consume no time |
| Disconnect | Neither pauses clocks nor extends the reconnect window |
| New deal | Refills reserves, including each Liar's Deck round and each Blackjack or Hold'em hand |

| Game or stage | On timeout |
| --- | --- |
| Ordinary turns, Bridge bidding | A legal action chosen from the player's own view |
| Bridge redeal offer | Decline |
| Red Points | Hand play and flipped-card choice share one allowance |
| Chinese Poker | Everyone arranges at once within allowance + reserve, at least 60 seconds ([`cpArrangeSeconds`](../shared/src/rules/chinesepoker.ts)); missing hands use the bot's non-fouled search |
| Blackjack betting | Everyone bets at once within twice the allowance, at least 15 seconds ([`bjBetSeconds`](../shared/src/rules/blackjack.ts)); missing human bets become the minimum 10 |
| Hold'em | Check if nothing is owed, otherwise fold; never stakes a timed-out human's chips |
| Big Two forced passes | Separate scheduler that uses no decision time; the clock still looks ordinary |

- Shared-deadline countdowns show only on the owner's seat until submission.
- Timed-out humans keep control on later turns. "Auto-played" stays until their next turn;
  missing Blackjack bets show "Auto"; bots show "Thinking".
- Each plate shows one status, highest first: eliminated → passed/Folded/All-in →
  Thinking → Auto-played → Arranged/Bet placed.

Runtime mechanics: [architecture](architecture.md#turn-clocks).

## Card controls

| Game | Interaction |
| --- | --- |
| Bridge calls | Pick level and suit, or Pass, then Confirm or pick the same call again; Cancel clears |
| Bridge, Ninety-Nine, Red Points | Click or keyboard activation plays. On touch, the first tap lifts and the second plays; tapping another card switches, tapping outside clears |
| Ninety-Nine | Explicit plus/minus and next-player choices |
| Red Points | Zero or one capture target plays immediately; several require choosing a highlighted table card |
| Sevens | Legal cards play directly; when blocked, select a card and press the irreversible Cover button, which shows its penalty |
| Chinese Poker | Place cards into front, middle, back; full rows show hand types; fouls need double confirmation |
| Blackjack | Chip buttons 10/20/50/100/200 and −/+ steps, then Bet; Hit, Stand, Double, Split follow legality |
| Big Two | Select cards, then Play or Pass. No suggestions, double-click play, or Enter shortcut |

- Bridge bidding overlays the table with touch targets at least 44px tall; recent calls
  stay visible with the info drawer closed.
- Red Points uses up to two table rows (one when short) and paginates crowded tables.
  Score buttons list all captures; seat trays show the latest red cards.
- Blackjack plates show Bet placed or Thinking while betting; the previous hand stays
  visible. Cards, chips, and results appear only at their presentation frame.
- Big Two hands reorder by drag or focused Alt + Left/Right; the order survives turns.
  Rank or suit sort replaces it. Cards stay focusable with `aria-disabled`, and turn
  changes are announced politely.

## Bots

- While waiting, the host adds, removes, or fills bots. With no seated human the last
  empty seat stays open, because a human must be able to end the match.
- Bots play every game, are always ready, and stay for the next match. Only humans host;
  the room closes when the last human leaves.
- Bots use only their own hand and public state. Injectable randomness picks among
  weighted near-best moves; an immediate Big Two win always plays.
- They are heuristic practice opponents: no difficulty levels, hidden-hand search, or
  optimal play.
- Bots wait for presentation plus a short thinking delay, save before broadcast, and
  resume after restart. Matches with bots never enter history. Bots have no profile,
  friends, or voice.

| Game | Strategy |
| --- | --- |
| Bridge | Natural bidding ([agreements](#bot-bidding-agreements)); declines redeals; public winners and voids guide trump use and partner support ([code](../server/src/bots/bridge-strategy.ts)) |
| Big Two | Fewest remaining groups; prefers ordinary replies and saves bombs and 2s; never passes voluntarily when an opponent has ≤5 cards; blocks one-card opponents ([code](../server/src/bots/bigtwo-strategy.ts)) |
| Red Points | Weighs immediate red points, future hand matches, and exposure to unseen cards ([code](../server/src/bots/redpoints-strategy.ts)) |
| Ninety-Nine | Keeps rescue cards, spends larger safe numbers; weighs return risk, next-seat risk, direction, and public evidence ([code](../server/src/bots/ninetynine-strategy.ts)) |
| Sevens | Saves reachable penalties, keeps follow-ups, weighs dead-card covers, blocking, and A/K closure ([code](../server/src/bots/sevens-strategy.ts), [knowledge](../server/src/bots/sevens-knowledge.ts)) |
| Chinese Poker | Searches all non-fouled 3/5/5 splits by estimated row wins, values, and sweep risk; also used by Auto arrange and timeouts ([code](../server/src/bots/chinesepoker-strategy.ts)) |
| Liar's Deck | Balances death risk, estimated honesty, and challenge odds; sheds cards, prefers non-joker truths ([code](../server/src/bots/liarsdeck-strategy.ts)) |
| Blackjack | Basic strategy for stand-on-soft-17 with peek, double after split, no surrender; bets 3–8% at random; player dealers compare standing with expected draws ([code](../server/src/bots/blackjack-strategy.ts)) |
| Hold'em | Chen preflop score, ~3 BB premium raises, short-stack shoves; 150-run postflop equity, ~60% pot strong bets, price-aware calls, small bluffs; no opponent model ([code](../server/src/bots/holdem-strategy.ts)) |

**Strategy limits**

- Big Two passes only when replying would spend bombs or 2s or break the plan. Leads always
  play. Human timeouts use the same strategy.
- Ninety-Nine rescue cards are 4, 5, 10, J, Q, K, and ♠A. Risk near 99 counts unseen cards
  and plays since the last reshuffle (per copy with two decks); once the stock can run out,
  risks beyond the match end are ignored.
- Sevens estimates are approximate. Absence is inferred only from forced covers, never from
  a voluntary play. Closure exposure assumes each opponent gets at most one gate play per
  rotation. Spectator views and settlement results are never used.
- Liar's Deck: a call reveals only the previous play. Honesty estimates exclude the bot's
  own cards and partly trust earlier claims. Emptying a hand against one remaining
  opponent guarantees a call.
- Blackjack player-dealer estimates ignore prorated payouts when the dealer is short.

## Bridge

| Setup | Rule |
| --- | --- |
| Deal | 52 cards, 13 each |
| Display | Suits ♠ ♥ ♣ ♦; ranks A down to 2 |
| HCP | A=4, K=3, Q=2, J=1 |
| Redeal offer | A hand with no ace and HCP ≤ 4 |

1. Redeal offers go clockwise from a random auction starter. Accepting redeals all hands;
   declining passes the offer to the next eligible seat, for that deal only.
2. The auction runs clockwise: levels 1–7 in ♣ ♦ ♥ ♠ NT, or Pass. Each bid must be higher;
   at equal level NT > ♠ > ♥ > ♦ > ♣. Four opening passes redeal; three passes after a bid end it.
3. The **last non-pass bidder** is declarer and sets trump or NT. No double, redouble, or dummy.
4. Declarer's counterclockwise neighbor leads; play goes clockwise, following suit when
   possible. Highest trump wins, else highest card of the led suit; the winner leads next.
5. After 13 tricks, declarer's side wins with at least `6 + level` tricks; otherwise
   defenders win. No vulnerability or bonus scoring.

### Bot bidding agreements

A simplified natural [system](../server/src/bots/bridge-bidding.ts) used by bots only.
Bots estimate partner strength and shape from the whole public auction; human calls are
treated as estimates, never as hand disclosure.

| Agreement | Meaning |
| --- | --- |
| Opening | 12 HCP; a major shows five cards; a minor uses the longest eligible suit |
| Fourth seat | May open weak after three passes to keep practice moving |
| Balanced | 4333, 4432, 5332 |
| 1NT / 2NT opening | 15–17 / 20–21 HCP; a 1NT overcall also needs a stopper |
| New suit response | Four cards; ≥6 HCP at level one, ≥10 at level two |
| Suit raise | Aims for ≥8 combined cards |
| NT game | Invite at 23 combined HCP; 3NT at 25 |
| Major levels 2/3/4 | 18 / 23 / 25 combined HCP |
| Minor levels 2/3/4/5 | 18 / 23 / 26 / 29 combined HCP |
| 2NT over 1NT | Invitation, ≥8 HCP |

Bots rebid only with established support or NT strength, stop repeating unsupported
suits, and never explore slams.

## Big Two

- 13 cards each. Rank 2 > A > K > Q > J > 10 > … > 3; suit ♠ > ♥ > ♦ > ♣.
- The ♣3 holder leads each deal with a play containing ♣3; turns go counterclockwise.
- A reply must match size and type and beat the previous play, except bombs.
- Passing locks the seat for the round. When the three other seats have passed, the last
  player leads freely and locks clear.
- No last-card call or forced highest single.

| Cards | Type | Compared by |
| --- | --- | --- |
| 1 | Single | Rank, then suit |
| 2 | Pair | Higher card |
| 5 | Straight | Top card rank, then its suit |
| 5 | Full house | Triple rank |
| 5 | Four of a kind + kicker | Quad rank |
| 5 | Straight flush | As straights |

- Triples alone, plain flushes, and four-card plays are illegal.
- Straights rank A2345 < 23456 < … < 10JQKA by top card (5, 6, … A). JQKA2, QKA23, and
  KA234 are invalid.
- Straights and full houses beat only their own type. Bombs (four of a kind, straight
  flush) beat any ordinary play including singles and pairs; straight flush beats four of a kind.

**Forced passes**

- With no legal reply, including bombs, the seat passes automatically after the
  presentation plus a random 0–5,000 ms, capped below the turn allowance so it never
  looks like a timeout. The player can still pass manually; free leads never auto-pass.
- Nothing changes before the commit. Each pending pass saves its deadline, so restarts
  keep the same delay and overdue passes resolve without a browser.

**Settlement**

- A hand with one card of every rank from 3 to 2 wins immediately (dragon); otherwise the
  first empty hand wins.
- Each loser scores `remaining cards × 2^(remaining 2s)`; against a dragon, losers count
  their full original hands. Scores do not carry between matches.

## Red Points

| Item | Rule |
| --- | --- |
| Deal | Six each, four on the table, 24 in stock; redeal if three or more table cards share a rank |
| Turns | Random starter, counterclockwise |
| A–9 capture | Sum to 10 (ace = 1) |
| 10, J, Q, K capture | Same rank only |
| Scoring | Captured hearts and diamonds only: ace 20, 2–9 face value, 10–K 10; deck total 208 |
| Winner | Highest score, ties shared |

1. Play a hand card, then flip the top stock card.
2. Each card must capture a matching table card if one exists (choose when several match).
   Unmatched cards stay on the table; captured pairs go to the player's pile.
3. When stock and hands are empty, score the piles. Table cards score nothing.

Hovering or focusing a card highlights its legal captures without selecting anything.

## Ninety-Nine

- Five cards each, the rest as stock, running total 0. Random starter, initially counterclockwise.
- Play a legal card, then draw one. The total may never exceed 99.
- An empty stock reshuffles all discards except the top card (unless two decks are used).

| Card | Effect |
| --- | --- |
| A | +1; ♠A resets the total to 0 |
| 2, 3, 6, 7, 8, 9 | Add face value |
| 4 | Reverse direction |
| 5 | Choose any surviving seat to go next |
| 10 | Choose +10 or −10 (floored at 0) |
| J | Pass |
| Q | Choose +20 or −20 (floored at 0) |
| K | Set the total to 99 |

- A seat with no legal card is eliminated and discards its hand; the next survivor plays
  on the same total. The last survivor wins; others rank in reverse elimination order.

**Two decks, no reshuffle (雙副牌不重洗)**

- Off by default; legacy snapshots use one deck. Fixed for the match and kept across restarts.
- Two shuffled 52-card decks, so duplicates are possible; everything else is unchanged.
- The stock never reshuffles. Drawing the last stock card ends the match: survivors tie
  for first and eliminated seats keep their ranks.
- The stock is labelled as no-reshuffle. Ties use `winners`, single wins `winnerSeat`
  ([result type](../shared/src/types/game.ts)).

## Sevens

- 13 cards each. The ♠7 holder starts with ♠7; play goes counterclockwise.
- Each suit grows from its 7: down to A, up to K, no wrap-around. A legal play is any 7,
  or a card next to a row's current low or high end.
- A player who can play must. Otherwise they cover one chosen card face down; others see
  only the count.
- At settlement, covers are revealed and penalties summed: A=1, 2–10 face value, J=11,
  Q=12, K=13. Lowest total wins, ties shared.

**Dragon Slaying (斬龍)**

- Off by default; host option while waiting, fixed for the match, kept across restarts.
- Playing a suit's A or K closes the whole suit at both ends; other suits stay open. The
  row stays darkened afterwards and the next turn waits for the effect.
- Effects: **Dragon** (default, 2.2 s overhead dragon, fire, and blade) or **Fire only**
  (火焰, 1.7 s). Neither shows text; reduced motion shows a still frame.

When all four suits are closed:

1. All remaining hands are covered at once in turn order, with normal penalties. These
   log entries are marked `auto`.
2. After the last closing effect, the table collapses (1.8 s) and holds (2 s).
3. The result dialog opens over the broken table.

## Chinese Poker

- 13 cards each. Everyone arranges at once into front 3, middle 5, back 5, by hand, by
  sorting, or with Auto arrange (the bot search).
- Submissions are final and hidden until all four are in.
- Rank A > K > … > 2; suits never break ties. A2345 is the lowest straight and 10JQKA the
  highest; no wrap-around.
- A back weaker than the middle, or a middle weaker than the front, is a foul (倒水). The
  server accepts it; the client asks twice.

| Row | Hands, high to low |
| --- | --- |
| Middle, back | Straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card |
| Front | Three of a kind, pair, high card |

**Scoring** (pairwise against each opponent)

| Winning row hand | Points (otherwise 1) |
| --- | --- |
| Front three of a kind | 3 |
| Middle full house / four of a kind / straight flush | 2 / 8 / 10 |
| Back four of a kind / straight flush | 4 / 5 |

- Per row, the winner gains and the loser loses the winning hand's points.
- A fouled hand loses every row to a clean opponent at the opponent's values; two fouls score 0.
- Sweep (打槍): winning all three rows against one opponent doubles that pairing.
  Home run (全壘打): sweeping all three opponents doubles those pairings again.
- Zero-sum; highest total wins, ties shared. No special declared hands (報到).

## Liar's Deck

Based on the Liar's Deck mode of *Liar's Bar*; Devil and Chaos variants are not implemented.

| Item | Rule |
| --- | --- |
| Deck | 20 cards: six each of K, Q, A, plus two jokers |
| Revolver | One bullet in six chambers, fixed at random for the whole game |
| Trigger odds | The n-th pull fires with probability `1/(7 − n)`; the sixth always fires |
| Visibility | Pull counts are public; bullet positions stay on the server |
| Round | Five cards per survivor and a random table face (K, Q, or A); matching cards and jokers are truthful |

1. A random seat starts the first round; turns go counterclockwise, skipping empty hands.
2. On a turn, play 1–3 cards face down claiming the table face, or call LIAR on the
   previous play. The round's first play cannot be called; the only seat with cards left must call.
3. Only the challenged play is revealed. Any lie makes its player pull the trigger;
   otherwise the caller pulls. The round then ends. Unchallenged cards are never revealed.
4. The shooter opens the next round, or the next survivor if the shooter died.
5. The last survivor wins; earlier deaths rank lower.

The table shows Play and LIAR buttons, matching-card checks, the player's own played cards,
hand sizes, and pull counts. Outcomes wait for their presentation frames.

## Blackjack

| Item | Rule |
| --- | --- |
| Opponent | House dealer by default; each seat plays only against it |
| Chips | 1,000 per seat, reset every match |
| Match | Eight hands; a freshly shuffled 52-card deck for 2–4 players, two decks for 5–8 players |
| Bet | Simultaneous, 10–200 in steps of 10 within chips, hidden until the deal ([timer](#turn-timer)) |
| Under 10 chips | Watches only |

1. Bettors get two face-up cards; the dealer gets an up card and a hidden hole card.
2. With an ace or ten-value up card the dealer peeks; a dealer blackjack ends the hand,
   and only player blackjacks push.
3. Bettors act in occupied-seat order N, E, S, W, P5, P6, P7, P8. Reaching 21, busting, or a natural ends a hand automatically.
4. The dealer reveals and hits below 17, standing on every 17 including soft 17. No draws
   if every hand busted or is a blackjack.
5. Settle. After hand eight, or when no seat can cover the minimum, most chips wins (ties shared).

| Action | Rule |
| --- | --- |
| Hit, Stand | Draw a card, or finish |
| Double | First two cards only; stake again and draw exactly one |
| Split | Equal-value pair, once per seat; stake again and play two hands in order, each first dealt a second card |
| Split aces | One card each; a split 21 is not blackjack |
| Payout | Blackjack 3:2, win 1:1, push returns the stake |
| Not supported | Insurance, surrender |

### Player dealer

- Host option while waiting (off by default).
- A random seat deals first, then the deal rotates clockwise over occupied seats for two
  full rotations (`2 × occupied seats` hands).
- The dealer does not bet. Its hole card is hidden from other seats until the reveal
  (observers see it). House peek, payout, double, and split rules still apply.
- After players finish, the dealer acts unless it has blackjack or every player hand busted
  or is blackjack. Below 17 it must hit; from 17 it may hit or stand; 21 or bust ends the
  turn. Timeouts follow house strategy.

**Settlement**

1. Net losses go to the dealer's pool; pushes return stakes.
2. Net wins (1:1, blackjack 3:2) are paid from the dealer's chips plus the pool.
3. If that is not enough, winnings are prorated and rounded down, leftovers go clockwise
   from the dealer's left, and the dealer ends at 0 ([payout rule](../shared/src/rules/blackjack.ts)).

Seats under 10 chips cannot bet but still deal, even at 0; nobody is eliminated. The match
ends after the last hand, or when fewer than two seats can cover the minimum.

## Texas Hold'em

| Item | Rule |
| --- | --- |
| Format | No-limit, two to eight occupied seats, 1,000 chips each, reset every match |
| Blinds | 10/20 → 15/30 → 25/50 → 40/80 → 60/120, rising every four hands ([levels](../shared/src/rules/holdem.ts)) |
| End | One seat holds all chips, or hand 20 finishes; most chips wins, ties shared |
| Ranking | Eliminated seats rank by the order they lost all chips |

**Deal and betting**

- A random occupied seat gets the button, which then moves clockwise to seats with chips.
- Each hand uses a fresh deck: two private cards per funded seat, dealt from the button's left.
- The next two seats post blinds; heads-up, the button posts the small blind. A short
  blind is all-in. No antes or burn cards.
- Action goes clockwise. Preflop starts after the big blind, who may raise when everyone
  calls. The flop (3 cards), turn, and river (1 each) start from the first unfolded seat
  after the button.

| Action | Rule |
| --- | --- |
| Fold | Leave the hand |
| Check | Only when nothing is owed |
| Call | Match the bet; all-in when short |
| Bet or raise | To at least the current bet plus the last full raise (initially the big blind), up to all chips |
| Short all-in raise | Must be called, but does not reopen raising for seats that already acted |
| Everyone else all-in | No raising |
| Street ends | Every actionable seat has acted since the last full raise and matched the bet |

**Showdown**

- If one seat remains, it wins without showdown. If at most one seat can still act, the
  rest of the board is dealt at once.
- Showdown uses the best five of seven cards with [Chinese Poker ranking](#chinese-poker):
  no suit ties, A2345 lowest straight.
- Contribution levels form main and side pots; the best eligible hands split each pot, odd
  chips going clockwise from the button. Uncalled chips return to their owner.
- Controls: Fold, Check/Call, Bet/Raise with slider or amount, and minimum, half-pot, pot,
  and all-in shortcuts.
- Board, pots, stakes, button, blinds, and showdown categories appear with their
  presentation frames; next-hand cards never appear early.
