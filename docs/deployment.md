# 部署

目標：既有 acserver 主機上的 **https://acserver.csie.org/card-together/**。

**前置需求**

- 以部署使用者的身分，在目標作業系統與架構上，從 repository 根目錄執行。
- Python 3.12+（含 HTTPS 憑證與 xz 支援）、rsync、util-linux（`flock`）、sudo、systemd 與 Nginx。Node.js bootstrap 支援 Linux x64 與 arm64。
- DNS、TLS 憑證與 HTTPS virtual host 必須已經可以運作；這些腳本不會建立它們。

## 建置與部署

```sh
python3 -B deploy/with-node.py -- bash deploy/build.sh &&
bash deploy/deploy.sh
```

[`with-node.py`](../deploy/with-node.py) 從 `https://nodejs.org/dist/` 下載完全相同的[固定版本](../.node-version)，透過 HTTPS 以官方的 `SHASUMS256.txt` 驗證壓縮檔，並安全地解壓縮到私人的暫存目錄。它把該發行版的 Node.js 與內附的 npm 放在 `PATH` 最前面執行指令，完成後移除暫存的發行版。轉址到官方 HTTPS 來源以外、checksum 不符、不支援的平台，以及以 root 執行，都會在建置前被拒絕。下載不會快取。這只驗證透過 HTTPS 發布的 checksum，不是 GPG 簽章。建置會在清理前把驗證過的 Node 執行檔複製到 `.deploy/node`。專案相依套件仍透過 `npm ci` 從 npm registry 取得。

