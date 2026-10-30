# 對局展示製作

全部 25 款模式都提供完整入門展示，入口在各模式的規則面板。影片無旁白，使用中文牌桌與畫面說明，附中英文字幕、章節和文字稿。內容以操作與完成一局為目標，特殊分支以明確標示的規則補充卡說明，不將單一牌例當成策略建議。

## 影片檔

影片不進 Git，比照[音樂與表情符號](media.md)由站長在本機提供：

- 原始檔放在被忽略的 `local-demos/<game>.mp4`（`<game>` 為 `DEMO_GAME_TYPES` 中的模式，只認根目錄）。請自行備份；重錄全部模式約需 40 分鐘。
- `npm run demos:import`（client 的 `predev`／`prebuild` 與完整檢查也會執行）把影片複製為帶內容雜湊的 `client/public/game-demos/<game>-<hash>.mp4`，並產生 `client/src/game-demo-videos.generated.json`。
- 匯入時比對 MP4 長度與 [`game-demo-recordings.json`](../client/src/game-demo-recordings.json)，相差超過 0.1 秒或沒有記錄長度（分段式 MP4）就失敗；其他檔名列為略過。
- 沒有影片的模式，規則面板不顯示展示區，只保留文字規則。字幕 `<game>.<locale>.vtt` 與章節時間仍在 Git 中，換影片時必須一併更新。
- 自動部署使用 `local-demos` 輸入快照，見[部署](deployment.md#ci-通過後自動部署)。

## 來源與隱私

- 課程時間軸：[`game-demos.ts`](../client/src/game-demos.ts)，實際錄影的起點、長度與章節秒數在 [`game-demo-recordings.json`](../client/src/game-demo-recordings.json)；雙語說明與文字稿入口：[`game-demo-i18n.ts`](../client/src/game-demo-i18n.ts)。牌類、下注類與棋類各自維護於 `client/src/game-demos/`；章節與字幕共用課程來源。
- [`generate-fixtures.ts`](../scripts/game-demos/generate-fixtures.ts) 整合 `cards-fixtures.ts`、`betting-fixtures.ts`、`boards-fixtures.ts`，以固定牌序／骰序或亂數種子呼叫正式 manager，驗證每一步合法並完成對局。產出僅包含固定玩家視角；他人未公開的排牌、蓋牌、布陣與船位提交內容也會移除；長局以差異快照儲存。
- [`recording-stage.tsx`](../scripts/game-demos/recording-stage.tsx) 使用正式牌桌與隔離的 store，按課程時間軸示範合成資料；選牌、排牌與叫品選擇使用正式控制項，提交後的狀態來自已驗證快照，不連線操作真實房間。各模式以正式展示元件呈現公開的揭盅、攤牌、底池與輪盤結果，再切換下一輪。
- 開發用入口 `client/demo-recording.html` 不在正式 build 的 HTML entry 中；fixtures 與錄製工具不會打包進正式網站。

## 重錄

使用 `.node-version` 指定的 Node.js，在專案根目錄執行：

```sh
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json scripts/game-demos/generate-fixtures.ts
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json scripts/game-demos/write-subtitles.ts
npm run dev:preview
```

1. 開啟預覽網址的 `/demo-recording.html?game=bridge`，遊戲值使用 `DEMO_GAME_TYPES` 中的任一模式。viewport 設為 1280 × 960，確認分頁可持續執行且不受背景節流。
2. 等待牌桌載入與 `window.demoRecording.ready`，先以 `window.demoRecording.run(20)` 快速檢查，確認 `done === true` 且 `error === null`。重錄前重新載入頁面。
3. 啟動瀏覽器錄影，再呼叫 `window.demoRecording.run()`。結束後確認相同完成旗標再停止錄影。可用多個分頁並行錄製；錄製期間不要寫入 `client/` 下任何檔案（含 `game-demo-recordings.json` 與匯入的影片），HMR 會重置錄製頁。
4. 預覽錄影只在畫面變化時寫入影格，回報的開始時間也比第一個影格早約 1–2 秒。以影片中第一次標題切換的時間對照 `window.demoRecording.timeline[1]` 校準起點，將各章節換算為影片秒數；再用 ffmpeg 轉成 30 fps H.264（`-movflags +faststart`），以 `tpad=stop_mode=clone` 延長最後畫面並裁到最後一章結束後 1 秒，保留片尾閱讀時間。
5. 將 MP4 放入 `local-demos/<game>.mp4`，把起點、影片長度與章節秒數更新至 `game-demo-recordings.json`，再執行字幕產生器更新 `client/public/game-demos/<game>.<locale>.vtt`，最後執行 `npm run demos:import`。字幕會涵蓋片尾的結果閱讀時間。若變更章節時間，必須同步重錄影片。
6. 實際檢查影片可播放、字幕可載入、章節落點正確、結算與固定結果相符；再執行專案完整檢查。

影片必須顯示目標、自己的資訊、可操作時機、主要控制項、完整必要階段、重複流程與結算。重複出牌可加速，但須標示；尚未公開的他人手牌、骰子與小秘書身分不能提前出現。錄製頁不提供旁觀者全手牌視角。開盅之後才可顯示該輪其他人的骰子，下一輪新骰子仍保持隱藏。
