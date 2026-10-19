#!/usr/bin/env bash
# Builds the signed Android wrapper (Trusted Web Activity) into the published client files.
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
manifest="$repo_dir/android/twa-manifest.json"
output="$repo_dir/client/public/download/card-together.apk"
bubblewrap=${BUBBLEWRAP:-bubblewrap}
bubblewrap_config="$HOME/.bubblewrap/config.json"

for name in ANDROID_KEYSTORE ANDROID_KEY_ALIAS ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD; do
  [[ -n ${!name:-} ]] || { echo "$name is required; see docs/android.md." >&2; exit 1; }
done
[[ -f $ANDROID_KEYSTORE ]] || { echo "Keystore not found: $ANDROID_KEYSTORE" >&2; exit 1; }
command -v "$bubblewrap" >/dev/null || { echo "Bubblewrap CLI not found; set BUBBLEWRAP." >&2; exit 1; }
[[ -f $bubblewrap_config ]] || { echo "Configure the JDK and Android SDK in $bubblewrap_config." >&2; exit 1; }
config_value() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$bubblewrap_config" "$1"; }
sdk_dir=$(config_value androidSdkPath)
# apksigner runs on the same JDK that Bubblewrap uses.
export PATH="$(config_value jdkPath)/bin:$PATH"
apksigner=$(find "$sdk_dir/build-tools" -mindepth 2 -maxdepth 2 -name apksigner | sort -V | tail -n 1)
[[ -x $apksigner ]] || { echo "apksigner not found under $sdk_dir/build-tools." >&2; exit 1; }

work_dir=$(mktemp -d)
server_pid=
cleanup() {
  if [[ -n $server_pid ]]; then kill "$server_pid" 2>/dev/null || true; fi
  rm -rf -- "$work_dir"
}
trap cleanup EXIT

# Bubblewrap downloads launcher icons, so serve the checkout's icons instead of production's.
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$repo_dir/client/public" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 50); do
  curl -fsS -o /dev/null "http://127.0.0.1:$port/app-icons/icon-512.png" 2>/dev/null && break
  sleep 0.1
done

python3 - "$manifest" "$work_dir/twa-manifest.json" "$port" "$ANDROID_KEYSTORE" "$ANDROID_KEY_ALIAS" <<'EOF'
import json
import sys

source, target, port, keystore, alias = sys.argv[1:]
manifest = json.load(open(source))
local = f'http://127.0.0.1:{port}/app-icons/'
manifest['iconUrl'] = local + 'icon-512.png'
manifest['maskableIconUrl'] = local + 'maskable-512.png'
manifest['signingKey'] = {'path': keystore, 'alias': alias}
# Generation would otherwise fetch the production web manifest, which may predate this checkout.
manifest.pop('webManifestUrl', None)
json.dump(manifest, open(target, 'w'), indent=2)
EOF

cd "$work_dir"
"$bubblewrap" update --skipVersionUpgrade --manifest="$work_dir/twa-manifest.json" --directory="$work_dir"

# Samsung Internet can host the app as the default browser but ignores the requested orientation, so the
# launcher opens Chrome whenever Chrome can host it and leaves other phones to their default browser.
launcher=$(find "$work_dir/app/src/main/java" -name LauncherActivity.java)
python3 - "$launcher" <<'PATCH'
import sys

path = sys.argv[1]
source = open(path).read().rstrip()
if not source.endswith('}') or 'createTwaLauncher' in source:
    sys.exit(f'Unexpected LauncherActivity source: {path}')
override = '''
    private static final String CHROME_PACKAGE = "com.android.chrome";
    private static final String TWA_CATEGORY = "androidx.browser.trusted.category.TrustedWebActivities";

    @Override
    protected com.google.androidbrowserhelper.trusted.TwaLauncher createTwaLauncher() {
        if (!hostsTrustedWebActivities(CHROME_PACKAGE)) return super.createTwaLauncher();
        return new com.google.androidbrowserhelper.trusted.TwaLauncher(this, CHROME_PACKAGE, getTaskId());
    }

    private boolean hostsTrustedWebActivities(String packageName) {
        android.content.Intent service = new android.content.Intent(
                androidx.browser.customtabs.CustomTabsService.ACTION_CUSTOM_TABS_CONNECTION).setPackage(packageName);
        for (android.content.pm.ResolveInfo info : getPackageManager().queryIntentServices(
                service, android.content.pm.PackageManager.GET_RESOLVED_FILTER)) {
            if (info.filter != null && info.filter.hasCategory(TWA_CATEGORY)) return true;
        }
        return false;
    }
}
'''
open(path, 'w').write(source[:-1] + override)
PATCH
BUBBLEWRAP_KEYSTORE_PASSWORD=$ANDROID_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD=$ANDROID_KEY_PASSWORD \
  "$bubblewrap" build --skipPwaValidation --manifest="$work_dir/twa-manifest.json" --directory="$work_dir"

# The published asset links only trust the release key, so refuse an APK signed by any other.
expected=$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["fingerprints"][0]["value"].replace(":", "").lower())' "$manifest")
actual=$("$apksigner" verify --print-certs app-release-signed.apk | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
[[ $actual == "$expected" ]] || { echo "APK signer $actual does not match android/twa-manifest.json." >&2; exit 1; }

install -D -m 0644 app-release-signed.apk "$output"
echo "Built $output"
