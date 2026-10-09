#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
build_dir="$repo_dir/client/dist"
site_dir=/opt/card-together/www/card-together
if [[ ! -f $build_dir/index.html || ! -d $build_dir/assets || ! -d $site_dir ]]; then
  echo 'Build the client and install the site before publishing its frontend.' >&2
  exit 1
fi
if ! grep -qF '/card-together/assets/' "$build_dir/index.html"; then
  echo 'Rebuild with VITE_BASE_PATH=/card-together/ before publishing.' >&2
  exit 1
fi
# The backend accepts only site emoji from its installed catalog; a missing catalog means none.
emoji_catalog() {
  if [[ -f $1 ]]; then cat -- "$1"; else echo '[]'; fi
}
catalog=shared/src/provided-emoji.generated.json
if [[ $(emoji_catalog "$repo_dir/$catalog") != "$(emoji_catalog "/opt/card-together/$catalog")" ]]; then
  echo 'Site emoji changed; publish them with deploy/deploy.sh so the backend accepts them.' >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$repo_dir/deploy/publish-client.sh"
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
exec 9>/run/lock/card-together-deploy.lock
flock -n 9 || { echo 'Another Card Together deployment is running.' >&2; exit 1; }
install -d -m 0700 /var/backups/card-together
backup_dir=$(mktemp -d "/var/backups/card-together/frontend-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
cp -p "$site_dir/index.html" "$backup_dir/index.html"
index_temp="$site_dir/.index-publish-$$"
trap 'rm -f -- "$index_temp"' EXIT
# Preserve old hashed assets for browsers still using the previous entry point.
rsync -a --exclude=/index.html --chown=root:root --chmod=D755,F644 \
  "$build_dir/" "$site_dir/"
rsync -a --exclude=/index.html --chown=root:root --chmod=D755,F644 \
  "$build_dir/" /opt/card-together/www/bridge_online/
install -m 0644 "$build_dir/index.html" "$index_temp"
mv -f -- "$index_temp" "$site_dir/index.html"
# Keep only the newest entry-point backups, and drop leftovers of the former /tmp location.
find /var/backups/card-together -mindepth 1 -maxdepth 1 -type d -name 'frontend-*' \
  | sort | head -n -5 | while IFS= read -r stale; do rm -rf -- "$stale"; done || true
find /tmp -mindepth 1 -maxdepth 1 -type d -name 'card-together-frontend.*' -mtime +7 \
  -exec rm -rf -- {} +
for directory in "$site_dir" /opt/card-together/www/bridge_online; do
  bash "$repo_dir/deploy/prune-assets.sh" "$build_dir" "$directory"
done
echo "Frontend published. Previous entry point: $backup_dir/index.html"
echo 'No backend restart or Nginx reload was performed.'
