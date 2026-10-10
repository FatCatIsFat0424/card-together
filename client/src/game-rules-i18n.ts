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

const pokerEnglish = table('Poker hands: strongest to weakest', ['Hand', 'Definition and comparison'], [
  ['Straight flush', 'Five consecutive ranks of one suit; compare the highest rank. A royal flush is the ace-high straight flush.'],
  ['Four of a kind', 'Four equal ranks and a kicker; compare the four-card rank, then the kicker.'],
  ['Full house', 'A triple and a pair; compare the triple, then the pair.'],
  ['Flush', 'Five cards of one suit; compare all five ranks from highest to lowest.'],
  ['Straight', 'Five consecutive ranks; compare the highest rank. A2345 is five-high; 10JQKA is ace-high.'],
  ['Three of a kind', 'Three equal ranks; compare the triple, then remaining ranks from highest to lowest.'],
  ['Two pair', 'Two different pairs; compare the higher pair, lower pair, then kicker.'],
  ['Pair', 'Two equal ranks; compare the pair, then remaining ranks from highest to lowest.'],
  ['High card', 'None of the above; compare all ranks from highest to lowest.'],
], 'A is high except in A2345. Straights cannot wrap through the ace. Suits never break ties; identical comparison ranks tie.');

const pokerChinese = table('撲克牌型：由大到小', ['牌型', '組成與比法'], [
  ['同花順', '同花色的五張連續牌；比最大點數。10JQKA 同花順就是皇家同花順。'],
  ['鐵支／四條', '四張相同點數加一張踢腳；先比四張的點數，再比踢腳。'],
  ['葫蘆', '三張同點數加一對；先比三張的點數，再比對子。'],
  ['同花', '五張同花色；從最大牌開始依序比較全部點數。'],
  ['順子', '五張連續點數；比最大點數。A2345 視為 5 最大，10JQKA 視為 A 最大。'],
  ['三條', '三張同點數；先比三張的點數，再由大到小比其他牌。'],
  ['兩對', '兩組不同點數的對子；依序比大對、小對、踢腳。'],
  ['一對', '兩張同點數；先比對子，再由大到小比其他牌。'],
  ['高牌／散牌', '不屬於上述牌型；所有牌由大到小逐張比較。'],
], 'A 通常最大，只有 A2345 的 A 算最小。順子不能繞過 A 接回 2。花色不分大小，比牌點數完全相同就是平手。');

