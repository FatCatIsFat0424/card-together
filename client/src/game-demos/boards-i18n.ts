import type { DemoText } from './types';

export const boardsDemoZh = {
  'reversi-start': {
    title: '黑白棋：從四顆棋子開始', caption: '這局固定從黑方視角觀看。黑先白後，在 8×8 棋盤輪流落子。',
  },
  'reversi-goal': {
    title: '目標：終局留下更多己色棋子', caption: '落子必須夾住對手，才能把對手翻成自己的顏色。中途領先不代表最後獲勝。',
  },
  'reversi-place': {
    title: '點選合法空格落子', caption: '輪到自己時，提示點是合法落點。滑鼠點一下送出；觸控預設先預覽，再按「確認」或再點同格。',
    rule: '觸控可按「取消」重選；開啟「一點即走」後省略確認。',
  },
  'reversi-flip': {
    title: '被夾住的棋子全部翻面', caption: '第一手已把中間的白子翻黑。接著看白方如何用新的落子反夾。',
    rule: '新子與原有己子之間，必須連續有至少一顆對手棋子，不能隔空格。',
  },
  'reversi-directions': {
    title: '同時檢查八個方向', caption: '橫、直、斜線都可以夾子；同一手夾住多個方向時，會一起翻轉。觀察手數紀錄與最後落點。',
  },
  'reversi-corners': {
    title: '加速觀察邊線與角落', caption: '接下來加速雙方的合法落子。角落不會再被夾翻，選點時也要考慮會留給對手哪些位置。',
  },
  'reversi-pass': {
    title: '規則卡：無子可下時自動跳過', caption: '這裡暫停說明跳過規則，不另外操作跳過按鈕。',
    rule: '單方沒有合法落點就自動跳過；雙方都無處可下即結束，不必等棋盤全滿。',
  },
  'reversi-speed': {
    title: '加速完成中盤與收官', caption: '保留接下來每一手，逐步填入剩餘空格。翻子數會反覆變動，最後才計算勝負。',
  },
  'reversi-last': {
    title: '最後一格', caption: '棋盤只剩一個空格，接下來落子後由伺服器判定雙方是否還有合法步。',
  },
  'reversi-end': {
    title: '結算：黑方 44 比 20 獲勝', caption: '60 手後黑方留下 44 子、白方 20 子。結算顯示勝負、原因與手數；按「返回房間」回到等待區。',
    rule: '終局子數相同是和局；也可在自己的回合提和，對方同意才成立。', outcome: '黑方以終局子數獲勝。',
  },
  'gomoku-start': {
    title: '五子棋：15×15 交叉點', caption: '這局示範已開啟「交換開局」與「連珠禁手」的房規，從第一位玩家的視角觀看。',
    rule: '預設房規兩項皆關閉；開局前由房主設定，開始後不能更改。',
  },
  'gomoku-goal': {
    title: '目標：橫、直、斜連成五子', caption: '每次下在空的交叉點，落下的棋子不能移動。這是簡短規則範例，白方刻意不阻擋黑方的連線。',
  },
  'gomoku-opening': {
    title: '先手玩家連下黑、白、黑', caption: '交換開局的前三顆，都由第一位玩家依序放置。點空交叉點落子；觸控預設再按「確認」或再點同點。',
    rule: '畫面提示目前該放哪一色；這三手還不是雙方輪流下。',
  },
  'gomoku-choose': {
    title: '後手選「執黑」或「執白」', caption: '三顆開局子已放好，現在由對手選色。本例選「執白」保留原色，之後白方先下。',
    rule: '選「執黑」會交換雙方顏色，座位不交換；固定玩家視角會等待對手完成選色。',
  },
  'gomoku-place': {
    title: '選色後正常輪流落子', caption: '白方下完再輪到黑方。滑鼠點選直接落子；觸控可先看預覽，再確認或取消重選。',
  },
  'gomoku-forbidden': {
    title: '規則卡：黑方的連珠禁手', caption: '這局有開連珠禁手。輪到黑方時，不合法位置以紅叉提示，不能送出。',
    rule: '黑方不能下出長連、雙四或雙三；恰好五子優先視為合法勝利。白方五子以上都算贏。',
  },
  'gomoku-speed': {
    title: '加速累積威脅', caption: '接下來加速幾手，觀察黑白雙方的連線與空端。實戰看見對方快連五時，要及早阻擋。',
  },
  'gomoku-five': {
    title: '最後一子連成五顆', caption: '黑方現在已有連續四子，輪到黑方補上第五顆。伺服器判勝後，棋盤會標出獲勝連線。',
  },
  'gomoku-end': {
    title: '結算：黑方連五獲勝', caption: '9 顆落子加一次選色，完成這局交換開局範例。查看勝負原因與子數，再按「返回房間」。',
    rule: '棋盤下滿仍無人獲勝即和局；未開連珠禁手時，雙方連成五顆以上都算贏。', outcome: '黑方恰好五子連線獲勝。',
  },
  'xiangqi-start': {
    title: '象棋：標準開局', caption: '這局沒有讓子。我方在下方執紅先走，對手執黑，所有棋子都是公開資訊。',
  },
  'xiangqi-goal': {
    title: '目標：將死或困斃對手', caption: '保護自己的帥，同時封住對方將的所有合法應對。吃掉很多棋子不是直接的勝利條件。',
  },
  'xiangqi-move': {
    title: '先選棋子，再選合法落點', caption: '點自己的棋子顯示合法提示，再點落點。滑鼠直接走子；觸控預設先預覽，再按「確認」或再點落點。',
  },
  'xiangqi-cannon': {
    title: '炮吃子必須隔一顆', caption: '剛才紅炮隔著黑炮吃掉黑馬，現在黑車可以回吃。吃子會出現在手數紀錄中。',
    rule: '車直橫走且不能越子；炮不吃子時同車，吃子時中間必須恰好隔一顆棋子。',
  },
  'xiangqi-pieces': {
    title: '馬、象、士與兵各有走法', caption: '接著看雙方出馬與移動士、炮。選子後只會標示目前合法的位置。',
    rule: '馬怕蹩腳；象走田字、不能過河且怕塞眼；士斜走一步、將帥直橫一步，都限九宮；兵只向前，過河後可橫走。',
  },
  'xiangqi-safety': {
    title: '規則卡：不能讓自己的帥被將軍', caption: '將帥也不能沒有遮擋地在同一路直接相對。這些限制已計入合法落點。',
    rule: '本遊戲同局面第三次出現時，單方持續將軍者判負，其他情形和局；連續 120 手無吃子也和局。',
  },
  'xiangqi-speed': {
    title: '加速完成中盤', caption: '接下來保留每手走子並加速播放。注意黑車逐漸深入紅方，紅方仍要兼顧將帥安全。',
  },
  'xiangqi-check': {
    title: '觀察黑方下一步的攻勢', caption: '黑車已深入我方半場，接下來觀察它如何打開中路。若被將軍，下一手必須解除威脅。',
  },
  'xiangqi-escape': {
    title: '紅方被將軍：先解將', caption: '黑車剛吃掉中兵並將軍。紅方用仕擋住車線，這一步必須通過將帥安全檢查。',
  },
  'xiangqi-mate': {
    title: '黑炮加入最後攻勢', caption: '紅方已用仕擋住車，輪到黑方繼續進攻。觀察炮線與紅帥九宮內的退路。',
  },
  'xiangqi-end': {
    title: '結算：黑方將死獲勝', caption: '46 手後紅方無法解將，黑方獲勝。結算列出將死與手數，按「返回房間」結束。',
    rule: '輪到的一方即使沒被將軍，只要完全沒有合法步也算輸，稱為困斃。', outcome: '本局我方紅棋落敗，黑方將死獲勝。',
  },
  'go-start': {
    title: '圍棋：9 路棋盤', caption: '這局在 9×9 的交叉點上進行，不讓子，我方執黑先下。所有棋子都是公開資訊，棋盤固定不旋轉。',
  },
  'go-goal': {
    title: '目標：圍住更多地盤', caption: '採數子法：自己的棋子，加上只被自己圍住的空點。白棋加貼目 7.5，所以不會有和局。',
    rule: '提到的子數不是勝負依據；最後比的是雙方的目數。',
  },
  'go-place': {
    title: '點交叉點落子', caption: '輪到自己時，點空的交叉點放一顆棋，放下後不能移動或收回。滑鼠直接落子；觸控預設先出現十字準星預覽，再按「確認」或再點同一點。',
    rule: '座標的列由下往上，欄位字母跳過 I，例如 D4。開啟「一點即走」後，觸控也會省略確認。',
  },
  'go-liberty': {
    title: '氣：棋子旁邊的空點', caption: '棋子上下左右相鄰的空點叫「氣」，相連的同色棋共用氣。接著白 E5 被黑棋包住三面，只剩一口氣。',
    rule: '一塊棋失去最後一口氣，就會被提走。只剩一口氣時稱為叫吃。',
  },
  'go-capture': {
    title: '提子：占住最後一口氣', caption: '黑下 D5，占住白 E5 的最後一口氣，這顆白子被提走，提子數會顯示在座位旁。',
    rule: '被提走的位置成為空點，之後雙方都能再下在那裡，但要遵守劫的規則。',
  },
  'go-rules': {
    title: '規則卡：自殺與劫', caption: '以下是規則補充，這局沒有出現。下在沒有氣的位置（自殺）不允許，除非同時提走對手的棋。',
    rule: '也不能下出讓棋盤回到先前任何一個出現過的局面，這條劫規則涵蓋單劫與循環劫。牌桌不標示這些點，它們無法點選。',
  },
  'go-speed': {
    title: '加速完成中盤', caption: '接下來加速播放，觀察雙方如何圍出地盤、互相提子；每一手都會記在手數紀錄中。',
  },
  'go-pass': {
    title: '停一手與結束對局', caption: '雙方都沒有值得下的地方時，按「停一手」再確認。對手先停一手，我方也停一手；連續兩次停一手，對局就停止。',
    rule: '手數達棋盤點數的 3 倍（9 路為 243 手，停一手也算一手）也會停止。停止後都進入點目。',
  },
  'go-mark': {
    title: '點目：先看伺服器標出的死子', caption: '伺服器依形勢先標出它認為已死的棋子，以淡色顯示；小方塊標示各自圍住的地盤，上方即時顯示雙方目數。',
    rule: '死子在計分前先從盤面拿掉。雙方共用一個期限，逾時未確認的真人視為接受目前標記。',
  },
  'go-toggle': {
    title: '點選棋塊，切換死活', caption: '右上角的黑 J9 被白棋包圍，卻沒有被標出。我方點一下，整塊相連的棋一起改標為死子，目數立即更新。',
    rule: '再點一次改回活子。任何切換都會清除雙方的確認，必須重新確認。',
  },
  'go-resume': {
    title: '規則卡：看法不同就繼續下棋', caption: '以下是規則補充，這局不需要。若雙方對死活的看法不同，任一方可按「繼續下棋」回到對局，由最後停一手者的對手先下。',
    rule: '確認時會附上自己看到的死子清單；標記若已變更就會被拒絕，所以不會確認到沒看過的結果。已達手數上限的對局不能繼續。',
  },
  'go-confirm': {
    title: '雙方確認，才計分', caption: '我方按「確認點目」，畫面顯示等待對手；對手確認後，伺服器立即依數子法結算。',
  },
  'go-end': {
    title: '結算：黑棋勝 3.5 目', caption: '黑棋 46 目，白棋 35 目加貼目 7.5，黑棋以 3.5 目獲勝。結算也列出手數與共提子數，按「返回房間」結束。',
    rule: '可隨時認輸，包含點目期間。不開放提和，貼目的 .5 也讓對局沒有和局。', outcome: '我方黑棋以數子法勝 3.5 目。',
  },
  'chess-start': {
    title: '西洋棋：8×8 棋盤', caption: '這局固定從白方視角觀看：我方在下方執白、先走，黑方在上方。所有棋子都是公開資訊，沒有讓子。',
  },
  'chess-goal': {
    title: '目標：將死對方的王', caption: '王被攻擊稱為「將軍」；被將軍又無法解除，就是「將死」，將死的一方輸。吃掉很多棋子不是直接的勝利條件。',
  },
  'chess-move': {
    title: '先選棋子，再選合法落點', caption: '點自己的棋子，棋盤標出合法落點，再點落點。滑鼠直接走子；觸控預設先預覽，再按「確認」或再點落點。',
    rule: '手數紀錄使用標準代數記譜，例如 Nc3 是馬走到 c3。可隨時認輸；輪到自己時可以提和，對手同意才成立。',
  },
  'chess-pieces': {
    title: '六種棋子｜重複走子加速展示', caption: '接下來加速展示：馬跳出、兵推進與吃子、后出動。選到棋子後，只會標示目前合法的落點。',
    rule: '王走一格；后直橫斜不限距離；車直橫、象斜走不限距離，都不能越子；馬走 L 形，可跳過棋子；兵向前一格（起始位置可走兩格），斜前一格吃子。',
  },
  'chess-check': {
    title: '被將軍：必須立刻解除', caption: '黑后走到 e7，沿 e 線攻擊我方的王。被將軍時，下一手必須解除威脅，棋盤只提供合法的應對；我方用象擋在中間。',
    rule: '解將有三種方法：移開王、吃掉攻擊的棋子、擋住攻擊線。任何一步都不能讓自己的王處於被將軍的狀態。',
  },
  'chess-escape': {
    title: '另一種解將：吃掉攻擊者', caption: '黑馬先跳到 b4，我方走兵後，黑馬吃掉 c2 的兵並將軍。我方改用后把這匹馬吃掉。',
    rule: '馬的攻擊無法擋住，只能移王或吃掉它。王也不能走到被攻擊的格子。',
  },
  'chess-speed': {
    title: '加速完成中盤', caption: '接下來加速播放：我方象將軍，黑兵擋住後被吃；白兵再吃一子，讓象的攻擊線打開，黑王被迫移開。',
  },
  'chess-promote': {
    title: '兵到底線：選擇升變棋子', caption: '白兵吃掉 a8 的黑車並到達底線，必須升變。棋盤跳出選單，這裡選「后」；黑象隨後把新的后吃回。',
    rule: '升變可選后、車、象或馬，不能維持為兵。升變後的棋子也可能被吃。',
  },
  'chess-castle': {
    title: '王車易位', caption: '點王再點 g1：王向車靠近兩格，車自動跳到王的另一側。這一步同時讓王更安全，並讓車離開角落。',
    rule: '條件：王與該側的車都沒動過，中間沒有棋子；王不能在被將軍時易位，也不能經過或停在被攻擊的格子。短易位記為 O-O，長易位記為 O-O-O。',
  },
  'chess-enpassant': {
    title: '規則卡：吃過路兵', caption: '以下是規則補充，這局沒有出現。敵兵從起始格一次走兩格，停在我方兵旁邊時，我方兵可以斜走到它經過的格子，把它吃掉。',
    rule: '只能在緊接著的下一步執行，錯過就不能再吃。操作與一般兵吃子相同：點兵，再點那個空格，記譜例如 exd6。',
  },
  'chess-draws': {
    title: '規則卡：自動和局', caption: '以下是規則補充。伺服器會立即判和，不必宣告：困斃、同一局面第三次出現、雙方各走 50 步都沒有吃子或動兵、子力不足以將死。',
    rule: '困斃是輪到的一方沒被將軍卻無合法步。子力不足只判王對王、王加單象或單馬對王、雙方只剩同色格的象。',
  },
  'chess-mate': {
    title: '連續將軍，直到將死', caption: '我方馬跳開，露出后的 c 線將軍；黑象擋住後被后吃掉，再次將軍；黑王退回 d8，后走到 a8，王沒有任何出路。',
    rule: '將死是被將軍，而且無法移王、吃掉攻擊者或擋住攻擊線。',
  },
  'chess-end': {
    title: '結算：白方將死獲勝', caption: '33 手後黑王無法解將，我方白棋獲勝。結算列出將死的原因與手數，按「返回房間」結束。',
    rule: '和局時雙方同列第一。逾時不會判負，系統會代走一步合法棋。', outcome: '我方白棋將死黑王獲勝。',
  },
  'jungle-start': {
    title: '鬥獸棋：八種動物的攻防', caption: '我方執紅先走，每方八隻動物；河流、陷阱與獸穴都會改變走法與戰局。',
  },
  'jungle-goal': {
    title: '目標：進入對方獸穴', caption: '走進對方獸穴就贏，不用先吃光對手。也可以吃光對方或讓對方完全無合法步獲勝。',
  },
  'jungle-move': {
    title: '點動物，再點合法格', caption: '一般上下左右走一格，不能進自己的獸穴。點我方動物查看提示，再選落點；觸控預設還要確認。',
  },
  'jungle-river': {
    title: '只有鼠可以進河流', caption: '紅鼠正在岸邊，接下來可以走進水域。選子後的提示也會排除不能到達的水格。',
    rule: '水中與岸上不能互吃，鼠只能走到空岸格離水；兩隻水中鼠可以互吃。',
  },
  'jungle-ranks': {
    title: '加速觀察吃子與等級', caption: '接下來加速雙方接觸。象、獅、虎、豹、狼、狗、貓、鼠依序由大到小，同級也能吃。',
    rule: '例外：岸上的鼠能吃象，象不能吃鼠；對手陷阱中的棋子另有等級限制。',
  },
  'jungle-leap': {
    title: '獅、虎沿直線跳河', caption: '接下來加速推進，留意藍獅的長距離跳河，之後紅象可以反吃。',
    rule: '獅虎可直線跳過整片河，落點須為空或能吃的敵子；水路中任何一隻鼠都會阻止跳躍。',
  },
  'jungle-traps': {
    title: '陷阱會削弱入侵者', caption: '加速觀察後續交戰；獸穴旁的三格陷阱，能保護守方，進攻前要先看清楚。',
    rule: '站在對方陷阱中的棋子等級視為 0，吃不了別人，也能被任何敵子吃掉；離開後恢復。',
  },
  'jungle-speed': {
    title: '加速推進到獸穴前', caption: '雙方繼續移動與交戰，紅獅往對方獸穴靠近。這段包含通往終局的所有動作。',
    rule: '連續 100 手沒有吃子會自動和局；也可在自己回合提和，等待對方同意。',
  },
  'jungle-den': {
    title: '最後一步進穴', caption: '紅獅已到藍方獸穴前，輪到紅方進入獸穴，讓伺服器判定勝負。',
  },
  'jungle-end': {
    title: '結算：紅方進穴獲勝', caption: '55 手後紅獅進入藍方獸穴；場上仍有雙方棋子，遊戲也立即結束。查看原因與手數後返回房間。',
    outcome: '紅方以進入對方獸穴獲勝。',
  },
  'landbattle-start': {
    title: '陸戰棋：先布陣，再交戰', caption: '固定從紅方觀看。每方 25 枚棋，只有己方身份公開；對方棋子由伺服器秘密裁判。',
  },
  'landbattle-goal': {
    title: '目標：奪取對方軍旗', caption: '奪下軍旗或讓對手沒有合法走法就獲勝。先完成合法布陣，才能開始輪流走子。',
  },
  'landbattle-deploy': {
    title: '點兩個位置交換布陣', caption: '可選預設陣型或按「自動」，也可點兩枚己棋交換。本例使用自動產生的合法陣型。',
    rule: '軍旗限大本營；地雷限最後兩排；炸彈不能放最前排；行營開局留空。非法交換會提示原因。',
  },
  'landbattle-submit': {
    title: '按「確認布陣」鎖定陣型', caption: '雙方各自確認，提交後不能修改。對手確認只表示已準備好，不會公開軍階；雙方完成才開戰。',
  },
  'landbattle-move': {
    title: '選己棋與合法落點', caption: '點己棋查看可走位置，再點目標。滑鼠直接送出；觸控預設先預覽，再按「確認」或再點落點。',
  },
  'landbattle-terrain': {
    title: '加速觀察公路、鐵路與行營', caption: '公路走一站，鐵路可以直線走遠但不能越子；接下來加速雙方前線調動。',
    rule: '行營內的棋子不能被攻擊；地雷、軍旗及進入大本營的棋子都不能移動。',
  },
  'landbattle-battle': {
    title: '第一次交戰只公布結果', caption: '紅方前線棋子準備攻擊藍方。裁判只告知進攻勝、負或同歸於盡，不公布對手軍階。',
  },
  'landbattle-specials': {
    title: '加速交戰：大小與特殊棋', caption: '觀察裁判的勝負提示與棋子消失。不能只從對方外觀猜定身份，走法與公開結果才是線索。',
    rule: '大吃小，同級同歸於盡；炸彈與對手同歸於盡；工兵可排雷，其他棋子碰地雷陣亡。任何棋子都能奪旗。',
  },
  'landbattle-engineer': {
    title: '工兵能沿鐵路轉彎', caption: '加速看紅方工兵調動；選到合法終點即可，伺服器會找出路線，紀錄也會列出途經站點。',
    rule: '只有工兵能在鐵路轉彎；鐵路路線仍不能穿過其他棋子。',
  },
  'landbattle-hidden': {
    title: '加速進攻，保持對方身份隱藏', caption: '接下來每一手仍使用紅方資訊。對手動過的棋子不可能是地雷或軍旗，但軍階依然不會直接顯示。',
  },
  'landbattle-flag': {
    title: '藍方司令陣亡，軍旗位置公開', caption: '剛才的同歸於盡使藍方司令陣亡，現在才公開藍方軍旗位置。其他未公開軍階仍然蓋著。',
    rule: '司令陣亡才亮出該方軍旗；不是每次交戰都翻開棋子。',
  },
  'landbattle-speed': {
    title: '加速完成奪旗前的調動', caption: '雙方軍旗現在都已公開，接下來加速剩餘走子與交戰，觀察紅方如何抵達藍方大本營前。',
    rule: '連續 60 手沒有交戰會和局；提和也須對方同意。',
  },
  'landbattle-capture': {
    title: '最後一步奪旗', caption: '紅棋已在藍方軍旗旁，輪到紅方攻入大本營。這次目標是已公開的軍旗。',
  },
  'landbattle-end': {
    title: '結算：紅方奪旗獲勝', caption: '雙方布陣後共走 137 手，紅方奪旗。結束後才公開剩餘全部軍階；查看原因與手數後返回房間。',
    outcome: '紅方奪旗獲勝，雙方各剩 7 枚棋。',
  },
  'battleship-start': {
    title: '海戰棋：從隱藏艦隊開始', caption: '我方與對手各有一片 10×10 海域。固定使用我方玩家視角，對手船位尚未公開。',
  },
  'battleship-goal': {
    title: '目標：擊沉對手全部五艘船', caption: '航空母艦 5 格、戰艦 4 格、巡洋艦與潛艇各 3 格、驅逐艦 2 格，共 17 格要命中。',
  },
  'battleship-place': {
    title: '選船，再點船首位置', caption: '從船隻按鈕選船，點海域放船；用「旋轉」切換方向，也可「隨機擺放」或「清除」。已放的船可點選後重新定位。',
    rule: '船不能超界或重疊；再次點選同一艘已選的船也能旋轉。本例提交一組固定的合法艦隊。',
  },
  'battleship-confirm': {
    title: '按「確認艦隊」鎖定', caption: '五艘船都合法時才能確認，確認後不能更改。雙方都完成後開始射擊；只看得到對手準備狀態。',
  },
  'battleship-shot': {
    title: '在敵方海域選一格射擊', caption: '點未射過的格子。滑鼠直接射擊；觸控預設先預覽，再按「確認」或再點同格。這局採雙方一人一發。',
    rule: '同一格不能射兩次；我方海域顯示自己的船與敵方射擊結果。',
  },
  'battleship-hit': {
    title: '未中之後繼續搜尋', caption: '雙方第一發都未中，現在輪到我方選另一格。依公開射擊結果縮小可能範圍。',
  },
  'battleship-target': {
    title: '命中後追查相鄰格', caption: '我方剛命中一格，但還不知道船型與全長。接下來沿附近格子追查，對手仍會輪流射擊。',
    rule: '命中不會公開船型；船的所有格子都被命中時才判定擊沉。',
  },
  'battleship-sunk': {
    title: '擊沉後才公開船型與位置', caption: '現在戰艦已被擊沉，紀錄顯示船名與完整四格位置。其他尚未擊沉的船仍然隱藏。',
  },
  'battleship-options': {
    title: '規則卡：房規會改變搜尋方式', caption: '本例兩項房規皆關閉，船可以相鄰，命中後仍然換人。',
    rule: '開局前可開啟「船隻不可相鄰」（含斜角），或「命中可再射」（擊沉也再射）。本模式沒有提和。',
  },
  'battleship-speed': {
    title: '加速完成搜尋與擊沉', caption: '保留後續每一發並加速播放，只依未中、命中與擊沉資訊搜尋。對手還沒沉的船不會提前顯示。',
  },
  'battleship-last': {
    title: '最後一艘仍要逐格確認', caption: '我方已擊沉四艘，還有一個命中點未解決。接下來射擊相鄰格，確認剩餘船隻。',
  },
  'battleship-end': {
    title: '結算：我方擊沉全部五艘', caption: '我方共射 41 發、命中 17 格、擊沉 5 艘，取得勝利。結束後才公開雙方完整艦隊；查看結算後返回房間。',
    outcome: '我方以艦隊全滅獲勝；對手共射 40 發。',
  },
  'banqi-start': {
    title: '暗棋：32 枚全部蓋著', caption: '這局固定從先手玩家觀看。雙方都不知道蓋牌身份，也尚未決定自己是紅方或黑方。',
  },
  'banqi-goal': {
    title: '目標：吃光對手或讓對手無棋可走', caption: '每回合可以翻一枚蓋牌，或移動自己的明棋。第一枚翻出的顏色決定雙方所屬。',
  },
  'banqi-flip': {
    title: '點一枚蓋牌翻開', caption: '點要翻的蓋牌；滑鼠直接翻，觸控預設先預覽，再按「確認」或再點一次。身份在翻開後才會公布。',
  },
  'banqi-colour': {
    title: '第一枚翻出黑將：我方執黑', caption: '我方剛翻出黑將，所以我方黑、對手紅。對手翻到的棋子不一定是自己的顏色，不能任意移動它。',
  },
  'banqi-blind': {
    title: '連吃房規也允許吃暗子', caption: '我方準備用黑將攻擊相鄰蓋牌，但事前不知道裡面是誰。點自己的明棋，再點合法的蓋牌目標。',
    rule: '本例開啟預設的連吃與吃暗子，未開車直衝。攻擊後才翻出目標並判定能否吃下。',
  },
  'banqi-reveal': {
    title: '吃暗子失敗：翻開，回合結束', caption: '剛才翻出己方黑卒，所以黑將留在原位、黑卒翻開，接著由對手行動。不能事先查看蓋牌再選。',
    rule: '翻到敵子且吃得下才移入；翻到己子或吃不下時，只翻開並結束回合。',
  },
  'banqi-capture': {
    title: '點明棋與可吃的敵子', caption: '對手剛翻出紅相，黑將可以吃它。選黑將看合法提示，再選紅相；觸控預設先確認。',
  },
  'banqi-stop': {
    title: '不繼續連吃時按「結束回合」', caption: '剛才吃子後還有連吃選項，回合尚未換人。按「結束回合」可以把剩餘連吃機會放棄。',
  },
  'banqi-ranks': {
    title: '加速觀察翻棋與吃子', caption: '將帥、士、象、車、馬、炮、兵依序排列。一般走直橫一格，同級或較小的敵子能吃。',
    rule: '兵卒能吃將帥，將帥不能吃兵卒；炮吃子必須直線隔恰好一枚，且不受目標大小限制。',
  },
  'banqi-speed': {
    title: '加速完成翻棋與中盤交戰', caption: '接下來保留全部翻棋、吃暗子、移動與結束回合動作，逐漸公開盤面，直到最後幾枚棋子。',
  },
  'banqi-chain': {
    title: '同一枚棋子接著連吃', caption: '黑士剛吃一子後仍可連吃，必須使用這枚黑士繼續選合法目標，也可按「結束回合」。',
    rule: '連吃不能換另一枚棋子，也不能走不吃子的步；若下一手吃暗子失敗，回合立即結束。',
  },
  'banqi-limit': {
    title: '加速收官：留意無吃子計數', caption: '雙方繼續移動最後的棋子。數量落後仍可能反吃，但要避免完全失去合法行動。',
    rule: '連續 50 次不吃子的移動會和局；翻棋或吃暗子會重設計數。提和須對手同意。',
  },
  'banqi-last': {
    title: '最後一枚黑棋受到威脅', caption: '我方只剩一枚黑士，對手的紅士在相鄰格。接下來觀察最後一次吃子與勝負判定。',
  },
  'banqi-end': {
    title: '結算：紅方吃光黑方', caption: '我方黑棋全被吃光，紅方剩 8 枚獲勝。81 筆翻走棋紀錄加 12 次結束連吃，完整結束本局。查看結算後返回房間。',
    outcome: '我方黑棋落敗，紅方以吃光對手獲勝。',
  },
  'chinesecheckers-start': {
    title: '跳棋：十顆彈珠的對角競賽', caption: '這局是兩人對局，固定從我方起始角在下方觀看。每人十顆彈珠，所有位置都公開。',
    rule: '支援 2、3、4 或 6 人；5 人不能開始。',
  },
  'chinesecheckers-goal': {
    title: '目標：填滿對角的十個孔', caption: '把彈珠從自己的起始角移向正對面的目標角。跳過的彈珠不會被吃，任何顏色都可以當跳板。',
  },
  'chinesecheckers-jump': {
    title: '選彈珠，再選合法落點', caption: '點己方彈珠查看提示，再點最終落點。滑鼠直接走；觸控預設先預覽，再按「確認」或再點落點。',
    rule: '走到相鄰空孔，或跳過相鄰一顆彈珠，落到同方向正後方的空孔。',
  },
  'chinesecheckers-chain': {
    title: '連跳只要點最終落點', caption: '我方後排彈珠現在可以連跳。選起點與最後一孔即可，伺服器會找合法路徑，不用逐孔點擊。',
    rule: '連跳可以轉向；一般走一步後不能再跳，跳完也不能再加走一步。',
  },
  'chinesecheckers-move': {
    title: '加速讓後排也跟上', caption: '雙方輪流移動，利用己方與敵方彈珠搭出連跳路線。手數紀錄會列出連跳途中落點。',
  },
  'chinesecheckers-speed': {
    title: '加速穿越中央棋盤', caption: '接下來保留所有動作並加速，觀察彈珠從兩端相遇、借用跳板，再進入各自目標角。',
  },
  'chinesecheckers-block': {
    title: '規則卡：防堵與自動跳過', caption: '這裡暫停說明目標角判定。若對手故意留子在你的目標角，並不一定能阻止你獲勝。',
    rule: '目標十孔全滿且至少一顆是自己的就完成，敵子視為到位；任何人補滿最後一孔都立即判勝。全無合法步則自動跳過。',
  },
  'chinesecheckers-finish': {
    title: '加速把最後幾顆送入目標角', caption: '接下來逐步補齊目標角空孔，同時留意名牌上的「到位」與「尚差列數」。',
    rule: '每人 150 回合上限或全員無棋可走時，比尚差列數，最少者勝；全員相同則和局。',
  },
  'chinesecheckers-last': {
    title: '對手只差最後一孔', caption: '對手的目標角已幾乎填滿，下一步補上空孔即可完成；我方仍有彈珠尚未到位。',
  },
  'chinesecheckers-end': {
    title: '結算：對手先完成對角', caption: '102 手後，對手到位 10/10，我方 7/10，對手獲勝。查看勝負原因與手數後按「返回房間」。',
    rule: '多人局第一位完成就結束；其餘依尚差列數排名，相同並列。', outcome: '我方第二，對手以全部抵達對角獲勝。',
  },
} satisfies Record<string, DemoText>;

