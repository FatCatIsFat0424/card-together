# 帳號與儲存

## 身分與工作階段

| 項目 | 規則 |
| --- | --- |
| 使用者名稱 | 3–24 個 ASCII 英文字母、數字、底線，可用單一的點或連字號分隔；不分大小寫且不可重複 |
| 新密碼 | 6–128 個字元，開頭與結尾不能是空白，不能是清單中的常見密碼 |
| 既有密碼 | 只檢查長度上限，讓舊密碼仍可使用 |
| 密碼雜湊 | 加鹽的非同步 scrypt（`N=131072`、`r=8`、`p=1`），限制並行數量並搭配 HTTP 速率限制 |
| 身分 | 帳號 UUID 就是玩家 ID；變更暱稱不影響身分 |
| 個人檔案 | 暱稱（1–20 個字元）、六位數顏色、已停用的預設頭像欄位（保留但不顯示；見 [API](api.md#個人檔案欄位)）、選填的圖片與透明度、座位背景、歷史紀錄可見度 |

- 登入會建立一個七天的不透明工作階段；只儲存它的 SHA-256 摘要。
- cookie 設為 HttpOnly 與 SameSite=Lax，正式環境另加 Secure。Socket 握手與每個操作都會重新驗證工作階段。
- 登出會撤銷一個工作階段。全部登出與變更密碼會撤銷所有工作階段，並中斷受影響的 socket。
- 變更密碼需要目前的密碼。沒有電子郵件或自助找回機制；管理者使用[離線重設](#管理者重設密碼)。

**玩家與隱私**

- bot 的身分是 `bot:<UUID>`，帶有 `isBot: true`，沒有帳號、工作階段或個人檔案。
- 有 bot 的已完成對局會出現在歷史紀錄中，也有回放，但不計入歷史紀錄的對局數、遊戲分布與勝率。
- 十款遊戲新開始的對局都會在 runtime 中保留只存在伺服器端的錄製資料（[`ReplayRecording`](../shared/src/types/replay.ts)、[錄製器](../server/src/runtime/replay-recording.ts)）。每次 commit 操作後，它會記錄未入座旁觀者收到的內容（每一份發出的手牌），扣除計時與呈現的 `serverNow`；畫面有變化時以路徑 patch 記錄。自動階段（德州撲克發完公牌與攤牌、騙子酒館質疑與開槍、21 點莊家行動）透過錄下的呈現畫格重播。
- 未發出的牌組與牌堆、騙子酒館的子彈、計時、聊天，以及錄製資料本身從不進入快照。即時快照與房間列表從不包含錄製資料。沒有錄製就開始的進行中遊戲維持不錄製，結果也沒有回放。
- 完成的錄製會成為第 1 版的 [MatchReplay](../shared/src/types/replay.ts) 封存，存放在[回放儲存區](#回放封存)；凡是歷史紀錄權限允許觀看該對局的人，都看得到每一份發出的手牌。步驟、結果與 runtime 以原子操作一起 commit；寫入失敗時三者一起還原。錄製資料在重新啟動後保留；封存在房間刪除後仍保留，並遵守本人／公開歷史紀錄規則與[對局保留規則](#回放封存)。
- [封存驗證器](../server/src/database/match-replay.ts)會檢查外層格式、patch 操作、大小上限與不安全的鍵（`__proto__`、`constructor`、`prototype`），並要求每個步驟都能套用到同一款遊戲、不含計時或伺服器時間的快照上。封存在讀取時檢查。runtime 錄製資料在啟動時完整檢查，已無法套用的會被丟棄並發出警告，該對局改為不錄製繼續進行；每次寫入只檢查結構。快照不會依照目前的遊戲規則檢查。
- 歷史紀錄依 N/E/S/W/P5/P6/P7/P8 的順序列出參與者。99、21 點、德州撲克與拿破崙只列出有人的座位；沒有 `seats` 的舊版結果列出四個座位。
- 人數彈性遊戲的快照在還原舊版四座位的值對照表時，額外座位的值為空。新的對局最多保存八個座位；缺少 `shuffleSeats` 代表 false。這些擴充過的快照與結果需要這個版本或更新的版本：回復到較舊的伺服器時，請依部署指南還原完整且相容的備份。
- 歷史紀錄預設公開，本人可以隱藏。Schema v5 曾一次把所有既有帳號設為公開；之後的選擇會保留。
- 座位背景會分享給房間。牌桌背景與牌背只有自己看得到。

**好友**

- 每一對帳號（不分順序）只能有一筆邀請，並區分寄件者與收件者權限。
- 已接受的好友可以看到彼此的上線狀態、主持中的房號與歷史上的最後上線時間。公開個人檔案、搜尋與待處理的邀請不包含最後上線資訊。
- 選填的內部欄位 `AccountRecord.lastSeenAt` 是非負的 safe integer Unix epoch 毫秒時間戳。舊資料缺少此值時維持未知（已接受好友的回應中為 `null`）；建立帳號與編輯個人檔案不會推測歷史活動。
- `Repository.saveRuntime` 以原子操作，隨已 commit 的快照一起推進最後上線時間：已連線的玩家使用 repository 時鐘；已斷線的玩家使用觀察到的斷線時間。runtime 玩家可以帶有獨立的活動時間戳；`null` 可避免只為還原而給的重新連線寬限期推進帳號歷史。這些值從不倒退，寫入失敗時兩邊都不會發布，移除暫時性玩家時仍保留帳號歷史。多個分頁會保持上線，直到最後一個斷線。重新啟動會保留既有的斷線時間；只有先前已連線的玩家會開始新的斷線寬限期，但不代表他們已重新上線。
- 加入好友的房間時會重新檢查好友關係、房主與容量。邀請是暫時性的，且只限已接受的好友。

**私訊與通知**

- 只有已接受的好友可以傳送私人文字、表情符號與貼圖；repository 儲存訊息時會以原子操作重新檢查好友關係。只有對話參與者可以讀取。
- 訊息支援離線送達，重新啟動後仍保留。已不是好友的雙方仍能以唯讀方式存取既有對話。訊息紀錄 90 天後到期，每次讀取時都會隱藏，並在啟動時與伺服器執行期間每小時持久移除。
- 已讀游標只能推進到該對話中的一則收件訊息；較舊的更新不能讓訊息重新變成未讀。已讀狀態只有讀者本人知道。
- 以寄件者為範圍的用戶端 ID 用來去除重複的重試。同一個 ID 用在其他收件者或其他訊息時會回傳衝突。媒體參照保留原本解析出的內容。
- 待處理的邀請來自好友關係。接受邀請會為發出邀請的人建立持久的通知，只有該帳號自己關閉或 90 天後才會消失。
- 通知只在站內。資料寫入後，Socket 事件會讓參與者的資料失效；重新連線時透過需驗證的 HTTP 重新載入未讀數與紀錄。
- 保留期限適用於目前使用中的資料庫。備份保留原本的內容，上傳的媒體則遵循另外的[媒體](media.md)生命週期。

## 金幣

- 每位完成遊戲的真人不論輸贏都會得到 `GAME_COIN_REWARD`（10），有 bot 的遊戲也一樣。旁觀者與被中止的遊戲沒有獎勵。21 點與德州撲克以整場對局發放，不是每一手。過去的對局不補發。
- `rewardedGameIds` 收據可防止重複發放，重新啟動後也一樣。
- `Repository.saveRuntime` 以一次原子寫入 commit 獎勵、收據、runtime、最後上線時間與已完成的歷史紀錄；`saveMatch` 從不發放金幣。
- 每次餘額變動（包括購買）都會增加 `coinRevision`，讓用戶端可以丟棄過時的回應。更新透過 `account:coins`、`account:updated` 與 resume 送達本人（[API](api.md#socket-操作)）。

## 每日獎勵

- 私人的選填欄位 `AccountRecord.dailyRewards` 儲存目前的台灣日期、已完成的不同遊戲類型、各遊戲的次數與勝場（上限兩次）、三個已指派的任務 ID、每天一次的替換收據、任務領取收據與簽到日期。每次寫入都會驗證[紀錄與日期規則](../server/src/database/daily-rewards.ts)。較舊的帳號從空白開始；歷史對局不會回補。
- 每日進度和金幣一起 commit，共用既有的 `rewardedGameIds` 收據。重試與重新啟動不會讓進度重複增加。讀取時在 Asia/Taipei 00:00 重設，不需要排程器或寫入資料庫；下一次變更時才會寫入。
- 初始指派使用帳號 ID、台灣日期與任務池 ID 的確定性 SHA-256 洗牌。唯讀的重新整理不會改變指派。從固定任務升級時保留同一天既有的領取收據；已知玩過的類型會以次數 1 起算。
- `Repository.replaceDailyTask` 把替換額度檢查與指派變更序列化處理。它會排除原本的三個任務，保留今天的計數，且從不變動金幣。對原始任務的重試會回傳已保存的替換結果；同時進行的替換最多只會消耗一次額度。領取需要目前已指派的任務。
- `Repository.claimDailyReward` 在序列化的 transaction 內檢查日期與資格，再一起更新收據、金幣與 `coinRevision`。重複領取回傳已保存的狀態；寫入失敗時獎勵仍可領取。從不信任用戶端送來的進度、金額、帳號 ID，或過去／未來的簽到日期。
- 所有簽到收據都會保留。本人 API 只回傳本月的日期；私人進度與收據不會出現在公開的帳號或個人檔案回應中。

## 成就

- 私人的選填欄位 `AccountRecord.achievements` 儲存累計的完成遊戲數、不同變體、勝場，以及已領取的每日任務數。所有計數器都保留完整的 safe integer 總數，不受目錄目標值限制。見[紀錄與驗證](../server/src/database/achievements.ts)。Schema v7 會一次回補仍保留的對局，以及已發放獎勵的已完成 runtime 遊戲，包括任何仍保留的 bot 遊戲。它會跨兩個來源去除重複的遊戲 ID，並取回補總數與舊計數器的最大值，避免重疊的歷史被重複計算。變體集合會合併；任務進度、金幣、收據與稱號擁有權都保留。兩個來源都沒有的歷史 bot 遊戲無法重建：舊計數器在 20 場／5 勝時就停止。缺少這些紀錄時，回補值是下限，而不是由金幣餘額推估的數字。簽到進度使用所有仍保留的每日簽到收據。舊的任務計數器在 15 時停止；已保存的進度會保留，新的領取會從這裡繼續累加。在上限時遺失的舊任務領取無法重建，因為每日任務收據每天都會重設。
- 遊戲進度和金幣與 `rewardedGameIds` 以原子操作一起 commit。每日任務數只在第一次成功的任務領取 transaction 中增加，並在每日重設後保留。重試或寫入失敗都不會讓任一計數器灌水。
- `Repository.claimAchievement` 在序列化的 transaction 內檢查目錄中的每個里程碑，並把專屬稱號一次授予 `ownedAchievementNameplates`。這個永久且只有本人可見的物品欄與 `ownedShopItems` 分開，無法購買。領取會保留金幣與裝備中的外觀，推進 `updatedAt`，並在資料寫入後才發布給本人。私人計數器從不進入個人檔案。

## 頭像外框

- 舊版的外框物品欄與購買路由仍由[外觀物品欄](#外觀物品欄)支援。

## 外觀物品欄

- `Repository.purchaseShopItem` 使用共用的[目錄](../shared/src/constants/shop.ts)，以一次原子寫入扣除金幣、增加 `coinRevision`，並授予永久擁有權。重複購買不會有任何效果；寫入失敗時物品欄與餘額都不變。購買不會自動裝備。
- 商品與貼圖 ID 是持久的參照。重新命名或移除它們需要相容的資料 migration，並為已擁有的商品與歷史紀錄保留圖案。
- 外框保留在 `ownedAvatarBorders`；其他商品使用私人的 `ownedShopItems`。裝備欄位定義在 [AccountProfile](../shared/src/types/account.ts)。服務層與 Repository 在裝備前都會驗證物品類型與擁有權。資料庫會拒絕不存在的 ID、重複的物品欄與未擁有的裝備。
- 裝備官方圖片樣式時，會覆蓋仍保留的上傳圖片。設為 null 會恢復上傳圖片或主題，不會遺失媒體。公開個人檔案包含外觀名牌與聊天框；房間中的身分另外包含座位樣式、座位框與勝利特效。物品欄、牌背與牌面、牌桌樣式、音效包與籌碼樣式只有本人看得到。購買與變更裝備會更新本人所有已連線的分頁。
- 貼圖訊息儲存穩定的目錄 ID。傳送需要擁有包含該貼圖的貼圖包；收件者不需擁有也能顯示。既有的表情符號與上傳貼圖維持各自獨立且免費的行為。

## 資料相容性

不變更 schema 就加入的選填欄位；缺少時使用預設值：

| 欄位 | 預設值 | 較早的伺服器 |
| --- | --- | --- |
| `MatchRecord.hasReplay` | 沒有回放；舊版結果仍可讀取 | 保留旗標並忽略 `replays/`；無法提供回放，也不會標示 `hasReplay` |
| `AccountRecord.lastSeenAt` | 未知 | 保留欄位；不推進歷史活動 |
| `coins`、`coinRevision` | 0 | 保留欄位；不發放任何獎勵 |
| `rewardedGameIds` | 空 | 保留欄位 |
| `AccountRecord.dailyRewards` | 沒有進度或領取紀錄 | 保留欄位；在較早伺服器上完成的遊戲不會推進每日任務 |
| `AccountRecord.achievements`、`ownedAchievementNameplates` | 計數器為零／已取得的物品欄為空 | 計數器不會推進；不支援帳號或 runtime 中裝備的已取得稱號。回復前請還原完整且相容的備份 |
| `ownedAvatarBorders`、`avatarBorder` | 空／原始頭像 | 保留欄位；無法顯示或管理外框 |
| `ownedShopItems`、官方圖片樣式欄位、`nameplate` | 物品欄為空／上傳圖片或主題／沒有名牌 | 無法顯示或管理商品；較舊的個人檔案寫入可能會丟失裝備 |
| `cardFaceStyle`、`soundPack`、`chipStyle`、`seatFrame`、`victoryEffect`、`chatFrame`（帳號、runtime 的 `PlayerInfo`） | 內建設計 | 不支援：裝備中的值無法通過較舊的驗證。回復前請還原完整且相容的備份 |
| 房間訊息與私訊中的 `shopSticker` | 不存在 | 不支援：回復前請還原完整且相容的備份 |
| `seatBackground` | 主題圖案 | 忽略；資料與媒體保留 |
| `RoomInfo.napoleonOptions` | 鬼牌召喚開啟 | 有拿破崙狀態時不支援；見下方 |
| `RoomInfo.additionalSeats`（99、21 點、德州撲克、拿破崙） | 四個座位；最多四個額外座位，可坐真人或 bot | 不支援：先請玩家離開額外座位，並由房主移除這些座位 |

- 較早的版本無法讀取 99 的並列結果（`winners`）。
- 加入牌七、十三支、騙子酒館、21 點、德州撲克或拿破崙之前的版本，會拒絕包含這些遊戲的狀態或歷史紀錄。
- 絕對不要讓兩個伺服器版本使用同一個資料庫。回復步驟：[部署](deployment.md#回復版本)。

## 資料庫

介面：[`Repository`](../server/src/database/repository.ts)、[schema](../server/src/database/schema.ts)、[migration](../server/src/database/migrations.ts)。兩種[儲存引擎](#儲存引擎)實作同一個介面，並共用相同的版本號碼與資料規則。

| Schema 版本 | 變更 |
| --- | --- |
| 7（目前） | 回補仍保留的成就歷史，並移除成就計數器上限 |
| 6 | 加入私訊、私人已讀游標與「邀請已接受」通知 |
| 5 | 一次把既有的對局歷史設為公開 |
| 4 | 牌背與圖片透明度的預設值，維持原本的外觀 |
| 1–3 | 啟動時 migration |

- JSON：啟動時會 migration 較舊的版本、驗證結果，並先把原檔另存為 `database.json.v<version>.bak`。較早的伺服器會拒絕 v7 檔案；回復需要完整且相容的備份，並會遺失該備份之後的寫入。
- SQLite：版本記錄在 `PRAGMA user_version`，從 v7 開始。schema 版本變更時，[SQLite migration](../server/src/database/sqlite-schema.ts) 必須同時加入一個步驟；啟動時先以 `VACUUM INTO` 另存 `database.sqlite.v<version>.bak`，再在一個 transaction 內套用。較舊的 JSON 文件先經過 JSON migration 才匯入。
- 無效的 JSON、版本、重複資料或參照會讓啟動停止，且不會動到檔案。

| Collection | 內容 |
| --- | --- |
| `accounts` | 身分、正規化的使用者名稱、密碼雜湊、個人檔案、金幣、時間戳、選填的最後上線歷史 |
| `sessions` | token 摘要、帳號、建立與到期時間 |
| `friendships` | 帳號配對、狀態、時間戳 |
| `matches` | 遊戲 ID、結果、參與者、完成時間、選填的 `hasReplay` 旗標 |
| `emojis` | 擁有者、不重複的名稱、媒體參照 |
| `directMessages` | 寄件者、收件者、用戶端 ID、解析後的內容、時間戳 |
| `messageReads` | 帳號、對話對象、最後讀取的收件訊息 |
| `friendNotifications` | 發出邀請者、接受的帳號、時間戳 |
| `runtime` | 玩家、房間、準備狀態、含私人手牌與紀錄的遊戲、最近的聊天、計時 |

| 位置 | 路徑 |
| --- | --- |
| 開發 | `server/data/database.json`；SQLite 為 `server/data/database.sqlite`（覆寫：[`DATABASE_ENGINE`、`DATABASE_PATH`](development.md#設定)） |
| 正式環境 | `/var/lib/card-together/database.json`；[切換](#sqlite-切換)後為 `database.sqlite`，JSON 保留為唯讀備援 |
| 圖片 | 資料庫旁的 `media/`：以內容定址的檔案，加上 `media/owners/` 配額標記 |
| 回放 | 資料庫旁的 `replays/`：每場已錄製對局一個 `<match ID>.json` 封存 |

**寫入與復原行為**

- 每個資料庫檔由一個程序獨占，由[擁有者鎖定檔](#單一擁有者鎖定)跨程序強制執行。
- 兩種引擎都在寫入持久化之後才完成 Promise；失敗時資料與記憶體都維持原狀。細節見[儲存引擎](#儲存引擎)。
- runtime 與已完成的對局在回覆與廣播前一起 commit。
- [`AnyGameState`](../shared/src/types/game.ts) 中以對局為範圍的 `autoPlaySeats` 會保存自願的電腦代打，不改變真人玩家的身分。舊快照缺少此欄位代表關閉。切換使用和遊戲操作相同的 commit／回復流程；排程工作只從已 commit 的狀態重建，並在取回控制權時取消。
- 選填的 `earlyLeaveSeats` 記錄自動代打座位中，已確認提早離開的那些座位。所有對局接收者都看得到，重新連線與重新啟動後仍保留，該座位停止代打時清除。沒有這個欄位的舊快照沒有離開標記。
- 重新啟動會保留私人手牌、計時與截止時間，並給斷線玩家重新計算 60 秒的時限（[架構](architecture.md#狀態-commit)）。
- 移除空房間會刪除它的遊戲與聊天，但不刪除歷史紀錄。每個房間的聊天保留 200 則訊息。語音從不儲存。
- 開發用的狀態檔被 Git 忽略，也從不以靜態檔案提供；圖片透過媒體 endpoint 取得。

### 儲存引擎

`DATABASE_ENGINE` 選擇引擎，預設 `json`；`DATABASE_PATH` 的副檔名必須相符（`.json` 或 `.sqlite`），否則啟動會停止（[設定](development.md#設定)）。

| | JSON（[adapter](../server/src/database/json-repository.ts)） | SQLite（[adapter](../server/src/database/sqlite-repository.ts)） |
| --- | --- | --- |
| 儲存 | 一份精簡的 JSON 文件，常駐記憶體 | Node.js 內建 `node:sqlite`，資料留在檔案中，以索引查詢 |
| 每次寫入 | 驗證並序列化整份文件，寫入暫存檔、fsync、重新命名 | 一個 `BEGIN IMMEDIATE` transaction，只寫入變更的列 |
| 寫入時的驗證 | 整份文件（runtime 錄製只檢查結構） | 只檢查要寫入的紀錄與它們的參照 |
| 持久性 | fsync 後才完成 | WAL 搭配 `synchronous=FULL`：每次 commit 都 fsync WAL 後才完成 |
| 附屬檔案 | 寫入中的 `.tmp` 暫存檔；開啟期間的 `database.json.lock` | 開啟期間的 `database.sqlite-wal`、`-shm` 與 `database.sqlite.lock` |

兩種引擎共用同一套帳號規則、保留規則與回放儲存區，回放封存與媒體都維持在資料庫旁的檔案。

**SQLite schema**（[DDL](../server/src/database/sqlite-schema.ts)、[讀寫](../server/src/database/sqlite-store.ts)）

| 資料表 | 內容 |
| --- | --- |
| `accounts` | 唯一的帳號 ID 與正規化使用者名稱、搜尋用的小寫暱稱、密碼雜湊，以及其餘欄位（金幣、每日獎勵、成就、物品欄、裝備）的 JSON 紀錄 |
| `account_activity` | 最後上線時間；與帳號紀錄分開，runtime commit 不必重寫帳號 |
| `sessions`、`friendships`、`emojis` | 欄位化的紀錄；好友配對、權杖摘要、每個帳號的表情符號名稱都是唯一鍵 |
| `matches`、`match_participants` | 每場對局一列 JSON 結果與回放旗標；參與者依帳號與完成時間建立索引 |
| `direct_messages`、`message_reads`、`friend_notifications` | 私訊 JSON 紀錄與寄件者／用戶端 ID 唯一鍵；刪除訊息時已讀游標一併刪除 |
| `rewarded_games` | 已發放獎勵的遊戲 ID |
| `runtime_state`、`runtime_players`、`runtime_rooms`、`runtime_games`、`runtime_chat` | 每位玩家、每個房間、每場遊戲與每個房間聊天各一列 JSON，加上一列記錄順序 |

- 帳號以外的參照使用外鍵；bot 參與者沒有帳號，所以參與者表不設外鍵，改在寫入時檢查。
- `seq` 欄保留插入順序，查詢結果的排序與 JSON 陣列相同。檔案標頭的 `application_id` 標記這是 Card Together 的資料庫；其他 SQLite 檔或較新版本會被拒絕，且不會被修改。新檔案的權限為 `0600`。

**SQLite transaction 與驗證**

- 所有操作依呼叫順序排隊，讀取會等待先前的寫入。每次寫入都是一個 `BEGIN IMMEDIATE` transaction；任何錯誤（包括 commit 失敗）都會 `ROLLBACK`。
- `saveRuntime` 在同一個 transaction 中發放獎勵與收據、推進最後上線時間、寫入對局並套用保留規則，最後驗證並寫入 runtime。runtime 先轉成各列 JSON，只寫入和上次 commit 不同的列；這份「已 commit 列」的紀錄只在 commit 成功後更新。
- 寫入時只驗證這次寫入的紀錄，沿用 JSON 的單筆驗證函式。runtime 的玩家、房間與聊天每次都檢查；內容沒變的遊戲列在 commit 時已驗證過，只重新檢查它和玩家、房間的關聯；帳號參照只檢查有變化的列。唯一性與參照由 schema 的限制保證。
- 啟動時讀出整份文件，執行和 JSON 相同的完整驗證（包括套用 runtime 錄製步驟）、丟棄無法套用的錄製、套用對局保留規則（先以 `VACUUM INTO` 備份到 `.match-history-<UUID>.bak/`），並清理回放目錄。
- 連線設定：`foreign_keys=ON`、`busy_timeout` 5 秒、預先編譯並重複使用的 statement。

**從 JSON 匯入**

[`importJsonDocument`](../server/src/database/sqlite-import.ts) 由[遷移工具](#遷移到-sqlite)呼叫：

- 先執行 JSON migration 與完整驗證，再於一個 transaction 中寫入所有 collection，保留 ID、雜湊、到期時間、媒體參照與順序。
- 從不覆寫：重複的鍵、好友配對或已存在的 runtime 會以 `IMPORT_CONFLICT` 拒絕整次匯入，目標不變。
- 寫入後比對數量、外鍵、合併後的唯一性與參照，並確認每一筆匯入的紀錄讀回時完全相同。
- 呼叫前必須停止兩個資料庫的所有寫入者。回放封存與媒體不會複製；它們必須位在 SQLite 檔旁的 `replays/` 與 `media/`。

### 單一擁有者鎖定

[`owner-lock.ts`](../server/src/database/owner-lock.ts)：伺服器、匯入，以及維護工具的套用模式，都會在資料庫旁建立 `<資料庫檔名>.lock`（例如 `database.sqlite.lock`），兩種引擎相同。

- 鎖定檔權限為 `0600`，一次完整寫入，記錄 PID、主機名稱、Linux boot ID、程序啟動時間與隨機 token。
- 擁有者仍在執行時，第二個程序立即以 `DATABASE_IN_USE` 失敗並顯示擁有者的 PID；不會等待，也不會動到鎖定檔。
- 正常關閉（`SIGTERM`、`SIGINT`、repository `close()`）會移除鎖定檔，而且只移除 token 仍屬於自己的檔案。
- 只有能證明擁有者已結束時，才會自動取代過時的鎖定檔並記錄 log：boot ID 不同（重新開機前留下的）、該 PID 不存在，或該 PID 的啟動時間不同（PID 已被重複使用）。因此 `MemoryMax` 終止或斷電後，systemd 仍能自動重新啟動。
- 其他主機留下的、或內容無法解析的鎖定檔永遠不會自動移除。手動處理：
  1. 停止服務，並確認沒有程序使用資料庫：`systemctl status card-together.service`、`ps -p <PID> -o pid,lstart,cmd`（PID 取自鎖定檔）。
  2. 確認後才移除，例如 `sudo -u card-together rm /var/lib/card-together/database.sqlite.lock`。
- SQLite 不使用 exclusive locking mode，所以服務執行時仍可做[線上備份](deployment.md#備份)。
- 鎖定檔只約束本專案的程式；直接用 `sqlite3` 或編輯器開啟檔案不受限制。

### 回放封存

介面：[`MatchReplay`](../shared/src/types/replay.ts)、[儲存區](../server/src/database/replay-store.ts)、[`MAX_MATCHES_PER_ACCOUNT`](../server/src/database/repository.ts)。

- 封存存放在資料庫之外，所以寫入時從不讀取、驗證或重寫它們。對局紀錄只保留 `hasReplay: true`。含有內嵌 `replay`（未發布的開發格式）的資料庫會在啟動時被拒絕。
- 檔名是經過驗證的對局 ID（`[A-Za-z0-9_-]`，最多 128 個字元）。每個檔案只寫入一次，在標記該對局的 commit 之前，以 `0600` 暫存檔寫入、fsync 並重新命名；目錄權限為 `0700`。
- 每個帳號只能列出並回放自己最近 100 場已完成的對局，包括有 bot 與未錄製的遊戲。只要還有任何真人參與者保留該對局，共用的結果與封存就會繼續保存；bot 身分從不延長保留期限。完成時間相同時保留資料庫的寫入順序。對局 commit 會以原子操作刪除過期的結果，並在資料寫入成功後才移除對應的封存檔。
- 啟動時對既有資料套用相同的保留規則，並在替換前把資料庫、旁邊的媒體與回放封存備份到私人的 `.match-history-<UUID>.bak/`。備份失敗時會中止啟動，不清除任何結果或封存。
- 讀取時驗證整份封存。檔案不存在、無法讀取或無效時視為沒有回放，並只記錄一次 log。
- commit 失敗時會刪除它寫入的檔案。啟動時會刪除殘留的暫存檔，以及沒有對應已標記對局的封存，並記錄有多少已標記的對局沒有檔案。不認得的檔案不會被動到。

## 備份與還原

**備份**：停止所有寫入者，再複製整個狀態目錄（`database.json` 或 `database.sqlite`，連同存在時的 `-wal`、`-shm`，以及 `media/` 與 `replays/`）。服務執行時，只能用[每日備份](deployment.md#備份)的方式：JSON 讀取一次完整檔案，SQLite 以 `VACUUM INTO` 複製；絕對不要在服務執行時直接複製 `.sqlite` 與它的 `-wal`。備份包含密碼雜湊與私人手牌：請妥善保密，並在另一台主機保留一份副本。

**還原**（正式環境使用 [`restore-data.sh`](deployment.md#還原資料)，它會執行以下每一步）：

1. 停止所有可能的寫入者，並另外保存目前的完整狀態。
2. 確認快照的引擎與設定相符、schema 相容並通過驗證，再以嚴格的權限與正確的擁有者還原資料庫、媒體與回放；被取代的 SQLite 檔的 `-wal`、`-shm` 必須一起移除，否則會被套用到還原後的檔案。
3. 啟動一個服務；確認登入、歷史紀錄、媒體與遊戲恢復都正常。

還原會遺失較新的寫入。絕對不要編輯使用中的 JSON、為了修好啟動而刪除資料，或還原與媒體、回放不相符的資料庫。快照中缺少的回放只會顯示「沒有錄製」；多出來的回放檔會在啟動時清除。

## 維護工具

所有工具都離線執行，依副檔名支援 JSON（`.json`）與 SQLite（`.sqlite`）資料庫，並有相同的需求：

- 先停止**所有資料庫寫入者**，並保留完整的資料庫、媒體與回放備份。這會讓玩家斷線。`--writers-stopped` 只是確認這件事，工具不會停止服務。
- 套用時會取得[擁有者鎖定檔](#單一擁有者鎖定)：仍在執行的伺服器或另一個工具會讓它以 `DATABASE_IN_USE` 失敗，且不寫入任何東西。不使用鎖定檔的寫入者，由檔案內容（JSON）或 SQLite `data_version` 的變化偵測。
- 明確傳入設定的資料庫路徑。檔案必須使用目前的 schema，且必須是一般檔案，不能有符號連結或硬連結；SQLite 檔還必須是 Card Together 資料庫。較舊的資料請先透過一次有備份的正常啟動升級。
- 以固定的 Node.js 版本、以資料庫檔案擁有者的身分執行。
- 先預覽（不寫入），再套用。印出的備份路徑請保密。
- 完成後重新啟動單一實例。

### 管理者重設密碼

不需要舊密碼即可重設密碼。沒有網頁版的管理者角色或找回 endpoint。

1. 透過可信任的管道確認請求者擁有該帳號；只憑使用者名稱、暱稱或歷史紀錄不足以證明。
2. 先預覽再套用（替換路徑與登入用的使用者名稱）：

   ```sh
   npm run admin:reset-password -- /absolute/path/database.json alice
   npm run admin:reset-password -- /absolute/path/database.json alice --apply --writers-stopped
   ```

   正式環境，從已安裝的目錄執行（[切換到 SQLite](deployment.md#切換到-sqlite)後改用 `database.sqlite`）：

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice'
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/auth/reset-password-cli.ts /var/lib/card-together/database.json alice --apply --writers-stopped'
   ```

3. 在隱藏輸入的提示中輸入新密碼兩次。密碼從不接受以參數、環境變數或重新導向的輸入傳入。
4. 透過可信任的私人管道傳送密碼，並請帳號擁有者變更密碼。
5. 重新啟動，確認新密碼可以使用，且舊的工作階段已被撤銷。

- 使用者名稱比對不分大小寫；不接受暱稱或帳號 ID。
- 預覽會回報路徑、帳號 ID、儲存的使用者名稱與工作階段數量。
- 套用時會寫入 0600 的備份 `<資料庫檔名>.password-reset-<UUID>.bak`（JSON 為原始位元組，SQLite 為 `VACUUM INTO` 產生的獨立資料庫），使用註冊時的密碼規則與雜湊方式，並只變更目標帳號的密碼、時間戳與工作階段。SQLite 在一個 transaction 中完成。
- 輸入被拒絕、檔案擁有者錯誤、資料庫被占用、來源在過程中被同時修改，或寫入失敗時，資料庫維持不變。結果中有 `warnings` 代表密碼**已經**變更；請清理回報的暫存檔或鎖定檔。
- 還原備份會恢復舊密碼與工作階段，並遺失較新的寫入。

### 對局紀錄清理

在啟動前，用這個離線工具預覽或套用[對局保留規則](#回放封存)：

```sh
npm run cleanup:match-history -- /absolute/path/database.json
npm run cleanup:match-history -- /absolute/path/database.json --apply --writers-stopped
```

- 依照[離線需求](#維護工具)，停止所有寫入者後以資料庫擁有者的身分執行。
- 試跑會回報全域已過期的紀錄與剩下的紀錄，不寫入任何檔案。其他真人仍需要的共用對局會繼續保存；每個帳號仍最多看到 100 場。
- 套用時會建立私人的 `.match-history-<UUID>.bak/` 目錄，內含資料庫（`database.json`，或以 `VACUUM INTO` 複製的 `database.sqlite`），以及旁邊 `media/` 與 `replays/`（若存在）的副本。備份失敗時資料庫不會被動到。接著以原子操作替換 `matches`（SQLite 為一個 transaction），並只移除過期的回放檔。
- 帳號、工作階段、獎勵、好友、訊息、媒體與可恢復的 runtime 都不變。第二次執行不會有任何效果。重新啟動後，確認登入、歷史紀錄、回放與遊戲恢復都正常。

### 遷移到 SQLite

[`migrate-sqlite.ts`](../server/src/database/migrate-sqlite.ts) 把 JSON 資料庫匯入同一目錄中的新 SQLite 檔。正式環境的步驟：[切換到 SQLite](deployment.md#切換到-sqlite)。

```sh
npm run admin:migrate-sqlite -- /absolute/path/database.json /absolute/path/database.sqlite
npm run admin:migrate-sqlite -- /absolute/path/database.json /absolute/path/database.sqlite --apply --writers-stopped
```

- 來源必須是 `.json`，目標必須是 `.sqlite`，兩者位在同一個目錄，讓 `media/` 與 `replays/` 繼續共用。
- 來源：一般檔案，沒有符號連結或硬連結，由執行者擁有，並通過 JSON migration 與完整驗證。來源從不被修改；套用時持有它的鎖定檔，匯入後再確認位元組沒有變化。
- 目標：不存在，或是執行者擁有的空白一般檔案；旁邊不能有 `-wal`、`-shm`、`-journal` 或 `.lock`。工具從不合併進既有的資料庫。
- 預覽回報各 collection 的筆數、是否有 runtime、會被丟棄的錄製、來源大小、可用空間與所需空間（來源的 5 倍：SQLite 約為 JSON 的 2.2 倍，而且單一匯入 transaction 會先寫入 WAL）。空間不足時套用會拒絕。
- 套用時以[匯入函式](#儲存引擎)在一個 transaction 中寫入，接著執行 `PRAGMA quick_check`、`foreign_key_check`，比對每個 collection 的筆數，並逐筆確認讀回內容相同。輸出的 `verification.tables` 列出每個資料表的列數。
- 任何失敗都會刪除部分寫入的目標與它的日誌檔（原本是空白檔則清回空白），JSON 維持不變。

### 匯出 SQLite 為 JSON

[`export-sqlite.ts`](../server/src/database/export-sqlite.ts) 把 SQLite 資料庫寫成新的 JSON 資料庫檔，用於回復到 JSON；內容包含切換後的所有寫入。步驟：[回復到 JSON](deployment.md#回復到-json)。

```sh
npm run admin:export-json -- /absolute/path/database.sqlite /absolute/path/database.export.json
npm run admin:export-json -- /absolute/path/database.sqlite /absolute/path/database.export.json --apply --writers-stopped
```

- 來源必須是目前 schema 的 Card Together SQLite 檔（一般檔案，沒有連結，由執行者擁有）；套用時持有它的鎖定檔。
- 在一個 read transaction 中讀出整份資料，套用和啟動相同的完整驗證；無法套用的錄製會被丟棄並回報，該對局繼續但不錄製。
- 從不覆寫：目標已存在時拒絕。以 `0600` 暫存檔寫入、fsync，再以 `link()` 發布到目標名稱。
- 寫入後重新讀取，以正式環境的 JSON 驗證器檢查，並確認內容與筆數相同；失敗時刪除輸出檔。
- 匯出檔不含媒體與回放：它們仍留在資料庫旁的 `media/` 與 `replays/`。

## SQLite 切換

- 第一階段：SQLite adapter、匯入函式，以及在兩種引擎上執行的 repository、auth、social、runtime、持久化與金幣測試。
- 第二階段：[擁有者鎖定檔](#單一擁有者鎖定)、[遷移](#遷移到-sqlite)與[匯出](#匯出-sqlite-為-json)工具、兩種引擎的維護工具、SQLite 線上備份與[還原](deployment.md#還原資料)，以及[切換 runbook](deployment.md#切換到-sqlite)。
- 正式環境的切換**尚未執行**，需經核准後依 runbook 進行；在那之前繼續使用 JSON（`server.env.example` 的預設值）。不要只修改 `DATABASE_ENGINE` 而跳過遷移。
- JSON adapter 至少再保留一個版本，作為回復與開發用的引擎。
- SQLite 開始接受寫入後，JSON 檔就已過時：回復時必須用匯出工具帶出較新的資料。不要加入雙重寫入。
- 多程序的房間協調需要另外設計。
