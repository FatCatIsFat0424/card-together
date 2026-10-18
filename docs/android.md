# Android app

The APK is a Trusted Web Activity: a launcher that opens
`https://acserver.csie.org/card-together/` full screen in the phone's Chrome. It is
distributed only from the site, not Google Play.

| Item | Value |
| --- | --- |
| Package | `org.csie.acserver.cardtogether` (permanent; changing it creates a different app) |
| Minimum Android | 7.0 (API 24) |
| Download | `/card-together/download/card-together.apk`, committed in `client/public/download/` |
| Wrapper settings | [`android/twa-manifest.json`](../android/twa-manifest.json) |
| Web manifest and icons | `client/public/manifest.webmanifest`, `client/public/app-icons/` |
| Asset links | `/.well-known/assetlinks.json`, served from the [Nginx snippet](../deploy/nginx/card-together.conf) |

- Site changes reach the app on the next launch; rebuild the APK only when wrapper
  settings, icons, or the signing key change.
- Without matching asset links the app still works but shows a browser URL bar.
  A test keeps the snippet's package and fingerprint equal to `twa-manifest.json`.
- Phones without a TWA-capable browser open the site in a Custom Tab.
- The lobby offers the APK only in Android browsers outside the installed app;
  dismissing it stores `card-together.androidAppDismissed`.

## Signing key

Every APK update must use the same key, or Android refuses to install it over the old app.

- Keystore and passwords live outside the repository in `~/.config/card-together/android/`
  (`release.keystore`, `signing.env`, mode 0600). Keep an offline backup of both.
- `signing.env` defines `ANDROID_KEYSTORE`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_PASSWORD`.
- If the key is replaced, update its SHA-256 fingerprint in `twa-manifest.json` and
  the Nginx snippet; existing installs must be uninstalled first.

## Build toolchain

One-time setup on the build machine:

1. Install JDK 17 and the Android SDK command-line tools with `build-tools;36.1.0`
   and `platforms;android-36`, then accept the SDK licenses.
2. Bubblewrap expects `bin/` and `lib/` at the SDK root; link them to
   `cmdline-tools/latest/bin` and `cmdline-tools/latest/lib`.
3. Write both paths to `~/.bubblewrap/config.json`:
   `{"jdkPath": "...", "androidSdkPath": "..."}`.
4. Install the Bubblewrap CLI (`@bubblewrap/cli`, built with 1.27.0) and put
   `bubblewrap` on `PATH`, or set `BUBBLEWRAP` to its path.

## Release

1. Raise `appVersionCode` by one and set `appVersion` in `android/twa-manifest.json`.
2. Build and sign; the script serves icons from the checkout, refuses an APK signed by
   any key other than the manifest fingerprint, and writes the published APK:

   ```sh
   set -a; source ~/.config/card-together/android/signing.env; set +a
   bash android/build-apk.sh
   ```

3. Commit the manifest and APK; the normal deployment publishes them.
