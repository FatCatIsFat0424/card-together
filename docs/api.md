# HTTP 與 Socket API

權威型別：[`shared/src/types/`](../shared/src/types)。路徑以後端為基準；正式環境的 Nginx 在 `/card-together/` 之下提供這些路徑。

## HTTP

- JSON 本文：`{ success: true, ... }` 或 `{ success: false, error }`，並搭配對應的狀態碼。
- 變更類請求需要允許的 Origin 與 JSON Content-Type；本文為空時送 `{}`。
- 以工作階段 cookie 驗證身分。註冊、登入、登出（會撤銷請求中帶有的有效工作階段）、讀取圖片與健康檢查不需要工作階段。
- 只有不可變的圖片讀取會被快取。

| 方法與路徑 | 輸入 | 結果 |
| --- | --- | --- |
| `POST /api/auth/register` | `username, password, nickname?, color?` | 201、帳號、工作階段 cookie |
| `POST /api/auth/login` | `username, password` | 帳號、工作階段 cookie |
| `GET /api/auth/me` | — | 目前的帳號 |
| `PATCH /api/auth/profile` | [個人檔案欄位](#個人檔案欄位) | 更新後的帳號；同步給已連線的玩家 |
| `POST /api/auth/shop/avatar-borders` | `border`（目錄 ID） | 購買後更新的帳號 |
| `POST /api/auth/shop/items` | `item`（目錄 ID）；選填 `equip: true` | 永久購買後更新的帳號；`equip` 會在同一次寫入裝備該商品（貼圖包沒有欄位，忽略），已擁有時只裝備、不再扣款；預設不裝備 |
| `GET /api/auth/achievements` | — | 本人的[成就狀態](../shared/src/types/achievements.ts)、里程碑進度與各類別的領取狀態 |
| `POST /api/auth/achievements/claim` | `category`：[目錄](../shared/src/constants/achievements.ts)中的 ID | 更新後的帳號與成就狀態；必須完成所有里程碑，重複領取具冪等性，不扣金幣 |
| `GET /api/auth/daily-rewards` | — | 本人的[每日狀態](../shared/src/types/daily-rewards.ts)、伺服器日期與時間、本月的簽到紀錄 |
| `POST /api/auth/daily-rewards` | `reward`：已指派的[任務 ID](../shared/src/constants/daily-rewards.ts) 或 `check-in`；`day`：伺服器的 YYYY-MM-DD | 更新後的帳號與每日狀態；重複領取具冪等性 |
| `POST /api/auth/daily-rewards/replace` | `task`：已指派且未領取的任務 ID；`day`：伺服器的 YYYY-MM-DD | 更新後的帳號與每日狀態；每天可替換一次，以同一個原始任務重試具冪等性 |
| `POST /api/auth/password` | `currentPassword, newPassword` | 撤銷所有工作階段 |
| `POST /api/auth/logout` | `{}` | 撤銷請求中帶有的工作階段，清除 cookie |
| `POST /api/auth/logout-all` | `{}` | 撤銷該帳號的所有工作階段 |
| `GET /api/account/history` | — | 自己最近 100 場對局（包括有 bot 的對局），由新到舊 |
| `GET /api/players/:accountId` | — | 公開個人檔案 |
| `GET /api/players/:accountId/history` | — | 對局與參與者對照表；限本人或歷史紀錄公開時 |
| `GET /api/players/:accountId/stats` | — | `{ success: true, stats: PlayerStats }`：伺服器累計的統計；限本人或歷史紀錄公開時 |
| `GET /api/players/:accountId/history/:matchId/replay` | — | `{ success: true, replay: MatchReplay }`；限本人或對象的歷史紀錄公開時 |
| `GET /api/friends` | — | `friends, incoming, outgoing`；已接受的好友包含上線狀態、可為 null 的 `hostedRoomCode`、`room` 與 `lastSeenAt` |
| `GET /api/friends/stats` | — | `stats`：以好友 ID 為鍵的 `together`（自己保留的對局中同桌的場數）與 `favoriteGame`（好友歷史紀錄中最常玩的遊戲；不公開或沒有紀錄時為 null） |
| `GET /api/friends/search?username=` | 完全相符的使用者名稱 | 公開帳號或 null |
| `POST /api/friends/requests` | `username` | 201、好友邀請 |
| `POST /api/friends/requests/:id/accept` | `{}` | 收件者接受 |
| `DELETE /api/friends/requests/:id` | `{}` | 收件者拒絕或寄件者取消 |
| `DELETE /api/friends/:accountId` | `{}` | 解除好友關係 |
| `GET /api/messages` | — | 收到的邀請、邀請已接受的通知、含未讀數的對話 |
| `GET /api/messages/:accountId` | 選填的 `before` 訊息 ID | 游標之前最近的 50 則訊息，依時間排序；帳號、`hasMore`、`canSend` |
| `POST /api/messages/:accountId` | `clientId` 加上一個[訊息輸入](../shared/src/types/direct-message.ts)，包括 `shopSticker` | 201、訊息；只限已接受的好友 |
| `POST /api/messages/:accountId/read` | `messageId` | 推進讀者的收件訊息游標 |
| `POST /api/messages/notifications/read` | `ids`：1–100 個不重複的通知或收到的邀請 ID；或 `{ all: true }` | 把自己的通知與收到的待處理邀請標為已讀，不刪除；已讀時間不會被改寫 |
| `POST /api/messages/notifications/clear` | `ids`：1–100 個不重複的通知 ID；或 `{ read: true }` | 刪除自己指定的「邀請已接受」通知，或所有已讀的；待處理的邀請只會因回覆而消失 |
| `POST /api/media` | `data`（base64）、`purpose`：`avatar`、`emoji`、`background`、`cardBack` | 圖片 ID |
| `GET /api/media/:id` | — | 不可變的圖片位元組 |
| `GET /api/emojis` | — | 自己的表情符號項目 |
| `POST /api/emojis` | `items: [{ name, mediaId }]`，1–50 個不重複的名稱 | 201、建立的項目 |
| `PATCH /api/emojis/:id` | `name` | 重新命名自己的項目 |
| `DELETE /api/emojis/:id` | `{}` | 刪除自己的項目 |
| `POST /api/emojis/delete` | `ids`：1–300 個不重複的 ID | `deleted` ID，以一次原子寫入完成；不存在或屬於他人的 ID 會被忽略 |
| `GET /health` | — | `{ status: 'ok' }` |

### 個人檔案欄位

| 欄位 | 接受的值 |
| --- | --- |
| `nickname`、`color`、歷史紀錄可見度 | 經過驗證的個人檔案值（[儲存](storage.md#身分與工作階段)） |
| `avatar`（已停用） | 預設頭像預設值（`cat`、`fox`、`owl`、`bear`、`rabbit`、`panda`）已停用：用戶端不再傳送也不再顯示。伺服器仍接受這些值並保留已儲存的欄位，以相容既有帳號與舊用戶端；省略時保留原值，其他值（包括只供 bot 座位使用的 `bot`）回傳 400。沒有 `avatarImage` 的帳號一律顯示同一張預設頭像 |
| `avatarImage`、`seatBackground`、`tableBackground`、`cardBack` | 已上傳的媒體 ID 或 null；`seatBackground` 使用 `background` 用途，並在房間的 `PlayerInfo` 中共享 |
| `tableBackgroundOpacity`、`cardBackOpacity` | 整數百分比 20–100 |
| `avatarBorder` | null（原始外框）或已擁有的目錄 ID；未擁有時回傳 403 |
| [`EQUIPMENT_SLOTS`](../shared/src/constants/shop.ts) 中的裝備欄位（`cardBackStyle`、`nameplate`、`cardFaceStyle`、`soundPack`、`seatFrame`、`victoryEffect`、`chipStyle`、`chatFrame`、…） | null 或已擁有且類型相符的目錄 ID；未擁有回傳 403，類型錯誤回傳 400 |
| `coins`、`coinRevision`、`ownedAvatarBorders`、`ownedShopItems`、`ownedAchievementNameplates` | 由伺服器管理；註冊或個人檔案請求從不能設定 |

成就路由需要工作階段，以及變更請求的 Origin／JSON 保護。不存在的類別 ID 回傳 400；未完成的類別回傳 409。伺服器依目錄授予稱號，忽略用戶端送來的計數、物品欄、帳號 ID 與獎勵 ID。取得的稱號只有在已擁有時，才能透過 `nameplate` 裝備欄位使用；商店會把它們當成不存在的商品而拒絕。

省略的欄位保留原值；無效的值回傳 400。

### 狀態碼

| 情況 | 狀態碼 |
| --- | --- |
| 無效的玩家 ID／不存在的玩家／歷史紀錄不公開 | 400 / 404 / 403 |
| 無效的回放對局 ID／回放不存在、無關、舊版或已清除 | 400 / 404 |
| 不存在的外框／金幣不足 | 400 / 409 |
| 無效的每日獎勵／日期過期、任務未完成或未指派，或無法替換 | 400 / 409 |
| 圖片過大或超過配額（[上限](media.md#上傳)） | 413 |
| 圖片儲存空間無法使用 | 503 |

### 回應內容

- `AccountProfile`（只給本人）：偏好設定、時間戳、金幣、物品欄、裝備。
- `PublicAccount`：ID、使用者名稱、暱稱、顏色、頭像、頭像圖片、裝備中的外框、名牌與聊天框。不含餘額或物品欄。
- 已接受的好友另有 `room`（[`FriendRoomPresence`](../shared/src/types/social.ts)）：好友在線且在房間中時，包含房號、遊戲、狀態、有人座位／總座位數、是否為房主，以及 `joinable`（等待中且旁觀區有空間）與 `spectatable`（對局或回放中且有空間）；否則為 null。
- `GET /api/messages` 的 `incoming` 與 `accepted` 項目都有 `readAt`（未讀時為 null）。標為已讀、清除與回覆邀請後會送出 `social:changed`，讓其他分頁同步。
- 只有 `GET /api/friends` 中已接受的項目包含必填的 `lastSeenAt`：Unix epoch 毫秒時間戳，或在沒有任何歷史活動紀錄時為 `null`。這個值在玩家清理與伺服器重新啟動後仍會保留。公開個人檔案、搜尋結果與待處理的邀請不包含它。顯示方式：[好友介面](interface.md#大廳與好友)。
- 任何回應都不包含密碼雜湊或工作階段摘要。
- 歷史列表 endpoint 回傳最近 100 場符合條件的 [MatchSummary](../shared/src/types/game.ts)，不分頁，包括有 bot 的對局；參與者對照表包含仍保留的真人帳號。對局的封存仍保留時，摘要會加上選填的 `hasReplay: true`，且從不包含回放或紀錄內容。既有的列表外層格式維持不變：帳號歷史為 `{ success: true, matches }`，玩家歷史為 `{ success: true, matches, players }`。搜尋與篩選在用戶端進行。
- 統計 endpoint 回傳 [`PlayerStats`](../shared/src/types/stats.ts)：兩個範圍（`human` 只算沒有 bot 座位的對局，`all` 全部）各有帳號層級的連勝與最近 10 場結果，以及每款玩過的遊戲的計數器（場數、勝場、並列、名次分布、各桌人數的場數、`counts`／`sums`、特殊紀錄的 `best`／`latest` 與締造的對局 ID、`since`／`logSince`／`versionSince` 起算時間），外加所有玩家拿破崙各角色的勝負合計（角色期望勝率的基準）。權限與歷史列表相同：帳號不存在 404、不公開 403、ID 格式錯誤 400。規則：[儲存](storage.md#統計)。
- 回放需要有效的工作階段，以及和玩家歷史列表相同的權限（對象本人或歷史紀錄公開）。查詢只限該對象仍保留的對局；知道無關對局的 ID 也無法存取。帳號不存在回傳 404，對象不公開回傳 403，封存不存在、舊版、已清除或無法讀取時回傳 404（[保留規則](storage.md#回放封存)）。回應中的 [MatchReplay](../shared/src/types/replay.ts) 包含初始的旁觀快照，以及每個已記錄步驟的一份 patch，在相同權限下揭露每一份發出的手牌。沒有錄製資料的對局回傳 404。見[錄製與隱私](storage.md#身分與工作階段)。播放不會建立房間，也不需要原本的玩家或亂數種子。
- 商店價格來自 [`shop.ts`](../shared/src/constants/shop.ts)，從不採用用戶端的值。重複購買不會再次扣款，也不會自動裝備。金幣規則：[儲存](storage.md#金幣)。
- 私訊介面：[`direct-message.ts`](../shared/src/types/direct-message.ts)。讀取需要已接受的好友關係，或仍保留的共同參與紀錄。發送允許去除前後空白後 1–500 個字元，或一張個人／站方／商店貼圖。發送商店貼圖需要擁有該貼圖包；只接受目錄 ID。`clientId` 使用 8–64 個 ASCII 英文字母、數字、底線或連字號；結果不確定時，以相同的 ID 與內容重試。非好友回傳 403，衝突的重試回傳 409，無法存取的對話回傳 404，格式錯誤或已過期的游標回傳 400。保留期限與移除：[儲存](storage.md#身分與工作階段)。

## Socket 操作

- 握手與每個操作都需要有效的工作階段與允許的 Origin。操作者由工作階段決定，從不取自 payload。
- 最後一個參數必須是 callback，否則操作會被忽略。沒有 payload 的操作只接收 callback。
- 失敗回傳 `{ success: false, error }`。成功會在資料寫入後才回覆，但暫時性的 signaling 與狀態未變更時除外。
- 遊戲類型：`bridge`、`bigtwo`、`redpoints`、`ninetynine`、`sevens`、`chinesepoker`、`liarsdeck`、`blackjack`、`holdem`、`napoleon`、`tenhalf`、`liarsdice`、`reversi`、`doudizhu`、`oldmaid`、`jungle`、`gomoku`。標準座位：`N`、`E`、`S`、`W`。
- 確切的 payload 與結果：[`socket-events.ts`](../shared/src/types/socket-events.ts)。

**房間**

| 操作 | Payload | 效果 |
| --- | --- | --- |
| `player:resume` | — | 回傳 `PlayerSnapshot`；連結或還原帳號 |
| `room:create` | `{ gameType }` | 回傳 `roomCode` |
| `room:join` | `{ roomCode }` | 以旁觀者身分加入，對局進行中也可以 |
| `room:joinFriend` | `{ accountId, roomCode }` | 以旁觀者身分加入線上好友所在的房間（不論是否為房主；對局或回放進行中也可以），並以原子操作離開原本的房間 |
| `room:invite` | `{ accountId }` | 在旁觀區還有空間時邀請已接受的好友 |
| `room:leave` | — | 離開；入座玩家離開會中止未結束的遊戲 |
| `room:kick` | `{ accountId }` | 房主移除另一位真人（對局中也可以移除旁觀者）；對方可以用房號重新加入 |
| `room:changeSeat` | `{ seat }` | 坐到一個空的標準座位 |
| `room:changeAdditionalSeat` | `{ index }` | 坐到一個額外座位；`RoomInfo.additionalSeats` 的索引，從 0 開始 |
| `room:standUp` | — | 等待中起身成為旁觀者 |
| `room:movePlayer` | `{ accountId, target }` | 房主在等待中移動一位真人；`target` 是 [`RoomSeatTarget`](../shared/src/types/room.ts) |
| `room:addSeat`、`room:removeSeat` | — | 房主加開一個額外座位（總共八個，拿破崙與釣魚為六個），或移除最後一個空的額外座位；只限等待中的 99、瘋狂 8、釣魚、21 點、德州撲克、梭哈與拿破崙 |
| `room:addBot` | `{ seat, difficulty? }` | 房主在等待中把 bot 加到任何已設定的座位（`N`–`W`，或已加開的 `P5`–`P8`）；省略難度時為困難 |
| `room:removeBot` | `{ seat }` | 房主在等待中移除 bot |
| `room:setBotDifficulty` | `{ seat, difficulty }` | 房主把等待中房間的一個 bot 改為簡單或困難；重設真人的準備狀態 |
| `room:fillBots` | — | 房主以已準備的 bot 補滿所有空位（包括額外座位），不超過遊戲的人數上限 |
| `room:ready`、`room:unready` | — | 等待中設定入座玩家的準備狀態，不論目前人數；從不會開始對局。房主永遠視為已準備，所以不需要呼叫（呼叫也不影響開始條件） |
| `room:start` | — | 只有在房主以外所有有人的座位都已準備，且人數符合該遊戲時，房主才能開始 |
| `room:setShuffleSeats` | `{ enabled }` | 房主在等待中切換自動隨機座位；預設為 false，並重設真人的準備狀態 |

**等待中的房間設定**（只限房主；除非另有註明，都會清除真人的準備狀態）

| 操作 | Payload |
| --- | --- |
| `room:setGameType` | `{ gameType }` |
| `room:setTimeControl` | [`TimeControl`](../shared/src/types/room.ts) |
| `room:setGameOptions` | [`GameOptionsPayload`](../shared/src/types/room.ts)：`{ gameType, options }`；遊戲必須與房間一致。只改排七的 `slayEffect` 時保留準備狀態 |

**共同觀看回放**（工作階段：[`RoomReplaySession`](../shared/src/types/room.ts)；時序：[`replay-session.ts`](../shared/src/replay-session.ts)）

| 操作 | Payload | 效果 |
| --- | --- | --- |
| `room:replay:start` | `{ subjectId, matchId }` | 只限房主在等待中使用：選擇對象歷史紀錄中、房主有權觀看（本人或公開）的已錄製對局。把狀態設為 `replaying`，從第 0 步以 1x 播放；移除畫面上仍留著的結算畫面 |
| `room:replay:control` | `{ step, playing, speed }` | 只限目前的房主：以伺服器時間重新設定播放基準（播放、暫停、跳轉、速度 0.5–4） |
| `room:replay:end` | — | 只限目前的房主：讓房間回到 `waiting` |
| `room:replay:load` | — | 只限目前的成員，且工作階段仍有效時：回傳 `{ archive: { match, replay, players } }`。成員不需要自己的歷史紀錄權限；開始時已檢查過房主的權限 |

- `replaying` 和對局一樣會鎖住房間：不能開始、變更設定、座位、準備狀態或 bot，也不能踢出入座的成員。加入、離開、踢出旁觀者與聊天仍可使用。房主轉移時保留工作階段；由新的房主控制。
- 用戶端從播放基準、`PlayerSnapshot.serverNow` 與觀看者端的步驟時長推算目前的步驟，所以伺服器不需要計時器。工作階段隨 runtime 保存，並隨房間結束。封存內容從不進入房間廣播。

**遊戲**

| 操作 | Payload | 效果 |
| --- | --- | --- |
| `game:action` | `{ gameType, action }`，型別契約見 [`ClientToServerEvents`](../shared/src/types/socket-events.ts) | 所有遊戲的叫牌、出牌、下注與其他規則操作；依目前遊戲的 adapter 驗證並套用，拒絕不符的 `gameType` |
| `game:autoPlay` | `{ enabled }` | 切換本局中由 bot 持續代打呼叫者的真人座位；需驗證身分，先 commit 再回覆與廣播 |
| `game:leaveEarly` | — | 開啟代打，並在一次 commit 中對所有玩家與旁觀者標示呼叫者已離開；關閉代打會清除這個標示 |
| `game:continue` | — | 離開結果畫面回到等待中的房間；其他人仍會看到結果 |
| `game:abortVote:start` / `cast` | — / `{ agree }` | 發起或投票終止對局（[規則](games/common.md#房間流程)） |
| `chat:send` | 一個[聊天輸入](../shared/src/types/socket-events.ts)，包括 `{ shopSticker }` | 文字，或一張個人／站方／商店貼圖；發送商店貼圖需要擁有該貼圖包 |

房規保存在 `RoomInfo.gameOptions` 的遊戲鍵下，切換遊戲再切回時保留原本選擇。遊戲局內仍使用開局時固定的規則；房規只在等待中可改。舊版個別遊戲操作事件與四個 `room:set*Options` 事件只回覆重新整理提示，不會執行操作；部署後仍開啟舊版的玩家需重新整理。

**權限**

- 伺服器檢查回合、牌與房間權限，並等待[呈現截止時間](architecture.md#呈現時間軸)。規則：[遊戲](games/README.md)。
- [`GameClock`](../shared/src/types/game.ts) 提供行動中的座位、截止時間、時間庫與伺服器時間。只有伺服器會強制執行逾時。
- `isBot` 不存在或為 false 代表真人。`bot:<UUID>` 身分無法驗證，也不會收到快照。
- `room:movePlayer`：目標位置有人時會交換兩人的位置；旁觀者坐到真人的座位時，兩人交換旁觀身分。bot 從不移到旁觀區或額外座位。移動會遵守旁觀區容量、重設真人的準備狀態，並讓 bot 保持準備。

**伺服器事件**

| 事件 | 內容 |
| --- | --- |
| `player:state` | 與 resume 相同的 `PlayerSnapshot`：選填的玩家、房間、遊戲狀態、聊天、錯誤，以及房間回放時的 `serverNow`。缺少房間或遊戲時會清除用戶端狀態 |
| `chat:message` | `{ roomCode, message }`；用戶端依 ID 只附加一次 |
| `room:invited` | 暫時性的邀請：房間、遊戲、寄件者、座位是否有空 |
| `room:kicked` | `{ roomCode }`，在被移除成員收到沒有房間的快照之後送出 |
| `account:coins` | 領取獎勵後的私人餘額與 `coinRevision` |
| `account:updated` | 購買或儲存個人檔案變更後的私人帳號，送到本人的所有分頁 |
| `social:changed` | 沒有 payload；受影響的帳號重新載入邀請、對話與未讀數 |

- 快照只送到操作者的分頁與受影響的房間成員。遊戲狀態依接收者過濾（[旁觀者](games/common.md#旁觀者與上帝視角)）。
- resume 一定包含聊天紀錄，並取代用戶端的副本；廣播只在接收者的房間改變時才包含聊天紀錄。
- 真人加入房間（包括建立房間）與離開時，會附加在地化的系統聊天訊息，並在資料寫入成功後廣播。離開包括被踢出、切換到好友的房間，以及斷線逾時；重新連線、額外分頁與重複加入不會產生訊息。最後一位真人離開時，會移除房間與聊天紀錄。
- [`ChatMessage`](../shared/src/types/chat.ts) 的圖片由伺服器解析：`emojis`（個人媒體 ID）與 `providedEmojis`（站方檔案），兩者合計最多 20 個名稱且不能重複。貼圖訊息的內容為空，且剛好有一個貼圖參照：個人的 `sticker`、從 `<base>/provided-emoji/<file>` 提供的 `providedSticker: { name, file }`，或依內建目錄解析的 `shopSticker`。

## 語音 signaling

語音成員是暫時性的，並以已 commit 的房間成員資格檢查。Socket.IO 負責協商；音訊經由 WebRTC 傳送，不寫入資料庫。運作與設定：[媒體](media.md#語音)。

| 用戶端操作 | Payload | 成功時 |
| --- | --- | --- |
| `voice:join` | `{ muted, deafened }` | `{ success, peerId, state }` |
| `voice:leave` | — | `{ success }` |
| `voice:settings` | `{ muted, deafened }` | `{ success }` |
| `voice:signal` | `{ targetPeerId, description?, candidate? }` | `{ success }` |

| 伺服器事件 | Payload |
| --- | --- |
| `voice:state` | `{ roomCode, participants }`，包含 peer ID、帳號 ID、muted、deafened |
| `voice:signal` | `{ fromPeerId, description?, candidate? }` |
| `voice:left` | `{ reason }` |

- 加入、離開與設定在 runtime 佇列中執行。`voice:signal` 立即轉送，並檢查連線、工作階段是否過期，以及目標是否為目前同一房間的 peer。
- 每個 signal 剛好包含一個 description（SDP ≤ 12,000 個字元）或 candidate（≤ 2,048 個字元）。來源由伺服器指定。
- 每個帳號只能有一個語音分頁；每次加入都會取得新的 peer ID。

## 速率限制

依帳號計算，所有分頁共用：

| 操作 | 上限 |
| --- | --- |
| 語音 | 每分鐘 1,200 次 |
| 其他所有 Socket 操作 | 每分鐘 240 次 |
| `chat:send` | 另外限制每 5 秒 5 次 |

HTTP 登入憑證與上傳路由有各自的上限（[儲存](storage.md#身分與工作階段)）。私訊發送限制為每個帳號每 5 秒 5 次請求，跨分頁計算且包括重試。HTTP 429 會附上 `Retry-After`；讀取紀錄與標示已讀不會消耗發送額度。