const english: Readonly<Record<GameType, readonly GameRuleSection[]>> = {
  bridge: [
    section('Goal, teams, and deal', 'A standard 52-card deck is dealt into four hands of 13. North and South are partners; East and West are partners.', 'Ranks are A > K > Q > J > 10 > … > 2. The declaring partnership must win at least six tricks plus the contract level.'),
    section('Weak-hand redeal', 'High-card points (HCP): A = 4, K = 3, Q = 2, J = 1; other cards = 0. A hand with no ace and at most four HCP qualifies to request a redeal.', 'Eligible seats are asked clockwise from the randomly chosen auction starter. Accepting redeals all four hands; declining checks the next eligible seat. A declined seat is not asked again until a new deal.'),
    section('Auction', 'The auction moves clockwise. Bid a level from 1 to 7 with clubs, diamonds, hearts, spades, or no trump (NT), or pass.', 'Every bid must exceed the current highest bid: compare level first, then ♣ < ♦ < ♥ < ♠ < NT. For example, 1NT beats 1♠, and 2♣ beats 1NT.', 'Four opening passes cause a new deal. After any bid, three consecutive passes end the auction. The last player who made a bid is declarer, and that bid is the contract.', 'A suit contract makes that suit trump; NT has no trump. There are no doubles, redoubles, vulnerability bonuses, or exposed dummy hand in this version.'),
    section('Playing a trick', 'The seat immediately counterclockwise from declarer leads the first trick. Each trick then proceeds clockwise, one card from each player.', 'The leader may play any card. Other players must follow the led suit if they have it. If they do not, they may play any card, including a trump.', 'The highest trump played wins; without any trump, the highest card of the led suit wins. An off-suit non-trump cannot win. The trick winner leads the next trick.'),
    section('Result and examples', 'All 13 tricks are played. A level-1 contract needs 7 tricks, level 3 needs 9, and level 7 needs all 13.', 'If declarer and partner reach the target, their team wins; otherwise the defending team wins. This match uses contract success, not duplicate-Bridge bonus scoring.'),
    section('Bidding and card controls', 'Select a level and strain or Pass, then confirm; selecting the same call again also confirms it. Cancel clears the pending selection.', 'On desktop, click a legal hand card to play. On touch, tap once to lift it and again to play; tapping another card changes the selection, and tapping outside clears it.'),
    section('Bot bidding agreements', 'Bots use a simplified natural system. These are estimates for interpreting bids, not restrictions on human bidding.', 'Ordinary openings show at least 12 HCP; major-suit openings show five cards. Minor openings prefer the longest eligible suit. After three opening passes, a weak fourth-seat bot may make a low opening to keep practice moving.', 'Balanced shapes are 4333, 4432, and 5332. 1NT shows 15–17 HCP; 2NT shows 20–21. A 1NT overcall also needs a stopper in the opponents’ announced suit.', 'A new-suit response shows four cards and at least 6 HCP at the one level or 10 at the two level. Suit raises seek eight combined cards.', 'Estimated combined HCP: NT invites at 23 and bids 3NT at 25; major levels 2/3/4 use 18/23/25; minor levels 2/3/4/5 use 18/23/26/29. A 2NT response to 1NT invites with at least 8 HCP.', 'Bots may rebid with partner support or enough NT strength, avoid repeating unsupported descriptions, do not explore slams, and decline weak-hand redeals.'),
  ],
  bigtwo: [
    section('Goal, deal, and first play', 'Each player receives 13 cards. The first player to empty their hand wins. Play is counterclockwise.', 'The holder of ♣3 starts every deal, and the opening play must contain ♣3. A dragon—one card of every rank from 3 through 2—wins immediately instead.'),
    section('Rank and suit order', 'Ranks: 3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2. Suits: ♣ < ♦ < ♥ < ♠. Compare rank before suit.'),
    table('Legal combinations', ['Cards', 'Combination', 'Comparison'], [
      ['1', 'Single', 'Rank, then suit.'], ['2', 'Pair of equal rank', 'The higher card of the pair, including its suit.'],
      ['5', 'Straight', 'Straight order, then the ending card’s suit.'], ['5', 'Full house', 'The triple’s rank.'],
      ['5', 'Four of a kind + kicker', 'The four-card rank; the kicker does not decide.'], ['5', 'Straight flush', 'Straight order, then the ending card’s suit.'],
    ], 'Standalone triples, ordinary flushes, and four-card plays are illegal. A straight only beats a straight, and a full house only beats a full house, unless a bomb is played.'),
    section('Straights and bombs', 'Straight order: A2345 < 23456 < 34567 < 45678 < 56789 < 678910 < 78910J < 8910JQ < 910JQK < 10JQKA. Compare the ending 5, 6, …, A, then that card’s suit. JQKA2, QKA23, and KA234 are invalid.', 'Four of a kind with a kicker and straight flushes are bombs. Any bomb beats any ordinary single, pair, straight, or full house. A straight flush beats any four-of-a-kind bomb. Equal bomb types use their own normal comparison.'),
    section('Turns and passing', 'A response normally needs the same type as the last play and a strictly stronger comparison. You may pass even if you can respond.', 'Passing locks you out for the rest of that round. Once all three opponents have passed or are locked, the last player gets a free lead with any legal combination and all pass locks clear.', 'If there is no legal response, including bombs, the game automatically passes after a random 0–5 second delay, capped by the turn allowance. You may manually pass sooner after the card animation finishes. Free leads always require a play.', 'There is no last-card announcement or rule forcing the highest single when an opponent has one card.'),
    section('Scoring and examples', 'Each loser’s penalty is remaining cards × 2^(number of twos remaining). For example, five cards with two twos cost 5 × 4 = 20 points.', 'A dragon applies the same penalty to the opponents’ original hands. Penalties do not carry into the next match.'),
    section('Controls', 'Select cards individually, then press Play, or press Pass. Dragging reorders your hand and never plays it. Sorting replaces manual order; Alt + Left/Right moves a focused card.', 'There is no double-click or global Enter shortcut for submitting a play; use the Play button.'),
  ],
  redpoints: [
    section('Goal and setup', 'Collect the most red points. Each player receives six cards, four cards begin face up on the table, and 24 cards remain in the stock.', 'If three or more opening table cards share a rank, the opening deal is redone. The first player is random; turns move counterclockwise.'),
    table('Capturing cards', ['Card played or flipped', 'Matching table card'], [
      ['A, 2, 3, 4, 5, 6, 7, 8, 9', 'One card making a total of 10, with A = 1: A+9, 2+8, 3+7, 4+6, or 5+5.'],
      ['10, J, Q, K', 'One card of exactly the same rank. A J cannot capture a Q or K.'],
    ], 'Suit does not affect matching. Each played or flipped card captures at most one table card; you cannot combine several table cards into a total of 10.'),
    section('A complete turn', 'First play one hand card. If a match exists, you must capture one matching table card; when several exist, choose one. Without a match, the played card remains on the table.', 'Then flip one stock card and apply the same mandatory-capture rule to the updated table. Both cards of every captured pair enter your score pile.', 'The hand play and flipped-card choice share one turn timer. Card animations do not consume the timer.'),
    table('Red-point scoring', ['Captured card', 'Points'], [
      ['♥A or ♦A', '20'], ['♥/♦ 2–9', 'The printed number'], ['♥/♦ 10, J, Q, K', '10'], ['Any ♠ or ♣', '0'],
    ], 'The full deck contains 208 red points. Both captured cards count, so a red 5 paired with another red 5 scores 10; a red ace paired with a black 9 scores 20.'),
    section('Ending, ties, and controls', 'The match ends after all hand cards are used and all 24 stock cards are flipped. Cards left on the table are not awarded to anyone. Highest captured total wins; tied highest totals share the win.', 'Hover or focus a hand card to preview its matches. When zero or one target exists, playing resolves immediately; multiple targets require choosing a highlighted table card. Each seat’s score opens its captured-card list.'),
  ],
  ninetynine: [
    section('Goal and setup', 'Be the last surviving player. Each player receives five cards; the running total starts at 0. The first player is random, and play initially moves counterclockwise.', 'On each turn play one legal card, apply its effect, then draw one replacement. The total must never exceed 99. When stock runs out, all discards except the newest played card are reshuffled.'),
    table('Every card effect', ['Card', 'Effect'], [
      ['A other than ♠A', 'Add 1.'], ['♠A', 'Reset the total to 0.'], ['2, 3, 6, 7, 8, 9', 'Add the printed number.'],
      ['4', 'Reverse direction; total unchanged.'], ['5', 'Choose another surviving player to act next; total unchanged.'],
      ['10', 'Choose +10 or −10. Subtraction cannot reduce the total below 0.'], ['J', 'Pass the turn; total unchanged.'],
      ['Q', 'Choose +20 or −20. Subtraction cannot reduce the total below 0.'], ['K', 'Set the total to 99.'],
    ], 'For 10 and Q, choosing a legal subtraction is allowed even when addition would exceed 99. A 5 cannot designate yourself or an eliminated player.'),
    section('Elimination and ranking', 'A player with no legal card is eliminated automatically and discards the entire hand. The total stays unchanged, and the next surviving player acts in the current direction.', 'With two survivors, reversing still sends the turn to the other player. A designation sends the next turn directly to the selected player; subsequent turns follow the current direction.', 'The last survivor wins. Other positions follow reverse elimination order: the most recently eliminated player places higher.'),
    section('Examples and controls', 'At total 95, an 8 is illegal; a 4, 5, J, K, ♠A, or a subtracting 10/Q is legal. At total 6, subtracting 10 sets the total to 0.', 'Choose plus/minus explicitly for 10 and Q, and choose the next player for 5. On touch, select a card with one tap and play it with the second.'),
  ],
  sevens: [
    section('Goal and opening', 'Each player receives 13 cards. Your goal is the lowest total penalty from covered cards, not merely being first to empty your hand.', 'The holder of ♠7 starts and must play ♠7. Turns proceed counterclockwise.'),
    section('Building the four suit rows', 'A 7 opens its own suit. Once open, extend that suit with exactly the next lower or higher rank: 7 → 6 → 5 → … → A, or 7 → 8 → 9 → … → K.', 'A is low, K is high, and there is no wrap-around. You cannot skip a rank or mix suits. With only ♥7 on the table, ♥6 and ♥8 are legal, but ♥5 is not.', 'Whenever you hold any legal card, you must play one. You cannot choose to cover instead.'),
    section('Covering and blocked cards', 'Only when no card is playable do you choose one hand card to cover face down. Covering cannot be undone. Others see your covered count but not the cards.', 'A covered 7 prevents that suit from opening. Covering a rank needed to extend a row can strand cards beyond it. Evaluate both the immediate penalty and the cards it may block.'),
    section('Optional Dragon Slaying', 'Off by default. The host may enable Dragon Slaying (斬龍) in the waiting room; changing it clears human readiness.', 'When enabled, playing either A or K immediately closes that entire suit: neither end may receive another card. Other suits remain open. The option is fixed for the match.'),
    table('Settlement and card penalties', ['Covered card', 'Penalty'], [['A', '1'], ['2–10', 'The printed number'], ['J', '11'], ['Q', '12'], ['K', '13']], 'After every card has been played or covered, all covered piles are revealed and summed. Played cards add no penalty. The lowest total wins; tied lowest totals share the win. Totals do not accumulate across matches.'),
    section('Controls', 'Play a legal card normally. When covering is required, select a card and use the separate Cover button, which displays its penalty. Your covered pile can be inspected before settlement; other playing seats’ piles remain hidden.'),
  ],
  chinesepoker: [
    section('Goal, deal, and arranging', 'Each player receives 13 cards and arranges all of them into three rows: front 3, middle 5, back 5. Every dealt card must be used exactly once.', 'All four players arrange simultaneously. You can sort, move cards between rows, or use Auto arrange. Confirming submits a final arrangement, hidden until everyone has submitted.', 'The shared arranging deadline is turn allowance plus reserve, but never less than 60 seconds. At expiry, missing arrangements are completed automatically with a non-fouled arrangement.'),
    pokerEnglish,
    section('Front row and fouls', 'The three-card front row permits only three of a kind, a pair, or high card. Three-card straights and flushes do not count.', 'Your back must be at least as strong as your middle, and your middle at least as strong as your front. A strict violation is a foul. Equal strength is allowed.', 'When comparing a three-card front with a five-card middle, only comparison ranks present in both evaluations are considered; additional kickers do not break that equality.', 'Fouls are allowed after a second confirmation. A fouled player loses every row to a non-fouled player, at the non-fouled winner’s row values. Two fouled players score zero against each other.'),
    table('Points for a winning row', ['Row', 'Winning hand', 'Value'], [
      ['Front', 'Three of a kind', '3'], ['Front', 'Any other legal hand', '1'],
      ['Middle', 'Full house', '2'], ['Middle', 'Four of a kind', '8'], ['Middle', 'Straight flush', '10'], ['Middle', 'Any other hand', '1'],
      ['Back', 'Four of a kind', '4'], ['Back', 'Straight flush', '5'], ['Back', 'Any other hand', '1'],
    ], 'Compare each of your three rows separately against every opponent’s corresponding row. A row winner gains its own row value and the loser loses the same amount; a tied row is worth zero.'),
    section('Sweeps, home runs, and examples', 'Winning all three rows against one opponent is a sweep (打槍) and doubles that pairing’s total. A tied row prevents a sweep.', 'Sweeping all three opponents is a home run (全壘打); all three of your pairings double again, for four times their original row sum.', 'Example: winning three ordinary one-point rows earns +3 before multipliers, +6 for a sweep, or +12 against that opponent as part of a home run. Row bonuses are included before multiplication.'),
    section('Match result and excluded special hands', 'Add all three pairings for each player; table scores sum to zero. Highest total wins, including tied winners. Scores reset next match.', 'There are no declared 13-card special hands such as a dragon, six pairs, or other 報到 bonuses. The ordinary 3/5/5 arrangement always applies.'),
  ],
  liarsdeck: [
    section('Goal, deck, and revolvers', 'Be the last surviving player. The deck contains 20 cards: six kings, six queens, six aces, and two jokers.', 'Each player has one bullet in a six-chamber revolver. Its chamber is chosen randomly at match start and never resets between rounds. Trigger counts are public; bullet positions stay hidden.'),
    section('Dealing and making a claim', 'Every round deals five cards to each survivor and randomly chooses K, Q, or A as the table face. Cards of that face and jokers count as truthful; every other face is a lie.', 'The first round’s opening seat is random. Play counterclockwise, skipping seats with empty hands.', 'On your turn, play one to three cards face down and claim that all match the table face, or call LIAR on the preceding play. The round’s first player must play because there is no previous claim to challenge.', 'You may mix truthful cards and lies, but a claim is dishonest if even one card is neither the table face nor a joker. If you are the only player still holding cards, you must call LIAR.'),
    section('Calling LIAR and the next round', 'Only the latest play is revealed. If any revealed card is a lie, its player pulls the trigger. If all are truthful, the caller pulls instead.', 'A trigger pull resolves automatically and ends the round. A survivor who pulled opens the next round; if that player dies, the next surviving seat counterclockwise opens.', 'Cards from unchallenged plays remain hidden even after the match. All remaining hands are redealt for the next round, but trigger counts and bullet positions persist.'),
    table('Risk after surviving earlier pulls', ['Next pull number', 'Chance of firing'], [['1', '1/6'], ['2', '1/5'], ['3', '1/4'], ['4', '1/3'], ['5', '1/2'], ['6', 'Certain']], 'These are conditional probabilities given survival so far, not a newly randomized bullet on each pull.'),
    section('Result and controls', 'The last survivor wins; later eliminations rank above earlier ones. Devil and Chaos variants are not included.', 'Select one to three cards and press Play, or press LIAR. Truthful cards are marked, and your already-played cards for this round remain listed. Emptying your hand does not itself win the match.'),
  ],
  blackjack: [
    section('Goal and match format', 'Each of the four seats plays against the dealer, not against the other players. Everyone starts with 1000 match-only chips. A match lasts up to eight hands, using a freshly shuffled 52-card deck each hand.', 'Finish with the most chips. If no seat can cover the minimum bet, the match ends early. Tied highest stacks share the win; chips reset next match.'),
    section('Betting and deal', 'Bets are 10–200 chips in steps of 10, limited by your available chips. A seat with fewer than 10 sits out.', 'All eligible seats bet simultaneously; bets are hidden until the deal. The window is twice the turn allowance, but at least 15 seconds. A missing human bet becomes the 10-chip minimum at expiry.', 'Each bettor receives two face-up cards. The dealer receives one up card and one hidden hole card. An ace or ten-value up card triggers a blackjack check before anyone acts.', 'A dealer blackjack ends the hand immediately. Only a player’s own natural blackjack pushes against it; every other hand loses.'),
    section('Card values and natural blackjack', 'A counts as 11, reduced to 1 whenever needed to avoid busting; 2–10 use face value; J/Q/K count as 10. A total is soft while an ace still counts as 11.', 'An original, unsplit two-card 21 is a natural blackjack. A 21 after splitting is an ordinary 21. Reaching 21, busting, and naturals end that hand automatically.'),
    table('Available actions', ['Action', 'Rule'], [
      ['Hit', 'Draw one card; continue unless the total reaches or exceeds 21.'], ['Stand', 'End this hand without drawing.'],
      ['Double', 'Only with the first two cards and enough spare chips: add the same stake, draw exactly one card, and stop.'],
      ['Split', 'Two cards of equal value, including different ten-value ranks, may be split once per seat. Add the same stake; each new hand immediately receives one card and is played in order.'],
    ], 'A seat can have at most two hands. Split aces get only one new card each and stop. Doubling after a non-ace split is allowed when the resulting hand is still active and you can afford it. No resplitting, insurance, or surrender.'),
    section('Turn order and dealer', 'Bettors act in N → E → S → W order, finishing both split hands before moving on. Decisions use the normal turn timer; every hand refills reserves.', 'After player actions, the dealer reveals the hole card, draws below 17, and stands on every 17, including soft 17. It need not draw when every player hand has busted or is a natural.'),
    table('Settlement', ['Outcome', 'Return including original stake'], [
      ['Natural blackjack', '2.5 × stake: profit 3:2, unless the dealer also has blackjack.'], ['Ordinary win', '2 × stake: profit 1:1.'],
      ['Push', 'The original stake is returned.'], ['Loss or bust', 'Nothing is returned.'],
    ], 'Bust loses even if the dealer also busts. Otherwise a natural beats a non-natural 21; a higher unbusted total wins against the dealer, and equal ordinary totals push. Split hands settle separately.', 'Example: a 20-chip blackjack returns 50 (30 profit); an ordinary win returns 40 (20 profit); a push returns 20.'),
    section('Controls', 'Choose chips or use the amount steps and press Bet. During your turn choose Hit, Stand, Double, or Split; unavailable actions are disabled. The acting hand is highlighted.'),
  ],
  holdem: [
    section('Goal, stacks, and match length', 'Four-seat no-limit Texas Hold’em. Everyone starts with 1000 match-only chips. Win every chip or finish with the largest stack after at most 20 hands. Tied largest stacks share the win.', 'Players with no chips are eliminated. Earlier eliminations rank lower; simultaneous eliminations are ordered by their starting stack for that hand, then N/E/S/W for equal stacks. Stacks reset next match.'),
    table('Blind levels', ['Hands', 'Small / big blind'], [['1–4', '10 / 20'], ['5–8', '15 / 30'], ['9–12', '25 / 50'], ['13–16', '40 / 80'], ['17–20', '60 / 120']], 'The opening button is random; it moves clockwise to the next seat with chips each hand. The next two dealt seats post the small and big blind. Heads-up, the button posts the small blind.', 'A short stack posts all it has. There are no antes or burn cards; each hand uses a freshly shuffled full deck and gives each remaining seat two private hole cards.'),
    section('Streets and acting order', 'Preflop: the seat after the big blind acts first. The big blind still gets an option to raise after everyone only calls.', 'Flop: reveal three community cards. Turn and river: reveal one each. On these streets the first eligible seat after the button acts first; play moves clockwise.', 'A street ends when every player able to act has acted since the last full raise and matched the current bet. Folded and all-in seats are skipped.'),
    table('Decisions and raises', ['Action', 'Rule'], [
      ['Fold', 'Give up this hand and all already-staked chips.'], ['Check', 'Allowed only when nothing is owed.'],
      ['Call', 'Match the current street bet; use all remaining chips if you cannot cover it.'],
      ['Bet / raise', 'Choose your total stake on this street, not just an extra amount. A full raise must reach the current bet plus the last full raise increment; the initial increment is the big blind.'],
      ['All-in', 'Commit every remaining chip. A short all-in below a full raise is legal, but does not reopen raising for players who already acted.'],
    ], 'No-limit means a legal raise may use your entire stack. Raising is unavailable if every other remaining player is all-in.', 'Example: with a current street bet of 40 and last full raise increment of 20, the minimum full raise is to 60. If you already staked 20, raising to 60 costs 40 more.'),
    pokerEnglish,
    section('Showdown and uncalled bets', 'If everyone but one player folds, that player wins without a showdown. If at most one remaining player can act after betting closes, the remaining board is dealt automatically.', 'At showdown, every unfolded player reveals their hole cards and uses the best five cards from their two hole cards and five community cards. You may use zero, one, or both hole cards.', 'A shared board may therefore cause a tie. Suits do not decide it. Stakes with no opposing contribution are returned to their owner.'),
    section('Main pot, side pots, and ties', 'Contributions form a main pot and additional side pots at each stack limit. You can win only a pot to which you contributed; folded chips stay in the pots but folded players cannot win.', 'Example: contributions of 100, 200, and 200 create a 300-chip main pot for all three and a 200-chip side pot for the two larger contributors.', 'Each pot independently goes to the best eligible hand. Tied winners split it evenly; leftover odd chips go to tied winners clockwise starting after the button.'),
    section('Timer and controls', 'Each hand refills the ordinary turn reserve. If a human runs out of time, they check when nothing is owed and otherwise fold.', 'Use Fold, Check/Call, and the Bet/Raise amount or slider. Minimum, half-pot, pot, and all-in shortcuts still must satisfy the legal raise limits. A raise amount is always the total for this street.'),
  ],
};

