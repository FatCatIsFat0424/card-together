# 測試

## 前置需求

- [`.node-version`](../.node-version) 中完全相同的 Node.js 版本，以及 `npm ci`。
- 資源匯入需要 Linux 的 `flock`（util-linux）；部署 fixture 需要 Bash 與 GNU `realpath`，和 CI 相同。部署 bootstrap 測試需要 Python 3.12+。

## 檢查工具

```sh
# While editing: preview, then run checks for branch and working-tree changes.
npm run check -- focused --base main --dry-run
npm run check -- focused --base main

# While editing: check specific repository-relative files.
npm run check -- focused --files client/src/stores/theme-store.ts

# Required before completing behavior changes; CI runs this.
npm run check -- full

# Full gate with real imports and cleared compiler state.
npm run check -- full --no-cache

# Release artifacts with production paths; deploys nothing.
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' \
  VITE_SOCKET_PATH=/card-together/socket.io npm run check -- release
```

**Focused 選擇**

| 規則 | 行為 |
| --- | --- |
| 輸入 | `--base` 與 `--files` 只能擇一。`--base` 使用與 HEAD 的 merge base，加上已 stage、未 stage 與未追蹤的變更，包括 rename 的兩側 |
| `--files` | 只檢查列出的檔案，其他一律不保證；無效、不安全或空的選擇會失敗 |
| 相依關係 | 追蹤遞移的 import、export、字面的動態 import 與 shared alias。runtime、安全性與持久化的變更會加入對應的邊界測試 |
| 擴大為 full | shared 介面、`AGENTS.md`、相依套件或設定、已刪除或未知的路徑、無法解析或動態的 import |
| 部署檔案 | 執行相關的 Python 模組；未對應的輔助程式與範本會執行所有模組 |
| 用戶端資源 | 需要建置與建置產物驗證 |
| 只有文件 | `docs/**/*.md`、`README.md`：只檢查所有 repository Markdown 的空白、本地連結目標與標題錨點；回報為 `documentation`，不代表執行期驗證 |
| 建議 | UI 變更會列出[瀏覽器檢查](development.md#瀏覽器驗證)；資料庫、Socket 與排牌變更會列出[基準測試](development.md#效能基準測試) |

**回報**

- 輸出是 JSON 報告，包含範圍、關卡、原因、耗時與建議。
- 第一個失敗會停止執行；其餘關卡回報 `not-run`。
- 取消執行，或執行期間來源、環境或設定有變更，都無法成功。
- 結果只適用於該次執行；沒有持久的驗證收據。

## 完整檢查

1. 準備音樂與表情符號匯入。
2. 對 shared、server、server 測試、client app 與 client Node 設定做型別檢查。
3. 具型別資訊的 lint、所有 Vitest 測試、Vite 建置與建置產物驗證。
4. 對每個部署 shell 腳本做語法檢查，並執行 Python unittest discovery。
5. 檢查 Markdown 的空白、相對連結目標，以及依 GitHub 標題 slug 規則的 `#anchor` 目標。

`release` 會加上明確的正式環境 base 與 Socket 路徑，並驗證 index 連結、目錄、內容雜湊，以及原始檔與建置結果的位元組。它不會安裝、發布或重新載入服務，也不保證線上 proxy 或 TLS；見[部署](deployment.md#驗證)。

| 快取 | 行為 |
| --- | --- |
| TypeScript | 每個環境各自的增量狀態；受影響的相依檔案一定會重新檢查。打包時不重新檢查 client app 的型別 |
| Lint | 從不快取 |
| 資源匯入 | 只有在原始檔、規則、匯入與驗證程式碼、相依套件、執行環境、目錄與輸出位元組全部相符時才重複使用；否則重新匯入 |
| `--no-cache` | 清除選定的編譯器狀態，並實際執行匯入 |

**資源匯入安全性**

- 拒絕符號連結，以及不是一般檔案的目錄或輸出檔。
- Linux `flock` 讓匯入工具依序執行，程序終止時自動釋放。絕對不要刪除鎖定檔。
- 以內容定址的檔案會在原子寫入的目錄與成功 manifest 之前寫入。中斷留下的暫存檔會在持有鎖時清理；無關的資源、備份與原始檔都會保留。
- `--profile` 會把各階段耗時印到 stderr。各階段彼此重疊（`prepare` 包含 codec 時間，`publish` 包含重新驗證），所以絕對不要把它們加總。

**獨立指令**

```sh
npm run typecheck
npm run lint
npm test                 # npm run test:watch for repeated runs
npm run build:client
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
```

根目錄的 `typecheck` 與 `lint` 也涵蓋 `server/tests`、基準測試、`scripts/`，以及 Vite 與 Vitest 設定。lint 把 floating promise 視為錯誤，並保留既有的 React hooks 警告。Vitest 會找出 `server/tests/**/*.test.ts`。

## 涵蓋範圍

來源：[server/tests](../server/tests)、[deploy/tests](../deploy/tests)。

| 範圍 | 涵蓋的行為 |
| --- | --- |
| 規則與 bot | 精確的合法動作、輸入不被修改、依接收者的隱私；650 手排牌與 163 場固定種子的完整對局；加權選擇 |
| 登入憑證 | 真實的雜湊與驗證、長度上限、對不存在的使用者執行假雜湊、2 個執行中／16 個等待中的佇列、在金鑰推導前套用速率限制 |
| 持久化與金幣 | 延後 commit、回復與重試、不提早廣播、過時的工作、重新開啟與重播、同時進行的購買／獎勵版本、原子批次。Repository、auth、social、金幣、回放與 runtime 持久化套件透過 [`tests/helpers/repository-adapters.ts`](../server/tests/helpers/repository-adapters.ts) 在 JSON 與 SQLite 上各執行一次；SQLite 另測 pragma、transaction 回復、匯入往返與衝突 |
| 媒體 | 真實的動態 GIF 上傳與提供的位元組；寫入、重新命名與擁有權失敗；配額；佇列復原 |
| 匯入與建置產物 | 各匯入工具的輸入、輸出、旗標、鎖與安全性；真實的 GIF 與動態 WebP 壓縮，包括無法壓進上限的輸入；失效處理；拒絕符號連結與 FIFO；SIGKILL 後復原；建置雜湊與 base 驗證 |
| 用戶端 | 帳號 generation 競態、API 失敗與 401 epoch、canvas 裁切與清理、零尺寸幾何、雙語規則、好友排序 |
| 部署 | 備份鎖與擁有權、受保護的安裝與發布、精確 SHA 的 CI 把關、開發／worktree 隔離、持久的自動部署停止、目錄防護、失敗與訊號復原、timer 順序、Nginx 解析、migration 與設定 |

- 伺服器啟動時會讀取產生的[表情符號目錄](media.md#站方表情符號)；測試會注入目錄，而不需要站長的原始檔。
- 部署測試使用暫存路徑與允許清單內的指令替身；正式環境的進入點保留權限檢查。
- Node 測試無法取代瀏覽器渲染、真實的 codec 或線上服務。
- 合併等價的設定與斷言，但保留每個獨立的行為檢查。

## 效能量測

- 對齊 Node 版本、輸入、硬體、快取與工作負載；量測程序的實際經過時間。
- 冷啟動與熱啟動分開回報，最好以三次樣本的中位數與範圍呈現。
- Vitest 各檔案的時間彼此重疊；不要加總成整個測試套件的時間。
- 正確性測試從不斷言效能期限。
- Load（`bench:load`）：受測伺服器在獨立程序中執行，用戶端的工作不會影響它的量測。報告包含各事件的 acknowledgement 延遲 p50/p95/p99、超出 10 ms 取樣間隔的 event loop 延遲、Repository 寫入次數、服務時間、佇列等待、每次寫入的位元組數（JSON 為檔案大小；SQLite 為 `/proc/self/io` 的 `write_bytes` 增量）與忙碌比例、RSS、heap，以及量測期間的 CPU 時間。量測結束後，會在無負載下計時一次寫入：JSON 為完整文件寫入（驗證、stringify、編碼、寫入＋fsync＋rename）；SQLite 為量測結束時的 runtime（驗證、序列化、只改一場遊戲的 commit、重寫整個 runtime 的 commit）。
- 100 人、10 分鐘的目標：ack p95 ≤ 150 ms、p99 ≤ 500 ms、event loop 延遲 p99 ≤ 50 ms、RSS < 768 MiB、沒有錯誤或非預期斷線。基準測試會回報這些目標，但從不為了達標調整工作負載。
- 請求逾時為 30 秒；報告另外計算超過瀏覽器 10 秒逾時的 ack。只比較選項、資料庫大小與主機負載都相同的執行結果。
