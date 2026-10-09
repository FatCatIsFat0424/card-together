#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_binary="$repo_dir/.deploy/node"
if [[ ! -x $node_binary || ! -f $repo_dir/client/dist/index.html ]]; then
  echo 'Build first: npm exec --yes --package="node@$(cat .node-version)" -- bash deploy/build.sh' >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$repo_dir/deploy/deploy.sh"
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
for tool in python3 rsync nginx systemctl flock; do command -v "$tool" >/dev/null; done
exec 9>/run/lock/card-together-deploy.lock
flock -n 9 || { echo 'Another Card Together deployment is running.' >&2; exit 1; }
# Serialize migration with deployments using the previous release's lock.
exec 7>/run/lock/bridge-online-deploy.lock
flock -n 7 || { echo 'A legacy deployment is running.' >&2; exit 1; }
exec 8>/run/lock/acserver-nginx-deploy.lock
flock -n 8 || { echo 'Another shared Nginx deployment is running.' >&2; exit 1; }

site_file=$(readlink -f /etc/nginx/sites-enabled/acserver.csie.org)
test -f "$site_file"
systemctl is-active --quiet nginx
nginx -t
old_active=false
new_active=false
if systemctl is-active --quiet bridge-online.service; then old_active=true; fi
if systemctl is-active --quiet card-together.service; then new_active=true; fi
if [[ $old_active == true && $new_active == true ]]; then
  echo 'Both application services are active. Stop duplicate writers before deploying.' >&2
  exit 1
fi
if [[ $old_active == false && $new_active == false ]]; then
  python3 - <<'PY'
import socket
with socket.socket() as listener:
    try:
        listener.bind(('127.0.0.1', 3001))
    except OSError:
        raise SystemExit('Port 3001 is occupied. Resolve the conflict before deploying.')
PY
fi
if [[ -f $repo_dir/server/data/database.json && ! -f /var/lib/card-together/database.json && ! -f /var/lib/bridge-online/database.json ]]; then
  echo 'Repository data found. Stop its writer and migrate it using docs/deployment.md first.' >&2
  exit 1
fi

if [[ -f /var/lib/bridge-online/database.json && -f /var/lib/card-together/database.json && ! -f /etc/card-together/server.env ]]; then
  echo 'Both legacy and new state exist without a new runtime configuration. Review the authoritative state first.' >&2
  exit 1
fi