const chinese: Readonly<Record<GameType, readonly GameRuleSection[]>> = {
  bridge: [
    section('目標、分隊與發牌', '使用一副 52 張撲克牌，每人 13 張。北與南一隊，東與西一隊，合作取得牌墩。', '點數大小為 A > K > Q > J > 10 > … > 2。莊家隊伍必須取得至少「6 + 合約線位」墩。'),
    section('弱牌重發', '大牌點數 HCP：A＝4、K＝3、Q＝2、J＝1，其他牌＝0。手中沒有 A，且 HCP 不超過 4，才可要求重發。', '從隨機選出的叫牌起始座位，順時針詢問符合條件的玩家。接受會重發所有人的牌；拒絕則詢問下一位。同一副牌已拒絕的玩家不會再被詢問，重發後重新計算。'),
    section('叫牌與定約', '順時針叫牌，可選 1～7 線搭配 ♣、♦、♥、♠ 或無王 NT，也可 Pass。', '每個非 Pass 叫牌都必須高於目前最高叫牌：先比線位，同線位為 ♣ < ♦ < ♥ < ♠ < NT。例如 1NT 高於 1♠，2♣ 高於 1NT。', '開場連續四人 Pass 就重發。有叫牌後連續三人 Pass，叫牌結束；本版本由最後一位非 Pass 叫牌者擔任莊家，該叫牌就是合約。', '花色合約以該花色為王牌，NT 沒有王牌。本版本沒有賭倍、再賭倍、身價加分，也沒有攤開明手的機制。'),
    section('出牌與牌墩', '莊家的逆時針相鄰玩家先攻第一墩；墩內依順時針順序，每人出一張。', '先攻者可出任意牌。其他人若有先攻花色就必須跟牌；沒有該花色才可出其他牌，包括王牌。', '有王牌時，由最大王牌贏墩；沒有王牌時，由先攻花色的最大牌贏墩。其他花色的非王牌不能贏墩。贏墩者先攻下一墩。'),
    section('勝負與例子', '完整打完 13 墩。1 線需 7 墩、3 線需 9 墩、7 線需全部 13 墩。', '莊家與搭檔合計達標，莊家隊獲勝；未達標，由防守隊獲勝。本版本用合約是否完成判定，不採複式橋牌的身價、超墩或局獎分制度。'),
    section('操作方式', '先選線位與花色或 Pass，再按確認；再次選擇相同叫牌也能確認。取消會清除尚未送出的選擇。', '電腦點擊合法手牌即可出牌；觸控先點一次抬起牌，再點同一張出牌。點其他牌會改選，點手牌外會取消。'),
    section('Bot 的自然叫牌約定', 'Bot 使用簡化自然制解讀公開叫牌；以下是估計方式，不是限制真人叫牌的規則。', '一般開叫需至少 12 HCP，高花開叫表示五張；低花優先選最長的合適花色。前三家都 Pass 時，第四家的弱牌 Bot 可能低線開叫，讓練習繼續。', '平均牌型為 4333、4432 或 5332。1NT 表示 15～17 HCP，2NT 表示 20～21；1NT 蓋叫還需要對敵方已叫花色有擋張。', '新花色答叫表示四張，一線至少 6 HCP、二線至少 10 HCP。加叫同花色會尋找兩人合計至少八張配合。', '估計兩人合計 HCP：無王 23 點邀請、25 點叫 3NT；高花 2／3／4 線用 18／23／25 點；低花 2／3／4／5 線用 18／23／26／29 點。對 1NT 答叫 2NT，視為至少 8 HCP 的邀請。', '搭檔顯示配合或足夠無王實力時 Bot 會再叫；避免反覆重述無支持的牌情，不探索滿貫，也會拒絕弱牌重發。'),
  ],
  bigtwo: [
    section('目標、發牌與首出', '每人 13 張，先出完手牌的人獲勝，依逆時針順序出牌。', '持有 ♣3 的玩家先出，第一手必須包含 ♣3。若一手牌包含 3～2 每種點數各一張，構成一條龍，直接獲勝。'),
    section('點數與花色大小', '點數由小到大：3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2。花色為 ♣ < ♦ < ♥ < ♠，先比點數，再比花色。'),
    table('合法牌型', ['張數', '牌型', '比較方式'], [
      ['1', '單張', '先比點數，再比花色。'], ['2', '對子', '比對子中較大的那張，包含花色。'],
      ['5', '順子', '先比順子順位，再比末張花色。'], ['5', '葫蘆', '只比三張相同牌的點數。'],
      ['5', '鐵支加一張', '只比四張相同牌的點數，踢腳不決定大小。'], ['5', '同花順', '依順子順位與末張花色比較。'],
    ], '單獨三條、普通同花、四張牌的組合都不能出。一般順子只能壓順子，葫蘆只能壓葫蘆，炸彈例外。'),
    section('順子與炸彈', '順子由小到大：A2345 < 23456 < 34567 < 45678 < 56789 < 678910 < 78910J < 8910JQ < 910JQK < 10JQKA。比最後的 5、6、…、A 及該張花色，不比組合內其他牌；JQKA2、QKA23、KA234 不合法。', '鐵支加一張與同花順都是炸彈，可壓任何一般單張、對子、順子、葫蘆。同花順大於任何鐵支；同種類炸彈依各自正常比法比較。'),
    section('跟牌、Pass 與重新領出', '一般跟牌必須與上一手相同牌型，且嚴格更大；有牌可壓時也可選擇 Pass。', 'Pass 後鎖定到本輪結束，不能中途再跟。其餘三家都已 Pass 或鎖定時，最後出牌者可自由領出任意合法牌型，所有 Pass 鎖定解除。', '完全沒有合法跟牌（包含炸彈）時，系統會在出牌動畫後等待隨機 0～5 秒自動 Pass，且不超過房間回合時間；動畫後也可先手動 Pass。自由領出不能 Pass。', '不要求喊最後一張，也不強制在對手剩一張時出最大單張。'),
    section('結算與例子', '每位輸家的罰分＝剩餘張數 × 2 的「剩餘 2 張數」次方。例如剩 5 張、其中 2 有兩張，罰 5 × 4＝20 分。', '一條龍直接以其他人原始手牌套用同一公式結算。每局獨立計分，不累積到下一局。'),
    section('操作方式', '逐張選牌後按出牌，或按 Pass。拖曳只改變手牌順序，不會出牌；排序會取代手動順序，聚焦牌可用 Alt＋左右方向鍵移動。', '沒有雙擊出牌或全域 Enter 出牌捷徑，送出請使用出牌按鈕。'),
  ],
  redpoints: [
    section('目標與準備', '收集最多紅點。每人 6 張手牌，桌面先開 4 張，牌庫剩 24 張。', '開場桌面若有至少三張相同點數就重發。隨機決定先手，之後逆時針輪流。'),
    table('吃牌配對', ['打出或翻出的牌', '可以吃的桌牌'], [
      ['A、2、3、4、5、6、7、8、9', '與一張桌牌相加等於 10，A 算 1：A＋9、2＋8、3＋7、4＋6、5＋5。'],
      ['10、J、Q、K', '只能配同點數的一張桌牌；J 不能吃 Q 或 K。'],
    ], '配對不限花色。每張打出或翻出的牌最多吃一張桌牌，不能用多張桌牌湊成 10。'),
    section('一個完整回合', '先打出一張手牌。有配對就必須選一張吃，若有多個對象自行選擇；沒有配對，該牌留在桌上。', '接著翻一張牌庫牌，依更新後的桌面套用相同吃牌規則。每次吃到的兩張牌一起加入你的收牌區。', '手牌出牌與翻牌後選擇共用同一個回合計時；動畫時間不扣除。'),
    table('紅點計分', ['收集到的牌', '分數'], [['♥A 或 ♦A', '20'], ['♥／♦ 的 2～9', '牌面點數'], ['♥／♦ 的 10、J、Q、K', '10'], ['任何 ♠ 或 ♣', '0']], '整副牌共有 208 紅點，吃到的兩張都計分。例如紅 5 吃紅 5 得 10 分，紅 A 吃黑 9 得 20 分。'),
    section('結束、平手與操作', '所有手牌出完且 24 張牌庫全部翻完後結算。桌上未被吃掉的牌不歸任何人。紅點最高者獲勝，最高同分共同獲勝。', '滑鼠移到手牌或鍵盤聚焦可預覽可吃牌；零個或一個對象時直接處理，多個對象要點選高亮桌牌。點每個座位的分數可查看該玩家吃過的完整牌堆。'),
  ],
  ninetynine: [
    section('目標與準備', '成為最後存活的人。每人 5 張，總點數從 0 開始。隨機先手，起始方向為逆時針。', '每回合打一張合法牌、執行效果，再補一張；總點數不能超過 99。牌庫用完時，保留最新打出的那張，其餘棄牌洗回牌庫。'),
    table('所有牌的效果', ['牌', '效果'], [
      ['除了 ♠A 的 A', '總點數＋1。'], ['♠A', '總點數歸 0。'], ['2、3、6、7、8、9', '加上牌面點數。'],
      ['4', '反轉出牌方向，點數不變。'], ['5', '指定另一位存活玩家下一個出牌，點數不變。'],
      ['10', '自行選擇＋10 或－10，最低減到 0。'], ['J', '跳過，點數不變。'],
      ['Q', '自行選擇＋20 或－20，最低減到 0。'], ['K', '總點數直接變成 99。'],
    ], '10 或 Q 的加法會超過 99 時，仍可選擇合法的減法。5 不能指定自己或已淘汰玩家。'),
    section('爆掉、輪序與名次', '整手牌沒有任何合法出法時，玩家自動爆掉，整手牌丟入棄牌區。總點數不變，依目前方向換下一位存活玩家。', '只剩兩人時，反轉後仍換另一位出牌。指定牌只決定下一位，之後繼續依目前方向輪流。', '最後存活者獲勝，其他名次依淘汰順序反向排列，越晚爆掉名次越高。'),
    section('例子與操作', '總點數 95 時，8 不能出；4、5、J、K、♠A，以及選減法的 10／Q 都可以。總點數 6 時，選－10 的結果是 0。', '出 10、Q 時要明確選加或減，出 5 時要選下一位。觸控先點選手牌，再點同一張出牌。'),
  ],
  sevens: [
    section('目標與首出', '每人 13 張，目標是讓蓋牌罰分最低，不是單純最快出完牌。', '持有 ♠7 的人先手，第一張必須是 ♠7，之後逆時針輪流。'),
    section('四個花色的接龍', '任何花色的 7 可開啟該花色。開啟後，向下只能依序 7 → 6 → 5 → … → A，向上只能依序 7 → 8 → 9 → … → K。', 'A 在最小端，K 在最大端，不能繞回去、跳號或混花色。例如桌上只有 ♥7 時，可出 ♥6、♥8，不能直接出 ♥5。', '只要手中有任一合法牌就必須出牌，不能自行選擇蓋牌。'),
    section('蓋牌與封鎖', '只有完全無牌可接時，才選一張手牌蓋下。蓋牌不能撤回；其他玩家只能看到蓋牌張數，看不到內容。', '蓋掉 7 會使該花色無法開啟，蓋掉延伸所需的點數也可能讓後方牌被卡住。選牌時可同時考量這張罰分與它會封住哪些牌。'),
    section('可選規則：斬龍', '預設關閉，房主可在等待中的牌七房間開啟；變更會清除真人準備狀態。', '開啟後，任一花色只要出了 A 或 K，整個花色立即關閉，兩端都不能再接；其他花色不受影響。本局開始後規則固定。'),
    table('結算與蓋牌罰分', ['蓋牌', '罰分'], [['A', '1'], ['2～10', '牌面點數'], ['J', '11'], ['Q', '12'], ['K', '13']], '全部牌出完或蓋完後，公開所有蓋牌並加總。成功接出的牌不罰分。總罰分最低者獲勝，最低同分共同獲勝；分數不累積到下一局。'),
    section('操作方式', '合法牌正常點選出牌。必須蓋牌時先選牌，再按獨立的蓋牌按鈕，按鈕會顯示罰分。結算前可查看自己的蓋牌，其他仍在玩的座位內容保持隱藏。'),
  ],
  chinesepoker: [
    section('目標、發牌與排墩', '每人 13 張，全部分成前墩 3 張、中墩 5 張、後墩 5 張，每張只能使用一次。', '四人同時排牌，可排序、在各墩間移動，或使用自動排牌。確認後不能修改，所有人都提交後才公開。', '共用排牌期限為「每回合時間＋保留時間」，至少 60 秒；時間到時，尚未提交者由系統自動排成不倒水的配置。'),
    pokerChinese,
    section('前墩與倒水', '前墩只有三條、一對、高牌三種牌型，三張順子或同花不成立。', '必須後墩 ≥ 中墩 ≥ 前墩，嚴格小於才算倒水，相同強度可以。', '前墩與中墩比較時，只比較雙方都有的比牌項目，五張墩額外的踢腳不會打破該次相等判定。', '倒水仍可提交，但需要第二次確認。倒水者對正常玩家每墩都輸，按正常玩家的獲勝墩值扣分；兩個倒水玩家互比為 0 分。'),
    table('贏一墩的分值', ['位置', '獲勝牌型', '分值'], [
      ['前墩', '三條', '3'], ['前墩', '其他合法牌型', '1'], ['中墩', '葫蘆', '2'], ['中墩', '鐵支', '8'], ['中墩', '同花順', '10'], ['中墩', '其他牌型', '1'],
      ['後墩', '鐵支', '4'], ['後墩', '同花順', '5'], ['後墩', '其他牌型', '1'],
    ], '與每位對手逐一比較對應的前、中、後墩。贏家加自己的獲勝墩值，輸家扣相同分數；該墩平手為 0。'),
    section('打槍、全壘打與例子', '對同一位對手三墩全贏就是打槍，該組比較的總分乘 2；有任何一墩平手就不算打槍。', '對其餘三家都打槍就是全壘打，自己的三組對戰再乘 2，合計為原始墩分的四倍。', '例如三墩都是普通 1 分且全贏，原始＋3，打槍後＋6；若是全壘打的一部分，對該對手得＋12。特殊墩值先加總，再套用倍數。'),
    section('勝負與未採用的特殊牌', '加總每位玩家與三位對手的分數，全桌合計為 0。最高分獲勝，最高同分共同獲勝；下局重新計分。', '沒有一條龍、六對半等十三張報到牌型或額外報到分，所有牌都必須依一般 3／5／5 排墩。'),
  ],
  liarsdeck: [
    section('目標、牌組與左輪', '成為最後存活者。共 20 張：K、Q、A 各 6 張，加 2 張 Joker。', '每人有六個彈巢、其中一顆子彈的左輪，開局隨機決定子彈位置，換輪不會重設。開槍次數公開，子彈位置隱藏。'),
    section('發牌與宣稱', '每輪每位存活者拿 5 張，並隨機指定 K、Q 或 A 為本輪桌牌。相同點數與 Joker 都算真牌，其他點數就是假牌。', '第一輪隨機先手，逆時針輪流，跳過手牌已空的玩家。', '自己的回合可蓋出 1～3 張，宣稱全都符合桌牌；或對上一手喊 LIAR。每輪第一位沒有上一手可質疑，因此必須先出牌。', '可混合真牌與假牌，但只要任一張不是桌牌或 Joker 就算說謊。只剩自己還有手牌時，必須喊 LIAR。'),
    section('質疑、開槍與下一輪', '只翻開最近一手。若有任一假牌，出牌者開槍；若全部是真牌，由質疑者開槍。', '開槍自動結算並結束本輪。開槍者活著就由他先開下一輪；若死亡，換逆時針下一位存活者。', '未被質疑的出牌即使賽後也不公開。下一輪重新發所有存活者的手牌，但保留開槍次數與子彈位置。'),
    table('已存活後，下次開槍的風險', ['下一槍次數', '中彈機率'], [['1', '1／6'], ['2', '1／5'], ['3', '1／4'], ['4', '1／3'], ['5', '1／2'], ['6', '必定中彈']], '這是已經活過前面槍數後的條件機率，不是每次重新隨機放子彈。'),
    section('勝負與操作', '最後存活者獲勝，越晚淘汰名次越高。未包含 Devil 或 Chaos 變體。', '選 1～3 張後按出牌，或按 LIAR。符合桌牌的真牌會標記，自己本輪已出過的牌仍列在手牌下方。出完手牌本身不代表獲勝。'),
  ],
  blackjack: [
    section('目標與局數', '四個座位各自對莊家，不互相比牌。每人初始 1000 籌碼，只用於本場；最多打 8 手，每手使用重新洗過的 52 張牌。', '最後籌碼最多者獲勝，最高同籌碼共同獲勝。如果沒人能付最低下注，提早結束；下場籌碼重設。'),
    section('下注與發牌', '每手下注 10～200，必須為 10 的倍數且不超過自己的籌碼；少於 10 者只能旁觀。', '所有可下注玩家同時下注，發牌前下注內容隱藏。期限為每回合時間的兩倍，至少 15 秒；真人逾時未下注，系統補最低 10。', '每位下注者拿兩張明牌，莊家一張明牌、一張暗牌。莊家明牌為 A 或 10 點牌時，先檢查是否 Blackjack。', '莊家 Blackjack 立刻結束該手；只有玩家自己的天然 Blackjack 平手，其餘都輸。'),
    section('點數與天然 Blackjack', 'A 算 11，若會爆牌則降為 1；2～10 依牌面，J／Q／K 算 10。仍有 A 算 11 的牌稱為軟點。', '原始未分牌的兩張合計 21 才是天然 Blackjack。分牌後的兩張 21 是普通 21。到 21、爆牌、天然 Blackjack 都會自動結束該手行動。'),
    table('四種行動', ['行動', '規則'], [
      ['要牌 Hit', '再拿一張，未到 21 或爆牌可繼續。'], ['停牌 Stand', '不再拿牌，結束這手。'],
      ['加倍 Double', '只限目前兩張且有足夠剩餘籌碼：再押相同金額，只拿一張後強制停牌。'],
      ['分牌 Split', '兩張點數相同可分一次，含不同的 10 點牌；再押相同金額，每手立即補一張，再依序操作。'],
    ], '每個座位最多兩手，不能再次分牌。分 A 每手只補一張就停牌；其他分牌後仍可在符合條件且付得起時加倍。沒有保險或投降。'),
    section('順序與莊家行動', '玩家依北 → 東 → 南 → 西行動，分牌先完成兩手再換人。行動使用一般回合計時，每手重新補滿保留時間。', '玩家結束後翻開莊家暗牌。莊家低於 17 必須要牌，所有 17 都停牌，包含軟 17。如果所有玩家都爆牌或天然 Blackjack，莊家不需要補牌。'),
    table('結算', ['結果', '返還金額（包含原下注）'], [
      ['天然 Blackjack', '下注 × 2.5，淨贏 3：2；莊家也 Blackjack 時平手。'], ['一般贏', '下注 × 2，淨贏 1：1。'],
      ['平手 Push', '退回原下注。'], ['輸或爆牌', '不返還。'],
    ], '玩家爆牌，即使莊家也爆牌仍輸。天然 Blackjack 大於非天然 21；其他未爆牌手比較點數，較高者贏、相同平手，分出的兩手各自結算。', '例：押 20，Blackjack 返還 50（淨贏 30）、普通贏返還 40（淨贏 20）、平手返還 20。'),
    section('操作方式', '用籌碼按鈕或增減金額選下注，再按下注確認。輪到自己時選要牌、停牌、加倍、分牌；不合法的行動會停用，目前操作的手會高亮。'),
  ],
  holdem: [
    section('目標、籌碼與局數', '四人無限注德州撲克，每人初始 1000 籌碼，只用於本場。拿到全桌籌碼或最多 20 手後籌碼最多者獲勝；最高同籌碼共同獲勝。', '沒有籌碼就淘汰，越早淘汰名次越低。同手淘汰先按該手起始籌碼較少者，若相同再依北／東／南／西排列；下一場重新給籌碼。'),
    table('盲注級別', ['手數', '小盲／大盲'], [['1～4', '10／20'], ['5～8', '15／30'], ['9～12', '25／50'], ['13～16', '40／80'], ['17～20', '60／120']], '第一手莊位隨機，每手順時針移到下一位仍有籌碼的人；其後兩位發牌玩家付小盲、大盲。只剩兩人時莊位付小盲。', '不夠付盲注就押入全部剩餘籌碼。沒有前注或燒牌；每手重新洗完整牌組，每位存活者拿兩張私有底牌。'),
    section('四條街與行動順序', '翻牌前：大盲後一位先行動。即使前面都只跟注，大盲仍有加注機會。', '翻牌開三張公共牌，轉牌、河牌各再開一張；這三條街從莊位後第一位可行動者開始，順時針輪流。', '所有仍可行動的人在最近一次完整加注後都已行動且補齊目前下注，該街才結束；棄牌或 All-in 者跳過。'),
    table('行動與加注', ['行動', '規則'], [
      ['棄牌 Fold', '放棄本手，已押籌碼仍留在底池。'], ['過牌 Check', '只有不欠下注時可用。'], ['跟注 Call', '補到目前該街下注，不足時押入全部剩餘籌碼。'],
      ['下注／加注 Bet／Raise', '輸入這條街的總投入，不是追加量。完整加注至少達目前下注＋上次完整加注增量；初始增量是大盲。'],
      ['All-in', '押入所有剩餘籌碼。不足一次完整加注的短 All-in 可以出，但不讓已行動玩家重新取得加注權。'],
    ], '無限注表示合法加注可到全部籌碼。如果其他未棄牌的人都 All-in，就不能再加注。', '例：目前下注 40、上次加注增量 20，最低完整加注到 60。如果你已投入 20，加注到 60 還要再付 40。'),
    pokerChinese,
    section('攤牌與未被跟到的籌碼', '只剩一人未棄牌時，直接贏池，不必攤牌。下注結束後最多只剩一人能行動，系統直接開完剩餘公共牌。', '攤牌時所有未棄牌者公開底牌，從兩張底牌＋五張公共牌中挑最好的五張。可使用零張、一張或兩張底牌。', '因此大家都用公共牌也可能平手，花色不判大小。超出任何對手投入、沒有被跟到的籌碼退回原玩家。'),
    section('主池、邊池與平手', '依投入上限分成主池與邊池。只能贏自己有投入的池；棄牌籌碼仍在池裡，但棄牌者不能贏。', '例：三人各投入 100、200、200，形成三人可爭的 300 主池，以及兩位較大投入者可爭的 200 邊池。', '每個池各自比較符合資格者的最佳牌。同牌者均分，無法均分的零頭從莊位後開始順時針分給平手贏家。'),
    section('計時與操作', '每手重新補滿一般回合保留時間。真人逾時，不欠下注就自動過牌，有欠下注就棄牌。', '使用棄牌、過牌／跟注與下注／加注金額或滑桿；最小、半池、全池、All-in 快捷仍須符合合法範圍。金額永遠表示這條街總投入。'),
  ],
};