| 階段 | 腳本 | 動作 |
| --- | --- | --- |
| 建置 | `build.sh` | 安裝鎖定版本的相依套件，包括 devDependencies（後端透過 `tsx` 執行 TypeScript）；執行[完整檢查](testing.md#完整檢查)；以正式環境路徑建置，並匯入音樂與站方表情符號；準備 `.deploy/node` |
| 備份 | `deploy.sh` | 要求 sudo、驗證設定、為應用程式、設定與狀態建立快照 |
| 安裝 | `deploy.sh` | 停止服務（短暫中斷）、安裝建置產物（包括產生的表情符號目錄）、啟動新服務 |
| Proxy 與健康檢查 | `deploy.sh` | 安裝 Nginx snippet、更新 `/etc/nginx/sites-enabled/acserver.csie.org` 中受管理的 include、測試並重新載入 Nginx、輪詢本機與公開的健康檢查 |

這個 snippet 也提供整個網域共用的 `/.well-known/assetlinks.json`，以及 [Android app](android.md) 的 APK 下載。

較早帶雜湊的資源與站方表情符號會持續發布，直到寬限期過後由 `prune-assets.sh` 移除。

| 路徑 | 內容 |
| --- | --- |
| `/opt/card-together` | 由 root 擁有的應用程式、相依套件、複製的 Node 執行檔 |
| `/opt/card-together/www/card-together` | 對外提供的前端 |
| `/etc/card-together/server.env` | 只有 root 可讀的執行環境設定 |
| `/var/lib/card-together/` | `database.json`（[切換到 SQLite](#切換到-sqlite)後為 `database.sqlite`）、`media/` 與 `replays/` |
| `/var/backups/card-together/` | `deploy-*`、`frontend-*` 與每日的 `data/` 快照 |

**systemd unit**（`card-together.service`）

- 以 `card-together` 身分執行，應用程式檔案唯讀、狀態目錄可寫入、自動重新啟動，並有 60 秒的正常停止時間。
- 限制裝置、kernel 介面、cgroup、namespace、personality 與 address family（Unix、IPv4、IPv6、netlink）。`MemoryDenyWriteExecute` 保持關閉，因為 V8 的 JIT 需要。
- `MemoryHigh=768M` 會限流，`MemoryMax=1G` 會終止並重新啟動記憶體洩漏的後端，以保護共用主機。若 journal 顯示正常負載下發生記憶體終止，兩者都要調高。
- **只能有一個後端擁有資料庫。** 第二個程序會因[擁有者鎖定檔](storage.md#單一擁有者鎖定)而啟動失敗。

## 執行環境設定

`/etc/card-together/server.env`：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
TRUST_PROXY_LOOPBACK=true
CLIENT_ORIGIN=https://acserver.csie.org
DATABASE_ENGINE=json
DATABASE_PATH=/var/lib/card-together/database.json
```

- 只能使用字面的 `KEY=value` 行：不能用 `export` 或 shell 展開。
- `CLIENT_ORIGIN` 是完全相符的 origin，不含路徑或結尾斜線。
- `DATABASE_ENGINE` 與 `DATABASE_PATH` 只能是 `json` 搭配 `database.json`，或 `sqlite` 搭配 `database.sqlite`，都在可寫入的狀態目錄內；部署會拒絕其他組合。沒有 `DATABASE_ENGINE` 的舊設定視為 `json`。
- 搜尋型 bot 的 worker pool 由選填的 `BOT_WORKERS`（預設 2）、`BOT_WORKER_MEMORY_MB`（預設 128）與 `BOT_SEARCH_QUEUE`（預設 32）控制；範例檔不含這三項，沿用預設即可。Worker 在第一次搜尋時才啟動，每個閒置約增加 30 MB RSS，執行搜尋時再加上最多 `BOT_WORKER_MEMORY_MB` 的堆積。預設最壞約 400 MB，仍在 `MemoryMax=1G` 內；增加 worker 數量或堆積上限前，必須先附量測數據提案調整記憶體上限（專案上限 4 GB）。Worker 以同一個 `tsx` 載入 TypeScript，部署不需額外步驟。
- 後端保持在 loopback 上。信任 loopback 時，Nginx 必須覆寫 `X-Forwarded-For`。
- 變更連接埠時，要同時更新這個檔案、Nginx upstream 與健康檢查指令。
- 前端建置：`VITE_BASE_PATH=/card-together/`、空的 `VITE_SERVER_URL`、`VITE_SOCKET_PATH=/card-together/socket.io`。TURN 設定放在 `client/.env.local`（[語音](media.md#語音)）。

所有變數：[開發](development.md#設定)。

## 驗證

```sh
sudo nginx -t
sudo systemctl status card-together.service --no-pager
curl --fail --show-error http://127.0.0.1:3001/health
curl --fail --show-error https://acserver.csie.org/card-together/health
```

- 健康檢查回傳 `{"status":"ok"}`。`deploy.sh` 會為啟動與 Nginx worker 切換輪詢最多 30 秒。
- 在瀏覽器中確認：登入、建立房間、在 `/card-together/login` 重新整理、Socket 連線、重新啟動後恢復、上傳的圖片、站方表情符號、音樂，以及既有用戶端的偏好設定遷移。
- 用不同網路上的真實裝置測試語音；可能需要 TURN。

## 維運

```sh
sudo journalctl -u card-together.service -n 100 --no-pager
sudo journalctl -u card-together.service -f
sudo systemctl restart card-together.service
sudo systemctl stop card-together.service
```

反覆啟動失敗時，檢查 log、設定、schema、連接埠與權限，必要時再執行 `sudo systemctl reset-failed card-together.service`。**絕對不要以刪除資料作為修復方式。**

### CI 通過後自動部署

以工作站操作者的身分，從審查過的 checkout 安裝（替換使用者名稱與 checkout 路徑）：

```sh
sudo bash deploy/install-auto-deploy.sh acaccel \
  /home/acaccel/card-together /home/acaccel/card-together-release
```

前置需求：部署使用者能在不需互動輸入的情況下 fetch `origin`，該使用者已設定 `gh auth login` 且具備 repository Actions 讀取權限，而且 `local-music/` 與 `local-emoji/` 都存在。只有在刻意要空目錄時，才允許空的資料夾。不需要 webhook endpoint。

安裝程式會建立：

| 路徑 | 用途 |
| --- | --- |
| `/usr/local/lib/card-together-auto-deploy/auto-deploy.py` | 穩定的控制程式，不受開發 checkout 中的編輯影響 |
| `/home/acaccel/card-together-release` | detached 的 linked worktree，只用於發行建置 |
| `/etc/card-together-auto-deploy.json` | 非機密設定：repository、來源／checkout／狀態／輸入路徑、選填的前端環境檔路徑、必要的 workflow 檔名、選填的 [Discord 通知](#部署通知) |
| `/var/lib/card-together-auto-deploy/inputs/` | 獨立保存的站長音樂、表情符號與選填 `frontend.env` 快照 |
| `/var/lib/card-together-auto-deploy/state.json` | 成功的 SHA、建置失敗的 SHA，以及未完成安裝的標記 |
| `/var/lib/card-together-auto-deploy/notifications.json` | 尚未送達、等待重送的[通知](#部署通知)更新；沒有時不存在 |
| `/etc/sudoers.d/card-together-auto-deploy` | 只允許部署使用者不輸入密碼執行 `/usr/bin/bash <release-checkout>/deploy/deploy.sh` |

服務以部署使用者的身分執行，timer 在開機一分鐘後、以及每次循環結束一分鐘後觸發。它只 fetch 遠端的 `main`，不變更開發分支、index 或檔案。遇到新的 SHA 時，它會查詢 GitHub Actions 針對該 `main` SHA 的 `push` run。每個回傳的 workflow，其最新的 run/attempt 都必須是 `completed` 且為 `success`；設定中必要的 workflow（一開始是 `ci.yml`）也必須存在。結果缺少、排隊中、失敗、取消、略過、格式錯誤或無法取得時，一律不允許部署。新增必要的 workflow 時，要加入設定中的 `workflows`，讓它們缺少時也會阻擋部署。

控制程式把輸入快照放進乾淨的 detached worktree，透過該版本官方的 [Node.js bootstrap](#建置與部署) 與發行檢查執行 `build.sh`，在呼叫既有的 `deploy.sh` 前再次檢查 CI。只有安裝成功（包括本機與公開的健康檢查）才會記錄 `last_success_sha`。建置期間抵達的較新 commit 會等到下一次循環。第一個符合條件的 SHA 一定會部署，即使既有的手動安裝剛好就是這個版本。完整部署仍會讓玩家短暫斷線。

開發中的變更（包括尚未 push 到 `main` 的本機 commit）都不會部署。這些 worktree 共用 Git 物件與 ref，但不共用工作檔案或相依套件。timer 啟用期間，不要在發行 worktree 中編輯或手動部署。API 憑證保留在該使用者既有的 `gh` 憑證儲存中；不要把 token 放進設定、repository 或指令參數。

**信任邊界**：來自 `main`、經 CI 核准的程式碼與部署腳本會在這台工作站上執行，而部署腳本以 root 執行。只有可信任的維護者應能 merge 進 `main`；請以審查與必要的 CI 保護該分支。部署使用者也必須被信任為主機管理者：允許執行的腳本位於該使用者可寫入的 worktree 中，所以這個指令限制並不能防止該使用者修改腳本。不要把這條規則給不受信任的使用者。

檢查或暫停：

```sh
systemctl status card-together-auto-deploy.timer --no-pager
sudo journalctl -u card-together-auto-deploy.service -n 100 --no-pager
python3 -B /usr/local/lib/card-together-auto-deploy/auto-deploy.py --inspect
sudo systemctl stop card-together-auto-deploy.timer card-together-auto-deploy.service
```

`--inspect` 會檢查憑證、CI、輸入與既有的發行 worktree，但不建置也不安裝。它只更新 remote-tracking ref。整個循環共用一把鎖，讓輪詢、複製輸入、建置、安裝、檢查與復原依序執行。既有的部署／Nginx 鎖仍會讓需要特權的安裝依序執行。

失敗與復原：

- fetch／API 錯誤會等到下一次循環，不動到已安裝的版本。
- checkout／輸入／建置錯誤會記錄 `failed_build_sha`，封鎖該 SHA，而不是每分鐘重新建置。修正原因後，以部署使用者身分加上 `--retry-build` 執行控制程式；較新的 SHA 會自動符合條件。
- 安裝前，控制程式會持久寫入 `installing_sha`。安裝錯誤、中斷、逾時或重新開機都會讓它留著，並停止**所有**後續的自動部署。依照[失敗處理](#失敗處理)與[回復版本](#回復版本)處理，確認應用程式與資料的相容性以及服務健康狀態，再以部署使用者身分加上 `--resume` 執行控制程式。復原指令只會解除封鎖，不會執行部署。
- 手動復原後，以 `sudo systemctl start card-together-auto-deploy.timer` 恢復 timer。若要在重新開機後也保持停用，請用 `disable --now` 而不是 `stop`。

重新執行安裝程式可以更新穩定的控制程式與 unit；它會暫停 timer，並保留既有的設定、輸入快照與收據。它不會中斷正在執行的循環：請等該循環結束後再重新執行安裝程式。若在暫停 timer 後重新安裝失敗，timer 會保持停止，直到操作者修正問題並重新啟動。安裝程式本身不會部署應用程式。從以 npm 為基礎的 Node.js bootstrap 升級時，請在 push 第一個需要官方下載工具的版本之前重新執行這個安裝程式；已安裝的穩定控制程式不會在應用程式程式碼變更時自我更新。要發布變更過的站長輸入，請停止 timer／服務，更新 `inputs/` 下對應的快照，並在發行 worktree 中使用既有的手動建置／部署流程。只變更輸入不會觸發自動部署；控制程式只監看 Git 版本。絕對不要把開發用的資料庫檔案複製進去。

同時進行開發時，請使用另一個後端連接埠與資料庫，並讓 Vite 的開發 proxy 指向它：[開發](development.md#設定)。

#### 部署通知

每次部署嘗試可以選擇把結構化的進度送到 BotFleet konata 通知轉發服務，由它發出一則 Discord 訊息，並隨各階段進展編輯該訊息：目標 SHA 與待部署的 commit 標題、CI 核准、建置、CI 再次檢查、含健康檢查的安裝，最後是結果（耗時，或失敗時的復原步驟）。等待 CI，以及被封鎖或停止的循環不會送出任何內容。轉發服務負責渲染與該路由的 Discord 頻道；見 BotFleet `docs/configuration.md` 中的說明。

安裝程式不會加入這個設定。更新控制程式後，把它加到既有的設定中：

```json
"notification": {
  "url": "http://127.0.0.1:4100/notifications/card-together-deploy",
  "key_file": "/var/lib/card-together-auto-deploy/notify.key"
}
```

- `url` 是轉發服務的路由；只有 loopback 主機才接受純 HTTP。每次嘗試都會附加自己的 key（`<SHA prefix>-<epoch>`），並送出 `PUT` 請求。
- `key_file` 存放轉發服務的 bearer key（與 konata 的 `NOTIFY_API_KEY` 相同的值），只有部署使用者可讀（`0600`）。每次更新時讀取，從不存進這份設定。
- 通知失敗時記錄 log（不含 key），且從不改變部署結果或收據。省略此設定或設為 `null` 即可停用通知。
- 每次嘗試最新一筆未送達的更新會保存在 `/var/lib/card-together-auto-deploy/notifications.json`，並在每次非檢查用的循環開始時重送，所以 konata 在部署途中重新啟動也不會留下過時的訊息。超過一小時的更新會被丟棄；檔案損壞只會失去這些重試。
- 每筆更新都帶有 `occurredAt`（UTC），重送時保留原值，讓轉發服務顯示延遲送達的更新實際發生的時間。這需要接受此欄位的 konata 版本。

### 失敗處理

- `deploy.sh` 會鎖定，防止同時部署（包括舊版的部署）與共用的 Nginx 編輯，偵測同時發生的網站變更，並在安裝前建立快照。
- 缺少建置結果，或建置結果不是以 `/card-together/` 為 base 時，會在停止任何服務之前失敗。`npm run check -- full` 會以 `/` 重新建置 `client/dist`，所以請在 `deploy.sh` 前一刻執行 `build.sh`。
- 停止服務後發生失敗或收到 `SIGINT`/`SIGTERM` 時，會停止新服務並還原已變更的 Nginx 設定。應用程式與狀態保留原處供檢查，服務也保持停止，避免有程式對較舊的狀態寫入。

### 備份

| 快照 | 內容 | 保留 |
| --- | --- | --- |
| `deploy-*`（每次部署） | 網站與 snippet、執行環境設定、unit 與啟用狀態；不含 `node_modules/`、`node` 與重複 `provided-music/` 的 `application/`；完整的 `card-together-data/` 與 `bridge-online-data/` | 最新 5 份，成功後清除較舊的 |
| `frontend-*`（每次發布） | 先前的前端進入點 | 最新 5 份 |
| `data/data-<UTC stamp>/`（每日約 04:15） | 經過驗證的資料庫（`database.json`，或 `database.sqlite`）、`media/` 與 `replays/` | 最新 14 份（`KEEP`），成功寫入新快照後才清除較舊的 |

- `application/` 中省略的檔案，可以在相符的版本執行 `deploy/build.sh` 重建。
- 每日備份在後端上線時執行，依 `server.env` 的 `DATABASE_ENGINE` 選擇資料庫；`DATABASE_PATH` 不在狀態目錄時會拒絕。媒體以內容定址，每個回放檔只寫入一次，未變更的媒體與回放以硬連結指向上一份快照。
- JSON：資料庫以原子 rename 替換，所以複製一次就得到完整檔案，並檢查是否為有效 JSON。
- SQLite：[`sqlite-snapshot-cli.ts`](../server/src/database/sqlite-snapshot-cli.ts) 以 `VACUUM INTO` 在一個讀取 transaction 中複製出單一檔案（rollback journal 模式，沒有 `-wal`），再執行 `PRAGMA quick_check`、`foreign_key_check` 與應用程式的啟動驗證；失敗時捨棄該快照，較舊的快照保留。複製以資料庫擁有者的身分（`setpriv`）執行，和服務共用 WAL 索引，建立的 `-shm` 也維持服務的擁有者；複本先放在狀態目錄的 `.backup-*`，再移入快照。中斷留下的 `.backup-*` 會在下一次備份時刪除。因此 backup unit 對狀態目錄有寫入權限。
- SQLite 快照每份都是完整的資料庫副本（無法硬連結），約需 `KEEP` × 資料庫大小，加上媒體與回放的差異。狀態目錄與備份目錄的可用空間都必須至少是資料庫加 `-wal` 的大小，否則跳過該次備份並記錄錯誤。
- 資料庫最先複製。在複製前就因保留規則被清除的回放，在該快照中會顯示「沒有錄製」；在資料庫複製後才寫入的回放，會在以該快照啟動時被清除（[回放封存](storage.md#回放封存)）。
- `install.sh` 會安裝 `backup-data.sh` 與 `card-together-backup.service`/`.timer`；`deploy.sh` 會啟用 timer，失敗時發出警告。若要單獨啟用：

  ```sh
  sudo bash deploy/install.sh "$PWD/.deploy/node"
  sudo systemctl enable --now card-together-backup.timer
  ```

- 檢查：

  ```sh
  systemctl list-timers card-together-backup.timer
  sudo journalctl -u card-together-backup.service -n 20 --no-pager
  sudo ls /var/backups/card-together/data
  ```

- 同一顆磁碟上的快照只能防範資料損毀與操作失誤；請在另一台主機保留副本。還原規則：[儲存](storage.md#備份與還原)。

### 還原資料

`install.sh` 會把 [`restore-data.sh`](../deploy/restore-data.sh) 安裝到 `/opt/card-together/restore-data.sh`。它把一份快照目錄（`data-*`，或 `deploy-*` 中的 `card-together-data/`）的資料庫、媒體與回放一起還原到狀態目錄：

```sh
sudo systemctl stop card-together.service card-together-backup.timer
sudo /opt/card-together/restore-data.sh /var/backups/card-together/data/data-<UTC stamp>
sudo systemctl start card-together.service card-together-backup.timer
```

- 服務仍在執行、或狀態目錄有 `database.*.lock` 時拒絕（[擁有者鎖定檔](storage.md#單一擁有者鎖定)）。
- 依 `server.env` 的 `DATABASE_ENGINE` 選擇要還原的檔案；快照必須包含該引擎的資料庫、`media/` 與 `replays/`，且不能有符號連結。引擎不符時拒絕。
- 以 `sqlite-snapshot-cli.ts verify` 檢查快照（SQLite 另做 `quick_check`），必須是這個版本能啟動的 schema；檢查從不修改快照。失敗時什麼都不還原。
- 寫入前把目前整個狀態目錄複製到 `/var/backups/card-together/pre-restore-<UTC stamp>-*`，請確認有足夠空間。
- 移除被取代資料庫的 `-wal`、`-shm`，以 `0600` 與狀態目錄的擁有者寫入資料庫，並以 `rsync --delete` 同步 `media/` 與 `replays/`。另一個引擎的檔案（例如保留的 JSON）不變。
- 服務保持停止。啟動後確認登入、歷史紀錄、回放、好友、媒體與恢復。

### 回復版本

1. 停止 `card-together` 與舊版 `bridge-online` 兩個服務。選擇相容的應用程式、相依套件、unit、設定與 Nginx 設定。
2. 只有在較舊的版本支援目前狀態的 schema 與欄位時，才保留目前的狀態（[相容性](storage.md#資料相容性)）。Schema v10 會遷移房間的 `gameOptions`；升級前先停止寫入，備妥資料庫、媒體與回放的完整備份。回復 v9 時必須使用升級前的完整備份，不能只換回舊程式。
3. 否則還原快照，並接受遺失較新的寫入。**資料庫、媒體與回放要一起**還原，狀態目錄為 `0700`、私人檔案為 `0600`，擁有者與選定的服務使用者相符。
4. 執行 `sudo systemctl daemon-reload`，測試並重新載入 Nginx，然後只啟動選定的服務。

回復到改名前的應用程式時：它未被動過的資料庫只是 migration 前的快照，所以要先整合較新的狀態。

已切換到 SQLite 時，要回到不支援 SQLite 的版本，先[回復到 JSON](#回復到-json)。

## 切換到 SQLite

正式環境已於 2026-10-27 切換到 SQLite，`database.json` 保留為唯讀檔，但已過時。以下步驟供新環境或重新切換使用（[儲存引擎](storage.md#儲存引擎)），**必須經過核准後才執行**。過程中服務會停止，玩家會斷線；請選在離峰時段並事先公告。

**前置條件**

- 包含[擁有者鎖定檔](storage.md#單一擁有者鎖定)、遷移與匯出工具的版本已經部署並健康運作；Node.js 為 24 以上（`.node-version`）。
- 空間：SQLite 檔約為 JSON 的 **2.2 倍**。遷移工具要求狀態目錄的可用空間至少是 JSON 的 5 倍（匯入 transaction 會先寫入 WAL），完整備份需要再一份狀態目錄的大小；切換後每份每日快照都是完整的 SQLite 副本，14 份約為 14 × 2.2 × JSON 大小，加上媒體與回放的差異。先確認：

  ```sh
  sudo du -sh /var/lib/card-together /var/lib/card-together/database.json /var/backups/card-together
  df -h /var/lib/card-together /var/backups/card-together
  ```

- 暫停自動部署與每日備份，避免途中重新啟動服務或複製到一半的狀態：

  ```sh
  sudo systemctl stop card-together-auto-deploy.timer card-together-backup.timer
  systemctl is-active card-together-auto-deploy.service card-together-backup.service
  ```

  兩者都必須是 `inactive`；正在執行就等它結束。

**步驟**

1. 停止服務，並確認沒有寫入者：

   ```sh
   sudo systemctl stop card-together.service
   systemctl is-active card-together.service
   sudo ls -la /var/lib/card-together
   ```

   服務必須是 `inactive`，而且沒有 `database.json.lock`。

2. 完整備份資料庫、媒體與回放（整個狀態目錄），並另外保存執行環境設定：

   ```sh
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   sudo install -d -m 0700 /var/backups/card-together
   sudo cp -a /var/lib/card-together "/var/backups/card-together/pre-sqlite-$stamp"
   sudo cp -p /etc/card-together/server.env "/var/backups/card-together/pre-sqlite-$stamp.server.env"
   sudo du -sh /var/lib/card-together "/var/backups/card-together/pre-sqlite-$stamp"
   ```

   同一顆磁碟上的備份不足以防範硬體故障；請再複製一份到另一台主機。

3. 驗證 JSON（完整的啟動驗證，不寫入任何檔案）：

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/database/sqlite-snapshot-cli.ts verify /var/lib/card-together/database.json'
   ```

   必須成功，`droppedRecordings` 應為空。記下 `collections`。

4. 預覽遷移（不寫入）：

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/database/migrate-sqlite-cli.ts /var/lib/card-together/database.json /var/lib/card-together/database.sqlite'
   ```

   確認 `collections` 與第 3 步相同、`availableBytes` 大於 `requiredBytes`，且 `droppedRecordings` 為空。

5. 套用遷移：

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/database/migrate-sqlite-cli.ts /var/lib/card-together/database.json /var/lib/card-together/database.sqlite --apply --writers-stopped'
   ```

   輸出必須是 `"mode": "applied"`，`verification` 包含 `"quickCheck": "ok"`、`"foreignKeyViolations": 0`、`"countsMatch": true`、`"readBack": true`。失敗時工具會刪除部分寫入的 SQLite 檔，JSON 不變；排除原因後從第 4 步重來，或直接回到第 8 步以 JSON 啟動。

6. 比對數量：以同一個驗證器分別讀取兩個資料庫，兩行輸出必須完全相同；再確認大小約為 2.2 倍：

   ```sh
   for db in database.json database.sqlite; do
     sudo -u card-together sh -c "cd /opt/card-together/server && ../node --import tsx src/database/sqlite-snapshot-cli.ts verify /var/lib/card-together/$db" \
       | python3 -c 'import json, sys; print(json.dumps(json.load(sys.stdin)["collections"], sort_keys=True))'
   done
   sudo ls -l /var/lib/card-together/database.json /var/lib/card-together/database.sqlite
   ```

   第 5 步輸出的 `verification.tables` 也應與這些數量一致（`direct_messages`、`message_reads`、`friend_notifications`、`rewarded_games`、`game_stats`、`account_stats` 對應各自的 collection）。

7. 切換執行環境設定：

   ```sh
   sudoedit /etc/card-together/server.env
   sudo grep '^DATABASE_' /etc/card-together/server.env
   ```

   只保留這兩行（沒有 `DATABASE_ENGINE` 就加上）：

   ```dotenv
   DATABASE_ENGINE=sqlite
   DATABASE_PATH=/var/lib/card-together/database.sqlite
   ```

8. 啟動服務：

   ```sh
   sudo systemctl start card-together.service
   sudo journalctl -u card-together.service -n 50 --no-pager
   curl --fail --show-error http://127.0.0.1:3001/health
   curl --fail --show-error https://acserver.csie.org/card-together/health
   sudo ls -l /var/lib/card-together
   ```

   log 不能有啟動錯誤；狀態目錄應出現 `database.sqlite-wal`、`database.sqlite-shm` 與 `database.sqlite.lock`。

9. 在瀏覽器中，以至少兩個帳號驗證：
   - 登入與登出；既有的工作階段仍有效。
   - 歷史紀錄：自己的與公開的對局、統計。
   - 回放：開啟一場有錄製的對局並播放。
   - 好友：清單、上線狀態、私訊與未讀狀態、好友通知。
   - 媒體：頭像、上傳的圖片與表情符號。
   - 恢復：切換前進行中的遊戲可以繼續，重新整理與重新連線後狀態正確。

   接著執行 `sudo systemctl restart card-together.service`，確認上述資料在重新啟動後仍在。

10. 把 JSON 檔保留為唯讀的備援，恢復 timer，並立即做一次 SQLite 備份：

    ```sh
    sudo chmod 0400 /var/lib/card-together/database.json
    sudo systemctl start card-together-backup.service
    sudo journalctl -u card-together-backup.service -n 20 --no-pager
    sudo ls -l /var/backups/card-together/data
    sudo systemctl start card-together-backup.timer card-together-auto-deploy.timer
    ```

    備份 log 必須包含 `"quickCheck":"ok"` 與 `Backup written`。SQLite 一開始接受寫入，這份 JSON 就已過時：它只用於第 8–9 步失敗、還沒有玩家寫入時的立即回復；之後的回復一律使用[匯出](#回復到-json)。不要讓兩個引擎同時寫入。

### 回復到 JSON

第 8–9 步就失敗、服務沒有接受任何寫入時，可以直接切回：停止服務，把 `server.env` 改回 `DATABASE_ENGINE=json` 與 `DATABASE_PATH=/var/lib/card-together/database.json`，再啟動服務並驗證。把 `database.sqlite` 移到備份目錄保存（第 2 步的備份中沒有它），讓日後重新切換時目標不存在。

SQLite 已經接受寫入後，用[匯出工具](storage.md#匯出-sqlite-為-json)把目前的資料寫成新的 JSON：

1. 暫停 timer、停止服務，並確認沒有 `database.sqlite.lock`：

   ```sh
   sudo systemctl stop card-together-auto-deploy.timer card-together-backup.timer
   sudo systemctl stop card-together.service
   sudo ls -la /var/lib/card-together
   ```

2. 完整備份目前的狀態與設定：

   ```sh
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   sudo cp -a /var/lib/card-together "/var/backups/card-together/pre-json-$stamp"
   sudo cp -p /etc/card-together/server.env "/var/backups/card-together/pre-json-$stamp.server.env"
   ```

3. 預覽，再匯出到新檔（從不覆寫）：

   ```sh
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/database/export-sqlite-cli.ts /var/lib/card-together/database.sqlite /var/lib/card-together/database.export.json'
   sudo -u card-together sh -c 'cd /opt/card-together/server && ../node --import tsx src/database/export-sqlite-cli.ts /var/lib/card-together/database.sqlite /var/lib/card-together/database.export.json --apply --writers-stopped'
   ```

   輸出必須有 `"validated": true`，`collections` 與預覽相同。

4. 以匯出檔取代過時的 JSON，並把 SQLite 檔移出狀態目錄（兩者都已在第 2 步的備份中；正常停止後不會有 `-wal` 或 `-shm`）：

   ```sh
   sudo -u card-together mv -f /var/lib/card-together/database.export.json /var/lib/card-together/database.json
   sudo mv /var/lib/card-together/database.sqlite "/var/backups/card-together/pre-json-$stamp.database.sqlite"
   ```

5. 把 `server.env` 改回 `DATABASE_ENGINE=json` 與 `DATABASE_PATH=/var/lib/card-together/database.json`，啟動服務，依第 8–9 步驗證，最後恢復 timer。

要回到不支援 SQLite 的舊版本時，先依上述步驟回到 JSON，再依[回復版本](#回復版本)處理。

## 只發布前端

適用於沒有後端或 Nginx 變更的 UI 或音樂變更：

```sh
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
bash deploy/publish-client.sh
```

- 使用部署鎖，同步資源，再以原子操作替換 `index.html`。它不會重新啟動後端，也不會重新載入 Nginx。
- 較早帶雜湊的資源保留 14 天；之後 `prune-assets.sh` 會移除目前建置中沒有的檔案。
- 只匯入音樂不會發布任何東西。音樂封面與音訊同在 `provided-music/`，隨建置產出一起發布，也適用同樣的 14 天保留規則。
- 站方表情符號目錄有變更時需要 `deploy.sh`；發布工具會拒絕與已安裝後端不同的目錄。

## 手動安裝

例行更新請使用 `deploy.sh`。單獨執行 `install.sh` 會保留 `server.env` 並停止服務，但不會遷移狀態，也不會變更 Nginx。

1. 安裝 snippet 並檢查 virtual host：

   ```sh
   sudo install -d -m 0755 /etc/nginx/snippets
   sudo install -m 0644 deploy/nginx/card-together.conf /etc/nginx/snippets/card-together.conf
   sudo install -m 0644 deploy/nginx/card-together-http.conf /etc/nginx/snippets/card-together-http.conf
   sudo nginx -T
   sudoedit /etc/nginx/sites-enabled/acserver.csie.org
   ```

2. 在既有的 server block 內各 include 每個 snippet **一次**，保持 TLS 與其他應用程式不變。絕對不要把它們加在 `http` 層級，或建立重複的 host。

   | Server block | Include |
   | --- | --- |
   | HTTPS | `include /etc/nginx/snippets/card-together.conf;` |
   | HTTP | `include /etc/nginx/snippets/card-together-http.conf;` |

3. 檢查執行環境設定，完成所有狀態遷移，然後啟動：

   ```sh
   sudo nginx -t
   sudo systemctl enable --now card-together.service
   sudo systemctl reload nginx
   ```

4. 執行[驗證](#驗證)。

| Snippet | 行為 |
| --- | --- |
| 路由 | SPA fallback、移除路徑前綴、WebSocket 標頭、cookie 路徑；3 MiB 請求上限，容納 base64 編碼的 2 MiB 圖片 |
| 帶雜湊的資源 | `/card-together/assets/` 與 `/card-together/provided-emoji/` 使用 `try_files $uri =404` 搭配 `Cache-Control: public, max-age=31536000, immutable`；缺少的檔案回傳 404，從不回傳 `index.html` |
| 壓縮 | CSS、JS、JSON、SVG |
| 標頭 | `X-Content-Type-Options`、`Referrer-Policy`，以及包含 `frame-ancestors` 的 **report-only** CSP |

- 把標頭改名為 `Content-Security-Policy` 之前，先檢查瀏覽器的 CSP 回報。
- 只要 location 有自己的 `add_header`，Nginx 就會丟掉繼承的標頭，所以每個這樣的 location 都要重複完整的標頭組。

## 遷移既有狀態

**從舊版 `bridge-online` 服務**（`/var/lib/bridge-online`）遷移時，完整的 `deploy.sh` 包裝流程會：

- 保留舊版的執行環境設定與註解，只變更資料庫路徑。
- 停用並停止 `bridge-online.service`，並備份兩個狀態目錄。
- 只在目的地為空且沒有資料庫時，以原子操作複製舊版狀態；從不覆寫既有的新狀態。
- 保留舊的應用程式、設定與狀態以便回復。新的 unit 與舊的 unit 互相衝突，避免出現兩個寫入者。

自訂路徑、proxy 設定或互相衝突的狀態需要操作者審查。直接執行 `install.sh` 時，會拒絕仍在使用或尚未遷移的舊版設定。

**從 repository 內的資料庫遷移**：停止使用它的程序，建置後執行：

```sh
sudo bash deploy/install.sh "$PWD/.deploy/node"
sudo install -d -m 0700 /var/backups/card-together
sudo cp -a server/data "/var/backups/card-together/pre-systemd-$(date -u +%Y%m%dT%H%M%SZ)"
sudo python3 deploy/migrate-state.py --legacy server/data --current /var/lib/card-together
sudo chown -R card-together:card-together /var/lib/card-together
bash deploy/deploy.sh
```

`migrate-state.py` 會拒絕符號連結與只有部分內容的目的地，保留來源，並複製整個狀態目錄（**資料庫、媒體與回放一起**）。

**改名相容性**

- 不再提供 `/bridge_online/`，它的工作階段也無法遷移；那些瀏覽器必須重新登入。
- API cookie 依 proxy 路徑設定。既有的 `card-together.*` 瀏覽器偏好設定優先於遷移過來的 `bridge.*` 值。
- 偏好設定遷移與已停止的舊版狀態是為了相容與回復而刻意保留的。

## Repository

正式來源：[FatCatIsFat0424/card-together](https://github.com/FatCatIsFat0424/card-together)。

```sh
git remote set-url origin git@github.com:FatCatIsFat0424/card-together.git
git ls-remote origin HEAD
```
