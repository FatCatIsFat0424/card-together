import type { DemoText } from './types';

export const bettingDemoZh = {
  'blackjack-goal': {
    title: '21 點：和莊家比，不是和全桌比',
    caption: '固定從 N 看完整四手。這間房已開啟「玩家當莊」，E 先當莊；閒家要在不爆牌下勝過莊家。',
    rule: '規則卡：每人 1,000 籌碼。預設系統莊打八手，低於 17 補牌、軟 17 也停牌；玩家當莊則輪兩圈，兩人共四手。',
  },
  'blackjack-bet': {
    title: '選擇注碼，再按下注',
    caption: '點 100 籌碼，或用 −／＋調整，再按「下注」。莊家不用押；其他閒家的注碼到發牌才公開。',
    rule: '下注 10–200，每次增減 10，不能超過持有籌碼。A 可算 1 或 11；J、Q、K 算 10。',
  },
  'blackjack-split': {
    title: '同點數可以分牌',
    caption: 'N 的兩張 8 可以按「分牌」：再押 100，分成兩手，接著依序處理目前亮起的那手。',
    rule: '每人最多分一次；同為 10 點的牌也可分。分 A 後每手只補一張，分出的 21 點不算黑傑克。',
  },
  'blackjack-double': {
    title: '兩張牌時可以加倍',
    caption: '第一手目前 11 點。按「加倍」再押同額，只補一張便自動結束這手；分牌後也可以加倍。',
  },
  'blackjack-hit': {
    title: '要牌不等於一定變好',
    caption: '輪到第二手，目前 10 點。按「要牌」補一張，再依新的點數決定；超過 21 就立即爆牌。',
  },
  'blackjack-stand': {
    title: '停牌保留目前點數',
    caption: '第二手已到 19 點，按「停牌」結束。閒家都完成後才翻開莊家底牌，換莊家決策。',
  },
  'blackjack-reveal': {
    title: '底牌公開後才知道莊家總點數',
    caption: '現在 E 的底牌已公開，莊家共 16 點，只能要牌。等莊家完成，兩手會分別和莊家比較並結算。',
    rule: '一般贏牌淨贏 1 倍注碼；同點退注；未分牌的兩張 21 點淨贏 1.5 倍。爆牌先輸，不因莊家爆牌而翻盤。',
  },
  'blackjack-rotate': {
    title: '下一手換 N 當莊',
    caption: '閒家改成 E，由 E 下注並決定停牌。N 現在是莊家，只能看到自己的底牌，E 仍看不到。',
    rule: '規則卡：莊家明牌為 A 或 10 點牌時會先檢查黑傑克；莊家黑傑克會直接結算。沒有保險或投降按鈕。',
  },
  'blackjack-dealer': {
    title: '當莊也要自己按按鈕',
    caption: 'E 完成後，N 的莊家手牌共 14 點，按「要牌」。玩家當莊低於 17 點不能停牌。',
  },
  'blackjack-dealer-stand': {
    title: '17 點以上，玩家莊家可以停牌',
    caption: 'N 已到 17 點，按「停牌」完成莊家回合。玩家莊家也可選繼續要牌，21 點或爆牌會自動結束。',
    rule: '規則卡：若所有閒家都爆牌或都是黑傑克，莊家不用再補牌。玩家莊家賠不起時，贏家按應得金額比例分配。',
  },
  'blackjack-natural': {
    title: '第三手：認識自然黑傑克',
    caption: '輪回 E 當莊，N 再下注 100。留意發牌後是否直接結算：未分牌的 A 加 10 點牌就是黑傑克。',
  },
  'blackjack-fast': {
    title: '加速走完最後一手',
    caption: '最後換 N 當莊，E 下注後選要牌。這段加速呈現相同流程，直到四手全部結束。',
    rule: '籌碼不足 10 不能下注，但仍會輪到當莊；能下注的人少於兩位時提早結束。',
  },
  'blackjack-end': {
    title: '四手完成，看整場籌碼',
    caption: 'N 最後 1,250，E 為 750；N 獲勝。結算看整場剩餘籌碼，並非只看最後一手。',
    outcome: '已完整示範下注、分牌、加倍、要牌、停牌、莊家決策、黑傑克與輪莊結算。',
  },
  'holdem-goal': {
    title: '德州撲克：兩張底牌加五張公牌',
    caption: '固定從 N 看三人對局。自己的兩張底牌可見，對手底牌蓋著；從最多七張牌中選最好的五張比大小。',
    rule: '每人 1,000 籌碼。拿走全桌籌碼便結束，否則最多二十手；每四手提高盲注，最後籌碼最多者勝。',
  },
  'holdem-preflop': {
    title: '翻牌前：認識按鈕與盲注',
    caption: 'N 拿按鈕，E 小盲 10、S 大盲 20。N 按「跟注 20」，E 補差額，大盲不欠注時按「過牌」。',
    rule: '翻牌前從大盲下一位開始，之後各街從按鈕左邊開始。單挑由按鈕付小盲；沒有前注或燒牌。',
  },
  'holdem-flop': {
    title: '翻牌：三張公牌一起公開',
    caption: '現在三張翻牌已公開。E、S 先過牌；輪到 N 時，先比較自己的底牌和公牌，再決定下注。',
    rule: '不欠注才可過牌；面對下注只能跟注、加注或棄牌。棄牌只退出這一手，已押的籌碼留在池內。',
  },
  'holdem-bet': {
    title: '開下注面板，輸入本街總注額',
    caption: 'N 點「下注」，在金額欄輸入 100，再按確認。面板也有滑桿及最小、半池、滿池、全下快捷鍵。',
    rule: '金額指這一街加到多少，不是額外加多少。至少符合面板下限，最多是這街已押加上剩餘籌碼。',
  },
  'holdem-fold': {
    title: '對手可以棄牌或跟注',
    caption: '面對 N 的 100，E 選「棄牌」，S 選「跟注」。E 的底牌仍不公開，已押的盲注仍留在底池。',
  },
  'holdem-turn': {
    title: '轉牌：第四張公牌與新一輪下注',
    caption: '轉牌已公開，本街注額重新從零開始。S、N 依序按「過牌」；前幾街的籌碼仍計入總底池。',
  },
  'holdem-river': {
    title: '河牌：第五張公牌',
    caption: '河牌後不再補公牌。S 先過牌，輪到 N；完成最後一輪下注，未棄牌者才攤開底牌。',
    rule: '牌型由大到小：同花順、四條、葫蘆、同花、順子、三條、兩對、一對、高牌；花色不破同分，A2345 是最小順子。',
  },
  'holdem-showdown': {
    title: '過牌後攤牌，再接下一手',
    caption: 'N 按「過牌」結束河牌下注。系統會公開仍在局內的底牌、分配底池，然後自動輪轉按鈕並開始下一手。',
  },
  'holdem-next-hand': {
    title: '第二手：籌碼深度已不同',
    caption: '上一手結算後、扣新盲注前，N 有 1,140、E 有 980、S 有 880。E 拿按鈕，先跟注，再輪 S。',
  },
  'holdem-short-stack': {
    title: '短籌碼全下仍能參與攤牌',
    caption: 'S 開加注面板，選「全下」並確認到 880。全下者這手不再操作，但仍保有符合投入金額的底池資格。',
  },
  'holdem-call': {
    title: 'N 跟注到 880',
    caption: 'N 按「跟注」補到 880。N 還有籌碼，E 也尚未完成行動，因此這輪還沒結束。',
  },
  'holdem-short-raise': {
    title: '不足完整加注的全下',
    caption: 'E 選「全下」加到 980。只多 100，不足上一個完整加注幅度；N 必須補差額，但不能因此重新加注。',
    rule: '規則卡：短全下不重新開放已行動者的加注權；只有一人還能行動時，也不能再對全下者加注。',
  },
  'holdem-sidepot': {
    title: '補差額，分成主池與邊池',
    caption: 'N 按「跟注 100」。主池 2,640 由 N、E、S 爭奪；邊池 200 只有 N、E 有資格。之後公牌自動發完再攤牌。',
    rule: '規則卡：各池獨立比牌；同牌型平分，零頭依按鈕後的順序分配。沒有人跟到的超額籌碼退回。',
  },
  'holdem-end': {
    title: '兩手完成，以攤牌贏走全桌籌碼',
    caption: '現在底牌已合法公開，N 的三條 A 贏得主池與邊池，累計 3,000；E、S 輸光籌碼，整場結束。',
    outcome: '已完整走過翻牌前、翻牌、轉牌、河牌、下注、棄牌、全下、短加注與邊池結算。',
  },
  'stud-goal': {
    title: '五張梭哈：一暗四明',
    caption: '固定從 N 看兩人對局。每人先付前注 10，再拿一張暗牌和一張明牌；自己的暗牌可見，對手的要等攤牌。',
    rule: '每人 1,000 籌碼。沒有強制 bring-in；明牌每輪最大者先行動，之後順時針。每手重新洗牌。',
  },
  'stud-hidden': {
    title: '明牌決定順序，暗牌影響真實牌力',
    caption: 'N 明牌 A 大於 E 的 K，先行動。只憑 E 的明牌無法確定完整牌型，不能把背面底牌當成已知資訊。',
    rule: '先手只比明牌的四條、三條、兩對、一對、單張，再比點數；仍同分才用 ♠、♥、♦、♣ 決定先後，不看明牌順子或同花。',
  },
  'stud-bet': {
    title: '先手可以過牌，也可以下注',
    caption: 'N 點「下注」，金額欄填 40 再確認。也可用滑桿或最小、半池、滿池、全下快捷鍵；前注已另計入底池。',
    rule: '目前最低下注 20。加注金額是這一輪的總注額；面板會限制可用範圍。',
  },
  'stud-call': {
    title: '跟注後再發下一張明牌',
    caption: 'E 按「跟注 40」。所有仍能行動的人補足注額並完成決策後，才發下一輪明牌。',
    rule: '面對下注可跟注、加注或棄牌；不欠注才能過牌。棄牌保留底牌隱私，卻放棄已投入的籌碼。',
  },
  'stud-third': {
    title: '第三張：重新比較明牌並決定先手',
    caption: 'N 的兩張明牌已成一對 A，這輪仍由 N 先。雙方過牌，讓流程繼續；每輪都會重新判斷明牌強弱。',
  },
  'stud-fourth': {
    title: '第四張：新一輪下注',
    caption: '第四張牌（第三張明牌）已發出。N 按「下注」到 100，E 跟注；之前的注額留在底池，本輪注額則重新計算。',
  },
  'stud-allin': {
    title: '第五張：最後一輪全下',
    caption: '每人已有一暗四明。N 點「下注」，選「全下」並確認剩餘 850；這次押完後，N 不再有後續決策。',
    rule: '規則卡：全下不足完整加注時不重開加注權；投入不同會形成主池與邊池，只能爭取自己有資格的部分。',
  },
  'stud-showdown': {
    title: '跟注到全下，才公開暗牌',
    caption: 'E 按全下跟注，最後一輪結束後才亮底牌。用各自完整五張比大小，不像德州有共用公牌可選。',
    rule: '牌型順序：同花順、四條、葫蘆、同花、順子、三條、兩對、一對、高牌。最終比牌花色不分大小，同分平分底池。',
  },
  'stud-end': {
    title: '一手完成，N 的三條 A 勝出',
    caption: 'E 的底牌現在已公開，N 的三條 A 勝過 E 的一對 K，收下含前注的 2,000；E 淘汰，整場結束。',
    outcome: '若沒有人拿走所有籌碼就繼續下一手，前注與最低下注每四手提高；最多二十手後比剩餘籌碼。',
  },
  'tenhalf-goal': {
    title: '十點半：保住點數，也要考慮牌型',
    caption: '固定從 N 看完整四手。E 先當莊，閒家只和莊家比；超過 10.5 就爆牌，不是越接近 21 越好。',
    rule: 'A 算 1，2–10 照牌面，J、Q、K 各半點。每人 1,000 籌碼，輪莊兩圈；兩人共四手。',
  },
  'tenhalf-bet': {
    title: '閒家下注，莊家不下注',
    caption: 'N 點 100 籌碼後按「下注」；也能用 −／＋每次調整 10。發牌後只有自己的第一張暗牌可見。',
    rule: '下注 10–200，不超過籌碼；其他人的待發注碼與暗牌都不提前公開。',
  },
  'tenhalf-hit': {
    title: '要牌會拿到一張公開明牌',
    caption: 'N 的暗牌是 10，按「要牌」嘗試補牌。若超過 10.5 就立刻爆牌；剛好 10.5 或拿到第五張則自動結束。',
  },
  'tenhalf-banker': {
    title: '閒家完成後，莊家仍要操作',
    caption: 'N 已到十點半並自動完成。E 當莊選「停牌」，雙方完成後才一起公開暗牌、比較並結算。',
    rule: '十點半沒有莊家 17 點規則；莊家可自由要牌或停牌，閒家全爆牌也仍輪到莊家。',
  },
  'tenhalf-rotate': {
    title: '第二手換 N 當莊',
    caption: '第一手的牌已公開並結算。現在換 N 當莊，E 下注；N 不下注，只等閒家行動後處理莊家手牌。',
  },
  'tenhalf-bust': {
    title: '對手要牌，底牌仍是祕密',
    caption: 'E 按「要牌」，新明牌公開，但 N 仍看不到 E 的暗牌。請依桌上的完成標記判斷何時換自己操作。',
    rule: '規則卡：閒家爆牌一律輸，即使莊家也爆牌；同牌型、同點數也由莊家勝。',
  },
  'tenhalf-own-banker': {
    title: 'N 的莊家回合',
    caption: '現在輪到 N，自己的暗牌為 2。按「要牌」補一張；莊家一樣有自己的暗牌，不能看到對手底牌。',
  },
  'tenhalf-settle': {
    title: '按停牌，完成這手的攤牌與結算',
    caption: 'N 目前 5 點，按「停牌」。此時雙方都完成，系統才把全部暗牌公開，並依勝負更新籌碼。',
    rule: '贏家拿回注碼，淨贏注碼乘自己的倍數；輸家支付注碼乘莊家倍數，最多付到本手起始籌碼。莊家賠不起時按比例分配。',
  },
  'tenhalf-five-start': {
    title: '第三手：另一條路是五張牌',
    caption: '換 E 當莊，N 再下注 100。這手留意牌張數；暗牌也算一張，最多只能拿到五張。',
  },
  'tenhalf-five': {
    title: '加速補牌，觀察張數與點數',
    caption: 'N 從自己的 2 開始連續按「要牌」。本段加速四次補牌，每張明牌都公開；第五張會自動完成。',
    rule: '規則卡：人五小（五張人頭）×5 > 天王（五張剛好 10.5）×4 > 五小（五張低於 10.5）×3 > 十點半 ×2 > 一般點數 ×1。',
  },
  'tenhalf-special-settle': {
    title: '特殊牌型不只看點數高低',
    caption: 'N 已拿到五張未爆，形成五小。現在 E 要牌，等 E 完成才攤牌；還不能把 E 的底牌當成已公開資訊。',
  },
  'tenhalf-fast': {
    title: '加速走完第四手與最後一輪輪莊',
    caption: '第三手已完成。最後 N 當莊、E 下注並停牌，再由 N 要牌，直到四手全部正常結算。',
    rule: '籌碼不到 10 就不能下注，但仍會輪莊；能下注的人少於兩位時，整場提早結束。',
  },
  'tenhalf-end': {
    title: '四手完成，累積籌碼決定勝負',
    caption: 'N 最後 1,500，E 為 500，N 獲勝。這場走過十點半、爆牌、五小與莊家爆牌，不能只用點數大小判斷輸贏。',
    outcome: '每次先看輪到誰、自己的點數與張數，再選要牌或停牌；只有全員完成後才翻開所有暗牌。',
  },
} satisfies Record<string, DemoText>;