const sharedTranslations: Readonly<Record<Locale, readonly GameRuleSection[]>> = {
  en: [
    section('Room setup and practice', 'These are Card Together’s implemented house rules. Four players occupy N/E/S/W. Clockwise means N → E → S → W; counterclockwise means N → W → S → E.', 'The host selects the game, timer, and any available rule option while waiting. Four occupied seats and all seated humans ready start the match. Changing room settings clears human readiness.', 'The host can add, remove, or fill empty seats with bots. Bots are always ready and act using their own cards and public information. At least one seated human is required.', 'Any match containing a bot is practice and does not enter personal or public match history. Chips and scores are local to a match, not a persistent balance.'),
    section('Turn allowance and reserve', 'Default timing is 5 seconds per turn plus a personal 20-second reserve for the deal. Each turn gets a fresh allowance, then consumes reserve; unused allowance is not added to reserve.', 'The host can set a 1–60 second allowance and 0–300 second reserve. New deals refill reserves; animations consume neither allowance nor reserve. Arranging and betting use the game-specific deadlines described above.', 'On expiry, an automatic legal decision is made and you retain control of later turns. Hold’em checks or folds as described above; declining a Bridge redeal is the timeout default.', 'Disconnecting does not pause the timer. Leaving or failing to reconnect within 60 seconds aborts an unfinished match.'),
    section('Spectators and information', 'A room permits up to eight spectators in addition to four seats. New members join as spectators and may take an empty seat while waiting; seated members may stand up while waiting.', 'Spectators and permanently eliminated players can see every hand. Hidden stock order and bullet positions stay hidden. A Hold’em fold alone does not grant this view; Sevens covered piles are visible to spectators and revealed to playing seats only at settlement.', 'During a match, observer messages and voice are separated from players still competing. Everyone sees the chat history after the match. Spectators cannot act or vote; their departure does not abort a match.'),
    section('Ending or returning to a room', 'A seated player may propose ending an active match. Three yes votes pass, or all seated humans when there are fewer than three; bots do not vote and the proposer automatically votes yes.', 'Voting lasts 60 seconds. A proposal starts a three-minute cooldown, retained after failure or expiry. A successful vote returns the room to waiting and clears the cooldown.', 'After scoring, each player can return individually while others keep viewing the result. The finished board clears when every human has returned or the next match begins.'),
  ],
  'zh-TW': [
    section('房間準備與練習局', '以上是 Card Together 目前採用的房規。四個座位為北／東／南／西；順時針＝北 → 東 → 南 → 西，逆時針＝北 → 西 → 南 → 東。', '等待中由房主選模式、計時與可用的規則選項。四個座位坐滿且所有入座真人準備後開局，變更房間設定會清除真人準備狀態。', '房主可加入、移除或補滿空位 Bot。Bot 隨時準備，僅依自己的牌與公開資訊行動；開局至少需要一位入座真人。', '只要有 Bot 就是練習局，不寫入個人或公開遊戲紀錄。籌碼與分數只限本場，不是永久餘額。'),
    section('回合時間與保留時間', '預設每回合 5 秒，另有每人每副牌 20 秒保留時間。每回合先用新的基本時間，耗盡後扣保留；沒用完的基本時間不會加進保留。', '房主可設定每回合 1～60 秒、保留 0～300 秒。新發牌會補滿保留，動畫不扣任何時間；排墩與下注的共用期限依上面各模式說明。', '逾時由系統代做合法行動，後續回合仍由玩家控制。德州撲克依上述規則過牌或棄牌，橋牌重發詢問逾時視為拒絕。', '斷線不會暫停計時；中途離開或 60 秒內未重連，未完成的對局會中止。'),
    section('觀戰與資訊範圍', '除四個座位外，最多八位觀戰者。加入房間先觀戰，等待中可坐空位；已入座者也可在等待中站起。', '觀戰者與永久淘汰玩家可看見每人的手牌，牌庫順序與子彈位置仍隱藏。德州撲克單次棄牌不會取得這個視角；牌七觀戰者可看蓋牌堆，仍在玩的座位則要等結算才看其他人的蓋牌。', '對局中觀戰者的文字與語音頻道與仍在競賽者分開，結束後大家可看完整聊天紀錄。觀戰者不能行動或投票，觀戰者離開不會中止對局。'),
    section('中止與返回房間', '入座玩家可提出結束對局，四人時需三票贊成；真人少於三位時需所有入座真人贊成。Bot 不投票，提案者自動算贊成，因此單人練習可直接結束。', '投票維持 60 秒，提案啟動三分鐘冷卻，失敗或逾時仍保留冷卻。成功則回到等待並清除冷卻。', '結算後每位玩家可各自返回房間，其他人仍可看結果；所有真人都返回或下一局開始時，才清除完成的牌桌。'),
  ],
};

export const gameRulesTranslations: Readonly<Record<Locale, Readonly<Record<GameType, readonly GameRuleSection[]>>>> = {
  en: english, 'zh-TW': chinese,
};

export function getGameRules(gameType: GameType, locale: Locale): readonly GameRuleSection[] {
  return [...gameRulesTranslations[locale][gameType], ...sharedTranslations[locale]];
}
