# Android app

APK 是 Trusted Web Activity：一個在手機的 Chrome 中以全螢幕開啟 `https://acserver.csie.org/card-together/` 的啟動器。只從網站發布，不上架 Google Play。

| 項目 | 值 |
| --- | --- |
| 套件名稱 | `org.csie.acserver.cardtogether`（永久固定；變更就會成為另一個 app） |
| 最低 Android 版本 | 7.0（API 24） |
| 方向 | APK 與已安裝的 web app 都固定橫向（兩個方向皆可）；有測試確保兩份 manifest 一致。版面目標：[介面](interface.md#牌桌) |
| 顯示 | 全螢幕；從邊緣滑入時會短暫顯示狀態列與導覽列。網站把 `display-mode: fullscreen` 或 `android-app://` referrer 視為已安裝的 app |
| 宿主瀏覽器 | 有安裝 Chrome 時使用 Chrome，否則使用預設瀏覽器；因為 Samsung Internet 會忽略方向設定，`build-apk.sh` 會修補啟動器。宿主瀏覽器改變時需要重新登入 |
| 下載 | `/card-together/download/card-together.apk`，commit 在 `client/public/download/` |
| 包裝設定 | [`android/twa-manifest.json`](../android/twa-manifest.json) |
| Web manifest 與圖示 | `client/public/manifest.webmanifest`、`client/public/app-icons/` |
| Asset links | `/.well-known/assetlinks.json`，由主機 ingress 的 well-known 設定提供（[見下](#asset-links)） |

- 網站的變更會在下次開啟 app 時生效；只有包裝設定、圖示或簽署金鑰改變時才需要重新建置 APK。
- asset links 不相符時 app 仍可使用，但會顯示瀏覽器網址列。
- 沒有支援 TWA 瀏覽器的手機會以 Custom Tab 開啟網站。
- 大廳只會在 Android 瀏覽器中、且不在已安裝的 app 內時提供 APK 下載；關閉提示後會儲存 `card-together.androidAppDismissed`。

## Asset links

`/.well-known/assetlinks.json` 是整個網域共用的檔案，不在這個 repository 內，也不由部署流程寫入。內容由主機 ingress 的 well-known 設定提供（LCM 的 `components.ingress.wellKnown`，指向一個 root 擁有的檔案），必須與 `twa-manifest.json` 一致：

```json
[{"relation":["delegate_permission/common.handle_all_urls"],
  "target":{"namespace":"android_app",
            "package_name":"<twa-manifest.json 的 packageId>",
            "sha256_cert_fingerprints":["<twa-manifest.json 的 fingerprints[].value>"]}}]
```

兩者位於不同位置，沒有自動檢查。更換金鑰或套件名稱後，手動確認：

1. 主機上的檔案內容與 `twa-manifest.json` 的 `packageId` 與每個指紋相符。
2. `curl https://example.org/.well-known/assetlinks.json`（以實際網域取代）回傳相同內容，`Content-Type` 為 `application/json`。

## 簽署金鑰

每次更新 APK 都必須使用相同的金鑰，否則 Android 會拒絕覆蓋安裝舊的 app。

- keystore 與密碼放在 repository 之外的 `~/.config/card-together/android/`（`release.keystore`、`signing.env`，權限 0600）。兩者都要保留離線備份。
- `signing.env` 定義 `ANDROID_KEYSTORE`、`ANDROID_KEY_ALIAS`、`ANDROID_KEYSTORE_PASSWORD` 與 `ANDROID_KEY_PASSWORD`。
- 若更換金鑰，要更新 `twa-manifest.json` 與主機 ingress 的 asset links 檔案中的 SHA-256 指紋；既有的安裝必須先解除安裝。

## 建置工具鏈

在建置機器上做一次性的設定：

1. 安裝 JDK 17 與 Android SDK command-line tools，加上 `build-tools;36.1.0` 與 `platforms;android-36`，再接受 SDK 授權條款。
2. Bubblewrap 預期 SDK 根目錄下有 `bin/` 與 `lib/`；把它們連結到 `cmdline-tools/latest/bin` 與 `cmdline-tools/latest/lib`。
3. 把兩個路徑寫入 `~/.bubblewrap/config.json`：`{"jdkPath": "...", "androidSdkPath": "..."}`。
4. 安裝 Bubblewrap CLI（`@bubblewrap/cli`，以 1.27.0 建置），並把 `bubblewrap` 放進 `PATH`，或把 `BUBBLEWRAP` 設為它的路徑。

## 發布

1. 在 `android/twa-manifest.json` 中把 `appVersionCode` 加一，並設定 `appVersion`。
2. 建置並簽署；腳本會從 checkout 提供圖示，拒絕由 manifest 指紋以外的金鑰簽署的 APK，並寫入要發布的 APK：

   ```sh
   set -a; source ~/.config/card-together/android/signing.env; set +a
   bash android/build-apk.sh
   ```

3. commit manifest 與 APK；一般部署流程會發布它們。