export const bettingDemoEn: Record<keyof typeof bettingDemoZh, DemoText> = {
  'blackjack-goal': {
    title: 'Blackjack: beat the dealer',
    caption: 'Watch all four hands from N. This room has Player Dealer enabled, with E dealing first. Beat the dealer without going over 21.',
    rule: 'Rule card: start with 1,000 chips. The default house game lasts eight hands and stands on all 17s. Player Dealer lasts two rotations: four hands with two seats.',
  },
  'blackjack-bet': {
    title: 'Choose an amount, then place the bet',
    caption: 'Click the 100 chip, or adjust with − / +, then click Bet. The dealer does not bet; other pending amounts stay hidden until the deal.',
    rule: 'Bet 10–200 in steps of 10, within your stack. Aces count as 1 or 11; J, Q and K count as 10.',
  },
  'blackjack-split': {
    title: 'Split equal-value cards',
    caption: 'N has two eights. Click Split to stake another 100 and create two hands. Play the highlighted hand first, then the next.',
    rule: 'One split per seat, including unequal ranks worth ten. Split aces receive one card each; a split 21 is not a natural blackjack.',
  },
  'blackjack-double': {
    title: 'Double while holding two cards',
    caption: 'The first hand totals 11. Click Double to add an equal stake, receive exactly one card, and finish that hand. Doubling after splitting is allowed.',
  },
  'blackjack-hit': {
    title: 'A hit adds both opportunity and risk',
    caption: 'The second hand now acts with 10 points. Click Hit for one card, then reassess. Going over 21 immediately busts the hand.',
  },
  'blackjack-stand': {
    title: 'Stand to keep your total',
    caption: 'The second hand has 19. Click Stand to finish. Only after all player hands finish does the dealer reveal its hole card and act.',
  },
  'blackjack-reveal': {
    title: 'The revealed hole card completes the dealer total',
    caption: 'E’s hole card is now public: the dealer has 16 and must hit. Once the dealer finishes, each split hand is settled separately.',
    rule: 'A regular win profits 1× the stake; ties return it. A natural two-card 21 profits 1.5×. A player bust loses even if the dealer busts.',
  },
  'blackjack-rotate': {
    title: 'N deals the next hand',
    caption: 'E is now the bettor and chooses to stand after betting. N is the dealer and can see its own hole card; E still cannot.',
    rule: 'Rule card: with an ace or ten-value up card, the dealer checks for blackjack first. Dealer blackjack ends the hand immediately. There is no insurance or surrender.',
  },
  'blackjack-dealer': {
    title: 'A player dealer uses the controls too',
    caption: 'After E finishes, N has a dealer total of 14. Click Hit. A player dealer cannot stand below 17.',
  },
  'blackjack-dealer-stand': {
    title: 'A player dealer may stand from 17',
    caption: 'N has reached 17. Click Stand to finish the dealer turn. Player dealers may also hit at 17 or above; 21 or a bust ends the turn automatically.',
    rule: 'Rule card: no dealer draw is needed if every player hand is busted or a natural. If a player dealer cannot pay all winnings, winners receive proportional payouts.',
  },
  'blackjack-natural': {
    title: 'Hand three: a natural blackjack',
    caption: 'E deals again and N bets 100. Watch for immediate settlement: an unsplit ace plus a ten-value card is a natural blackjack.',
  },
  'blackjack-fast': {
    title: 'Speed through the last hand',
    caption: 'N deals the final hand. E bets, then hits. This accelerated sequence completes the same normal flow until all four hands are settled.',
    rule: 'Below 10 chips a seat cannot bet but still takes its dealer turn. The match ends early if fewer than two seats can bet.',
  },
  'blackjack-end': {
    title: 'Four hands complete: compare final stacks',
    caption: 'N finishes with 1,250 chips and E with 750. N wins by the final match stack, rather than the last hand alone.',
    outcome: 'Completed betting, splitting, doubling, hitting, standing, dealer decisions, a natural blackjack and both dealer rotations.',
  },
  'holdem-goal': {
    title: 'Hold’em: two private cards and five community cards',
    caption: 'Watch a three-seat match from N. Your two hole cards are visible; opponents’ cards are hidden. Make the best five-card hand from up to seven cards.',
    rule: 'Start with 1,000 chips each. Win every chip to finish early, otherwise play up to twenty hands. Blinds rise every four hands; the largest final stack wins.',
  },
  'holdem-preflop': {
    title: 'Preflop: button and blinds',
    caption: 'N has the button, E posts 10 and S posts 20. N clicks Call 20, E completes the difference, and S checks when nothing is owed.',
    rule: 'Preflop starts after the big blind; later streets start after the button. Heads-up, the button posts the small blind. There are no antes or burn cards.',
  },
  'holdem-flop': {
    title: 'Flop: three community cards',
    caption: 'The three flop cards are public now. E and S check. When N acts, compare your hole cards with the board before choosing a bet.',
    rule: 'Check only when nothing is owed. Facing a bet, call, raise or fold. Folding leaves your committed chips in the pot and exits only this hand.',
  },
  'holdem-bet': {
    title: 'Open the bet panel and enter a street total',
    caption: 'N clicks Bet, enters 100 in the amount field and confirms. The panel also offers a slider and Min, Half Pot, Pot and All-in shortcuts.',
    rule: 'The amount is the total for this street, not extra chips. Respect the displayed minimum; the maximum includes your existing street bet and remaining stack.',
  },
  'holdem-fold': {
    title: 'Opponents may fold or call',
    caption: 'Facing N’s 100, E folds and S calls. E’s hole cards remain hidden; E’s earlier blind contribution stays in the pot.',
  },
  'holdem-turn': {
    title: 'Turn: fourth community card and a new betting round',
    caption: 'The turn is public and street bets reset to zero. S and N check in order. Chips from earlier streets remain in the total pot.',
  },
  'holdem-river': {
    title: 'River: the fifth community card',
    caption: 'No more community cards follow the river. S checks first, then N acts. Remaining players reveal only after the final betting round closes.',
    rule: 'High to low: straight flush, four of a kind, full house, flush, straight, trips, two pair, pair, high card. Suits do not break ties; A2345 is the lowest straight.',
  },
  'holdem-showdown': {
    title: 'Check, show down, then start the next hand',
    caption: 'N clicks Check to close river betting. The server reveals remaining hands, awards the pot, rotates the button and automatically starts the next hand.',
  },
  'holdem-next-hand': {
    title: 'Hand two: different stack depths',
    caption: 'N won the previous pot. Before posting the new blinds, the stacks were N 1,140, E 980 and S 880. E has the button and calls first, before S acts.',
  },
  'holdem-short-stack': {
    title: 'A short stack can go all-in and still show down',
    caption: 'S opens Raise, chooses All-in and confirms 880. An all-in seat takes no further actions but keeps eligibility for the pot matching its contribution.',
  },
  'holdem-call': {
    title: 'N calls to 880',
    caption: 'N clicks Call to match 880. N still has chips and E still owes a decision, so the betting round continues.',
  },
  'holdem-short-raise': {
    title: 'An all-in below a full raise',
    caption: 'E goes all-in to 980, only 100 more, below the previous full raise size. N must match the difference but does not regain raising rights.',
    rule: 'Rule card: a short all-in does not reopen raising for players who already acted. A lone player with chips also cannot raise against all-in opponents.',
  },
  'holdem-sidepot': {
    title: 'Call the difference: main pot and side pot',
    caption: 'N clicks Call 100. N, E and S contest the 2,640 main pot; only N and E contest the 200 side pot. The board then runs out automatically before showdown.',
    rule: 'Rule card: award each pot independently. Ties split it, with odd chips clockwise after the button. Uncalled excess chips return to their owner.',
  },
  'holdem-end': {
    title: 'Two hands complete: win every chip at showdown',
    caption: 'The hole cards are legally public now. N’s three aces win both pots for a 3,000 stack. E and S have no chips, ending the match.',
    outcome: 'Completed preflop, flop, turn, river, betting, folding, all-ins, an incomplete raise and side-pot settlement.',
  },
  'stud-goal': {
    title: 'Five-card stud: one down, four up',
    caption: 'Watch from N in a two-seat match. Each seat antes 10, then receives one hidden card and one up card. Only your own hidden card is visible until showdown.',
    rule: 'Start with 1,000 chips each. No forced bring-in. The strongest showing hand opens each round, followed clockwise. Every hand uses a newly shuffled deck.',
  },
  'stud-hidden': {
    title: 'Up cards set the order; hidden cards affect strength',
    caption: 'N’s showing ace beats E’s king, so N acts first. E’s full hand cannot be known from an up card; a card back is still private information.',
    rule: 'Opening order compares showing quads, trips, two pair, pair, then high cards. Ties use ranks, then spades, hearts, diamonds, clubs. Showing straights and flushes do not count.',
  },
  'stud-bet': {
    title: 'The opener may check or bet',
    caption: 'N clicks Bet, enters 40 and confirms. The slider and Min, Half Pot, Pot and All-in shortcuts also work. Antes already count toward the pot.',
    rule: 'The current minimum bet is 20. A raise amount is the total for this round; the panel enforces the legal range.',
  },
  'stud-call': {
    title: 'Call before the next up card',
    caption: 'E clicks Call 40. The next up card is dealt only after all remaining players with chips match the bet and finish their decisions.',
    rule: 'Facing a bet, call, raise or fold. Check only when nothing is owed. Folding keeps the hole card private but forfeits committed chips.',
  },
  'stud-third': {
    title: 'Third card: reassess the showing hands',
    caption: 'N’s two up cards now make a pair of aces, so N opens again. Both players check. The server reassesses the showing-card order every round.',
  },
  'stud-fourth': {
    title: 'Fourth card: a fresh betting round',
    caption: 'The fourth card has been dealt. N bets to 100 and E calls. Earlier contributions stay in the pot while this round tracks its own bets.',
  },
  'stud-allin': {
    title: 'Fifth card: the final round goes all-in',
    caption: 'Each player has one down card and four up cards. N opens Bet, chooses All-in and confirms the remaining 850. N then has no further decisions.',
    rule: 'Rule card: an incomplete all-in raise does not reopen raising. Unequal contributions create main and side pots, each limited to eligible players.',
  },
  'stud-showdown': {
    title: 'Call all-in, then reveal the hole cards',
    caption: 'E calls all-in. Only after the final round closes are the hole cards shown. Compare each player’s five cards; there is no shared board as in Hold’em.',
    rule: 'High to low: straight flush, quads, full house, flush, straight, trips, two pair, pair, high card. Suits do not break final ties; tied hands split the pot.',
  },
  'stud-end': {
    title: 'One hand complete: N’s three aces win',
    caption: 'E’s hole card is public now. N’s three aces beat E’s pair of kings, collecting 2,000 including antes. E is eliminated and the match ends.',
    outcome: 'Otherwise play another hand, raising antes and minimum bets every four hands. The match lasts at most twenty hands, then compares remaining stacks.',
  },
  'tenhalf-goal': {
    title: 'Ten and a Half: manage points and hand types',
    caption: 'Watch all four hands from N. E banks first. Each bettor competes only against the banker; going over 10.5 busts the hand.',
    rule: 'Aces count 1, 2–10 their face value, and J/Q/K half a point. Start with 1,000 chips; two banker rotations make four hands with two seats.',
  },
  'tenhalf-bet': {
    title: 'Bettors stake chips; the banker does not',
    caption: 'N chooses the 100 chip and clicks Bet. Use − / + for steps of 10. After dealing, only your own first, face-down card is visible.',
    rule: 'Bet 10–200 within your stack. Other pending amounts and hole cards remain private.',
  },
  'tenhalf-hit': {
    title: 'Hit for a public up card',
    caption: 'N’s hole card is a ten. Click Hit to draw. Exceeding 10.5 busts immediately; exactly 10.5 or a fifth card automatically finishes the hand.',
  },
  'tenhalf-banker': {
    title: 'After bettors finish, the banker still acts',
    caption: 'N has reached ten and a half and finished automatically. E chooses Stand. Only after both finish are the hole cards revealed and the hand settled.',
    rule: 'There is no dealer-17 rule here. Bankers freely hit or stand, and still take a turn even when all bettors bust.',
  },
  'tenhalf-rotate': {
    title: 'Hand two: N becomes banker',
    caption: 'The first hand has been revealed and settled. N now banks while E bets. N skips betting and waits for the bettor’s turn to finish.',
  },
  'tenhalf-bust': {
    title: 'An opponent’s hit does not reveal the hole card',
    caption: 'E clicks Hit. The new up card is public, but N still cannot see E’s hole card. Watch the finished marker to know when your turn begins.',
    rule: 'Rule card: a busted bettor always loses, even if the banker busts too. Equal hand types and points favor the banker.',
  },
  'tenhalf-own-banker': {
    title: 'N’s banker turn',
    caption: 'N now acts with a private two. Click Hit to draw. Bankers see their own hole card, not their opponent’s.',
  },
  'tenhalf-settle': {
    title: 'Stand to reveal and settle the hand',
    caption: 'N has 5 points. Click Stand. With both players finished, the server reveals all hole cards and updates stacks according to the result.',
    rule: 'A winner gets the stake back plus stake × its own multiplier. A loser pays stake × the banker’s multiplier, capped at its starting stack. A short banker pays proportionally.',
  },
  'tenhalf-five-start': {
    title: 'Hand three: another route is five cards',
    caption: 'E banks again and N bets 100. Watch the card count this hand: the hole card counts, and five cards is the limit.',
  },
  'tenhalf-five': {
    title: 'Speed through hits while tracking points and count',
    caption: 'Starting with the private two, N repeatedly clicks Hit. This accelerated sequence shows four public draws; the fifth card automatically ends N’s turn.',
    rule: 'Rule card: five face cards ×5 > five cards totaling 10.5 ×4 > five cards below 10.5 ×3 > ten and a half ×2 > ordinary points ×1.',
  },
  'tenhalf-special-settle': {
    title: 'Special hands outrank ordinary point totals',
    caption: 'N has five cards without busting: a Five Small hand. E now hits; wait for E to finish before showdown. E’s hole card is still private.',
  },
  'tenhalf-fast': {
    title: 'Speed through the fourth hand and final rotation',
    caption: 'Hand three is settled. In the final hand N banks, E bets and stands, then N hits. Continue until all four hands have settled normally.',
    rule: 'Below 10 chips a seat cannot bet but still banks. Fewer than two seats able to bet ends the match early.',
  },
  'tenhalf-end': {
    title: 'Four hands complete: final stacks decide the match',
    caption: 'N finishes with 1,500 and E with 500, so N wins. The match covered ten and a half, a bust, Five Small and a banker bust: points alone do not determine every result.',
    outcome: 'Check whose turn it is, your points and your card count before choosing Hit or Stand. All hole cards reveal only when everyone has finished.',
  },
};
