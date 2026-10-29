# 開發

專案規則：[AGENTS.md](../AGENTS.md)。檢查指令：[測試](testing.md)。

## 環境建置

1. 使用 [`.node-version`](../.node-version) 中完全相同的 Node.js 版本。應用程式需要 Node.js 24 以上（SQLite 引擎使用內建的 `node:sqlite`），檢查工具與部署則要求完全相同的版本。
2. 在 repository 根目錄執行 `npm ci`。所有 workspace 共用根目錄的 TypeScript。
3. 啟動 `npm run dev:server` 與 `npm run dev:client`，再開啟 <http://localhost:5173>。

client 的 `predev` 與 `prebuild` 會從被忽略的 `local-music/` 與 `local-emoji/` 資料夾匯入站長的音樂與站方表情符號；見[媒體](media.md)。

專案使用 Node.js 與 npm，不需要 Conda。`npm ci` 會把鎖定版本的相依套件安裝到這個 checkout 的 `node_modules/`；另一個 checkout 有自己的相依套件。Node.js 版本管理工具是選用的。在支援的 Linux 主機上，也可以用[官方 Node.js bootstrap](deployment.md#建置與部署)，以固定版本與內附的 npm 執行開發指令，而不變更系統的執行環境。正式環境使用複製的 Node 執行檔與專用的 systemd 帳號；應用程式、設定與狀態的路徑記錄在[部署](deployment.md)中。

## 設定

- 伺服器只讀取程序的環境變數。`server/.env.example` 僅供參考，不會自動載入。
- Vite 在啟動與建置時讀取 `client/.env.local`；變更後請重新啟動或重新建置。
- `VITE_` 開頭的值是公開的 JavaScript。絕對不要放機密資料。

| 伺服器變數 | 行為 |
| --- | --- |
| `PORT` | 預設 `3001` |
| `HOST` | 選填的綁定位址；在本機 proxy 後方請用 `127.0.0.1` |
| `DATABASE_ENGINE` | `json`（預設）或 `sqlite`；其他值會停止啟動。SQLite 使用內建的 `node:sqlite`，請以 `.node-version` 的版本執行（[儲存引擎](storage.md#儲存引擎)） |
| `DATABASE_PATH` | 不論 cwd，預設都是 `server/data/database.json`（`sqlite` 為 `server/data/database.sqlite`）；以相對路徑覆寫時，從 cwd 解析。副檔名必須與引擎相符（`.json`／`.sqlite`），否則啟動會停止 |
| `CLIENT_ORIGIN` | 以逗號分隔、完全相符的 `http(s)://host[:port]` origin：不含路徑、結尾斜線或預設連接埠。正式環境必填；開發環境預設為 `localhost:5173` 與 `127.0.0.1:5173`。有無效項目時會停止啟動 |
| `NODE_ENV` | `production` 會啟用 Secure cookie 並要求 HTTPS |
| `TRUST_PROXY_LOOPBACK` | 預設 `false`。只在可信任、會覆寫轉送位址的本機 proxy 後方啟用 |
| `BOT_WORKERS` | 搜尋型 bot 的 worker thread 數量，預設 `2`，範圍 0–8；`0` 關閉 worker pool，搜尋型 bot 改用簡單策略（[Bot worker pool](architecture.md#bot-worker-pool)）。不是範圍內的整數時會停止啟動 |
| `BOT_WORKER_MEMORY_MB` | 每個 worker 的 V8 old-generation 堆積上限（MiB），預設 `128`，範圍 32–1024；超過時該 worker 會被終止並視為當機 |
| `BOT_SEARCH_QUEUE` | 等待空閒 worker 的任務上限，預設 `32`，範圍 0–1024；超過時直接改用簡單策略 |
| `SEVENS_DEV_PRESET` | 只限開發環境。`near-slay` 會在 44 筆出牌紀錄後開始牌七，每個花色都已從 2 排到 Q，每個座位留下兩張 A 或 K。其他任何值，或正式環境中的任何值，都會停止啟動 |

| Vite 變數 | 行為 |
| --- | --- |
| `VITE_BASE_PATH` | 預設 `/`；必須以 `/` 開頭與結尾 |
| `VITE_SERVER_URL` | 選填的外部 API／Socket origin；留空時使用應用程式的 origin 與 base |
| `VITE_SOCKET_PATH` | 選填的 Socket.IO 路徑 |
| `VITE_DEV_PROXY_TARGET` | 開發 proxy 的 HTTP(S) origin；預設 `http://localhost:3001`。不能包含憑證、路徑、query 或 fragment |
| `VITE_WEBRTC_ICE_SERVERS` | 公開的 JSON ICE 設定；見[語音](media.md#語音) |

正式環境的值：[部署](deployment.md#執行環境設定)。

當工作站也在連接埠 `3001` 上執行正式環境時，開發環境請使用另一個後端連接埠與資料庫：

```sh
PORT=3002 HOST=127.0.0.1 npm run dev:server
```

在 `client/.env.local` 設定 `VITE_DEV_PROXY_TARGET=http://127.0.0.1:3002`，再啟動 `npm run dev:client`。預設的開發資料庫仍是 `server/data/database.json`；絕對不要指向 `/var/lib/card-together/` 中的資料庫。同一個資料庫只能由一個程序開啟，第二個開發伺服器或工具會因[擁有者鎖定檔](storage.md#單一擁有者鎖定)立即失敗；程序結束後留下的鎖定檔，會在確認該 PID 已不存在後自動取代，所以 `tsx watch` 重新啟動不受影響。API 與 Socket.IO 的 proxy 請求都使用設定的開發目標。這個變數只用於 Vite 的開發伺服器，不會改變正式環境的 Nginx upstream。

選用的[自動部署服務](deployment.md#ci-通過後自動部署)使用獨立的 detached worktree 與站長輸入快照。你目前的分支、尚未 commit 的變更與只存在本機的 commit 都不會進入它的正式環境建置。

## UI 慣例

- **核取方塊**：使用 [AppCheckbox](../client/src/components/AppCheckbox.tsx)（MUI、主題變數、44px 點擊範圍）。標籤要與原生 input 關聯，並透過 `slotProps.input` 傳入 input 的無障礙屬性。
- **字級與控制項**：token 定義在 [global.css](../client/src/styles/global.css)；內文 13–15 px，次要標籤最小 12 px。`px`／`rem` 的字級字面值小於 12 px 會讓檢查失敗；單一字元的徽章（如莊家 `D`）若確實放不下，可在同一行或上一行加註解 `single-glyph` 與理由。按鈕使用 [Button](../client/src/components/Button.tsx)（主要操作為 34 px 膠囊）、[IconButton](../client/src/components/IconButton.tsx)（20 px 圖示、40 px 點擊範圍）、[Tabs](../client/src/components/Tabs.tsx) 與 [Chip](../client/src/components/Chip.tsx)。
- **密度與邊距**：頁面內容的外距一律用 `--page-inset`（桌機 24px，≤52rem 為 16px，手機與矮的橫向畫面為 12px），四邊相等，內距 12–16px。列表列約 44–52px：頭像 32px（`Avatar` 的 `row`）、名稱 14px、一行 12px 的次要文字；寬度允許時排成多欄（`repeat(auto-fill, minmax(…, 1fr))`），動作緊貼內容，超過兩個次要動作時收進 [OverflowMenu](../client/src/components/OverflowMenu.tsx)。置中對話框使用 [dialog.ts](../client/src/styles/dialog.ts)：`dialogPaperClass(size)` 與 `dialogParts` 讓四邊外距都是 `--dialog-inset`（16px，手機與矮橫向 12px）、高度上限為 `100dvh` 減去兩倍外距、寬度上限為 `100vw` 減去兩倍外距，標題與頁尾固定，內容在對話框內捲動；矮橫向時寬度撐滿到外距。用到 MUI `Dialog` 的非全螢幕元件都必須使用它（測試會檢查）。
- **圖示**：使用 [AppIcon](../client/src/components/AppIcon.tsx)，搭配個別匯入的 `@mui/icons-material` SVG；圖示繼承文字大小與顏色。裝飾性圖示需要搭配控制項的無障礙名稱與已翻譯的狀態文字。
- **自訂圖案**：在 Material Icons 沒有合適替代時，保留既有的花色、頭像、皇冠、骷髏、龍與左輪手槍圖案。
- **動態效果**：尊重減少動態效果的偏好；沒有動畫時，呈現仍必須保留資訊與截止時間。
- **規則文字**：雙語規則放在 `client/src/game-rules-i18n.ts`，必須與[遊戲](games/README.md)及連結的 shared 函式一致。
- **偏好設定**：瀏覽器偏好設定使用 `card-together.*` 鍵。舊版 `bridge.*` 值會遷移過來，但不會取代既有的鍵。

頁面行為與版面：[介面](interface.md)。

## 效能基準測試

需手動執行；不屬於任何檢查關卡。

```sh
npm run bench:database   # indexed queries and persistent writes
npm run bench:socket     # snapshot/chat payload bytes and runtime writes across rooms
npm run bench:arrange    # Chinese Poker arrangement search: seed 23, 1 warmup, 20 samples
npm run bench:render     # phone render cost of bot games with each cosmetic collection
npm run bench:load       # 100 scripted players against a separate server process (10 min; -- --smoke for 30 s, -- --engine sqlite)
```

- 每個基準測試都會建立並移除自己的暫存資料庫。絕對不要讓它指向正式環境的 `DATABASE_PATH`。
- Socket 結果：`payloadBytes` 與 `snapshotPayloadBytes` 計算快照，`chatPayloadBytes` 計算聊天。接受結果前，先確認 acknowledgement、接收者與工作負載都正確。
- 排牌的時間預算需手動執行；它的正確性測資留在 Vitest 中。
- Render：建置用戶端、啟動暫時的伺服器，並在 706x336（DPR 3）、4 倍 CPU 降速下，對每款遊戲與每組裝備各錄一次玩家回合的 5 秒 trace。選項：`-- --games liarsdeck,holdem,liarsdice,xiangqi --sets plain,starfleet,neoncity --samples 1`。需要 Chromium：`npx playwright install chromium-headless-shell`，或設定 `CHROME`（缺少系統函式庫時另設 `LD_LIBRARY_PATH`）。在同一次執行中拿 `mainTaskMs` 與 `paints` 和 `plain` 比較：絕對時間會隨機器負載變動，而且 headless 模式下 compositor（`VizCompositorThread`）在 CPU 上執行，和手機的 GPU 不同。
- Load：產生達到保留上限的模擬資料庫（2,000 個帳號、每人 100 場對局、回放封存），在獨立程序中以空閒連接埠與暫存狀態目錄啟動伺服器，再驅動 100 個已登入的用戶端：房間依遊戲登錄順序輪流分配遊戲（預設 20 個房間，少於遊戲數時只涵蓋前 20 款；要涵蓋全部請把 `--rooms` 設為遊戲數以上），包含腳本化的真人與 bot、旁觀者、房間聊天、大廳 HTTP、私訊，以及定期重新連線。`--engine sqlite` 會以正式的匯入函式把產生的 JSON 匯入 SQLite 並回報匯入時間；預設為 `json`。選項：`-- --engine json --duration 600 --clients 100 --rooms 20 --accounts 2000 --matches 100 --replays 1000 --output report.json`。JSON 輸出到 stdout，摘要輸出到 stderr；請用 `npm run --silent`。執行前先確認主機負載，並和結果一起回報。
- 只比較完全相同的工作負載與執行環境版本。前端啟動大小包括進入點 chunk **以及**預先載入的 chunk。

## 瀏覽器驗證

依受影響的行為選擇範圍。自動化測試已涵蓋規則邊界、完整對局、授權、寫入失敗與重新啟動後的復原。

| 變更 | 瀏覽器檢查範圍 |
| --- | --- |
| 規則或伺服器邏輯，沒有 UI 變更 | 不需要，除非整合狀況仍不確定 |
| 在地化 UI 或遊戲選項 | 一次真實的用戶端／伺服器流程，加上受影響畫面在 1366×768 與 360×640 的檢查；矮的橫向畫面再加 844×390、780×360 與 706×336 |
| 共用版面、導覽、斷點 | 受影響的頁面在 2560×1440、1920×1080、1366×768、390×844、375×667、360×640、844×390、780×360、706×336，以及變更的斷點附近 |
| 驗證、成員資格、傳輸、私人資料、部署 | 以不同帳號檢查登入／登出、建立／加入房間與聊天、重新整理／重新連線，以及受影響的遊戲流程；migration 請依照[部署](deployment.md) |

| 受影響區域 | 另外檢查 |
| --- | --- |
| 等待房間或遊戲版面 | 文件不會捲動、控制項可見、座位與牌不重疊；空間改變時的計時器與聊天／資訊切換 |
| 撿紅點或共用牌桌 | 擁擠的牌桌、多個可吃目標、沒有呈現中繼資料的初始發牌 |
| 音樂 | 切換路由時的暫停／繼續；已暫停的分頁重新載入後仍保持暫停 |
| 語音 | 不同瀏覽器的參與者；合成串流既無法證明麥克風可用，也無法證明跨 NAT 路由 |

規則：

- 使用[共用預覽](#共用預覽)的合成帳號與資料庫，並在各項檢查之間重複使用；不要每次重新啟動，也不要用固定秒數等待。
- 透過既有的輔助工具或只限開發環境的 fixture 進入要看的畫面，而不是打完整場對局。以一次真實操作確認變更過的串接；注入的狀態無法證明授權或持久性。
- 開發過程以腳本量測判斷版面：元素尺寸、是否超出容器或視窗、重疊、裁切與文字截斷，輸出數字而不是截圖。上表的多個尺寸用同一支腳本批次量測。
- 截圖只用於最後驗收：每個變更的畫面拍 1280×800 與 844×390 各一張；量測無法判斷的效果（動畫、色彩、圖片內容）才另外截圖。
- 發生失敗或變更共用部分時擴大範圍；選定的檢查通過就停止，並回報實際範圍與限制。
- 加入新的測試基礎設施前先詢問。

### 共用預覽

```sh
npm run dev:preview -- start [--slot 0-49] [--host 127.0.0.1] [--reset]
npm run dev:preview -- status [--slot N]
npm run dev:preview -- stop [--slot N]
```

| 項目 | 行為 |
| --- | --- |
| 連接埠 | 用戶端 `6200+slot`（Vite dev，修改後熱更新），伺服器 `4200+slot`；同時執行的 worktree 各用一個 slot |
| 狀態 | 系統暫存目錄下的 `card-together-preview-<slot>/`：SQLite 資料庫、上傳與回放、日誌、PID；`--reset` 清空後重建 |
| 就緒 | 輪詢伺服器 `/health` 與用戶端首頁，就緒才回傳網址；90 秒內未就緒會停止已啟動的程序 |
| 測試資料 | 新資料庫註冊 `preview1`–`preview4`（密碼 `preview-pass-2026`，只用於這個暫存資料庫），`preview1` 與其他三人互為好友。每個帳號的登入狀態存成 Playwright `storageState`（`<帳號>.storage.json`），瀏覽器腳本直接載入，不必登入（登入與註冊每 15 分鐘限 20 次） |
| 停止 | 只停止這個 slot 自己啟動的程序群組 |
| 對外連線 | `--host` 綁定其他位址（例如 Tailscale）；預設只綁 `127.0.0.1` |

來源：[`scripts/dev/preview.ts`](../scripts/dev/preview.ts)。