export const boardsDemoEn: Record<keyof typeof boardsDemoZh, DemoText> = {
  'reversi-start': {
    title: 'Reversi: start with four discs', caption: 'We keep the dark player’s perspective throughout. Dark moves first on the 8×8 board, then light.',
  },
  'reversi-goal': {
    title: 'Goal: finish with more discs', caption: 'Bracket opposing discs to turn them into your colour. A lead in the middle of the match does not guarantee victory.',
  },
  'reversi-place': {
    title: 'Choose a legal empty square', caption: 'Dots mark legal destinations on your turn. Click to play with a mouse; touch previews first, then use Confirm or tap the same square again.',
    rule: 'On touch, Cancel lets you choose again. One-tap mode skips confirmation.',
  },
  'reversi-flip': {
    title: 'Every bracketed disc flips', caption: 'The first move has flipped the white disc between the dark discs. Now watch light bracket a disc in reply.',
    rule: 'There must be at least one continuous opposing disc between the new disc and an existing friendly disc, with no empty gap.',
  },
  'reversi-directions': {
    title: 'Check all eight directions', caption: 'Horizontal, vertical and diagonal lines all count. A move can flip several directions at once. Follow the move list and last-move marker.',
  },
  'reversi-corners': {
    title: 'Faster play: edges and corners', caption: 'We speed up the next legal moves. A corner disc cannot be bracketed again; consider which replies your move leaves available.',
  },
  'reversi-pass': {
    title: 'Rule card: automatic passes', caption: 'Pause here to explain passing. There is no separate pass button to operate.',
    rule: 'A player with no legal square passes automatically. When neither player can move, the match ends even if squares remain empty.',
  },
  'reversi-speed': {
    title: 'Fast-forward through the middle and endgame', caption: 'Every remaining move is retained as the empty squares fill. Disc counts can swing repeatedly before the final count.',
  },
  'reversi-last': {
    title: 'The last empty square', caption: 'One square remains. After this placement the server checks whether either player still has a legal move.',
  },
  'reversi-end': {
    title: 'Result: dark wins 44–20', caption: 'After 60 placements, dark has 44 discs and light 20. Review the outcome, reason and move count, then use Back to room.',
    rule: 'Equal final disc counts draw. A draw offer on your turn also needs the opponent’s agreement.', outcome: 'Dark wins by final disc count.',
  },
  'gomoku-start': {
    title: 'Gomoku: a 15×15 grid', caption: 'This example enables Swap opening and Renju forbidden moves. We keep the first player’s perspective.',
    rule: 'Both options are off by default. The host chooses them before the match; they cannot change during play.',
  },
  'gomoku-goal': {
    title: 'Goal: connect five stones', caption: 'Use empty intersections to make a horizontal, vertical or diagonal line. Stones cannot move. For this short rules example, white deliberately leaves black’s line unblocked.',
  },
  'gomoku-opening': {
    title: 'First player places black, white, black', caption: 'In the swap opening, the first player places all three opening stones. Click an empty intersection; touch previews before Confirm or a second tap.',
    rule: 'The prompt shows which colour to place. Players do not alternate during these first three stones.',
  },
  'gomoku-choose': {
    title: 'Second player chooses Black or White', caption: 'The three opening stones are on the board. The opponent now chooses a colour; this example keeps White, which moves next.',
    rule: 'Choosing Black swaps colours, not seats. The fixed player view waits while the opponent chooses.',
  },
  'gomoku-place': {
    title: 'Alternate normally after the choice', caption: 'After white plays, black moves. Mouse clicks place immediately; touch previews allow confirmation or cancellation.',
  },
  'gomoku-forbidden': {
    title: 'Rule card: Renju restrictions for black', caption: 'Renju is enabled here. On black’s turn, red crosses mark forbidden points that cannot be played.',
    rule: 'Black cannot make an overline, double four or double three; an exact five takes priority as a legal win. White wins with five or more.',
  },
  'gomoku-speed': {
    title: 'Faster play: build a threat', caption: 'Speed through the next few moves and watch both lines and their open ends. In a competitive game, block the opponent before they connect five.',
  },
  'gomoku-five': {
    title: 'Place the fifth stone', caption: 'Black now has four consecutive stones and can add the fifth. The server declares the result and the winning line is highlighted.',
  },
  'gomoku-end': {
    title: 'Result: black connects five', caption: 'Nine placements and one colour choice complete this swap-opening example. Review the reason and stone count, then use Back to room.',
    rule: 'A full board without a winner draws. With Renju disabled, five or more wins for either colour.', outcome: 'Black wins with an exact five.',
  },
  'xiangqi-start': {
    title: 'Xiangqi: the standard opening', caption: 'No handicap is used. We play red from the bottom and move first; the opponent is black. Every piece is public.',
  },
  'xiangqi-goal': {
    title: 'Goal: checkmate or stalemate the opponent', caption: 'Protect your general while removing every legal answer for the opposing general. Winning material alone does not end the match.',
  },
  'xiangqi-move': {
    title: 'Select a piece, then a legal destination', caption: 'Select your piece to see legal targets, then choose one. Mouse moves immediately; touch previews before Confirm or a second tap on the destination.',
  },
  'xiangqi-cannon': {
    title: 'A cannon capture needs one screen', caption: 'The red cannon just jumped the black cannon to capture a horse. Black can now recapture with the rook. Captures appear in the move list.',
    rule: 'Rooks move straight without jumping. Cannons move like rooks when not capturing, but a capture must jump exactly one piece.',
  },
  'xiangqi-pieces': {
    title: 'Horses, elephants, advisors and soldiers', caption: 'Watch the horses develop and an advisor and cannon move. Selecting a piece shows only destinations legal in the current position.',
    rule: 'A blocked horse leg or elephant eye stops the move. Elephants cannot cross the river. Advisors move diagonally, generals orthogonally, one palace step. Soldiers gain sideways moves after crossing.',
  },
  'xiangqi-safety': {
    title: 'Rule card: keep your general safe', caption: 'The generals cannot face each other along an unobstructed file. Legal targets already account for this and self-check.',
    rule: 'On the third repeated position, a sole perpetual checker loses; other repetition draws. A run of 120 plies without capture also draws.',
  },
  'xiangqi-speed': {
    title: 'Fast-forward through the middlegame', caption: 'Every move is retained at higher speed. Black’s rook enters red’s territory while red must keep the general protected.',
  },
  'xiangqi-check': {
    title: 'Watch black’s next attack', caption: 'Black’s rook is deep in our territory. Watch it open the central file. If checked, the next move must remove that threat.',
  },
  'xiangqi-escape': {
    title: 'Red is in check: answer it first', caption: 'Black’s rook has captured the central soldier and given check. Red interposes an advisor; this move must pass the general-safety check.',
  },
  'xiangqi-mate': {
    title: 'Black’s cannon joins the attack', caption: 'Red has blocked the rook with an advisor and black moves again. Watch the cannon line and the red general’s remaining palace squares.',
  },
  'xiangqi-end': {
    title: 'Result: black wins by checkmate', caption: 'After 46 moves red has no answer to check. Review the checkmate reason and move count, then use Back to room.',
    rule: 'A player with no legal move also loses without being in check; this is stalemate in Xiangqi.', outcome: 'Our red side loses; black wins by checkmate.',
  },
  'go-start': {
    title: 'Go: a 9×9 board', caption: 'This match uses 9×9 intersections with no handicap. We play black and move first. Every stone is public and the board never rotates.',
  },
  'go-goal': {
    title: 'Goal: surround more territory', caption: 'Area scoring counts your stones plus the empty points only you surround. White adds 7.5 komi, so there are no ties.',
    rule: 'The number of captured stones does not decide the winner; the final point count does.',
  },
  'go-place': {
    title: 'Click an intersection to place', caption: 'On your turn, click an empty intersection to place a stone. It cannot be moved or taken back. Mouse clicks place immediately; touch shows a crosshair preview first, then Confirm or a second tap on the same point.',
    rule: 'Rows are counted from the bottom and the column letters skip I, as in D4. With one-tap play enabled, touch skips the confirmation.',
  },
  'go-liberty': {
    title: 'Liberties: empty neighbouring points', caption: 'The empty points above, below and beside a stone are its liberties; connected stones of one colour share them. White E5 is soon surrounded on three sides with one liberty left.',
    rule: 'A group that loses its last liberty is captured. A group with one liberty left is in atari.',
  },
  'go-capture': {
    title: 'Capture: fill the last liberty', caption: 'Black plays D5, filling the last liberty of white E5. The white stone is removed and the capture count appears beside the seat.',
    rule: 'A captured point becomes empty and can be played again, subject to the ko rule.',
  },
  'go-rules': {
    title: 'Rule card: suicide and ko', caption: 'Rule explanation; this match does not show them. A stone placed where it has no liberties (suicide) is not allowed unless it captures opposing stones.',
    rule: 'A move also cannot recreate any earlier board position; this superko rule covers simple ko and longer cycles. The table does not mark these points, but they cannot be selected.',
  },
  'go-speed': {
    title: 'Fast-forward through the middle game', caption: 'We now speed up and watch both sides build territory and trade captures. Every move is still written in the move list.',
  },
  'go-pass': {
    title: 'Passing ends the game', caption: 'When neither side sees a worthwhile move, press Pass and confirm. The opponent passes first and we pass too; two passes in a row stop the game.',
    rule: 'Play also stops at three times the number of points (243 moves on 9×9, passes included). Either way, the count begins.',
  },
  'go-mark': {
    title: 'Marking: start from the server’s dead stones', caption: 'The server first marks the stones it judges dead, shown faded. Small squares show each side’s territory and the totals update live.',
    rule: 'Dead stones are removed before scoring. Both players share one deadline; a human who has not confirmed in time accepts the current marking.',
  },
  'go-toggle': {
    title: 'Click a group to toggle dead or alive', caption: 'Black J9 in the top-right corner is surrounded by white but was not marked. We click it and the whole connected group becomes dead; the totals update immediately.',
    rule: 'Click again to mark it alive. Any change clears both confirmations, so both players confirm again.',
  },
  'go-resume': {
    title: 'Rule card: play on if you disagree', caption: 'Rule explanation; this match does not need it. If the players disagree about dead stones, either can press Play on to resume. The opponent of the last passer moves next.',
    rule: 'Confirmation includes the dead stones you saw and is refused if the marking changed, so nobody confirms a result they have not seen. A match at the move limit cannot resume.',
  },
  'go-confirm': {
    title: 'Both confirm, then the count', caption: 'We press Accept and the table waits for the opponent. When they confirm, the server scores the position at once by area counting.',
  },
  'go-end': {
    title: 'Result: black wins by 3.5', caption: 'Black has 46 points; white has 35 plus 7.5 komi, so black wins by 3.5. The result also lists the move count and captured stones; use Back to room.',
    rule: 'You may resign at any time, including during marking. Draw offers are unavailable, and the half-point komi prevents ties.', outcome: 'Our black side wins by area scoring by 3.5 points.',
  },
  'chess-start': {
    title: 'Chess: an 8×8 board', caption: 'We keep white’s perspective throughout: our side is at the bottom and moves first, with black at the top. Every piece is public and there is no handicap.',
  },
  'chess-goal': {
    title: 'Goal: checkmate the king', caption: 'An attacked king is in check; if the check cannot be answered, it is checkmate and that player loses. Winning material is not itself a win.',
  },
  'chess-move': {
    title: 'Select a piece, then a legal square', caption: 'Select your piece to see its legal squares, then choose one. Mouse moves immediately; touch previews before Confirm or a second tap on the destination.',
    rule: 'The move list uses standard algebraic notation: Nc3 means a knight moves to c3. You can resign at any time, or offer a draw on your turn if the opponent agrees.',
  },
  'chess-pieces': {
    title: 'The six pieces | Repeated moves accelerated', caption: 'We now speed up: knights develop, pawns advance and capture, and a queen comes out. Selecting a piece shows only squares legal in the current position.',
    rule: 'The king moves one square; the queen any distance in a straight or diagonal line; rooks straight and bishops diagonally, neither jumping; knights move in an L and may jump; pawns advance one square (two from the start) and capture diagonally forward.',
  },
  'chess-check': {
    title: 'In check: answer it immediately', caption: 'The black queen reaches e7 and attacks our king along the e-file. After a check the next move must remove it, and the board offers only legal replies; we block with a bishop.',
    rule: 'There are three answers: move the king, capture the attacker, or block the line. No move may leave your own king in check.',
  },
  'chess-escape': {
    title: 'Another answer: capture the attacker', caption: 'A black knight goes to b4. After our pawn move it captures the pawn on c2 with check, and our queen captures the knight.',
    rule: 'A knight’s attack cannot be blocked, so move the king or capture it. The king also cannot step onto an attacked square.',
  },
  'chess-speed': {
    title: 'Fast-forward through the middlegame', caption: 'We speed up: our bishop gives check and the blocking pawn is captured; our pawn captures again, opening the bishop’s line and forcing the black king aside.',
  },
  'chess-promote': {
    title: 'A pawn on the last rank: choose a piece', caption: 'The white pawn captures the rook on a8 and must promote. A picker opens; we choose the queen. The black bishop then recaptures it.',
    rule: 'A pawn may become a queen, rook, bishop or knight, but cannot remain a pawn. The new piece can be captured like any other.',
  },
  'chess-castle': {
    title: 'Castling', caption: 'Select the king, then g1. The king moves two squares toward the rook and the rook jumps to its other side, tucking the king away and activating the rook.',
    rule: 'Neither the king nor that rook may have moved, and no piece may stand between them. The king may not castle out of, through or into check. Kingside is O-O; queenside is O-O-O.',
  },
  'chess-enpassant': {
    title: 'Rule card: en passant', caption: 'Rule explanation; it does not occur in this game. If an enemy pawn advances two squares from its start and lands beside our pawn, our pawn may capture it by moving to the square it crossed.',
    rule: 'It must be done on the very next move or the chance is lost. Select the pawn, then the empty square, as for any pawn capture; it is written exd6.',
  },
  'chess-draws': {
    title: 'Rule card: automatic draws', caption: 'Rule explanation. The server declares these immediately, with no claim needed: stalemate, the third occurrence of a position, 50 moves each without a capture or pawn move, and insufficient material.',
    rule: 'Stalemate means the side to move is not in check but has no legal move. Insufficient material covers only king versus king, king plus one bishop or knight versus king, and bishops of one square colour.',
  },
  'chess-mate': {
    title: 'Check after check until mate', caption: 'Our knight steps aside and the queen checks along the c-file. The bishop blocks and is captured with check; the king returns to d8 and the queen goes to a8 with no escape.',
    rule: 'Checkmate is check with no way to move the king, capture the attacker or block the line.',
  },
  'chess-end': {
    title: 'Result: white wins by checkmate', caption: 'After 33 moves the black king cannot answer check, so our white side wins. The result lists the checkmate reason and move count; use Back to room.',
    rule: 'In a draw both players share first place. A timeout never loses; the system plays a legal move for you.', outcome: 'Our white side wins by checkmate.',
  },
  'jungle-start': {
    title: 'Jungle: eight animals per side', caption: 'We are red and move first. Rivers, traps and dens affect how each of the eight animals can move and fight.',
  },
  'jungle-goal': {
    title: 'Goal: enter the opposing den', caption: 'Entering the enemy den wins without capturing every animal. Capturing them all or leaving the opponent no legal move also wins.',
  },
  'jungle-move': {
    title: 'Select an animal, then a legal square', caption: 'Ordinary moves are one orthogonal square; your own den is forbidden. Select an animal to see targets, then choose one. Touch normally requires confirmation.',
  },
  'jungle-river': {
    title: 'Only rats enter water', caption: 'Our red rat is on the riverbank and can now enter the water. Legal target hints exclude water squares other animals cannot reach.',
    rule: 'Water and land animals cannot capture each other across the bank. Rats may leave onto empty land; two rats in water can capture each other.',
  },
  'jungle-ranks': {
    title: 'Faster play: ranks and captures', caption: 'Speed up until the sides meet. From strongest down: elephant, lion, tiger, leopard, wolf, dog, cat, rat. Equal ranks can capture each other.',
    rule: 'Exception: a rat on land can capture an elephant; an elephant cannot capture a rat. Enemy traps change ranks separately.',
  },
  'jungle-leap': {
    title: 'Lions and tigers leap across rivers', caption: 'Speed through the approach and watch the blue lion’s long river leap, followed by the red elephant’s recapture.',
    rule: 'A leap crosses the full river in a straight line to an empty square or capturable enemy. Any rat in the crossed water blocks it.',
  },
  'jungle-traps': {
    title: 'Traps weaken invading animals', caption: 'Watch the next captures at higher speed. Each den’s three traps protect its defender; check them before approaching.',
    rule: 'An animal in an enemy trap has rank 0: it cannot capture and any enemy can capture it. Leaving restores its rank.',
  },
  'jungle-speed': {
    title: 'Fast-forward to the den approach', caption: 'Both sides keep moving and fighting as the red lion approaches the opposing den. Every action leading to the finish is included.',
    rule: 'A run of 100 plies without capture draws automatically. A draw offer on your turn requires the opponent’s agreement.',
  },
  'jungle-den': {
    title: 'The final step into the den', caption: 'The red lion is now beside the blue den. Red can enter it and let the server settle the match.',
  },
  'jungle-end': {
    title: 'Result: red enters the enemy den', caption: 'After 55 moves the red lion enters blue’s den. Both sides still have animals, but the match ends immediately. Review the result and return to the room.',
    outcome: 'Red wins by entering the opposing den.',
  },
  'landbattle-start': {
    title: 'Land Battle Chess: deploy, then fight', caption: 'We keep red’s perspective. Each side has 25 pieces; only our own identities are visible. The server referees the hidden enemy ranks.',
  },
  'landbattle-goal': {
    title: 'Goal: capture the enemy flag', caption: 'Take the opposing flag or leave the opponent no legal move to win. Both sides must submit legal deployments before alternating moves.',
  },
  'landbattle-deploy': {
    title: 'Tap two stations to swap pieces', caption: 'Choose a preset or Auto, or tap two friendly pieces to swap them. This example uses a legal automatically generated deployment.',
    rule: 'Flags belong in headquarters, mines in the last two rows, and bombs off the front row. Camps start empty. Invalid swaps explain the restriction.',
  },
  'landbattle-submit': {
    title: 'Confirm deployment to lock it in', caption: 'Both players confirm independently and cannot edit afterwards. Enemy readiness does not reveal ranks. Play starts only when both are ready.',
  },
  'landbattle-move': {
    title: 'Select your piece and a legal target', caption: 'Select a friendly piece to see destinations, then choose one. Mouse submits immediately; touch previews before Confirm or a second tap.',
  },
  'landbattle-terrain': {
    title: 'Faster play: roads, rails and camps', caption: 'Roads move one station; railways allow longer straight moves without jumping pieces. Speed through both sides’ initial manoeuvres.',
    rule: 'Pieces in camps cannot be attacked. Mines, flags and any piece inside headquarters cannot move.',
  },
  'landbattle-battle': {
    title: 'The first battle reveals only its outcome', caption: 'Red is about to attack a blue piece on the front. The referee reports attacker win, loss or mutual removal, without naming the enemy rank.',
  },
  'landbattle-specials': {
    title: 'Faster battles: ranks and special pieces', caption: 'Follow the referee’s outcomes and removed pieces. Enemy appearances do not establish identities; public movements and battle results are your clues.',
    rule: 'Higher rank wins; equal ranks remove both. Bombs remove both fighters. Engineers clear mines; other ranks die attacking them. Any piece can take a flag.',
  },
  'landbattle-engineer': {
    title: 'Engineers can turn along railways', caption: 'Watch our engineer manoeuvre at higher speed. Choose its legal final station; the server finds the route, and the move list records stations passed.',
    rule: 'Only engineers may turn along rails. No railway path can pass through another piece.',
  },
  'landbattle-hidden': {
    title: 'Faster attacks, with enemy ranks still hidden', caption: 'Every upcoming move retains red’s filtered view. An enemy piece that moved cannot be a mine or flag, but its exact rank remains hidden.',
  },
  'landbattle-flag': {
    title: 'Blue’s fallen marshal reveals its flag', caption: 'The latest mutual removal killed blue’s marshal, so blue’s flag location is now public. Other unrevealed ranks stay covered.',
    rule: 'A marshal’s death reveals that side’s flag. Ordinary battles do not turn every enemy piece face up.',
  },
  'landbattle-speed': {
    title: 'Fast-forward through the final manoeuvres', caption: 'Both flags have now been revealed. Speed through the remaining moves and battles as red approaches blue’s headquarters.',
    rule: 'A run of 60 plies without battle draws. A draw offer also requires the opponent’s agreement.',
  },
  'landbattle-capture': {
    title: 'The final flag capture', caption: 'Red is beside blue’s revealed flag. It is red’s turn to attack the headquarters and take that publicly known target.',
  },
  'landbattle-end': {
    title: 'Result: red captures the flag', caption: 'After deployment and 137 moves, red takes the flag. Only now are all surviving ranks revealed. Review the reason and move count, then return to the room.',
    outcome: 'Red wins by flag capture; each side has seven pieces left.',
  },
  'battleship-start': {
    title: 'Battleship: begin with hidden fleets', caption: 'Each player has a 10×10 sea. We keep our own player view; enemy ship positions have not been revealed.',
  },
  'battleship-goal': {
    title: 'Goal: sink all five enemy ships', caption: 'Carrier: 5 cells; battleship: 4; cruiser and submarine: 3 each; destroyer: 2. The full fleet occupies 17 cells.',
  },
  'battleship-place': {
    title: 'Choose a ship, then its bow square', caption: 'Select a ship button and tap its bow square. Use Rotate, Random or Clear as needed. Select a placed ship to reposition it.',
    rule: 'Ships cannot overlap or leave the sea. Tapping the selected placed ship again rotates it. This example submits a fixed legal fleet.',
  },
  'battleship-confirm': {
    title: 'Confirm fleet to lock positions', caption: 'All five ships must be legal before confirmation, which is final. Both players must finish before firing. Enemy readiness reveals no positions.',
  },
  'battleship-shot': {
    title: 'Choose one cell in the target sea', caption: 'Choose a cell you have not fired at. Mouse fires immediately; touch previews before Confirm or a second tap. This match alternates one shot each.',
    rule: 'You cannot shoot the same cell twice. Your own sea shows your ships and incoming enemy shots.',
  },
  'battleship-hit': {
    title: 'Keep searching after a miss', caption: 'Both first shots missed. We now choose another cell, narrowing possibilities using only public shot results.',
  },
  'battleship-target': {
    title: 'Follow a hit into neighbouring cells', caption: 'We just hit a cell, but do not know the ship’s type or full length. Follow up nearby while the opponent continues taking turns.',
    rule: 'A hit does not name the ship. Only hitting every cell of that ship sinks it.',
  },
  'battleship-sunk': {
    title: 'A sinking reveals the ship and its cells', caption: 'The battleship is now sunk, so its name and all four cells are public. Other ships still afloat remain hidden.',
  },
  'battleship-options': {
    title: 'Rule card: room options change the search', caption: 'Both options are off here: ships may touch, and a hit still passes the turn.',
    rule: 'Before starting, the host can enable No touching, including diagonals, or Hit again, including sinkings. This game has no draw offers.',
  },
  'battleship-speed': {
    title: 'Fast-forward through searching and sinkings', caption: 'Every shot is retained at higher speed. Search from misses, hits and sinkings; enemy ships still afloat are never shown early.',
  },
  'battleship-last': {
    title: 'Resolve the final ship one cell at a time', caption: 'We have sunk four ships and have one unresolved hit. Fire at its neighbour to check the remaining ship.',
  },
  'battleship-end': {
    title: 'Result: all five enemy ships sunk', caption: 'We win with 41 shots, 17 hits and five sinkings. Both complete fleets become visible only after the match ends. Review the result, then return to the room.',
    outcome: 'We win by sinking the fleet; the opponent fired 40 shots.',
  },
  'banqi-start': {
    title: 'Banqi: all 32 pieces start covered', caption: 'We keep the first mover’s perspective. Neither player knows the covered identities, and neither has a colour yet.',
  },
  'banqi-goal': {
    title: 'Goal: capture all enemies or block their actions', caption: 'On your turn, flip a covered piece or move one of your face-up pieces. The first flipped colour determines both players’ colours.',
  },
  'banqi-flip': {
    title: 'Choose a covered piece to flip', caption: 'Click to flip with a mouse. Touch previews before Confirm or a second tap. The identity becomes public only after the flip.',
  },
  'banqi-colour': {
    title: 'The first flip is a black general: we are black', caption: 'Our first flip revealed the black general, making us black and the opponent red. A player can flip an opposing colour but cannot move it.',
  },
  'banqi-blind': {
    title: 'Chain mode also allows blind attacks', caption: 'Our black general can attack an adjacent covered piece without knowing its identity. Select the face-up attacker, then the legal covered target.',
    rule: 'This match uses the default chain and blind captures, with Rook dash off. The target is revealed and resolved only after the attack.',
  },
  'banqi-reveal': {
    title: 'Failed blind attack: reveal and end the turn', caption: 'The target was our own black soldier. The general stayed put, the soldier turned face up, and the opponent now acts. Covered identities cannot be inspected first.',
    rule: 'A capturable enemy is taken and entered. A friendly or uncatchable piece is only revealed, ending the turn.',
  },
  'banqi-capture': {
    title: 'Choose a face-up enemy to capture', caption: 'The opponent just revealed a red elephant that our black general can take. Select the general, then the legal target; touch normally asks for confirmation.',
  },
  'banqi-stop': {
    title: 'Use End turn to decline another capture', caption: 'The capture left a chain available, so the turn has not passed. End turn gives up the remaining capture opportunity.',
  },
  'banqi-ranks': {
    title: 'Faster play: flips and captures', caption: 'The order is general, advisor, elephant, rook, horse, cannon, soldier. Normal movement is one orthogonal cell; equal or lower enemies can be captured.',
    rule: 'Soldiers can capture generals, but generals cannot capture soldiers. A cannon capture jumps exactly one piece in a straight line, regardless of target rank.',
  },
  'banqi-speed': {
    title: 'Fast-forward through reveals and exchanges', caption: 'Every flip, blind attack, move and End turn is retained as the board becomes public and the remaining pieces fight.',
  },
  'banqi-chain': {
    title: 'Continue capturing with the same piece', caption: 'Our black advisor just captured and can continue. Choose another legal target with that advisor, or use End turn.',
    rule: 'A chain cannot switch pieces or make a quiet move. A failed blind attack ends the turn immediately.',
  },
  'banqi-limit': {
    title: 'Faster endgame: watch the quiet-move count', caption: 'Both sides move their remaining pieces. A side behind in numbers can still capture, but must avoid losing all legal actions.',
    rule: 'Fifty consecutive non-capturing moves draw. Flips and blind attacks reset the count. A draw offer needs the opponent’s agreement.',
  },
  'banqi-last': {
    title: 'Our last black piece is threatened', caption: 'We have one black advisor left, beside a red advisor. Watch the final capture and the server’s result.',
  },
  'banqi-end': {
    title: 'Result: red captures every black piece', caption: 'Our black pieces are gone; red wins with eight left. The complete match has 81 flip/move entries and 12 End turn actions. Review the result and return to the room.',
    outcome: 'We lose as black; red wins by capturing every opposing piece.',
  },
  'chinesecheckers-start': {
    title: 'Chinese checkers: a race with ten marbles', caption: 'This two-player match keeps our starting corner at the bottom. Each player has ten marbles, and every position is public.',
    rule: 'Supported player counts are 2, 3, 4 and 6. Five players cannot start.',
  },
  'chinesecheckers-goal': {
    title: 'Goal: fill all ten holes in the opposite corner', caption: 'Move from your starting corner into its opposite target. Jumped marbles stay on the board, and either colour can serve as a stepping stone.',
  },
  'chinesecheckers-jump': {
    title: 'Select a marble and a legal destination', caption: 'Select a friendly marble to see targets, then choose the final hole. Mouse moves immediately; touch previews before Confirm or a second tap.',
    rule: 'Step into an adjacent empty hole, or jump one adjacent marble into the empty hole immediately beyond in the same direction.',
  },
  'chinesecheckers-chain': {
    title: 'For a jump chain, choose only the final hole', caption: 'Our back marble can now chain jumps. Select its starting and final holes; the server finds a legal route without separate clicks for each landing.',
    rule: 'Chains may turn. A step cannot be followed by jumps, and a jump cannot be followed by a step.',
  },
  'chinesecheckers-move': {
    title: 'Faster play: bring the back marbles along', caption: 'Players alternate, using either colour to build jump routes. The move list includes intermediate landings in a chain.',
  },
  'chinesecheckers-speed': {
    title: 'Fast-forward across the centre', caption: 'Every move is retained as the marbles meet in the middle, borrow stepping stones and enter their opposite targets.',
  },
  'chinesecheckers-block': {
    title: 'Rule card: blocking and automatic passes', caption: 'Pause to explain target completion. An opponent deliberately leaving marbles in your target does not necessarily prevent a win.',
    rule: 'A full target with at least one friendly marble completes it; enemies count as arrived. Any player filling the last hole settles the win immediately. No legal move means an automatic pass.',
  },
  'chinesecheckers-finish': {
    title: 'Fast-forward through the final arrivals', caption: 'Fill the remaining target holes and watch Arrived and Rows left on the player badges.',
    rule: 'At 150 turns per player, or when nobody can move, the fewest rows left wins; if everyone ties, it is a draw.',
  },
  'chinesecheckers-last': {
    title: 'The opponent needs one last hole', caption: 'The opponent’s target is almost full. Filling the remaining hole will complete it, while some of our marbles still have not arrived.',
  },
  'chinesecheckers-end': {
    title: 'Result: the opponent completes the target first', caption: 'After 102 moves, the opponent has 10/10 arrived and we have 7/10. Review the winning reason and move count, then use Back to room.',
    rule: 'In multiplayer, the first completion ends the match; others rank by rows left, sharing places for ties.', outcome: 'We place second; the opponent wins by completing the opposite corner.',
  },
};
