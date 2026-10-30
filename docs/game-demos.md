# 對局展示製作

首批影片為橋牌、拿破崙、十三支與吹牛骰；入口在各模式的規則面板。影片無旁白，使用中文牌桌與畫面說明，附中英文字幕、章節和文字稿。內容以操作與完成一局為目標，特殊分支以明確標示的規則補充卡說明，不將單一牌例當成策略建議。

## 來源與隱私

- 課程時間軸：[`game-demos.ts`](../client/src/game-demos.ts)；雙語說明與文字稿：[`game-demo-i18n.ts`](../client/src/game-demo-i18n.ts)。章節與字幕共用此來源。
- [`generate-fixtures.ts`](../scripts/game-demos/generate-fixtures.ts) 以固定牌序／骰序呼叫正式 manager，驗證每一步合法並完成對局。產出僅包含固定玩家視角；十三支他人未公開的提交內容也會移除。
- [`recording-stage.tsx`](../scripts/game-demos/recording-stage.tsx) 使用正式牌桌與隔離的 store，按課程時間軸示範合成資料；選牌、排牌與叫品選擇使用正式控制項，提交後的狀態來自已驗證快照，不連線操作真實房間。吹牛骰以正式揭盅元件顯示已公開紀錄，再切換下一輪。
- 開發用入口 `client/demo-recording.html` 不在正式 build 的 HTML entry 中；fixtures 與錄製工具不會打包進正式網站。

## 重錄

使用 `.node-version` 指定的 Node.js，在專案根目錄執行：

```sh
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json scripts/game-demos/generate-fixtures.ts
node node_modules/tsx/dist/cli.mjs --tsconfig server/tsconfig.json scripts/game-demos/write-subtitles.ts
npm run dev:preview
```

1. 開啟預覽網址的 `/demo-recording.html?game=bridge`，遊戲值另可用 `napoleon`、`chinesepoker`、`liarsdice`。viewport 設為 1280 × 960，保持分頁在前景。
2. 等待牌桌載入與 `window.demoRecording.ready`，先以 `window.demoRecording.run(20)` 快速檢查，確認 `done === true` 且 `error === null`。重錄前重新載入頁面。
3. 啟動瀏覽器錄影，再呼叫 `window.demoRecording.run()`。結束後確認相同完成旗標，立即停止錄影，避免多餘尾段。錄製期間不要編輯會觸發 HMR 的來源檔。
4. 將 MP4 放入 `client/public/game-demos/<game>.mp4`；把錄影開始到 `run()` 的實測延遲與影片長度更新至 `DEMO_RECORDINGS`，再執行字幕產生器，更新同目錄的 `<game>.<locale>.vtt`。字幕會涵蓋片尾的結果閱讀時間。若變更章節時間，必須同步重錄影片。
5. 實際檢查影片可播放、字幕可載入、章節落點正確、結算與固定結果相符；再執行專案完整檢查。

影片必須顯示目標、自己的資訊、可操作時機、主要控制項、完整必要階段、重複流程與結算。重複出牌可加速，但須標示；尚未公開的他人手牌、骰子與小秘書身分不能提前出現。錄製頁不提供旁觀者全手牌視角。開盅之後才可顯示該輪其他人的骰子，下一輪新骰子仍保持隱藏。
