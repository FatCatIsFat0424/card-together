# Game rules

Implemented house rules; tournament rules may differ.

- Four seats: N/E/S/W. Current rooms require all four to start; Blackjack/Hold'em
  rules can also represent two- or three-seat games.
- Clockwise: N → E → S → W; counterclockwise: N → W → S → E.
- The server decides legality, turns and results. Playing seats see only their own hands;
  observer exceptions are described below.

## Shared room lifecycle

| Stage | Behavior |
| --- | --- |
| Waiting | Host selects the game; all modes require four configured, occupied, ready seats and no additional seats to start |
| Blackjack/Hold'em rules | Can represent two to four occupied seats ([constants](../shared/src/constants/game-rules.ts)); current [room startup](../server/src/managers/room-manager.ts) still requires four |
| Empty flexible seat | No chips, cards, turn, button, blind, result or history entry |
| Flexible seat changes | Sitting/standing/leaving or adding/removing bots clears human readiness |
| Finished | Humans return individually with Continue; others retain the result until everyone returns or the next match starts |
| Leave/reconnect expiry | Leaving or failing to reconnect within 60 seconds aborts an unfinished match |
| History | Completed results persist independently of room action history |

**Abort votes**

- Seated humans may propose/vote; bots never vote. The starter automatically votes yes.
- Threshold: three of four, or `min(3, seated humans)` with bots/empty seats; a solo human can end immediately.
- Votes last 60 seconds. Starting one sets a three-minute cooldown, retained after failure/expiry.
- Success returns the room to waiting and clears cooldown, including for the next match.

### Spectators and god view

**Room membership and perspective**

- Up to [eight spectators](../shared/src/constants/game-rules.ts), in addition to seats.
  Members without seats are spectators; joining/invites work during a match.
- While waiting, spectators may sit in an empty seat and seated humans may stand.
- Spectators start at South, have no play/vote controls, and can Leave via game info.
  Their departure/disconnection never aborts a match; Continue dismisses their finished board.
- Click a plate/avatar/name, or focus the plate and press Enter/Space, to choose the bottom seat
  and enlarge its hand. Content/presentation rotate locally; actual seats/permissions do not change.
- Perspective works for empty hands and lasts until leaving. Seated/eliminated players keep
  their own perspective; covered-card badges still open pile details.

| Observer | God-view access |
| --- | --- |
| Spectator | All seat hands |
| Permanently eliminated player | Ninety-Nine bust, Liar's Deck death, Hold'em out of chips, house-Blackjack unable to cover minimum |
| Hold'em folded player | No god view |

- Hands appear face up beside plates (two overlapping rows for long hands).
  Blackjack dealer/Hold'em hole cards use dashed outlines.
- Stock order, bullets and undealt cards remain hidden.
- Sevens observers see all covered piles/penalties and can inspect each covered-count badge;
  active seats see only their own covers until settlement.
- Previous hands/covers remain during presentation; elimination access starts after its frame.
- Observer messages use `audience: 'observers'` and reach observers only. Active seats have
  their own channel and stop hearing observers in voice; full chat becomes visible after settlement.