install -d -m 0700 /var/backups/card-together
backup_dir=$(mktemp -d "/var/backups/card-together/deploy-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
cp -p "$site_file" "$backup_dir/site.conf"
snippet=/etc/nginx/snippets/card-together.conf
http_snippet=/etc/nginx/snippets/card-together-http.conf
for directory in /etc/card-together /etc/bridge-online; do
  if [[ -d $directory ]]; then cp -a "$directory" "$backup_dir/$(basename "$directory")-config"; fi
done
for unit in card-together bridge-online; do
  systemctl is-enabled "$unit.service" > "$backup_dir/$unit.enabled" 2>/dev/null || true
  if [[ -f /etc/systemd/system/$unit.service ]]; then
    cp -p "/etc/systemd/system/$unit.service" "$backup_dir/$unit.service"
  fi
done
if [[ -f $snippet ]]; then cp -p "$snippet" "$backup_dir/snippet.conf"; fi
if [[ -f $http_snippet ]]; then cp -p "$http_snippet" "$backup_dir/http-snippet.conf"; fi
# The installed tree is only replaced by install.sh, so it can be copied while the service runs.
# Dependencies, the Node binary, and music copies are rebuilt from the matching checkout.
if [[ -d /opt/card-together ]]; then
  rsync -a --exclude='/node' --exclude='node_modules/' --exclude='provided-music/' \
    /opt/card-together/ "$backup_dir/application/"
fi
python3 "$repo_dir/deploy/configure-nginx.py" --input "$site_file" --output "$backup_dir/site.new.conf"
python3 "$repo_dir/deploy/prepare-runtime.py" \
  --current /etc/card-together/server.env --legacy /etc/bridge-online/server.env \
  --example "$repo_dir/deploy/systemd/server.env.example" --output "$backup_dir/server.new.env"

nginx_changed=false
service_changed=false
site_temp=
# Replace a file through a same-directory temporary (dot-prefixed, so Nginx globs never
# include it), keeping the target's mode and ownership.
replace_file() {
  local source=$1 target=$2
  site_temp=$(mktemp "$(dirname -- "$target")/.$(basename -- "$target").XXXXXX")
  cat -- "$source" > "$site_temp"
  chmod --reference="$target" -- "$site_temp"
  chown --reference="$target" -- "$site_temp"
  mv -f -- "$site_temp" "$target"
  site_temp=
}
on_error() {
  local status=${1:-$?}
  trap - ERR INT TERM
  if [[ -n $site_temp ]]; then rm -f -- "$site_temp"; fi
  if [[ $service_changed == true ]]; then systemctl stop card-together.service || true; fi
  if [[ $nginx_changed == true ]]; then
    replace_file "$backup_dir/site.conf" "$site_file"
    if [[ -f $backup_dir/snippet.conf ]]; then
      cp -p "$backup_dir/snippet.conf" "$snippet"
    else
      rm -f -- "$snippet"
    fi
    if [[ -f $backup_dir/http-snippet.conf ]]; then
      cp -p "$backup_dir/http-snippet.conf" "$http_snippet"
    else
      rm -f -- "$http_snippet"
    fi
    if nginx -t; then systemctl reload nginx || true; fi
  fi
  echo "Deployment failed. Backups: $backup_dir. Inspect: journalctl -u card-together -n 100" >&2
  echo 'Application services remain stopped; review data before rollback or retry.' >&2
  exit "$status"
}
trap on_error ERR
# A signal during the stopped-service window must still run the same recovery path.
trap 'on_error 130' INT
trap 'on_error 143' TERM
service_changed=true
if systemctl cat bridge-online.service >/dev/null 2>&1; then
  systemctl stop bridge-online.service
  systemctl disable bridge-online.service
fi
if systemctl cat card-together.service >/dev/null 2>&1; then systemctl stop card-together.service; fi
# Confirm graceful shutdown before reading either database or installing files.
if systemctl is-active --quiet bridge-online.service || systemctl is-active --quiet card-together.service; then
  echo 'A backend is still active; database copying is unsafe.' >&2
  on_error 1
fi
for directory in /var/lib/bridge-online /var/lib/card-together; do
  if [[ -d $directory ]]; then cp -a "$directory" "$backup_dir/$(basename "$directory")-data"; fi
done
getent passwd card-together >/dev/null || useradd --system --user-group \
  --home-dir /var/lib/card-together --no-create-home --shell /usr/sbin/nologin card-together
install -d -m 0700 /etc/card-together
if [[ ! -e /etc/card-together/server.env ]]; then
  install -m 0600 "$backup_dir/server.new.env" /etc/card-together/server.env
fi
python3 "$repo_dir/deploy/migrate-state.py" \
  --legacy /var/lib/bridge-online --current /var/lib/card-together
install -d -o card-together -g card-together -m 0700 /var/lib/card-together
chown -R card-together:card-together /var/lib/card-together
bash "$repo_dir/deploy/install.sh" "$node_binary"
bash "$repo_dir/deploy/start-service.sh"
python3 "$repo_dir/deploy/wait-for-health.py" http://127.0.0.1:3001/health
install -d -m 0755 /etc/nginx/snippets
cmp -s "$backup_dir/site.conf" "$site_file" || {
  echo 'Nginx site changed during deployment; review the concurrent change before retrying.' >&2
  on_error 1
}
nginx_changed=true
install -m 0644 "$repo_dir/deploy/nginx/card-together.conf" "$snippet"
install -m 0644 "$repo_dir/deploy/nginx/card-together-http.conf" "$http_snippet"
replace_file "$backup_dir/site.new.conf" "$site_file"
nginx -t
systemctl reload nginx
python3 "$repo_dir/deploy/wait-for-health.py" https://acserver.csie.org/card-together/health
trap - ERR INT TERM
# A missing backup schedule must not turn a healthy deployment into a failure.
systemctl enable --now card-together-backup.timer \
  || echo 'Warning: could not enable card-together-backup.timer; enable it manually.' >&2
# Retention: keep the five newest deployment snapshots (names sort chronologically).
find /var/backups/card-together -mindepth 1 -maxdepth 1 -type d -name 'deploy-*' \
  | sort | head -n -5 | while IFS= read -r stale; do rm -rf -- "$stale"; done || true
echo 'Deployed: https://acserver.csie.org/card-together/'
echo "Backups: $backup_dir"
systemctl status card-together.service --no-pager
