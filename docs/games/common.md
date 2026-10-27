# Shared game rules

- Standard seats N/E/S/W. Clockwise is N → E → S → W; counterclockwise is N → W → S → E.
- Seated players see only their own hand; [observers](#spectators-and-god-view) see more.

## Shared room lifecycle

| Stage | Behavior |
| --- | --- |
| Waiting | Everyone seated, including the host, can prepare at any player count. Readiness never starts a match; the host separately presses Start after all occupied seats are ready and the player count is valid |
| Player counts | Ninety-Nine, Blackjack, and Hold'em support 2–8 occupied seats, Napoleon 4–6; other games require N/E/S/W. At least one seated human is required. Empty configured seats do not block a flexible game |
| Extra seats | Flexible rooms can add P5/P6/P7/P8 (Napoleon P5/P6). Turn order continues after W and skips unoccupied seats; empty seats receive no cards, chips, turns, results, or history entries |
| Shuffle seats | Available for every game, off by default. At start, shuffle humans among their occupied positions; bots keep their seats and empty seats remain empty. Seat changes and the game commit together |
| Readiness | Sitting, standing, leaving, adding or removing bots, and option changes clear human readiness; changing only the Sevens effect keeps it |
| Finished | Each human returns with Continue; others keep the result until everyone returns or the next match starts |
| Leave or reconnect expiry | Leaving, or not reconnecting within 60 seconds, aborts an unfinished match |
| History | Completed results persist under the [history retention policy](../storage.md#replay-archives) |

**Abort votes**

- Seated humans propose and vote; the proposer votes yes automatically. Bots never vote.
- Passing needs `min(3, seated humans)` votes, including humans in additional seats;
  a lone human ends the match immediately.
- A vote lasts 60 seconds. Starting one sets a three-minute cooldown that remains after
  failure or expiry. Success returns the room to waiting and clears the cooldown.

## Spectators and god view

- Up to [eight spectators](../../shared/src/constants/game-rules.ts) besides the seats. Any
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
  presentation frame ([timeline](../architecture.md#presentation-timeline)).
- Observer chat (`audience: 'observers'`) reaches observers only. Seated players have
  their own channel and do not hear observers in voice; all chat becomes visible after settlement.

## Turn timer

| Clock | Rule |
| --- | --- |
| Default | A fresh 300 seconds per turn, then the player's 300-second reserve for the deal |
| Unused allowance | Never added to the reserve |
| Settings | Host only, while waiting: 1–300 seconds allowance plus 0–300 seconds reserve ([shared limits](../../shared/src/time-control.ts)) |
| Display | Own plate shows allowance and reserve; others show allowance only while acting |
| Animations | Consume no time |
| Disconnect | Neither pauses clocks nor extends the reconnect window |
| New deal | Refills reserves, including each Liar's Deck round and each Blackjack or Hold'em hand |

| Game or stage | On timeout |
| --- | --- |
| Ordinary turns, Bridge and Napoleon bidding, Napoleon exchange and secretary call | A legal action chosen from the player's own view |
| Bridge redeal offer | Decline |
| Napoleon discard review (four players) | Everyone confirms at once within twice the allowance, at least 15 seconds ([`napoleonReviewSeconds`](../../shared/src/rules/napoleon.ts)); missing confirmations happen automatically |
| Red Points | Hand play and flipped-card choice share one allowance |
| Chinese Poker | Everyone arranges at once within allowance + reserve, at least 60 seconds ([`cpArrangeSeconds`](../../shared/src/rules/chinesepoker.ts)); missing hands use the bot's non-fouled search |
| Blackjack betting | Everyone bets at once within twice the allowance, at least 15 seconds ([`bjBetSeconds`](../../shared/src/rules/blackjack.ts)); missing human bets become the minimum 10 |
| Hold'em | Check if nothing is owed, otherwise fold; never stakes a timed-out human's chips |
| Big Two forced passes | Separate scheduler that uses no decision time; the clock still looks ordinary |

- Shared-deadline countdowns show only on the owner's seat until submission.
- Timed-out humans keep control on later turns. "Auto-played" stays until their next turn;
  missing Blackjack bets show "Auto"; bots show "Thinking".
- Each plate shows one status, highest first: eliminated → passed/Folded/All-in →
  Thinking → Auto-played → Arranged/Bet placed.

Runtime mechanics: [architecture](../architecture.md#turn-clocks).

## Card controls

| Game | Interaction |
| --- | --- |
| Bridge calls | Pick level and suit, or Pass, then Confirm or pick the same call again; Cancel clears |
| Napoleon | Bridge-style calls at levels 9–16; select the exact discard count, then confirm; pick the secretary card from all 54; leading the secretary card or a joker asks for the suit; the secretary summon is a toggle before playing, and joker summons are stated, not offered |
| Bridge, Ninety-Nine, Red Points | Click or keyboard activation plays. On touch, the first tap lifts and the second plays; tapping another card switches, tapping outside clears |
| Ninety-Nine | Explicit plus/minus and next-player choices |
| Red Points | Zero or one capture target plays immediately; several require choosing a highlighted table card |
| Sevens | Legal cards play directly; when blocked, select a card and press the irreversible Cover button, which shows its penalty |
| Chinese Poker | Place cards into front, middle, back; full rows show hand types; fouls need double confirmation |
| Blackjack | Chip buttons 10/20/50/100/200 and −/+ steps, then Bet; Hit, Stand, Double, Split follow legality |
| Big Two | Select cards, then Play or Pass. No suggestions, double-click play, or Enter shortcut |

- Bridge bidding overlays the table with touch targets at least 44px tall; recent calls
  stay visible with the info drawer closed. During the auction each plate shows that seat's
  latest call (a bid with its suit, NT, or Pass) beside the name, updated as calls arrive.
- Red Points uses up to two table rows (one when short) and paginates crowded tables.
  Score buttons list all captures; seat trays show the latest red cards.
- Blackjack plates show Bet placed or Thinking while betting; the previous hand stays
  visible. Cards, chips, and results appear only at their presentation frame.
- Big Two hands reorder by drag or focused Alt + Left/Right; the order survives turns.
  Rank or suit sort replaces it. Cards stay focusable with `aria-disabled`, and turn
  changes are announced politely.

## Bots

- While waiting, the host adds, removes, or fills bots in any configured seat, additional
  seats included; filling covers every empty seat. With no seated human the last
  empty seat stays open, because a human must be able to end the match.
- Bots play every game, are always ready, and stay for the next match. Only humans host;
  the room closes when the last human leaves.
- Each bot has an independent **Easy** or **Hard** difficulty. New bots and legacy
  snapshots default to Hard. The host changes difficulty while waiting; changes reset
  human readiness and persist across matches and restarts.
- Both levels use only their own hand and public state. Hard retains the existing
  [card game strategies](cards.md#bot-strategies). Injectable randomness picks among
  weighted near-best moves; an immediate Big Two win always plays.
- They are heuristic practice opponents: no hidden-hand search or
  optimal play.
- Easy uses basic bidding (Napoleon: level 9 only with enough jokers and point cards) and random legal plays, captures, covers, and Ninety-Nine
  choices without opponent inference or planning. Chinese Poker uses a greedy valid
  arrangement; Liar's Deck uses fixed challenge odds; Blackjack uses minimum bets and
  a 17-point stand threshold; Hold'em uses free checks and simple randomized betting
  ([easy strategies](../../server/src/bots/easy-strategy.ts)).
- Bots wait for presentation plus a short thinking delay, save before broadcast, and
  resume after restart. Matches with bots follow the [history and replay policy](../storage.md#identity-and-sessions). Bots have no profile,
  friends, or voice.
