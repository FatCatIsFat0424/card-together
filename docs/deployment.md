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
| `/var/lib/card-together/` | `database.json`、`media/` 與 `replays/` |
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
DATABASE_PATH=/var/lib/card-together/database.json
```

- 只能使用字面的 `KEY=value` 行：不能用 `export` 或 shell 展開。
- `CLIENT_ORIGIN` 是完全相符的 origin，不含路徑或結尾斜線。
- `DATABASE_PATH` 要放在可寫入的狀態目錄內。
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
| `data/data-<UTC stamp>/`（每日約 04:15） | 經過 JSON 驗證的 `database.json`、`media/` 與 `replays/` | 最新 14 份（`KEEP`） |

- `application/` 中省略的檔案，可以在相符的版本執行 `deploy/build.sh` 重建。
- 每日備份在後端上線時執行：資料庫以原子 rename 替換，媒體以內容定址，每個回放檔只寫入一次。未變更的檔案以硬連結指向上一份快照。
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

- 同一顆磁碟上的快照只能防範資料損毀與操作失誤；請在另一台主機保留副本。還原步驟：[儲存](storage.md#備份與還原)。

### 回復版本

1. 停止 `card-together` 與舊版 `bridge-online` 兩個服務。選擇相容的應用程式、相依套件、unit、設定與 Nginx 設定。
2. 只有在較舊的版本支援目前狀態的 schema 與欄位時，才保留目前的狀態（[相容性](storage.md#資料相容性)）。
3. 否則還原快照，並接受遺失較新的寫入。**資料庫、媒體與回放要一起**還原，狀態目錄為 `0700`、私人檔案為 `0600`，擁有者與選定的服務使用者相符。
4. 執行 `sudo systemctl daemon-reload`，測試並重新載入 Nginx，然後只啟動選定的服務。

回復到改名前的應用程式時：它未被動過的資料庫只是 migration 前的快照，所以要先整合較新的狀態。

## 只發布前端

適用於沒有後端或 Nginx 變更的 UI 或音樂變更：

```sh
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
bash deploy/publish-client.sh
```

- 使用部署鎖，同步資源，再以原子操作替換 `index.html`。它不會重新啟動後端，也不會重新載入 Nginx。
- 較早帶雜湊的資源保留 14 天；之後 `prune-assets.sh` 會移除目前建置中沒有的檔案。
- 只匯入音樂不會發布任何東西。
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
