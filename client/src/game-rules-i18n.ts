import type { GameType } from '@shared/types';
import type { Locale } from './i18n';

export interface GameRuleSection {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly table?: {
    readonly headers: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
}

function section(title: string, ...paragraphs: string[]): GameRuleSection {
  return { title, paragraphs };
}

function table(title: string, headers: readonly string[], rows: readonly (readonly string[])[], ...paragraphs: string[]): GameRuleSection {
  return { title, paragraphs, table: { headers, rows } };
}

const pokerEnglish = table('Poker hands: strongest to weakest', ['Hand', 'Makeup'], [
  ['Straight flush', 'Five in a row, one suit'],
  ['Four of a kind', 'Four of one rank + one'],
  ['Full house', 'Three of one rank + a pair'],
  ['Flush', 'Five of one suit'],
  ['Straight', 'Five in a row; A2345 is lowest, 10JQKA highest'],
  ['Three of a kind', 'Three of one rank'],
  ['Two pair', 'Two pairs + one'],
  ['Pair', 'Two of one rank'],
  ['High card', 'None of the above'],
], 'Equal hands compare the main group first (four, triple, then pair), then the rest from highest to lowest; straights compare their top card.', 'A is high except in A2345, and straights cannot wrap. Suits never break ties.');

const pokerChinese = table('撲克牌型：由大到小', ['牌型', '組成'], [
  ['同花順', '同花色五張連續'],
  ['鐵支／四條', '四張同點＋一張'],
  ['葫蘆', '三張同點＋一對'],
  ['同花', '五張同花色'],
  ['順子', '五張連續；A2345 最小，10JQKA 最大'],
  ['三條', '三張同點'],
  ['兩對', '兩組對子＋一張'],
  ['一對', '兩張同點'],
  ['高牌／散牌', '不屬於以上牌型'],
], '同牌型先比主要組合（四條、三條、再到對子），再由大到小比其餘牌；順子比最大張。', 'A 最大，只有 A2345 的 A 算最小；順子不能繞過 A。花色不分大小。');

const english: Readonly<Record<GameType, readonly GameRuleSection[]>> = {
  bridge: [
    section('Goal and teams', 'North–South play East–West with 13 cards each. Ranks run A high to 2 low.', 'Declarer’s side needs 6 + contract level tricks (level 1 needs 7, level 7 all 13); otherwise the defenders win.', 'No doubles, vulnerability, bonus scoring, or exposed dummy.'),
    section('Auction', 'Clockwise. Bid level 1–7 with ♣, ♦, ♥, ♠, or no trump (NT), or pass.', 'Each bid must be higher: level first, then ♣ < ♦ < ♥ < ♠ < NT (1NT beats 1♠; 2♣ beats 1NT).', 'After a bid, three passes in a row end the auction. The last bidder declares and that suit is trump; NT has none. Four opening passes redeal.'),
    section('Weak-hand redeal', 'High-card points (HCP): A 4, K 3, Q 2, J 1. A hand with at most 4 HCP may ask for a redeal, including a lone ace with no other points.', 'Eligible seats are asked clockwise from the auction starter. Accepting redeals every hand; a seat that declines is not asked again that deal.'),
    section('Playing a trick', 'The seat counterclockwise from declarer leads first; play goes clockwise and each trick winner leads the next.', 'Follow the led suit if you can; otherwise play anything, including trump.', 'The highest trump wins; with no trump played, the highest card of the led suit wins.'),
    section('Controls', 'Pick a level and strain or Pass, then confirm; picking the same call again also confirms.', 'Touch: tap a card to lift it and tap it again to play.'),
    table('Bot bidding agreements', ['Call', 'Bots read it as'], [
      ['Opening', '12+ HCP; a major shows five cards, a minor the longest suit. After three passes a weak fourth-seat bot may open low.'],
      ['1NT / 2NT', 'Balanced (4333, 4432, 5332) with 15–17 / 20–21 HCP. A 1NT overcall also stops their suit.'],
      ['New suit', 'Four cards; 6+ HCP at the one level, 10+ at the two level.'],
      ['Raise', 'Eight or more combined cards in the suit.'],
      ['Game tries', 'Combined HCP: NT 23 invites, 25 bids 3NT; majors 18/23/25 for levels 2/3/4; minors 18/23/26/29 for levels 2–5. 2NT over 1NT invites with 8+.'],
    ], 'These only describe bot bids; humans bid freely. Bots never explore slams and always decline weak-hand redeals.'),
  ],
  bigtwo: [
    section('Goal and first play', '13 cards each, counterclockwise. First to empty their hand wins.', 'The ♣3 holder leads, and the first play must include ♣3. A dragon (one of every rank 3–2) wins at once.', 'Order: 3 < 4 < … < K < A < 2 by rank, then ♣ < ♦ < ♥ < ♠ by suit.'),
    table('Legal combinations', ['Cards', 'Combination', 'Compare by'], [
      ['1', 'Single', 'Rank, then suit'], ['2', 'Pair', 'Higher card, including suit'],
      ['5', 'Straight', 'Straight order, then top card’s suit'], ['5', 'Full house', 'Triple’s rank'],
      ['5', 'Four of a kind + one', 'Four-card rank (bomb)'], ['5', 'Straight flush', 'Straight order, then top card’s suit (bomb)'],
    ], 'No triples, plain flushes, or four-card plays. Respond with the same type and a higher play, unless you play a bomb.'),
    section('Straights and bombs', 'Straights: A2345 < 23456 < … < 10JQKA. JQKA2, QKA23, and KA234 are invalid.', 'A bomb beats any non-bomb; a straight flush beats four of a kind.'),
    section('Passing', 'You may pass even if you could play, but you stay locked out until the next free lead.', 'When everyone else has passed, the last player leads anything; free leads cannot pass.', 'With no legal play, you pass automatically after a random 0–5 seconds, or sooner by hand.', 'No last-card call and no forced high single.'),
    section('Scoring and controls', 'Each loser pays cards left × 2^(2s left): five cards with two 2s cost 5 × 4 = 20. A dragon scores the others’ full hands. Scores do not carry over.', 'Select cards, then press Play or Pass. Dragging only reorders; Alt + ←/→ moves a focused card.'),
  ],
  redpoints: [
    section('Setup', 'Six cards each, four face up on the table, 24 in the stock. Three or more equal ranks on the opening table redeal.', 'Random first player, then counterclockwise.'),
    table('Capturing cards', ['Card played or flipped', 'Captures'], [
      ['A–9', 'One table card summing to 10 (A = 1): A+9, 2+8, 3+7, 4+6, 5+5'],
      ['10, J, Q, K', 'One table card of the same rank'],
    ], 'Suit does not matter. Each card captures at most one table card; no combining.'),
    section('A turn', 'Play a hand card, then flip the stock top. Each must capture a match if one exists (you choose among several); otherwise it stays on the table.', 'Both steps share one turn timer.'),
    table('Red-point scoring', ['Captured card', 'Points'], [
      ['♥A, ♦A', '20'], ['♥/♦ 2–9', 'Face value'], ['♥/♦ 10, J, Q, K', '10'], ['♠, ♣', '0'],
    ], 'Both cards of a capture count (208 in the deck): red 5 + red 5 = 10; red A + black 9 = 20.'),
    section('End and controls', 'Ends when all hands and the stock are used; leftover table cards score nothing. Highest total wins; ties share.', 'Hover a hand card to preview captures. Tap a seat’s score to see its pile.'),
  ],
  ninetynine: [
    section('Goal and turns', 'Be the last survivor. Five cards each, total starts at 0, random first player, counterclockwise.', 'Play a card, apply it, and draw one. The total may never exceed 99.', 'An empty stock reshuffles every discard but the newest (not with two decks).'),
    table('Every card effect', ['Card', 'Effect'], [
      ['A (not ♠A)', '+1'], ['♠A', 'Reset to 0'], ['2, 3, 6, 7, 8, 9', '+ face value'],
      ['4', 'Reverse direction'], ['5', 'Name the next player'],
      ['10', '+10 or −10'], ['J', 'Pass'], ['Q', '+20 or −20'], ['K', 'Set to 99'],
    ], 'Subtraction stops at 0 and is allowed even when adding would bust. A 5 cannot name yourself or an eliminated player.'),
    section('Elimination and ranking', 'With no legal card you are out and discard your hand; the total stays and play continues.', 'Heads-up, a 4 still passes the turn to the other player.', 'Later eliminations rank higher.'),
    section('Option: two decks, no reshuffle', '104 cards, so duplicates can appear. The stock never reshuffles.', 'Drawing the last stock card ends the match; all survivors tie for first.'),
    section('Example', 'At 95, an 8 is illegal; 4, 5, J, K, ♠A, or a minus 10/Q is legal. At 6, −10 gives 0.'),
  ],
  sevens: [
    section('Goal and opening', '13 cards each. Lowest covered-card penalty wins, not first out.', 'The ♠7 holder starts with ♠7; play goes counterclockwise.'),
    section('Building the rows', 'Any 7 opens its suit. Extend one rank at a time, down to A or up to K, with no skips or wrapping.', 'Example: with only ♥7 down, ♥6 and ♥8 are legal; ♥5 is not.', 'If you hold any legal card, you must play one.'),
    section('Covering and blocked cards', 'Only with no legal card, cover one card face down. Covers are final; others see only how many you have.', 'A covered 7 keeps its suit closed; covering a middle rank strands the cards beyond it.'),
    section('Option: Dragon Slaying (default on)', 'Playing an A or K closes that whole suit at both ends. The host sets it while waiting.'),
    table('Covered-card penalties', ['Card', 'Penalty'], [['A', '1'], ['2–10', 'Face value'], ['J', '11'], ['Q', '12'], ['K', '13']], 'At the end all covers are revealed and summed. Lowest total wins; ties share.'),
  ],
  chinesepoker: [
    section('Arranging', 'Split 13 cards into a front of 3, middle of 5, and back of 5. Everyone arranges at once.', 'Sort, move cards, or Auto arrange. Confirmed hands are final and hidden until all submit.', 'Deadline: turn + reserve time, at least 60 seconds. Late hands are auto-arranged without a foul.'),
    pokerEnglish,
    section('Front row and fouls', 'The front only counts three of a kind, pair, or high card.', 'Back ≥ middle ≥ front; a weaker back or middle is a foul. When comparing front and middle, only ranks both rows have count.', 'Fouling needs a second confirmation. A foul loses every row to non-fouled players; two fouls score 0 against each other.'),
    table('Points for a winning row', ['Row', 'Winning hand', 'Points'], [
      ['Front', 'Three of a kind', '3'], ['Middle', 'Full house', '2'], ['Middle', 'Four of a kind', '8'],
      ['Middle', 'Straight flush', '10'], ['Back', 'Four of a kind', '4'], ['Back', 'Straight flush', '5'], ['Any', 'Anything else', '1'],
    ], 'Each row is compared with each opponent; the loser pays the winner’s points. A tied row scores 0.'),
    table('Sweeps and result', ['Bonus', 'Condition', 'Effect'], [
      ['Sweep (打槍)', 'Win all three rows against one opponent', '× 2 for that pairing'],
      ['Home run (全壘打)', 'Sweep all three opponents', '× 2 again (× 4)'],
    ], 'Example: three 1-point rows = +3, a sweep +6, a home run +12 from that opponent.', 'Totals sum to zero; highest wins. No 13-card special hands such as dragons or six pairs.'),
  ],
  liarsdeck: [
    section('Deck and revolvers', '20 cards: six each of K, Q, and A, plus two jokers.', 'Everyone has one bullet in a six-chamber revolver, placed at the start and never reset. Pull counts are public.'),
    section('Making a claim', 'Each round deals five cards to survivors and picks a table card: K, Q, or A. That rank and jokers are true; anything else is a lie.', 'On your turn, play 1–3 cards face down claiming they match, or call LIAR on the previous play. The round’s first player must play; the last player holding cards must call.', 'Random first opener; counterclockwise, skipping empty hands.'),
    section('Calling LIAR and the next round', 'Only the latest play is revealed. Any lie: its player pulls the trigger. All true: the caller pulls.', 'The puller opens the next round, or the next survivor counterclockwise if they died. Hands are redealt; revolvers keep their state.', 'Unchallenged plays are never revealed.'),
    table('Chance of firing', ['Pull', 'Chance'], [['1st', '1/6'], ['2nd', '1/5'], ['3rd', '1/4'], ['4th', '1/3'], ['5th', '1/2'], ['6th', 'Certain']], 'Given that earlier pulls did not fire.'),
    section('Winning', 'The last survivor wins; emptying your hand does not. Later deaths rank higher.'),
  ],
  blackjack: [
    section('Match', 'Two to eight players each play the dealer, starting with 1000 chips. Up to eight hands; every hand reshuffles (one deck for 2–4 players, two for 5–8).', 'Most chips wins; ties share. Ends early if nobody can bet 10.'),
    section('Betting and deal', 'Bet 10–200 in steps of 10, all at once and hidden. Window: twice the turn time, at least 15 seconds; a missed bet becomes 10. Under 10 chips sits out.', 'You get two face-up cards; the dealer gets one up and one hole card.', 'With an A or ten-value up card, the dealer checks for blackjack. If found, the hand ends: only a player blackjack pushes.'),
    section('Card values', 'A is 11, or 1 to avoid busting; J, Q, K are 10. A total with an ace counted as 11 is soft.', 'Only an unsplit two-card 21 is blackjack. Hands stop automatically at 21 or bust.'),
    table('Actions', ['Action', 'Rule'], [
      ['Hit', 'Take a card'], ['Stand', 'Stop'],
      ['Double', 'First two cards only: add the same bet, take exactly one card'],
      ['Split', 'Two equal-value cards, once per seat: add the same bet; each hand gets a card'],
    ], 'Split aces get one card each. Doubling after other splits is allowed. No resplitting, insurance, or surrender.'),
    section('Order and dealer', 'Seats act N → E → S → W → P5–P8, finishing both split hands first.', 'The dealer then reveals and draws to 17, standing on every 17, including soft 17.'),
    table('Settlement', ['Outcome', 'Returned, including bet'], [
      ['Blackjack', '2.5× (3:2)'], ['Win', '2× (1:1)'], ['Push', 'Bet back'], ['Loss or bust', 'Nothing'],
    ], 'A bust loses even if the dealer busts. Blackjack beats an ordinary 21. Split hands settle separately.', 'Example, 20-chip bet: blackjack returns 50, a win 40, a push 20.'),
    section('Option: player dealer', 'Seats take turns as dealer clockwise from a random seat, for two rotations. The dealer does not bet and sees the hole card.', 'After the players, the dealer must hit below 17 and chooses from 17 up.', 'Players win from or lose to the dealer’s chips; a short dealer pays winners proportionally and drops to 0.'),
  ],
  holdem: [
    section('Match', 'No-limit, 2–8 players, 1000 chips each. Win every chip or have the most after 20 hands; ties share.', 'Players with no chips are out; earlier busts rank lower.'),
    table('Blind levels', ['Hands', 'Small / big blind'], [['1–4', '10 / 20'], ['5–8', '15 / 30'], ['9–12', '25 / 50'], ['13–16', '40 / 80'], ['17–20', '60 / 120']], 'The button starts at random and moves clockwise. The next two seats post blinds; heads-up, the button posts the small blind. Short stacks post all they have.', 'No antes; fresh deck every hand.'),
    section('Betting rounds', 'Preflop: the seat after the big blind acts first; the big blind may still raise if everyone just calls.', 'Flop (3 cards), turn (1), river (1): the first active seat after the button acts first.', 'A round ends once everyone able to act has matched the bet since the last full raise.'),
    table('Decisions and raises', ['Action', 'Rule'], [
      ['Fold', 'Give up the hand'], ['Check', 'Only when nothing is owed'], ['Call', 'Match the bet, or go all-in if short'],
      ['Bet / raise', 'Enter your street total. A full raise adds at least the last raise (initially the big blind)'],
      ['All-in', 'Every chip; a short all-in does not reopen raising'],
    ], 'Example: bet 40 after a raise of 20 → minimum raise to 60; with 20 already in, that costs 40 more.'),
    pokerEnglish,
    section('Showdown', 'If all but one fold, that player wins without showing. If at most one player can act, the board is dealt out.', 'Use the best five of your two hole cards and five board cards, in any mix. Uncalled chips are returned.'),
    section('Main pot, side pots, and ties', 'Each all-in level forms a side pot; you only win pots you put chips into.', 'Example: 100, 200, and 200 in → a 300 main pot for all three and a 200 side pot for the larger two.', 'Ties split each pot; odd chips go clockwise from the button.'),
    section('Timer', 'On timeout you check, or fold if you owe chips. Each hand refills the reserve.'),
  ],
  napoleon: [
    table('Players and deal', ['Players', 'Cards each', 'Face down'], [['4', '13', '2'], ['5', '10', '4'], ['6', '8', '6']], '54 cards: a deck plus two jokers. Seats join N, E, S, W, P5, P6.', 'Only the 16 point cards (A, K, Q, J of each suit) count.'),
    section('Auction', 'Random starter, clockwise. Bid 9–16 with ♣, ♦, ♥, ♠, or NT, or pass; number first, then ♣ < ♦ < ♥ < ♠ < NT.', 'When everyone else passes, the last bidder is the Napoleon and the suit is trump. No bids: redeal.'),
    section('Exchange', 'The Napoleon takes the face-down cards and discards the same number, any cards.', 'Four players: the discards are shown and the others confirm. Five or six: hidden until the end.', 'Point cards in the discards go to the defenders.'),
    section('Secretary card', 'The Napoleon names any card; its holder secretly joins their side. Naming your own card means no secretary, and nobody is told.', 'The secretary knows at once; others find out when the card is played.', 'The secretary card beats everything and may be played anytime; leading it names the suit to follow.'),
    table('Card strength in a trick', ['Tricks', 'Strongest first'], [
      ['Before the final three', 'Secretary card > big joker > small joker > trump > led suit > others'],
      ['Final three', 'Secretary card > trump > led suit > others > big joker > small joker'],
    ], 'A is high and 2 low. A joker led in the final three ranks lowest in the suit it names.', 'Final three: tricks 11–13 (4 players), 8–10 (5), 6–8 (6).'),
    section('Playing tricks', 'The Napoleon leads first; clockwise; the trick winner leads next.', 'Follow the led suit if you can; jokers and the secretary card may always be played. Leading a joker names the suit.', 'No claims; every trick is played out.'),
    table('Summons', ['Lead', 'Must be played'], [
      ['Trump 2', 'Big joker'], ['Trump 3', 'Small joker'], ['Napoleon with the summon switch on', 'Secretary card'],
    ], 'Joker summons follow the host option (default on) and are automatic. They do not apply in NT, when that joker is the secretary card, or when the leader holds it.', 'The secretary can be summoned while another seat holds it unplayed, but not with a trump 2/3 that summons a joker.'),
    section('Winning', 'The Napoleon side wins with at least the bid in point cards; otherwise the defenders win. No multipliers.', 'Plates show each seat’s point cards; side totals stay hidden.'),
    section('Controls', 'Bid like Bridge. Exchange: select as many cards as you picked up (★), then discard. Naming: pick a suit or the jokers, then a card.'),
  ],
  tenhalf: [
    section('Match', 'Two to eight players, one 52-card deck per hand, 1000 chips each. Seats take turns as banker clockwise from a random seat, two rounds, so everyone banks equally often.', 'Most chips at the end wins; ties share. Ends early if fewer than two seats can bet 10.'),
    section('Betting and deal', 'Players bet 10–200 in steps of 10, all at once and hidden. Window: twice the turn time, at least 15 seconds; a missed bet becomes 10. The banker does not bet; under 10 chips sits out betting.', 'Everyone in the hand, the banker too, gets one face-down card, seen only by its owner until the showdown.'),
    table('Card values', ['Card', 'Points'], [['A', '1'], ['2–10', 'Face value'], ['J, Q, K', '½']], 'Over 10.5 points is a bust. A hand holds at most five cards and stops drawing at 10.5, a bust, or its fifth card.'),
    section('Order', 'Players act N → E → S → W → P5–P8, then the banker. On your turn, hit (draw a face-up card) or stand; the banker chooses freely, too. Hands stay hidden until everyone is done; then every hole card is shown.'),
    table('Special hands: strongest first', ['Hand', 'Makeup', 'Multiple'], [
      ['Five faces (人五小)', 'Five J/Q/K cards', '×5'],
      ['Tianwang (天王)', 'Five cards totalling exactly 10.5', '×4'],
      ['Five small (五小)', 'Five cards totalling under 10.5', '×3'],
      ['Ten and a half (十點半)', 'Fewer than five cards totalling exactly 10.5', '×2'],
      ['Ordinary', 'Up to 10 points', '×1'],
    ], 'Any special hand beats every ordinary total. Equal hands go to the banker, and so does any tie.'),
    section('Settlement', 'A player wins by outranking the banker; a bust always loses, even if the banker busts. A winner collects bet × its own multiple. A loser pays bet × the banker’s multiple (1 if the banker busted) but never more than the chips held before the hand.', 'The banker pays winners from its own chips plus what it collected; if that falls short, winners share it in proportion to what each is owed.', 'Example, 20-chip bet: a plain win returns 40 in total; against a banker holding ten and a half you lose 40.'),
  ],
  liarsdice: [
    section('Dice and cups', 'Two to eight players start with 5 dice each. Everyone rolls under a cup and sees only their own dice; all dice are rolled again every round.', 'A random player opens the first round, then turns pass clockwise.'),
    section('Bidding', 'Bid how many dice in total, across every cup, show a face: for example four 5s. The next bid must have more dice, or the same number of a higher face. Faces rank 2 < 3 < 4 < 5 < 6 < 1, so ones are highest.', 'Instead of bidding, call the previous bid. You cannot call before anyone has bid.'),
    section('Ones', 'Ones are wild and count as any face. Once anyone bids on ones, they are no longer wild for the rest of the round.', 'A bid on ones counts only ones.'),
    section('Calling', 'Every cup is lifted and the bid face is counted. At least the bid: the caller loses a die. Fewer: the bidder loses a die.', 'The loser opens the next round, or the next player clockwise if they have no dice left.'),
    section('Winning', 'A player with no dice is out. The last player with dice wins; later eliminations rank higher.'),
  ],
};

const chinese: Readonly<Record<GameType, readonly GameRuleSection[]>> = {
  bridge: [
    section('目標與分隊', '南北對東西，每人 13 張。點數 A 最大、2 最小。', '莊家隊需取得「6＋合約線位」墩（1 線 7 墩、7 線全部 13 墩），未達標則防守隊獲勝。', '沒有賭倍、身價、超墩加分，也不攤明手。'),
    section('叫牌', '順時針叫牌：1～7 線搭配 ♣、♦、♥、♠ 或無王 NT，或 Pass。', '叫牌必須更高：先比線位，再比 ♣ < ♦ < ♥ < ♠ < NT（1NT 高於 1♠，2♣ 高於 1NT）。', '有人叫牌後連續三家 Pass 即結束，最後叫牌者當莊家，該花色為王牌，NT 無王牌。開場四家 Pass 就重發。'),
    section('弱牌重發', '大牌點 HCP：A 4、K 3、Q 2、J 1。HCP ≤ 4 可要求重發，包含一張 A 且其餘牌沒有點數的手牌。', '從叫牌起始座位順時針詢問符合者；接受則全部重發，拒絕者本副牌不再被問。'),
    section('出牌與牌墩', '莊家逆時針鄰座首攻，之後順時針出牌，贏墩者先出下一墩。', '有首攻花色必須跟；沒有才可出其他牌，包括王牌。', '最大王牌贏墩；沒人出王牌時，首攻花色最大者贏。'),
    section('操作方式', '選線位與花色或 Pass 後按確認；再選一次相同叫牌也算確認。', '觸控：點一下抬起牌，再點一次出牌。'),
    table('Bot 叫牌約定', ['叫牌', 'Bot 的解讀'], [
      ['開叫', '12+ HCP；高花表示五張，低花選最長花色。前三家 Pass 時，第四家弱牌 Bot 可能低線開叫。'],
      ['1NT／2NT', '平均牌型（4333、4432、5332），15～17／20～21 HCP。1NT 蓋叫還需擋住對方花色。'],
      ['新花色答叫', '四張；一線 6+ HCP、二線 10+ HCP。'],
      ['加叫', '兩人合計八張以上配合。'],
      ['成局門檻', '合計 HCP：NT 23 邀請、25 叫 3NT；高花 2／3／4 線 18／23／25；低花 2～5 線 18／23／26／29。對 1NT 答 2NT 為 8+ 邀請。'],
    ], '以上只用來解讀 Bot，不限制真人叫牌。Bot 不探索滿貫，也一律拒絕弱牌重發。'),
  ],
  bigtwo: [
    section('目標與首出', '每人 13 張，逆時針出牌，先出完者獲勝。', '持有 ♣3 者先出，第一手必須包含 ♣3。一條龍（3～2 各一張）直接獲勝。', '大小：點數 3 < 4 < … < K < A < 2，同點數再比花色 ♣ < ♦ < ♥ < ♠。'),
    table('合法牌型', ['張數', '牌型', '比法'], [
      ['1', '單張', '點數，再比花色'], ['2', '對子', '較大那張（含花色）'],
      ['5', '順子', '順子順位，再比末張花色'], ['5', '葫蘆', '三張的點數'],
      ['5', '鐵支＋一張', '四張的點數（炸彈）'], ['5', '同花順', '順子順位，再比末張花色（炸彈）'],
    ], '不能出三條、普通同花或四張牌。跟牌須同牌型且更大；炸彈例外。'),
    section('順子與炸彈', '順子：A2345 < 23456 < … < 10JQKA。JQKA2、QKA23、KA234 不合法。', '炸彈壓任何非炸彈；同花順大於鐵支。'),
    section('Pass 規則', '有牌可壓也能 Pass，但要等下一次自由出牌才能再出。', '其他人都 Pass 後，最後出牌者可自由出任意牌型；自由出牌不能 Pass。', '無牌可出時，系統隨機等 0～5 秒自動 Pass，也可提早手動 Pass。', '不用喊最後一張，也不強制出最大單張。'),
    section('計分與操作', '輸家罰「剩餘張數 × 2^(手上 2 的張數)」：剩 5 張含兩張 2，罰 5 × 4＝20。一條龍以其他人整手牌計算。分數不累積。', '選牌後按出牌或 Pass。拖曳只調整順序；Alt＋←／→ 可移動聚焦的牌。'),
  ],
  redpoints: [
    section('準備', '每人 6 張，桌面翻開 4 張，牌庫 24 張。開場桌面有三張以上同點數就重發。', '隨機先手，之後逆時針輪流。'),
    table('吃牌配對', ['打出或翻出的牌', '可吃'], [
      ['A～9', '相加為 10 的一張桌牌（A 算 1）：A＋9、2＋8、3＋7、4＋6、5＋5'],
      ['10、J、Q、K', '同點數的一張桌牌'],
    ], '不看花色。每張牌最多吃一張桌牌，不能多張湊 10。'),
    section('一個回合', '先打一張手牌，再翻牌庫頂一張。有可配對就必須吃（多個時自選），沒有就留在桌上。', '兩個步驟共用一次回合時間。'),
    table('紅點計分', ['吃到的牌', '分數'], [['♥A、♦A', '20'], ['♥／♦ 2～9', '牌面點數'], ['♥／♦ 10、J、Q、K', '10'], ['♠、♣', '0']], '吃到的兩張都計分（整副 208 點）：紅 5 吃紅 5 得 10，紅 A 吃黑 9 得 20。'),
    section('結束與操作', '手牌與牌庫用完即結算，桌上剩牌不計分。最高分獲勝，同分共同獲勝。', '滑鼠移到手牌可預覽能吃的牌。點座位分數可看該玩家吃過的牌。'),
  ],
  ninetynine: [
    section('目標與回合', '最後存活者獲勝。每人 5 張，總點數從 0 開始，隨機先手，逆時針輪流。', '出一張牌、執行效果、補一張；總點數不能超過 99。', '牌庫用完時，保留最新一張，其餘棄牌洗回（雙副牌模式不重洗）。'),
    table('所有牌的效果', ['牌', '效果'], [
      ['A（♠A 除外）', '＋1'], ['♠A', '歸 0'], ['2、3、6、7、8、9', '＋牌面點數'],
      ['4', '迴轉方向'], ['5', '指定下一位'],
      ['10', '＋10 或 －10'], ['J', 'Pass'], ['Q', '＋20 或 －20'], ['K', '直接變 99'],
    ], '減法最低到 0，加法會爆時仍可選減法。5 不能指定自己或已淘汰者。'),
    section('爆掉與名次', '沒有任何能出的牌就爆掉，整手棄掉；點數不變，輪到下一位。', '只剩兩人時，出 4 仍換對方出牌。', '越晚爆掉名次越高。'),
    section('選項：雙副牌不重洗', '共 104 張，可能出現相同的牌；牌庫不重洗。', '最後一張牌被摸走即結算，所有存活者並列第一。'),
    section('例子', '總點數 95：8 不能出；4、5、J、K、♠A 或選減法的 10／Q 可以。總點數 6 時出 －10 變 0。'),
  ],
  sevens: [
    section('目標與首出', '每人 13 張。蓋牌罰分最低者獲勝，不是比誰先出完。', '持有 ♠7 者先出 ♠7，之後逆時針輪流。'),
    section('接龍規則', '任何 7 都能開啟該花色。每次往下接到 A 或往上接到 K，一次一張，不能跳號或循環。', '例：桌上只有 ♥7 時，可出 ♥6、♥8，不能出 ♥5。', '手上有能接的牌就必須出。'),
    section('蓋牌與封鎖', '完全無牌可接時，才蓋一張牌，蓋了不能收回；其他人只看得到張數。', '蓋掉 7 會讓該花色無法開啟，蓋掉中間的牌會卡住後面的牌。'),
    section('選項：斬龍（預設開啟）', '任一花色出了 A 或 K，整排兩端都關閉。房主可在等待中設定。'),
    table('蓋牌罰分', ['牌', '罰分'], [['A', '1'], ['2～10', '牌面點數'], ['J', '11'], ['Q', '12'], ['K', '13']], '結束時公開所有蓋牌並加總，最低者獲勝，同分共同獲勝。'),
  ],
  chinesepoker: [
    section('排墩', '13 張分成前墩 3 張、中墩 5 張、後墩 5 張，所有人同時排。', '可排序、移動或自動排牌；確認後不能改，全員提交才公開。', '期限為回合時間＋保留時間，至少 60 秒；逾時由系統排成不倒水的牌。'),
    pokerChinese,
    section('前墩與倒水', '前墩只算三條、一對、高牌。', '必須後墩 ≥ 中墩 ≥ 前墩，否則倒水。前墩與中墩比較時，只比雙方都有的點數。', '倒水要再確認一次才能送出。倒水者每墩都輸給正常玩家；兩個倒水者互比 0 分。'),
    table('贏一墩的分值', ['位置', '獲勝牌型', '分值'], [
      ['前墩', '三條', '3'], ['中墩', '葫蘆', '2'], ['中墩', '鐵支', '8'],
      ['中墩', '同花順', '10'], ['後墩', '鐵支', '4'], ['後墩', '同花順', '5'], ['任何', '其他牌型', '1'],
    ], '每墩分別和每位對手比，輸家付贏家的分值；平手 0 分。'),
    table('打槍與勝負', ['加成', '條件', '效果'], [
      ['打槍', '對同一位對手三墩全贏', '該組分數 × 2'],
      ['全壘打', '對三位對手都打槍', '再 × 2（共 × 4）'],
    ], '例：三墩各 1 分全贏得 ＋3，打槍 ＋6，全壘打時對該對手 ＋12。', '全桌分數合計為 0，最高者獲勝。沒有一條龍、六對半等報到牌型。'),
  ],
  liarsdeck: [
    section('牌組與左輪', '共 20 張：K、Q、A 各 6 張，加 2 張 Joker。', '每人一把六彈巢左輪，只有一顆子彈，開局決定位置且不重設。開槍次數公開。'),
    section('出牌與宣稱', '每輪發給存活者各 5 張，並指定 K、Q 或 A 為桌牌。該點數與 Joker 是真牌，其他都是假牌。', '輪到你時蓋出 1～3 張並宣稱都是桌牌，或對上一手喊 LIAR。每輪第一位必須出牌；只剩自己有牌時必須喊 LIAR。', '第一輪隨機先手，逆時針輪流，跳過手牌已空的人。'),
    section('質疑、開槍與下一輪', '只翻開上一手：有假牌，出牌者開槍；全是真牌，質疑者開槍。', '開槍者先開下一輪；若死亡則由逆時針下一位存活者開始。重新發牌，左輪狀態保留。', '沒被質疑的牌永不公開。'),
    table('中彈機率', ['第幾槍', '機率'], [['1', '1／6'], ['2', '1／5'], ['3', '1／4'], ['4', '1／3'], ['5', '1／2'], ['6', '必定中彈']], '前面幾槍都沒中彈時的機率。'),
    section('勝負', '最後存活者獲勝，出完手牌不算贏。越晚死亡名次越高。'),
  ],
  blackjack: [
    section('對局', '2～8 位玩家各自對莊家，起始 1000 籌碼。最多 8 手，每手重新洗牌（2～4 人一副、5～8 人兩副）。', '籌碼最多者獲勝，同分共同獲勝；沒人付得起 10 時提早結束。'),
    section('下注與發牌', '下注 10～200，以 10 為單位，所有人同時暗下。期限為回合時間兩倍、至少 15 秒，未下注自動押 10；籌碼不足 10 只能旁觀。', '每人兩張明牌，莊家一明一暗。', '莊家明牌為 A 或 10 點牌時先檢查 Blackjack；若是則該手立即結束，只有玩家的 Blackjack 平手。'),
    section('點數', 'A 算 11，會爆時算 1；J、Q、K 算 10。A 仍算 11 的點數為軟點。', '只有未分牌的兩張 21 才是 Blackjack。到 21 或爆牌自動結束。'),
    table('行動', ['行動', '規則'], [
      ['要牌 Hit', '再拿一張'], ['停牌 Stand', '結束這手'],
      ['加倍 Double', '僅限前兩張：再押同額，只拿一張'],
      ['分牌 Split', '兩張點數相同，每座位一次：再押同額，兩手各補一張'],
    ], '分 A 各只補一張；其他分牌後可加倍。不能再分牌，沒有保險或投降。'),
    section('順序與莊家', '依北 → 東 → 南 → 西 → 第 5～8 席行動，分牌的兩手先打完。', '莊家最後翻牌，補到 17 點，所有 17（含軟 17）都停牌。'),
    table('結算', ['結果', '返還（含本金）'], [['Blackjack', '2.5 倍（3：2）'], ['贏', '2 倍（1：1）'], ['平手', '退回本金'], ['輸或爆牌', '0']], '玩家爆牌即使莊家也爆仍算輸。Blackjack 大於普通 21。分牌兩手各自結算。', '例：押 20，Blackjack 返還 50、贏 40、平手 20。'),
    section('選項：玩家當莊家', '從隨機一位起順時針輪流當莊，共兩圈。莊家不下注，看得到暗牌。', '閒家結束後，莊家未滿 17 必須要牌，17 以上自行決定。', '輸贏直接與莊家籌碼結算；莊家不夠賠時依比例分給贏家，籌碼歸零。'),
  ],
  holdem: [
    section('對局', '無限注，2～8 人，每人 1000 籌碼。贏走全部籌碼，或 20 手後籌碼最多者獲勝；同分共同獲勝。', '籌碼歸零即淘汰，越早淘汰名次越低。'),
    table('盲注級別', ['手數', '小盲／大盲'], [['1～4', '10／20'], ['5～8', '15／30'], ['9～12', '25／50'], ['13～16', '40／80'], ['17～20', '60／120']], '莊位隨機開始，順時針移動，之後兩位付小盲、大盲；只剩兩人時莊位付小盲。籌碼不足就全押。', '沒有前注；每手重新洗牌。'),
    section('四條街', '翻牌前：大盲下一位先行動；若大家只跟注，大盲仍可加注。', '翻牌（3 張）、轉牌（1 張）、河牌（1 張）：莊位後第一位仍在局者先行動。', '所有可行動者都補齊最近一次完整加注後的下注，該街結束。'),
    table('行動與加注', ['行動', '規則'], [
      ['棄牌 Fold', '放棄本手'], ['過牌 Check', '不欠下注時才能用'], ['跟注 Call', '補齊下注，不足則全押'],
      ['下注／加注', '輸入本街總投入；完整加注至少再加上次加注額（起始為大盲）'],
      ['All-in', '押上全部；不足完整加注的全押不會重新開放加注'],
    ], '例：目前下注 40、上次加注 20，最低加注到 60；已投入 20 的話還要付 40。'),
    pokerChinese,
    section('攤牌', '只剩一人沒棄牌就直接贏，不必亮牌。最多只剩一人能行動時，自動發完公共牌。', '從兩張底牌與五張公共牌中任選最好的五張。沒人跟到的籌碼退回。'),
    section('主池、邊池與平手', '每個全押金額會分出邊池，只能贏自己有投入的池。', '例：投入 100、200、200 → 三人爭 300 主池，後兩人爭 200 邊池。', '平手均分，零頭從莊位後順時針分配。'),
    section('計時', '逾時自動過牌，欠下注時棄牌。每手補滿保留時間。'),
  ],
  napoleon: [
    table('人數與發牌', ['人數', '每人', '桌面蓋牌'], [['4', '13', '2'], ['5', '10', '4'], ['6', '8', '6']], '共 54 張：一副牌加大小鬼。依北、東、南、西、第 5、6 席入局。', '只有 16 張點數牌（各花色 A、K、Q、J）計分。'),
    section('叫牌', '隨機起叫，順時針。叫 9～16 搭配 ♣、♦、♥、♠ 或 NT，或 Pass；先比數字，再比 ♣ < ♦ < ♥ < ♠ < NT。', '其他人都 Pass 後，最後叫牌者成為拿破崙，該花色為王牌。沒人叫牌就重發。'),
    section('換牌', '拿破崙拿起桌面蓋牌，再棄回相同張數，任意牌皆可。', '4 人時棄牌公開，其他人確認後繼續；5、6 人時到結算才公開。', '棄牌中的點數牌算給防家。'),
    section('秘書牌', '拿破崙指定任一張牌，持有者就是暗中同隊的小秘書。指定到自己的牌則沒有秘書，也不會告知他人。', '小秘書會立即得知身分；其他人要等秘書牌打出才知道。', '秘書牌最大，隨時可出；首引時要指定跟牌花色。'),
    table('牌墩大小', ['輪次', '由大到小'], [
      ['末三輪以前', '秘書牌 > 大鬼 > 小鬼 > 王牌 > 首引花色 > 其他'],
      ['末三輪', '秘書牌 > 王牌 > 首引花色 > 其他 > 大鬼 > 小鬼'],
    ], '同花色 A 最大、2 最小。末三輪首引的鬼牌，在指定花色中最小。', '末三輪：4 人第 11～13 輪、5 人第 8～10 輪、6 人第 6～8 輪。'),
    section('出牌', '拿破崙首攻，順時針出牌，贏墩者下一輪先出。', '有首引花色必須跟；鬼牌與秘書牌隨時可出。首引鬼牌要指定花色。', '不能倒牌，每墩都要打完。'),
    table('召喚', ['首引', '必須打出'], [['王牌 2', '大鬼'], ['王牌 3', '小鬼'], ['拿破崙開啟召喚開關', '秘書牌']], '叫鬼依房主選項（預設開啟），自動觸發。無王合約、該鬼牌是秘書牌，或首引者自己持有時不召喚。', '秘書牌在別人手上且未打出時可召喚秘書，但會召喚鬼牌的王牌 2、3 不能用來召喚秘書。'),
    section('勝負', '拿破崙方吃到的點數牌達到叫牌數字即獲勝，否則防家獲勝。不計倍數。', '座位旁顯示各自吃到的點數牌；不顯示陣營合計。'),
    section('操作方式', '叫牌同橋牌。換牌：選與拿到的牌（★）相同張數後棄牌。指定秘書牌：先選花色或鬼牌，再選牌。'),
  ],
  tenhalf: [
    section('對局', '2～8 位玩家，每手一副 52 張牌，每人 1000 籌碼。從隨機一位起順時針輪流當莊，共兩圈，每個座位當莊次數相同。', '最後籌碼最多者獲勝，同分共同獲勝；不足兩人付得起 10 時提早結束。'),
    section('下注與發牌', '閒家下注 10～200，以 10 為單位，所有人同時暗下。期限為回合時間兩倍、至少 15 秒，未下注自動押 10。莊家不下注；籌碼不足 10 只能旁觀下注。', '參與的人（含莊家）各拿一張蓋著的暗牌，開牌前只有自己看得到。'),
    table('點數', ['牌', '點數'], [['A', '1 點'], ['2～10', '依牌面'], ['J、Q、K', '半點']], '超過 10.5 點即爆牌。一手最多五張，到 10.5 點、爆牌或拿到第五張就不能再要。'),
    section('行動順序', '閒家依北 → 東 → 南 → 西 → 第 5～8 席行動，最後是莊家。輪到你時可要牌（拿一張明牌）或停牌，莊家同樣自由決定。全部完成後才一起翻開暗牌。'),
    table('特殊牌型：由大到小', ['牌型', '組成', '倍數'], [
      ['人五小', '五張都是 J、Q、K', '×5'],
      ['天王', '五張牌合計正好 10.5 點', '×4'],
      ['五小', '五張牌合計不到 10.5 點', '×3'],
      ['十點半', '不到五張牌，合計正好 10.5 點', '×2'],
      ['一般點數', '10 點以下', '×1'],
    ], '任何特殊牌型都大於一般點數。牌型相同或點數相同，一律莊家勝。'),
    section('結算', '閒家牌比莊家大才算贏；閒家爆牌一律輸，即使莊家也爆。贏家拿下注額 × 自己牌型的倍數；輸家賠下注額 × 莊家牌型的倍數（莊家爆牌算 1 倍），但最多賠光該局開始前的籌碼。', '莊家用自己的籌碼加上收到的錢賠付；不夠賠時，依每位贏家應得的比例分配。', '例：押 20，一般贏拿回 40；對上十點半的莊家，輸 40。'),
  ],
  liarsdice: [
    section('骰子與骰盅', '2～8 人，每人 5 顆骰子。大家在骰盅下搖骰，只看得到自己的；每輪都重新搖骰。', '第一輪隨機一人先喊，之後順時針輪流。'),
    section('喊點', '喊出所有骰盅合計有幾個幾點，例如「四個 5」。下一位要喊更多個，或同樣個數但點數更大；點數大小為 2 < 3 < 4 < 5 < 6 < 1，1 點最大。', '輪到你時也可以不喊，直接開上一位的喊法；還沒有人喊時不能開。'),
    section('1 點百搭', '1 點百搭，可當任何點數。有人喊 1 點（叫齋）後，該輪 1 點不再百搭。', '喊 1 點時只算 1 點本身。'),
    section('開', '掀開所有骰盅，統計所喊的點數。達到所喊個數，開的人少一顆骰子；不足，則喊的人少一顆。', '輸的人先喊下一輪；若他已沒有骰子，則由順時針下一位開始。'),
    section('勝負', '骰子用完即淘汰，最後還有骰子的人獲勝；越晚淘汰名次越高。'),
  ],
};

const sharedTranslations: Readonly<Record<Locale, readonly GameRuleSection[]>> = {
  en: [
    table('Room setup', ['Item', 'Rule'], [
      ['Players', 'Ninety-Nine, Blackjack, Hold’em, Liar’s Dice 2–8; Napoleon 4–6; others 4'],
      ['Seat order', 'Clockwise N → E → S → W → P5–P8, skipping empty seats'],
      ['Start', 'Once everyone seated is ready, the host presses Start'],
      ['Bots', 'The host adds or removes them; at least one human must sit'],
      ['Seat shuffle', 'Optional, off by default; shuffles humans at the start'],
    ], 'Changing settings clears readiness. Matches with bots are practice and are not recorded. Chips and scores last one match.'),
    table('Turn timer', ['Item', 'Rule'], [
      ['Default', '300 seconds per turn, then a 300-second reserve per deal'],
      ['Host range', '1–300 seconds per turn, 0–300 reserve'],
      ['Timeout', 'A legal move is made for you; Bridge redeal offers are declined'],
    ], 'Unused turn time is not saved; animations are free. Disconnecting does not pause the clock; leaving or 60 seconds offline aborts the match.'),
    section('Spectators', 'Up to eight spectators besides the seats. Join as a spectator; sit or stand while waiting.', 'Spectators and eliminated players see every hand but not the stock or bullets. Sevens covers stay hidden from players until the end.', 'During a match spectator chat and voice are separate; spectators cannot act or vote.'),
    section('Ending early', 'Seated players can vote to end a match: three yes votes, or every seated human if fewer. Bots do not vote.', 'Votes last 60 seconds, with a three-minute cooldown.'),
  ],
  'zh-TW': [
    table('房間設定', ['項目', '規則'], [
      ['人數', '99、21 點、德州撲克、吹牛骰 2～8 人；拿破崙 4～6 人；其他 4 人'],
      ['座位順序', '順時針 北 → 東 → 南 → 西 → 第 5～8 席，跳過空位'],
      ['開始', '入座者都準備後，由房主按開始'],
      ['Bot', '房主可加入或移除；至少需一位真人入座'],
      ['自動換位', '可選，預設關閉；開局時打亂真人座位'],
    ], '變更設定會清除準備狀態。有 Bot 的對局是練習局，不列入紀錄。籌碼與分數只限本場。'),
    table('回合計時', ['項目', '規則'], [
      ['預設', '每回合 300 秒，用完再扣每副牌 300 秒保留時間'],
      ['房主可調', '每回合 1～300 秒，保留 0～300 秒'],
      ['逾時', '系統代出合法行動；橋牌重發詢問視為拒絕'],
    ], '沒用完的回合時間不累積，動畫不計時。斷線不暫停；離開或斷線超過 60 秒會中止對局。'),
    section('觀戰', '座位外最多 8 位觀戰者。加入房間先觀戰，等待中可入座或起身。', '觀戰者與已淘汰者可看所有手牌，但看不到牌庫與子彈位置。牌七的蓋牌對玩家要到結算才公開。', '對局中觀戰者的文字與語音另外分開；觀戰者不能行動或投票。'),
    section('提前結束', '入座玩家可發起結束投票：需三票贊成，真人不足三位時需全員贊成。Bot 不投票。', '投票 60 秒，發起後冷卻三分鐘。'),
  ],
};

export const gameRulesTranslations: Readonly<Record<Locale, Readonly<Record<GameType, readonly GameRuleSection[]>>>> = {
  en: english, 'zh-TW': chinese,
};

export function getGameRules(gameType: GameType, locale: Locale): readonly GameRuleSection[] {
  return [...gameRulesTranslations[locale][gameType], ...sharedTranslations[locale]];
}
