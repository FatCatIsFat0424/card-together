# 對局展示製作

每個模式都在 `DEMO_GAME_TYPES` 中，有入門展示腳本（[`game-demos.test.ts`](../server/tests/client/game-demos.test.ts) 檢查沒有遺漏）。影片入口在各模式的規則面板，只有匯入站長提供的影片後才顯示。

## 內容規則

- **畫面不燒字**：錄製頁只顯示正式牌桌與既有的公開揭曉面板（揭盅、攤牌、結算等），沒有標題、說明、規則補充卡或資訊列。牌桌介面維持中文，每個模式只錄一支。
- **字幕外掛**：每支影片有 `<game>.zh-TW.vtt` 與 `<game>.en.vtt`。播放器預設顯示目前介面語言的字幕，切換語言時立即改變（瀏覽器只在載入時讀取 `default`，所以由程式切換 `textTracks` 的 `mode`）。播放器下方沒有章節與文字稿。
- **長度 60–90 秒，只示範基本流程**：目標、一兩個用正式控制項完成的真實回合、加速走完其餘部分、結算。複雜模式可接近 90 秒；沒有共用的開場說明。加速時字幕要說明正在加速。
- **細節放在規則文字**：例外、選項與計分細節寫在 [`game-rules-i18n.ts`](../client/src/game-rules-i18n.ts)（兩種語言）與 [`docs/games/`](games/README.md)，影片不另做補充。
- **不提前洩漏**：尚未公開的他人手牌、骰子、排牌與小秘書身分不能出現，加速段落也一樣。錄製頁不提供旁觀者全手牌視角；開盅後才顯示該輪其他人的骰子。
- 每段字幕一或兩行，可再分成先後兩則，顯示在畫面頂端（`line:0`），不遮住自己的手牌與控制項；`server/tests/client/game-demos.test.ts` 檢查長度與行寬。尚未改成短版的模式列在 `LONG_FORMAT_GAME_TYPES`，改完即移除。

## 影片檔

影片不進 Git，比照[音樂與表情符號](media.md)由站長在本機提供：

- 原始檔放在被忽略的 `local-demos/<game>.mp4`（只認根目錄）。請自行備份；新增模式須先完成下述錄製與驗證。
- `npm run demos:import`（client 的 `predev`／`prebuild` 與完整檢查也會執行）把影片複製為帶內容雜湊的 `client/public/game-demos/<game>-<hash>.mp4`，並產生 `client/src/game-demo-videos.generated.json`。
- 匯入時比對 MP4 長度與 [`game-demo-recordings.json`](../client/src/game-demo-recordings.json)，相差超過 0.1 秒或沒有記錄長度（分段式 MP4）就失敗；其他檔名列為略過。
- 沒有影片的模式，規則面板不顯示展示區，只保留文字規則。字幕在 Git 中，換影片時必須一併更新。
- 正式環境的建置由 LCM 執行，影片從它提供的輸入目錄 `demos/`（`LCM_INPUTS_DIR`）讀取，見[部署](deployment.md#建置)。新增或更換影片時，也要更新主機上的該目錄。

## 來源與隱私

- 課程時間軸：[`game-demos.ts`](../client/src/game-demos.ts)（牌類、下注類、棋類、吃墩類，以及快艇骰子、骨牌接龍與密碼推理在 `client/src/game-demos/*-scenes.ts`）。每個場景指定秒數、要呈現的快照步數，以及可選的字幕切換點 `split`。字幕文字：[`game-demo-i18n.ts`](../client/src/game-demo-i18n.ts) 與 `client/src/game-demos/*-i18n.ts`。
- 錄影記錄：`game-demo-recordings.json` 存放起點 `leadIn`、影片長度 `duration`，以及實測的各場景起點 `starts`。尚未錄製的模式以暫代值佔位（起點 0 秒、長度為課程總長，沒有 `starts`），測試會檢查暫代值與課程同步。
- [`subtitles.ts`](../scripts/game-demos/subtitles.ts) 依場景與起點產生字幕：第一則從 0 秒開始，最後一則延續到片尾。[`write-subtitles.ts`](../scripts/game-demos/write-subtitles.ts) 寫出 `client/public/game-demos/<game>.<locale>.vtt`；測試要求檔案與產生結果一致。
- [`generate-fixtures.ts`](../scripts/game-demos/generate-fixtures.ts) 整合 `cards-fixtures.ts`、`betting-fixtures.ts`、`boards-fixtures.ts`、`trick-fixtures.ts` 與 `dice-fixtures.ts`（快艇骰子、骨牌接龍、密碼推理），以固定牌序／骰序或亂數種子呼叫正式 manager，驗證每一步合法並完成對局。產出僅包含固定玩家視角；他人未公開的排牌、蓋牌、布陣、船位與密碼猜測提交內容也會移除；長局以差異快照儲存。
- 牌類與吃墩教學使用 [`card-recipes.json`](../scripts/game-demos/card-recipes.json) 的固定動作及亂數消耗次數，與即時 bot 策略分開，避免策略更新改變已錄影片。改腳本時須重新驗證整場、字幕與對應影片。
- [`recording-stage.tsx`](../scripts/game-demos/recording-stage.tsx) 使用正式牌桌與隔離的 store，按時間軸示範合成資料；每個步驟在場景開始 3.5 秒後依序呈現，間隔超過 2.5 秒時才用正式控制項示範自己的操作（選牌、排牌、叫品），提交後的狀態來自已驗證快照，不連線操作真實房間。
- 開發用入口 `client/demo-recording.html` 不在正式 build 的 HTML entry 中；fixtures 與錄製工具不會打包進正式網站。

## 重錄

使用 `.node-version` 指定的 Node.js，在專案根目錄執行：

```sh
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json scripts/game-demos/generate-fixtures.ts
npm run dev:preview
```

1. 開啟預覽網址的 `/demo-recording.html?game=<game>`，viewport 設為 1280 × 960，確認分頁可持續執行且不受背景節流。
2. 等待 `window.demoRecording.ready`，先以 `window.demoRecording.run(20)` 快速檢查，確認 `done === true` 且 `error === null`。重錄前重新載入頁面。
3. 啟動瀏覽器錄影（預覽分頁的錄影，或無頭 Chromium 的 CDP screencast），再呼叫 `window.demoRecording.run()`；`done` 之後多錄約 1 秒再停止。保留 `window.demoRecording.timeline`（各場景開始的時間戳）。可用多個分頁並行錄製；錄製期間不要寫入 `client/` 下任何檔案，HMR 會重置錄製頁。
4. 錄製頁在 `run()` 之前以全黑畫面覆蓋，黑幕消失的第一個影格就是 `timeline[0]`，作為影片 0 秒並剪掉之前的部分；各場景起點為 `timeline[i] − timeline[0]`。錄影只在畫面變化時寫入影格（VFR），用 ffmpeg 轉成 30 fps H.264（`-movflags +faststart`），以 `tpad=stop_mode=clone` 延長最後畫面並裁到最後一個場景結束後約 1 秒。
5. 將 MP4 放入 `local-demos/<game>.mp4`，把 `leadIn`、`duration` 與 `starts` 寫入 `game-demo-recordings.json`，執行 `write-subtitles.ts` 更新字幕，最後執行 `npm run demos:import`。若變更場景秒數，必須同步重錄影片。
6. 實際檢查影片可播放、兩種字幕的換段與畫面相符、切換介面語言時字幕跟著切換、結算與固定結果相符；再執行專案完整檢查。
