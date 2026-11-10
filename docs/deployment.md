# 部署

目標：既有 acserver 主機上的 **https://acserver.csie.org/card-together/**。

這個 repository 不含任何部署、備份、systemd 或 Nginx 程式。LCM 把它當成通用的 `managed` 服務：在沙箱中建置、安裝成唯讀的 release、以專用帳號執行、發布前端、設定 ingress 路由，並依 Resource 文件的宣告備份資料。主機端的設定與操作（`lcm host allow`、`lcm resource action card-together deploy`、policy、備份與還原）見 LCM repository 的 `docs/services.md`（Managed services、備份）與 `docs/operations.md`。以下只列出應用程式對主機的需求。

## 建置

LCM 在 checkout 上以官方 Node.js 24 執行（`PATH` 上有 `node`／`npm`，允許網路下載套件）：

```sh
npm ci --include=dev && npm run build:release
```

[`build:release`](../scripts/release/build-release.ts) 依序：

1. 匯入音樂、站方表情符號與入門展示影片（[媒體](media.md)、[對局展示製作](game-demos.md#影片檔)）。
2. 以正式環境路徑建置 client：`tsc -b` 與 `vite build`。`VITE_BASE_PATH=/card-together/`、空的 `VITE_SERVER_URL`、`VITE_SOCKET_PATH=/card-together/socket.io` 是預設值，環境中已設定時沿用。
3. 驗證建置產物（[`artifacts.ts`](../scripts/validation/artifacts.ts)）：index 連結、目錄、內容雜湊，以及原始檔與建置結果的位元組。
4. 組出 `.release/`（被 Git 忽略）。

- 不執行測試：品質由 GitHub CI 的 `npm run check -- full` 把關（[測試](testing.md)）。
- 建置輸入不在 Git 內：環境變數 `LCM_INPUTS_DIR`（絕對路徑）下的 `music/`、`emoji/`、`demos/` 取代 `local-music/`、`local-emoji/`、`local-demos/`；未設定時使用後者。三個子目錄都必須存在，唯讀即可；路徑上不能有符號連結（匯入工具會拒絕）。
- TURN 設定是 `VITE_` 開頭的公開值（`VITE_WEBRTC_ICE_SERVERS`，[語音](media.md#語音)），開發機放在 `client/.env.local`，Git 內沒有它。LCM 的建置環境是固定的，不傳入這個值，所以正式版本不使用 TURN（與改由 LCM 部署前相同）。

**`.release/` 內容**（LCM 以它作為 release 根目錄）

| 路徑 | 用途 |
| --- | --- |
| `server/start.mjs` | 進入點：以 `tsx/esm/api` 的 `register()` 註冊 TypeScript 載入器，再載入 `server/src/index.ts` |
| `server/src/`、`shared/src/` | 後端與共用原始碼（含 `provided-emoji.generated.json`） |
| `client/dist/` | 前端建置結果，由主機發布（[靜態前端](#靜態前端)） |
| `node_modules/` | 含 devDependencies（`tsx` 在執行時需要）；workspace 連結維持相對路徑，組裝時檢查每個連結都在 release 內且有效 |
| 各層 `package.json`、`tsconfig.json` | 套件解析與 `@shared/*` 路徑對應 |

## 執行

`node server/start.mjs`，工作目錄是 release 根目錄，release 與整個工作目錄唯讀。進入點與後端都不使用 `process.cwd()`；`start.mjs` 明確指定 `server/tsconfig.json`，所以 `@shared/*` 在任何工作目錄下都能解析，bot 搜尋 worker 也各自註冊同一份設定。只有狀態目錄可寫入。

## 執行環境設定

LCM 從 `/etc/card-together/env` 載入下列變數，並另外設定 `PORT` 與 `HOST=127.0.0.1`（來自主機設定 `host.json`，env 檔不能含這兩項）：

```dotenv
NODE_ENV=production
TRUST_PROXY_LOOPBACK=true
CLIENT_ORIGIN=https://acserver.csie.org
DATABASE_ENGINE=sqlite
DATABASE_PATH=/var/lib/card-together/database.sqlite
```

- 只能使用字面的 `KEY=value` 行：不能用 `export` 或 shell 展開。
- `CLIENT_ORIGIN` 是完全相符的 origin，不含路徑或結尾斜線；正式環境缺少它時後端拒絕啟動。
- `DATABASE_PATH` 必須明確設定在狀態目錄內：沒有設定時預設路徑在 release 內（`server/data/`），而 release 是唯讀的。`media/` 與 `replays/` 位於資料庫檔旁邊。
- `DATABASE_ENGINE` 為 `sqlite`（正式環境）或 `json`（[儲存引擎](storage.md#儲存引擎)）；一個資料庫只能由一個程序開啟（擁有者鎖定檔）。
- 搜尋型 bot 的 worker pool 由選填的 `BOT_WORKERS`（預設 2）、`BOT_WORKER_MEMORY_MB`（預設 128）與 `BOT_SEARCH_QUEUE`（預設 32）控制；沿用預設即可。Worker 在第一次搜尋時才啟動，每個閒置約增加 30 MB RSS，執行搜尋時再加上最多 `BOT_WORKER_MEMORY_MB` 的堆積。預設最壞約 400 MB，仍在 Resource 的 `limits.memoryMax: 1G` 內；增加 worker 數量或堆積上限前，必須先附量測數據提案調整記憶體上限（專案上限 4 GB）。
- 後端保持在 loopback 上。信任 loopback 時，ingress 必須覆寫 `X-Forwarded-For`。
- 變更連接埠時，同時更新主機設定中服務的 port 與 Resource 的健康檢查網址。

所有變數：[開發](development.md#設定)。

## 狀態目錄

`/var/lib/card-together/`，由服務帳號擁有，是唯一可寫入的位置：

| 內容 | 說明 |
| --- | --- |
| `database.sqlite` | 資料庫，執行時另有 `-wal`、`-shm` 與 `database.sqlite.lock` |
| `media/` | 上傳的圖片 |
| `replays/` | 對局回放封存 |

結構升級（schema migration）由伺服器啟動時自行處理，不需要獨立的 migrate 步驟。

## 靜態前端

LCM 把 `client/dist` 發布到 ingress 的靜態目錄（`/card-together/x.js` 對應到該目錄下的 `x.js`），應用程式不做任何發布。已開啟的分頁仍會要求舊的帶雜湊檔案，所以 Resource 的 `publish` 保留 `assets/`、`provided-music/` 與 `provided-emoji/` 中較早的檔案 14 天。音樂封面與音訊同在 `provided-music/`。站方表情符號目錄有變更時，後端也要隨同部署。

## 健康檢查

`GET /health` 回傳 200 與 `{"status":"ok"}`。Resource 的 `checks` 以 `http://127.0.0.1:3001/health` 檢查，ingress 也提供公開的 `/card-together/health`。

## 備份

在 Resource 的 `backup` 宣告資料，應用程式沒有備份程式：

```yaml
backup:
  sources:
    - { type: sqlite, path: database.sqlite }
    - { type: files, path: media/ }
    - { type: files, path: replays/ }
  mode: online
  keep: { daily: 14, weekly: 4 }
```

- 資料庫、媒體與回放必須一起備份與還原，並依資料庫引擎還原對應的檔案；規則見[儲存](storage.md#備份與還原)。
- `sqlite` 來源在服務執行時取得一致的副本（SQLite 不使用 exclusive locking mode）。把它排在第一個：在資料庫複製前就因保留規則被清除的回放，會在快照中顯示「沒有錄製」；資料庫複製後才寫入的回放，會在以該快照啟動時被清除（[回放封存](storage.md#回放封存)）。
- 同一顆磁碟上的備份只能防範資料損毀與操作失誤；異地副本不在 LCM 的範圍。
- 還原由 LCM 的 `restore` 動作執行（先備份目前資料、停止服務、取代來源、啟動並檢查健康）。還原後確認登入、歷史紀錄、回放、好友、媒體與遊戲恢復。

## 驗證

```sh
curl --fail --show-error http://127.0.0.1:3001/health
curl --fail --show-error https://acserver.csie.org/card-together/health
sudo journalctl -u card-together.service -n 100 --no-pager
```

- 健康檢查回傳 `{"status":"ok"}`。
- 在瀏覽器中確認：登入、建立房間、在 `/card-together/login` 重新整理、Socket 連線、重新啟動後恢復、上傳的圖片、站方表情符號、音樂，以及既有用戶端的偏好設定遷移。
- 用不同網路上的真實裝置測試語音；可能需要 TURN。

反覆啟動失敗時，檢查 log、設定、schema、連接埠與權限。**絕對不要以刪除資料作為修復方式。**

## 回復版本

LCM 的 `rollback` 動作啟用前一個 release；資料不會跟著回復。

1. 只有在較舊的版本支援目前狀態的 schema 與欄位時，才直接回復程式並保留目前的狀態（[相容性](storage.md#資料相容性)）。Schema v10 會遷移房間的 `gameOptions`；升級前先備妥資料庫、媒體與回放的完整備份。回復 v9 時必須使用升級前的完整備份，不能只換回舊程式。
2. 否則先停止服務，還原快照並接受遺失較新的寫入。**資料庫、媒體與回放要一起**還原，狀態目錄為 `0750`、私人檔案為 `0600`，擁有者是服務帳號。

已切換到 SQLite 時，要回到不支援 SQLite 的版本，先[回復到 JSON](#回復到-json)。

## 切換到 SQLite

正式環境已於 2026-10-27 切換到 SQLite，`database.json` 保留為唯讀檔，但已過時。以下步驟供新環境或重新切換使用（[儲存引擎](storage.md#儲存引擎)），**必須經過核准後才執行**。過程中服務會停止，玩家會斷線；請選在離峰時段並事先公告。

**前置條件**

- 包含[擁有者鎖定檔](storage.md#單一擁有者鎖定)、遷移與匯出工具的版本已經部署並健康運作；Node.js 為 24 以上（`.node-version`）。
- 空間：SQLite 檔約為 JSON 的 **2.2 倍**。遷移工具要求狀態目錄的可用空間至少是 JSON 的 5 倍（匯入 transaction 會先寫入 WAL），完整備份需要再一份狀態目錄的大小；切換後每份每日快照都是完整的 SQLite 副本，14 份約為 14 × 2.2 × JSON 大小，加上媒體與回放的差異。先確認：

  ```sh
  sudo du -sh /var/lib/card-together /var/lib/card-together/database.json /var/backups/card-together-manual
  df -h /var/lib/card-together /var/backups/card-together-manual
  ```

- 暫停 LCM 的 `auto-deploy` 與 `scheduled-backup` policy，並確認沒有進行中的部署或備份，避免途中重新啟動服務或複製到一半的狀態。
- 工具從目前的 release 以服務帳號執行；以下步驟的 `$release` 與 `$node` 是（`<runtime>` 是 Resource 使用的 runtime 名稱）：

  ```sh
  release=/opt/card-together/current
  node=/opt/lcm/runtimes/<runtime>/bin/node
  ```

**步驟**

1. 停止服務，並確認沒有寫入者：

   ```sh
   lcm resource action card-together stop --wait
   systemctl is-active card-together.service
   sudo ls -la /var/lib/card-together
   ```

   服務必須是 `inactive`，而且沒有 `database.json.lock`。

2. 完整備份資料庫、媒體與回放（整個狀態目錄），並另外保存執行環境設定：

   ```sh
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   sudo install -d -m 0700 /var/backups/card-together-manual
   sudo cp -a /var/lib/card-together "/var/backups/card-together-manual/pre-sqlite-$stamp"
   sudo cp -p /etc/card-together/env "/var/backups/card-together-manual/pre-sqlite-$stamp.env"
   sudo du -sh /var/lib/card-together "/var/backups/card-together-manual/pre-sqlite-$stamp"
   ```

   同一顆磁碟上的備份不足以防範硬體故障；請再複製一份到另一台主機。

3. 驗證 JSON（完整的啟動驗證，不寫入任何檔案）：

   ```sh
   sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/sqlite-snapshot-cli.ts verify /var/lib/card-together/database.json
   ```

   必須成功，`droppedRecordings` 應為空。記下 `collections`。

4. 預覽遷移（不寫入）：

   ```sh
   sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/migrate-sqlite-cli.ts /var/lib/card-together/database.json /var/lib/card-together/database.sqlite
   ```

   確認 `collections` 與第 3 步相同、`availableBytes` 大於 `requiredBytes`，且 `droppedRecordings` 為空。

5. 套用遷移：

   ```sh
   sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/migrate-sqlite-cli.ts /var/lib/card-together/database.json /var/lib/card-together/database.sqlite --apply --writers-stopped
   ```

   輸出必須是 `"mode": "applied"`，`verification` 包含 `"quickCheck": "ok"`、`"foreignKeyViolations": 0`、`"countsMatch": true`、`"readBack": true`。失敗時工具會刪除部分寫入的 SQLite 檔，JSON 不變；排除原因後從第 4 步重來，或直接回到第 8 步以 JSON 啟動。

6. 比對數量：以同一個驗證器分別讀取兩個資料庫，兩行輸出必須完全相同；再確認大小約為 2.2 倍：

   ```sh
   for db in database.json database.sqlite; do
     sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/sqlite-snapshot-cli.ts verify /var/lib/card-together/$db \
       | python3 -c 'import json, sys; print(json.dumps(json.load(sys.stdin)["collections"], sort_keys=True))'
   done
   sudo ls -l /var/lib/card-together/database.json /var/lib/card-together/database.sqlite
   ```

   第 5 步輸出的 `verification.tables` 也應與這些數量一致（`direct_messages`、`message_reads`、`friend_notifications`、`rewarded_games`、`game_stats`、`account_stats` 對應各自的 collection）。

7. 切換執行環境設定：

   ```sh
   sudoedit /etc/card-together/env
   sudo grep '^DATABASE_' /etc/card-together/env
   ```

   只保留這兩行（沒有 `DATABASE_ENGINE` 就加上）：

   ```dotenv
   DATABASE_ENGINE=sqlite
   DATABASE_PATH=/var/lib/card-together/database.sqlite
   ```

8. 啟動服務：

   ```sh
   lcm resource action card-together start --wait
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

   接著執行 `lcm resource action card-together restart --wait`，確認上述資料在重新啟動後仍在。

10. 把 JSON 檔保留為唯讀的備援，立即做一次 SQLite 備份，最後恢復兩個 policy：

    ```sh
    sudo chmod 0400 /var/lib/card-together/database.json
    lcm resource action card-together backup --wait
    ```

    確認 LCM 的備份紀錄成功，並含 `sqlite`、`media/` 與 `replays/` 三個來源。SQLite 一開始接受寫入，這份 JSON 就已過時：它只用於第 8–9 步失敗、還沒有玩家寫入時的立即回復；之後的回復一律使用[匯出](#回復到-json)。不要讓兩個引擎同時寫入。

### 回復到 JSON

第 8–9 步就失敗、服務沒有接受任何寫入時，可以直接切回：停止服務，把 `/etc/card-together/env` 改回 `DATABASE_ENGINE=json` 與 `DATABASE_PATH=/var/lib/card-together/database.json`，再啟動服務（`lcm resource action card-together start --wait`）並驗證。把 `database.sqlite` 移到備份目錄保存（第 2 步的備份中沒有它），讓日後重新切換時目標不存在。

SQLite 已經接受寫入後，用[匯出工具](storage.md#匯出-sqlite-為-json)把目前的資料寫成新的 JSON：

1. 暫停 LCM 的 `auto-deploy` 與 `scheduled-backup` policy、停止服務，並確認沒有 `database.sqlite.lock`（`$release` 與 `$node` 見上）：

   ```sh
   lcm resource action card-together stop --wait
   sudo ls -la /var/lib/card-together
   ```

2. 完整備份目前的狀態與設定：

   ```sh
   stamp=$(date -u +%Y%m%dT%H%M%SZ)
   sudo cp -a /var/lib/card-together "/var/backups/card-together-manual/pre-json-$stamp"
   sudo cp -p /etc/card-together/env "/var/backups/card-together-manual/pre-json-$stamp.env"
   ```

3. 預覽，再匯出到新檔（從不覆寫）：

   ```sh
   sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/export-sqlite-cli.ts /var/lib/card-together/database.sqlite /var/lib/card-together/database.export.json
   sudo -u card-together env -C "$release/server" "$node" --import tsx src/database/export-sqlite-cli.ts /var/lib/card-together/database.sqlite /var/lib/card-together/database.export.json --apply --writers-stopped
   ```

   輸出必須有 `"validated": true`，`collections` 與預覽相同。

4. 以匯出檔取代過時的 JSON，並把 SQLite 檔移出狀態目錄（兩者都已在第 2 步的備份中；正常停止後不會有 `-wal` 或 `-shm`）：

   ```sh
   sudo -u card-together mv -f /var/lib/card-together/database.export.json /var/lib/card-together/database.json
   sudo mv /var/lib/card-together/database.sqlite "/var/backups/card-together-manual/pre-json-$stamp.database.sqlite"
   ```

5. 把 `/etc/card-together/env` 改回 `DATABASE_ENGINE=json` 與 `DATABASE_PATH=/var/lib/card-together/database.json`，啟動服務，依第 8–9 步驗證，最後恢復兩個 policy。

要回到不支援 SQLite 的舊版本時，先依上述步驟回到 JSON，再依[回復版本](#回復版本)處理。

## Ingress 路由

Nginx、TLS 與路由由主機的 LCM ingress 提供，這個 repository 不含任何 Nginx 設定；ingress 的設定方式見 LCM repository 的 `docs/operations.md`（Ingress 與 Routes）。主機設定（`host.json`）授予服務的前綴 `/card-together/`、後端 port 與靜態目錄（LCM 發布 `client/dist` 的位置；`/card-together/x.js` 對應到該目錄下的 `x.js`）；呈現選項是服務 Resource 文件的 `route` 區段。應用程式需要：

| 需求 | 值 |
| --- | --- |
| 前綴 | `/card-together/`；`/card-together` 轉址到 `/card-together/` |
| API proxy | `api/` 轉發到後端 `/api/`；請求上限 3 MiB（base64 編碼的 2 MiB 圖片）；cookie 路徑改寫為前綴 |
| Socket.IO | `socket.io/` 轉發到後端 `/socket.io/`；WebSocket、讀取逾時 75 秒、不緩衝 |
| 健康檢查 | `health` 精確比對，轉發到後端 `/health` |
| 不可變資源 | `assets/` 與 `provided-emoji/`：快取一年，缺少的檔案回傳 404，從不回傳 `index.html` |
| SPA fallback | 其他路徑回到 `index.html`（`no-cache`） |
| APK 下載 | `download/card-together.apk` 以附件、`application/vnd.android.package-archive` 提供 |
| 標頭 | `X-Content-Type-Options`、`Referrer-Policy`，以及下列 **report-only** CSP |
| `/.well-known/assetlinks.json` | 網域層級，由 ingress 的 well-known 設定提供，見 [Android app](android.md#asset-links) |

路由範例（網域以 `example.org` 表示）：

```yaml
route:
  proxy:
    - path: api/
      upstream: /api/
      bodyLimit: 3m
      cookiePath: true
      category: api
    - path: socket.io/
      upstream: /socket.io/
      websocket: true
      timeout: 75s
      category: socket
    - path: health
      exact: true
      upstream: /health
      category: health
  static:
    spa: true
    immutable: [assets/, provided-emoji/]
    downloads:
      - path: download/card-together.apk
        type: application/vnd.android.package-archive
  headers:
    cspReportOnly: true
    csp: >-
      default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:;
      connect-src 'self' wss://example.org; object-src 'none'; base-uri 'self'; form-action 'self';
      frame-ancestors 'self'
```

- 後端保持在 loopback 上；ingress 以用戶端位址覆寫 `X-Forwarded-For`，這是 `TRUST_PROXY_LOOPBACK=true` 的前提。
- 把標頭改名為 `Content-Security-Policy` 之前，先檢查瀏覽器的 CSP 回報。
- API 與 Socket.IO 的觀察／限流 hook 由 ingress 為每個 route 產生，不屬於這個 repository。
- 這個 repository 不接觸 Nginx；路由是 Resource 文件與主機設定的內容。

## 相容性

- 不再提供 `/bridge_online/`，它的工作階段也無法遷移；那些瀏覽器必須重新登入。
- API cookie 依 proxy 路徑設定。既有的 `card-together.*` 瀏覽器偏好設定優先於遷移過來的 `bridge.*` 值。
- 偏好設定遷移是為了相容而刻意保留的。

## Repository

正式來源：[FatCatIsFat0424/card-together](https://github.com/FatCatIsFat0424/card-together)。

```sh
git remote set-url origin git@github.com:FatCatIsFat0424/card-together.git
git ls-remote origin HEAD
```
