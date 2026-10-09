#!/usr/bin/env bash
set -euo pipefail

# Build as the deployment user first; this script only installs prepared artifacts.
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_binary=${1:?Usage: sudo bash deploy/install.sh /absolute/path/to/node}
if [[ $EUID -ne 0 || $node_binary != /* || ! -x $node_binary ]]; then
  echo 'Run as root with an absolute executable Node path.' >&2
  exit 1
fi
"$node_binary" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)' || {
  echo 'Node.js 22.13 or newer is required; use Node.js 24.' >&2
  exit 1
}
command -v rsync >/dev/null
if [[ -f /etc/bridge-online/server.env && ! -f /etc/card-together/server.env ]]; then
  echo "Migrate the existing installation with deploy/deploy.sh first." >&2
  exit 1
fi
if systemctl is-active --quiet bridge-online.service; then
  echo "Stop and disable bridge-online.service before installing." >&2
  exit 1
fi
test -f "$repo_dir/node_modules/tsx/package.json"
test -f "$repo_dir/client/dist/index.html"
grep -qF '/card-together/assets/' "$repo_dir/client/dist/index.html" || {
  echo 'Build the client with VITE_BASE_PATH=/card-together/ before installing.' >&2
  exit 1
}
getent passwd card-together >/dev/null || useradd --system --user-group \
  --home-dir /var/lib/card-together --no-create-home --shell /usr/sbin/nologin card-together
if systemctl cat card-together.service >/dev/null 2>&1; then
  systemctl stop card-together.service
fi
empty_dir=$(mktemp -d)
trap 'rm -rf -- "$empty_dir"' EXIT
install -d -m 0755 /opt/card-together
install -m 0644 "$repo_dir/package.json" /opt/card-together/package.json
rsync -a --delete --chown=root:root --chmod=a+rX \
  "$repo_dir/node_modules/" /opt/card-together/node_modules/
for workspace in shared server client; do
  install -d -m 0755 "/opt/card-together/$workspace"
  install -m 0644 "$repo_dir/$workspace/package.json" "/opt/card-together/$workspace/package.json"
  dependency_source="$repo_dir/$workspace/node_modules"
  if [[ ! -d $dependency_source ]]; then dependency_source=$empty_dir; fi
  rsync -a --delete --chown=root:root --chmod=a+rX \
    "$dependency_source/" "/opt/card-together/$workspace/node_modules/"
done
for workspace in shared server; do
  rsync -a --delete --chown=root:root --chmod=D755,F644 \
    "$repo_dir/$workspace/src/" "/opt/card-together/$workspace/src/"
  install -m 0644 "$repo_dir/$workspace/tsconfig.json" "/opt/card-together/$workspace/tsconfig.json"
done
install -m 0644 "$repo_dir/tsconfig.json" /opt/card-together/tsconfig.json
# Keep old hashed assets available to already-open browser sessions.
install -d -m 0755 /opt/card-together/www/bridge_online
if [[ -d /opt/bridge-online/www/bridge_online ]]; then
  rsync -a --chown=root:root --chmod=D755,F644 \
    /opt/bridge-online/www/bridge_online/ /opt/card-together/www/bridge_online/
fi
rsync -a --exclude=/index.html --chown=root:root --chmod=D755,F644 \
  "$repo_dir/client/dist/" /opt/card-together/www/bridge_online/
install -d -m 0755 /opt/card-together/www/card-together
# Previous hashed assets stay for open tabs, and previous site emoji for chat history that
# still references them; prune-assets.sh removes both after a grace period.
rsync -a --delete --exclude=/assets/ --exclude=/provided-emoji/ --chown=root:root --chmod=D755,F644 \
  "$repo_dir/client/dist/" /opt/card-together/www/card-together/
for subdirectory in assets provided-emoji; do
  install -d -m 0755 "/opt/card-together/www/card-together/$subdirectory"
  if [[ -d $repo_dir/client/dist/$subdirectory ]]; then
    rsync -a --chown=root:root --chmod=D755,F644 \
      "$repo_dir/client/dist/$subdirectory/" "/opt/card-together/www/card-together/$subdirectory/"
  fi
done
for directory in /opt/card-together/www/card-together /opt/card-together/www/bridge_online; do
  bash "$repo_dir/deploy/prune-assets.sh" "$repo_dir/client/dist" "$directory"
done
install -m 0755 "$node_binary" /opt/card-together/node
install -d -m 0700 /etc/card-together
if [[ ! -e /etc/card-together/server.env ]]; then
  install -m 0600 "$repo_dir/deploy/systemd/server.env.example" /etc/card-together/server.env
fi
install -m 0755 "$repo_dir/deploy/backup-data.sh" /opt/card-together/backup-data.sh
install -m 0644 "$repo_dir/deploy/systemd/card-together.service" /etc/systemd/system/card-together.service
install -m 0644 "$repo_dir/deploy/systemd/card-together-backup.service" \
  /etc/systemd/system/card-together-backup.service
install -m 0644 "$repo_dir/deploy/systemd/card-together-backup.timer" \
  /etc/systemd/system/card-together-backup.timer
systemd-analyze verify /etc/systemd/system/card-together.service \
  /etc/systemd/system/card-together-backup.service /etc/systemd/system/card-together-backup.timer
systemctl daemon-reload
echo 'Installed. Review /etc/card-together/server.env and migrate existing data before starting.'
echo 'Start with: sudo systemctl enable --now card-together.service'