- Elimination switches channels only after presentation. See [presentation timing](architecture.md#presentation-timeline).

### Turn timer

| Clock | Rule |
| --- | --- |
| Default | Fresh 5 seconds per turn, then the player's 20-second deal reserve |
| Unused allowance | Never added to reserve |
| Host changes | Waiting only, within [shared limits](../shared/src/time-control.ts); clears human readiness |
| Display | Own plate always shows turn + own reserve; other plates show allowance only while acting |
| Animations | Consume neither allowance nor reserve |
| Disconnect | Does not pause clocks or extend reconnect time |
| New deal | Refills reserves, including each Liar's Deck round |

| Game/stage | Deadline and timeout action |
| --- | --- |
| Ordinary turns, Bridge bidding/redeal | Private-view legal decision; redeal timeout declines |
| Red Points | Hand play and flipped-card choice share an allowance, excluding animations |
| Chinese Poker | All arrange together: allowance + reserve, minimum 60 seconds ([`cpArrangeSeconds`](../shared/src/rules/chinesepoker.ts)); missing arrangements use the non-fouled bot search |
| Blackjack betting | All bet together: twice allowance, minimum 15 seconds ([`bjBetSeconds`](../shared/src/rules/blackjack.ts)); starts after prior settlement; missing human bets become minimum 10 |
| Blackjack decisions | Ordinary turn clock; each deal refills reserves |
| Hold'em | Ordinary turn clock/refill each hand; timeout checks if nothing owed, otherwise folds; bot strategy never stakes timed-out humans' chips |
| Big Two forced passes | Separate scheduler; no decision time consumed, but ordinary-looking clock remains public |

- Shared-deadline countdowns appear only on the owner's seat until submission.
- Humans regain control on subsequent turns. Auto-played persists until the next turn;
  bots show Thinking while acting. Missing Blackjack bets show Auto.
- One status slot per plate, highest priority first:
  eliminated → pass lock/Folded/All-in → Thinking → Auto-played → Arranged/Bet placed.

### Card controls

| Game | Interaction |
| --- | --- |
| Bridge calls | Pick level/suit or Pass, then Confirm or select the same call again; Cancel clears |
| Bridge/Ninety-Nine/Red Points | Mouse click or keyboard activation plays; touch lifts first, second tap plays; another card changes selection, outside tap clears |
| Ninety-Nine | Explicit plus/minus and next-player choices |
| Red Points | Zero/one target plays immediately; multiple targets require a highlighted table-card choice |
| Sevens | Legal cards play directly; when blocked, select any card then use the irreversible Cover button with its penalty |
| Chinese Poker | Place selected cards in front/middle/back; full rows show hand types; fouls require double confirmation |
| Blackjack | Chip buttons 10/20/50/100/200 and −/+ steps, then Bet; over-limit values disabled; Hit/Stand/Double/Split follow legality |
| Big Two | Select cards then Play/Pass; no quick-play suggestions, double-click or global Enter shortcut |

**Layout and accessibility**

- Bridge bidding overlays the table with touch targets at least 44px tall; latest calls stay
  visible when the auction's info drawer is closed.
- Red Points table: up to two rows, one when height is insufficient; crowded tables paginate.
  Capture highlights preserve order/page. Score buttons list all captures; overlapping seat trays show latest red cards.
- Blackjack: betting plates show Bet placed/Thinking; prior hand stays visible. Acting hand is
  highlighted; cards, chips, settlement and history reveal only at their presentation frame.
- Big Two: mouse/touch drag or focused Alt + Left/Right reorders; order survives turns/removals.
  Rank/suit sort replaces it; click/tap still toggles selection. Cards stay focusable with
  `aria-disabled`; labelled hand group and polite turn announcements remain accessible.

### Bots

- Waiting host may add/remove bots or fill empty seats; unseated members remain spectators.
- With no seated human, the final empty seat stays open. A match needs a seated human who can end it.
- Bots support all games, are always ready and remain for the next match. Only humans host;
  the room disappears when its last human leaves.
- Inputs: own hand and public state only. Injectable randomness selects weighted near-best
  candidates; immediate Big Two wins override randomness.
- Heuristic practice opponents: no difficulty settings, hidden-hand search or optimal-play guarantee.
- Wait for presentation plus a short thinking delay; save before broadcast and resume after restart.
  Existing Big Two forced-pass timing remains separate.
- Bot matches keep resumable state/results but never enter public/personal history.
  Bots have no account profile or social/voice participation.

| Game | Strategy summary and authoritative implementation |
| --- | --- |
| Bridge | Natural bidding/partner calls; decline redeals; public winners/voids guide trump conservation and partner support ([strategy](../server/src/bots/bridge-strategy.ts)) |
| Big Two | Minimal remaining groups; ordinary replies preferred, bombs/2s conserved; no voluntary pass when any opponent has ≤5 cards; block active one-card opponents ([strategy](../server/src/bots/bigtwo-strategy.ts)) |
| Red Points | Compare captures by immediate red points, future hand matches and unseen-card exposure ([strategy](../server/src/bots/redpoints-strategy.ts)) |
| Ninety-Nine | Preserve rescue cards, spend larger safe numbers; compare return/next-seat risk, rotation and public evidence of no number cards ([strategy](../server/src/bots/ninetynine-strategy.ts)) |
| Sevens | Save reachable penalties, maintain follow-ups, infer absence only from forced covers; compare dead-card covers/blocking and A/K closure exposure ([strategy](../server/src/bots/sevens-strategy.ts), [knowledge](../server/src/bots/sevens-knowledge.ts)) |
| Liar's Deck | Balance next-pull death risk, estimated honesty and challenge probability; shed cards, prefer non-joker truths, force calls when required ([strategy](../server/src/bots/liarsdeck-strategy.ts)) |
| Blackjack | Basic strategy: soft-17 stand/peek, double after split, no surrender; random 3–8% bets; player dealers compare standing with unseen-card draw expectation ([strategy](../server/src/bots/blackjack-strategy.ts)) |
| Hold'em | Chen preflop scoring, ~3-BB premium raises/short-stack shoves; 150-run postflop equity, ~60%-pot strong bets, price-aware calls and small bluffs; no opponent model ([strategy](../server/src/bots/holdem-strategy.ts)) |
| Chinese Poker | Search all non-fouled 3/5/5 splits; estimate row wins/values and sweep risk; Auto arrange/deadline use the same search ([strategy](../server/src/bots/chinesepoker-strategy.ts)) |

**Strategy boundaries**

- Big Two passes only when replies spend bombs/2s or break a minimal plan, trading tempo for
  preservation. Leads always play; human timeout decisions use the same strategy.
- Ninety-Nine rescue cards: 4/5/10/J/Q/K/♠A. Near-99 risk uses unseen cards/public plays since
  reshuffle (per-copy with two decks); stock exhaustion suppresses risks beyond match end.
- Sevens estimates are approximate, not exact hidden-card distributions or measured win rates.
  Counts include hidden covers; closure exposure gives each opponent at most one gate play per
  counterclockwise rotation, conservatively assuming use. Blocking benefit is shared across opponents.
- Sevens excludes spectator hands/covers and settlement results; voluntarily choosing another
  play never proves a card absent.
- Liar's Deck calls reveal only the previous play. Honesty estimates exclude own cards/plays
  and partially trust earlier claims; emptying a hand with one opponent remaining guarantees a call.
- Blackjack player-dealer expectation ignores short-bank proportional payout effects.

## Bridge

| Setup | Rule |
| --- | --- |
| Deal | 52 cards, four hands of 13 |
| Display | Suits ♠/♥/♣/♦; ranks A down to 2 |
| HCP | A=4, K=3, Q=2, J=1 |
| Redeal eligibility | No ace and HCP ≤4 |

- Check redeal offers clockwise from a random auction starter. Acceptance redeals all hands;
  decline checks the next eligible seat and is remembered for that deal only.
- Auction runs clockwise: level 1–7 with ♣/♦/♥/♠/NT or Pass. Bids must increase;
  equal-level order is NT > ♠ > ♥ > ♦ > ♣.
- Four opening passes redeal; three passes after a bid finish the auction.
- **Last non-pass bidder** is declarer, determining trump/NT; no double/redouble or standard dummy.
- Declarer's counterclockwise neighbor leads. Play clockwise, following suit when possible.
  Highest trump wins, otherwise highest led-suit card (A > K > … > 2); winner leads next.
- After 13 tricks, declarer's NS/EW team wins with at least `6 + contract level` tricks;
  otherwise defenders win. No duplicate-Bridge vulnerability/bonus scoring.

### Bot bidding agreements

Simplified natural [bidding system](../server/src/bots/bridge-bidding.ts), not enforced on humans.
Bots infer partner minimum HCP, suit lengths and shape from the full public auction, including
calls before an overcall; human calls are estimates, never private-hand disclosure.

| Call/agreement | Estimate |
| --- | --- |
| Ordinary opening | 12 HCP; major shows five cards; minor prefers longest eligible suit |
| Fourth-seat exception | Weak low opening after three passes keeps practice moving |
| Balanced shape | 4333, 4432, 5332 |
| 1NT / 2NT opening | 15–17 / 20–21 HCP; 1NT overcall also needs a stopper |
| New-suit response | Four cards; ≥6 HCP at level one, ≥10 at level two |
| Suit raise | Seek ≥8 combined cards |
| Combined NT strength | Invite at 23 HCP; 3NT at 25 |
| Combined major strength | 18/23/25 HCP for levels 2/3/4 |
| Combined minor strength | 18/23/26/29 HCP for levels 2/3/4/5 |
| 2NT response to 1NT | Invitation, ≥8 HCP |

Rebid only with established support/NT strength; stop repeating unsupported descriptions.
No slam exploration.

## Big Two

- Deal 13 each; rank 2 > A > K > Q > J > 10 > … > 3; suit ♠ > ♥ > ♦ > ♣.
- ♣3 holder leads every deal with a play containing ♣3; turns run counterclockwise.
- Replies match size/type and beat the preceding play, except bombs.
- Passing locks the seat for that round; three other seats passed/locked grants a free lead and clears locks.
- No last-card announcement or compulsory highest-single rule.

| Cards | Legal type | Comparison |
| --- | --- | --- |
| 1 | Single | Rank, then suit |
| 2 | Pair | Higher card |
| 5 | Straight | Ending rank, then that card's suit |
| 5 | Full house | Triple rank |
| 5 | Four-of-a-kind + kicker | Quad rank |
| 5 | Straight flush | Straight comparison |

- Standalone triples, ordinary flushes and four-card plays are illegal.
- Straights: A2345 < 23456 < 34567 < … < 910JQK < 10JQKA; compare ending 5/6/…/A.
  JQKA2/QKA23/KA234 are invalid. Ordinary straights/full houses beat only their own type.
- Bombs beat all ordinary groups, including singles/pairs. Straight flush > four-of-a-kind;
  equal bomb types use normal comparison.

**Forced passes**

- No legal reply, including bombs: auto-pass after presentation plus a sampled integer
  0–5,000 ms, capped by turn allowance so it does not appear as a timeout.
- No lock/turn/log change before commit. Manual pass works after presentation; free leads never auto-pass.
- Each pass saves its private deadline. Restart preserves the sample; overdue work resumes
  through the serialized runtime coordinator without browser participation.

**Settlement**

- One card of every rank 3 through 2 is an immediate dragon win; otherwise first empty hand wins.
- Loser score: `remaining cards × 2^(remaining twos)`; dragons score original opponent hands.
- Scores do not accumulate between matches.

## Red Points

| Setup/scoring | Rule |
| --- | --- |
| Deal | Six each, four table cards, 24 stock cards; redeal if ≥3 opening table cards share a rank |
| Turns | Random starter, counterclockwise |
| A–9 capture | Sum to 10; ace=1 |
| 10/J/Q/K capture | Same rank only |
| Red score | Hearts/diamonds only: ace=20, 2–9 face value, 10/J/Q/K=10; deck total 208 |
| Winner | Highest captured score, ties shared; no cross-match accumulation |

1. Play a hand card, then flip one stock card.
2. Each must capture one matching table card if available; choose among multiple targets.
   Unmatched cards stay on the table; pairs join the acting player's pile.
3. Exhaust stock and hands, then score captured piles. Uncaptured table cards score nothing.

Hover/focus previews legal captures with a glow, preserving table order/page. It does not
select, submit or enable a capture; normal click/capture-choice controls still apply.

## Ninety-Nine

- Five cards each, remainder stock, total zero; random starter, initially counterclockwise.
- Play one legal card then replenish one; total cannot exceed 99.
- Empty stock reshuffles discards except the top card, unless two-deck mode is enabled.

| Card | Effect |
| --- | --- |
| A | +1; ♠A resets to zero |
| 2, 3, 6, 7, 8, 9 | Add face value |
| 4 | Reverse direction; unchanged total |
| 5 | Choose another surviving seat next; unchanged total |
| 10 | Choose +10/−10; subtraction floors at zero |
| J | Pass; unchanged total |
| Q | Choose +20/−20; subtraction floors at zero |
| K | Set total to 99 |

- No legal card: eliminate the seat/discard its hand; next survivor acts with unchanged total.
- Last survivor wins; others rank in reverse elimination order.

**Two decks, no reshuffle / 雙副牌不重洗**

| Setting | Behavior |
| --- | --- |
| Default | Off; legacy snapshots use single-deck rules |
| Setup | Host changes while waiting; clears human readiness; fixed for match and survives restart |
| Deck | Two shuffled 52-card decks; duplicate cards possible; effects/deal/turns unchanged |
| Stock | Never reshuffles; the draw taking the last stock card ends the match immediately |
| Result | Surviving seats tie for first; eliminated seats retain reverse-order ranks; last-survivor ending may happen first |
| UI | Stock labelled no reshuffle; rules box lists the option |

Single wins keep `winnerSeat`; stock-exhaustion ties use `winners`
([result contract](../shared/src/types/game.ts)). Earlier releases cannot read tied results;
rollback requires data without them.

## Sevens

- Deal 13 each; ♠7 holder starts with ♠7, then counterclockwise.
- Each suit grows from 7: A…6 below, 8…K above; no wrap-around.
- Legal: any 7 opens a suit, or a card directly adjacent to the row's low/high end.
- Must play if possible. Otherwise cover a chosen card face down; other active seats see only the count.
- At settlement reveal covers and sum penalties: A=1, 2–10 face value, J=11, Q=12, K=13.
  Lowest penalty wins, ties shared; no cross-match accumulation.

**Dragon Slaying (close suit on A or K) / 斬龍**

| Setting/effect | Behavior |
| --- | --- |
| Default | Off; legacy snapshots use standard rules |
| Host changes | Waiting only; clears human readiness; fixed for match and survives restart |
| A or K play | Immediately closes the entire suit, blocking both ends; other suits remain playable |
| Dragon | 2.9-second overhead dragon/fire/blade presentation without text |
| Fire only / 火焰 | 1.7-second blade/fire presentation without a dragon |
| Effect selection | Saved/fixed for match; legacy choice is dragon; changing only effect preserves readiness |
| Afterwards | Row stays darkened; reduced motion uses a still frame; next turn waits |

When all four suits close:

1. Cover remaining hands at once, in turn order, with identical penalties to individual covers.
   These log entries use `auto` and are valid only after every suit closes.
2. After the last closing presentation, collapse the table for 1.8 seconds and hold for 2 seconds.
3. Show settlement; the broken table remains under the result dialog.

## Chinese Poker

- Deal 13 each. All arrange simultaneously into front 3 / middle 5 / back 5.
- Sort, move cards or Auto arrange with the bot algorithm before confirming.
- Submission is final and hidden until all four submit.
- Rank A > K > … > 2; suits never break ties. A2345 is lowest, 10JQKA highest; no wrap-around.
- Back weaker than middle, or middle weaker than front, is a foul (倒水).
  Server accepts it; client warns and requires second confirmation.

| Row | Hands, high to low |
| --- | --- |
| Middle/back | Straight flush, four of a kind, full house, flush, straight, three of a kind, two pair, pair, high card |
| Front | Three of a kind, pair, high card |

**Pairwise scoring**

| Winning hand | Row value (otherwise 1) |
| --- | --- |
| Front three of a kind | 3 |
| Middle full house / four of a kind / straight flush | 2 / 8 / 10 |
| Back four of a kind / straight flush | 4 / 5 |

- Compare each row against each opponent; winner gains/loser loses the winner's row value.
- Foul loses all rows to a non-fouled opponent at that opponent's values; two fouls score zero.
- Sweep (打槍): all three rows won against one opponent doubles that pairing.
- Home run (全壘打): sweep all three opponents doubles those pairings again.
- Zero-sum total; highest score wins, ties shared. No cross-match accumulation.
- No special declared hands (報到), including 13-card dragons or six pairs.

## Liar's Deck

Based on the Liar's Deck mode of *Liar's Bar*; Devil/Chaos variants are not implemented.

| Setup | Rule |
| --- | --- |
| Deck | 20 cards: six each K/Q/A and two jokers |
| Revolver | One bullet in six chambers; random fixed position for the entire game |
| Trigger risk | n-th pull: `1/(7 − n)`; sixth always fires |
| Public/private | Pull counts public; bullet positions stay server-only |
| Round | Five cards per survivor; random K/Q/A table face; matching cards/jokers are truths |

1. Random first-round starter; counterclockwise turns skip empty hands.
2. Play 1–3 face-down cards claiming table-face matches, or call LIAR on the previous play.
   Round-opening play cannot be called; the only remaining seat with cards must call.
3. Reveal only the challenged play: any lie makes its player pull, otherwise the caller pulls.
   Resolution is automatic and ends the round; unchallenged cards are never revealed, even after the game.
4. Surviving shooter opens next round; if dead, next surviving seat opens.
5. Last survivor wins; earlier eliminations rank lower; no cross-match accumulation.

UI: Play/LIAR buttons, checks on matching cards, own played-card list, seat hand sizes and
pull counts. Pull outcome, next cards and elimination wait for their presentation frames.

## Blackjack

| Setup | Rule |
| --- | --- |
| House dealer | Two to four seats, each playing only against the server |
| Chips | 1000 per occupied seat, match-only |
| Match | Eight hands; freshly shuffled 52-card deck per hand, sufficient for hands ending at 21/bust |
| Bet | Simultaneous, 10–200 in steps of 10 within balance; hidden until deal ([timer](#turn-timer)) |
| Sit out | Fewer than 10 chips: watch only |

1. Deal bettors two face-up cards; dealer gets an up card and hidden hole card.
2. Ace/ten-value up card: peek; dealer blackjack ends immediately, with only player blackjacks pushing.
3. Bettors act N/E/S/W; reaching 21, busting or a natural ends the hand automatically.
4. Reveal dealer hole card; hit below 17, stand on all 17s including soft 17.
   Skip draws if every hand busted or is a blackjack.
5. Settle. After hand eight, or no seat can cover minimum, most chips wins (ties shared).
   No cross-match accumulation.

| Action/result | Rule |
| --- | --- |
| Hit / Stand | Draw / finish |
| Double | First two cards only; stake again, draw exactly one |
| Split | Equal-value cards, once per seat; stake again and play two hands in order, each immediately completed with one new card |
| Split aces | Only the one additional card; split two-card 21 is not blackjack |
| Extra stakes | Double/split require enough chips |
| Payout | Blackjack 3:2, ordinary win 1:1, push returns stake |
| Unsupported | Insurance and surrender |

### Player dealer

- Host enables while waiting (default off); changing it clears human readiness.
- Random participating dealer first, then clockwise skipping empty seats for two full rotations:
  `2 × occupied seats` hands (eight for four, four for two).
- Dealer does not bet; sees its own hole card (also visible in god view), hidden from other seats until reveal.
- House peek/payout/double/split/no-insurance rules still apply.
- After players finish, reveal the hole card. Dealer acts unless it has blackjack or every
  player hand busted/is blackjack. Hit below 17; hit or stand from 17; 21/bust ends the turn.
  Timeout follows house strategy.

**Settlement**

1. Collect each player's net loss into the dealer's pool; pushes return stakes.
2. Pay net wins (ordinary 1:1, blackjack 3:2) from dealer chips plus collections.
3. If insufficient, prorate/round down winnings, then distribute leftovers clockwise
   from dealer's left; dealer ends at zero ([payout rule](../shared/src/rules/blackjack.ts)).

Seats below 10 cannot bet but still deal, even at zero chips; no permanent elimination.
End after the last hand or fewer than two seats can cover minimum (a lone eligible dealer has no bettors).

## Texas Hold'em

| Setup/end | Rule |
| --- | --- |
| Seats/chips | No-limit, two to four occupied seats; 1000 match-only chips each |
| Blinds | 10/20 → 15/30 → 25/50 → 40/80 → 60/120, increasing every four hands ([levels](../shared/src/rules/holdem.ts)) |
| End | One seat owns all chips or hand 20 completes; most chips wins, ties shared |
| Eliminated ranks | Order of losing all chips; no cross-match accumulation |

**Deal and action order**

- Random occupied button first; rotates clockwise to seats with chips, skipping empties.
- Fresh deck per hand, two private cards per funded seat, dealing from button's left.
- Next two seats post blinds; heads-up button posts small blind. Short blind is all-in.
  No antes or burn cards.
- Clockwise action: preflop starts after big blind, which may raise after everyone calls;
  flop (3 cards), turn and river (1 each) start with first unfolded seat after button.

| Action | Rule |
| --- | --- |
| Fold | Leave this hand |
| Check | Only with nothing owed |
| Call | Match, all-in when short |
| Bet/raise | Street total ≥ current bet + last full raise (big blind initially), up to own chips |
| Short all-in raise | Must be called; does not reopen raising for seats that already acted |
| Other seats all-in | Raising unavailable |
| Street complete | Every actionable seat has acted since the last full raise and matched the bet |

**Settlement and display**

- One remaining seat wins without showdown. With at most one actionable seat after betting,
  deal the remaining board at once.
- Showdown reveals unfolded hands, best five of seven; [Chinese Poker ranking](#chinese-poker),
  no suit tie-break, A2345 lowest straight.
- Contribution levels create main/side pots; best eligible hands split each pot, odd chips
  clockwise from button. Unmatched contributions return to owners.
- Controls: Fold, Check/Call, Bet/Raise slider/amount and minimum/half-pot/pot/all-in shortcuts.
- Board, pots, street stakes, button/blinds and showdown categories follow presentation frames;
  next-hand hole cards never appear early.
