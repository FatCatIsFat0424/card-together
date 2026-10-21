#!/usr/bin/env bash
# Production entrypoints own privilege checks; orchestration accepts explicit paths.

configure_deployment_paths() {
  local checkout=$1 host_root=$2
  [[ $checkout == /* && $host_root == /* && -d $checkout && -d $host_root ]] || {
    echo 'Deployment paths must be existing absolute directories.' >&2
    return 1
  }
  repo_dir=$checkout
  local prefix=${host_root%/}
  application_dir="$prefix/opt/card-together"
  state_dir="$prefix/var/lib/card-together"
  legacy_state_dir="$prefix/var/lib/bridge-online"
  configuration_dir="$prefix/etc/card-together"
  legacy_configuration_dir="$prefix/etc/bridge-online"
  unit_dir="$prefix/etc/systemd/system"
  backup_root="$prefix/var/backups/card-together"
  lock_dir="$prefix/run/lock"
  nginx_site="$prefix/etc/nginx/sites-enabled/acserver.csie.org"
  snippet_dir="$prefix/etc/nginx/snippets"
  deployment_tmp="$prefix/tmp"
  site_dir="$application_dir/www/card-together"
}

start_application_service() {
  if systemctl is-failed --quiet card-together.service; then
    systemctl reset-failed card-together.service
  fi
  systemctl enable --now card-together.service
}

# Checked before any service stops so a wrong or missing build cannot cause an outage.
validate_install_artifacts() {
  local node_binary=$1
  "$node_binary" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)' || {
    echo 'Node.js 22.13 or newer is required; use Node.js 24.' >&2
    return 1
  }
  command -v rsync >/dev/null
  if [[ ! -f $repo_dir/node_modules/tsx/package.json || ! -f $repo_dir/client/dist/index.html ]]; then
    echo 'Build first: python3 -B deploy/with-node.py -- bash deploy/build.sh' >&2
    return 1
  fi
  grep -qF '/card-together/assets/' "$repo_dir/client/dist/index.html" || {
    echo 'Build the client with VITE_BASE_PATH=/card-together/ before installing (run deploy/build.sh).' >&2
    return 1
  }
}

install_application() (
  trap - ERR INT TERM
  local node_binary=$1
  validate_install_artifacts "$node_binary"
  if [[ -f $legacy_configuration_dir/server.env && ! -f $configuration_dir/server.env ]]; then
    echo 'Migrate the existing installation with deploy/deploy.sh first.' >&2
    exit 1
  fi
  if systemctl is-active --quiet bridge-online.service; then
    echo 'Stop and disable bridge-online.service before installing.' >&2
    exit 1
  fi
  getent passwd card-together >/dev/null || useradd --system --user-group \
    --home-dir "$state_dir" --no-create-home --shell /usr/sbin/nologin card-together
  if systemctl cat card-together.service >/dev/null 2>&1; then
    systemctl stop card-together.service
  fi
  local empty_dir
  empty_dir=$(mktemp -d "$deployment_tmp/card-together-install.XXXXXX")
  trap 'rm -rf -- "$empty_dir"' EXIT
  install -d -m 0755 "$application_dir"
  install -m 0644 "$repo_dir/package.json" "$application_dir/package.json"
  rsync -a --delete --chown=root:root --chmod=a+rX \
    "$repo_dir/node_modules/" "$application_dir/node_modules/"
  local workspace dependency_source subdirectory
  for workspace in shared server client; do
    install -d -m 0755 "$application_dir/$workspace"
    install -m 0644 "$repo_dir/$workspace/package.json" "$application_dir/$workspace/package.json"
    dependency_source="$repo_dir/$workspace/node_modules"
    if [[ ! -d $dependency_source ]]; then dependency_source=$empty_dir; fi
    rsync -a --delete --chown=root:root --chmod=a+rX \
      "$dependency_source/" "$application_dir/$workspace/node_modules/"
  done
  for workspace in shared server; do
    rsync -a --delete --chown=root:root --chmod=D755,F644 \
      "$repo_dir/$workspace/src/" "$application_dir/$workspace/src/"
    install -m 0644 "$repo_dir/$workspace/tsconfig.json" "$application_dir/$workspace/tsconfig.json"
  done
  install -m 0644 "$repo_dir/tsconfig.json" "$application_dir/tsconfig.json"
  install -d -m 0755 "$site_dir"
  # Old immutable resources remain available to open tabs and historical chat.
  rsync -a --delete --exclude=/assets/ --exclude=/provided-emoji/ --chown=root:root --chmod=D755,F644 \
    "$repo_dir/client/dist/" "$site_dir/"
  for subdirectory in assets provided-emoji; do
    install -d -m 0755 "$site_dir/$subdirectory"
    if [[ -d $repo_dir/client/dist/$subdirectory ]]; then
      rsync -a --chown=root:root --chmod=D755,F644 \
        "$repo_dir/client/dist/$subdirectory/" "$site_dir/$subdirectory/"
    fi
  done
  bash "$repo_dir/deploy/prune-assets.sh" "$repo_dir/client/dist" "$site_dir"
  install -m 0755 "$node_binary" "$application_dir/node"
  install -d -m 0700 "$configuration_dir"
  if [[ ! -e $configuration_dir/server.env ]]; then
    install -m 0600 "$repo_dir/deploy/systemd/server.env.example" "$configuration_dir/server.env"
  fi
  install -m 0755 "$repo_dir/deploy/backup-data.sh" "$application_dir/backup-data.sh"
  install -m 0644 "$repo_dir/deploy/systemd/card-together.service" "$unit_dir/card-together.service"
  install -m 0644 "$repo_dir/deploy/systemd/card-together-backup.service" "$unit_dir/card-together-backup.service"
  install -m 0644 "$repo_dir/deploy/systemd/card-together-backup.timer" "$unit_dir/card-together-backup.timer"
  systemd-analyze verify "$unit_dir/card-together.service" \
    "$unit_dir/card-together-backup.service" "$unit_dir/card-together-backup.timer"
  systemctl daemon-reload
  echo "Installed. Review $configuration_dir/server.env and migrate existing data before starting."
  echo 'Start with: sudo systemctl enable --now card-together.service'
)

validate_client_publish() {
  local build_dir="$repo_dir/client/dist"
  if [[ ! -f $build_dir/index.html || ! -d $build_dir/assets || ! -d $site_dir ]]; then
    echo 'Build the client and install the site before publishing its frontend.' >&2
    return 1
  fi
  if ! grep -qF '/card-together/assets/' "$build_dir/index.html"; then
    echo 'Rebuild with VITE_BASE_PATH=/card-together/ before publishing.' >&2
    return 1
  fi
  local catalog=shared/src/provided-emoji.generated.json checkout_catalog='[]' installed_catalog='[]'
  if [[ -f $repo_dir/$catalog ]]; then checkout_catalog=$(cat -- "$repo_dir/$catalog"); fi
  if [[ -f $application_dir/$catalog ]]; then installed_catalog=$(cat -- "$application_dir/$catalog"); fi
  if [[ $checkout_catalog != "$installed_catalog" ]]; then
    echo 'Site emoji changed; publish them with deploy/deploy.sh so the backend accepts them.' >&2
    return 1
  fi
}

publish_client() (
  validate_client_publish
  local build_dir="$repo_dir/client/dist" backup_dir index_temp
  exec 9>"$lock_dir/card-together-deploy.lock"
  flock -n 9 || { echo 'Another Card Together deployment is running.' >&2; exit 1; }
  install -d -m 0700 "$backup_root"
  backup_dir=$(mktemp -d "$backup_root/frontend-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  cp -p "$site_dir/index.html" "$backup_dir/index.html"
  index_temp="$site_dir/.index-publish-$$"
  trap 'rm -f -- "$index_temp"' EXIT
  # Publish assets before replacing the entry point; previous hashed files stay available.
  rsync -a --exclude=/index.html --chown=root:root --chmod=D755,F644 \
    "$build_dir/" "$site_dir/"
  install -m 0644 "$build_dir/index.html" "$index_temp"
  mv -f -- "$index_temp" "$site_dir/index.html"
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'frontend-*' \
    | sort | head -n -5 | while IFS= read -r stale; do rm -rf -- "$stale"; done || true
  find "$deployment_tmp" -mindepth 1 -maxdepth 1 -type d -name 'card-together-frontend.*' -mtime +7 \
    -exec rm -rf -- {} +
  bash "$repo_dir/deploy/prune-assets.sh" "$build_dir" "$site_dir"
  echo "Frontend published. Previous entry point: $backup_dir/index.html"
  echo 'No backend restart or Nginx reload was performed.'
)

deploy_application() (
  local node_binary=$1 site_file backup_dir snippet http_snippet directory unit
  for tool in python3 rsync nginx systemctl flock; do command -v "$tool" >/dev/null; done
  validate_install_artifacts "$node_binary"
  exec 9>"$lock_dir/card-together-deploy.lock"
  flock -n 9 || { echo 'Another Card Together deployment is running.' >&2; exit 1; }
  exec 7>"$lock_dir/bridge-online-deploy.lock"
  flock -n 7 || { echo 'A legacy deployment is running.' >&2; exit 1; }
  exec 8>"$lock_dir/acserver-nginx-deploy.lock"
  flock -n 8 || { echo 'Another shared Nginx deployment is running.' >&2; exit 1; }
  site_file=$(readlink -f "$nginx_site")
  test -f "$site_file"
  systemctl is-active --quiet nginx
  nginx -t
  local old_active=false new_active=false
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
  if [[ -f $repo_dir/server/data/database.json && ! -f $state_dir/database.json && ! -f $legacy_state_dir/database.json ]]; then
    echo 'Repository data found. Stop its writer and migrate it using docs/deployment.md first.' >&2
    exit 1
  fi
  if [[ -f $legacy_state_dir/database.json && -f $state_dir/database.json && ! -f $configuration_dir/server.env ]]; then
    echo 'Both legacy and new state exist without a new runtime configuration. Review the authoritative state first.' >&2
    exit 1
  fi
  install -d -m 0700 "$backup_root"
  backup_dir=$(mktemp -d "$backup_root/deploy-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
  cp -p "$site_file" "$backup_dir/site.conf"
  snippet="$snippet_dir/card-together.conf"
  http_snippet="$snippet_dir/card-together-http.conf"
  for directory in "$configuration_dir" "$legacy_configuration_dir"; do
    if [[ -d $directory ]]; then cp -a "$directory" "$backup_dir/$(basename "$directory")-config"; fi
  done
  for unit in card-together bridge-online; do
    systemctl is-enabled "$unit.service" > "$backup_dir/$unit.enabled" 2>/dev/null || true
    if [[ -f $unit_dir/$unit.service ]]; then cp -p "$unit_dir/$unit.service" "$backup_dir/$unit.service"; fi
  done
  if [[ -f $snippet ]]; then cp -p "$snippet" "$backup_dir/snippet.conf"; fi
  if [[ -f $http_snippet ]]; then cp -p "$http_snippet" "$backup_dir/http-snippet.conf"; fi
  # The installed tree can be backed up while serving; state is copied after shutdown.
  if [[ -d $application_dir ]]; then
    rsync -a --exclude='/node' --exclude='node_modules/' --exclude='provided-music/' \
      "$application_dir/" "$backup_dir/application/"
  fi
  python3 "$repo_dir/deploy/configure-nginx.py" --input "$site_file" --output "$backup_dir/site.new.conf"
  python3 "$repo_dir/deploy/prepare-runtime.py" \
    --current "$configuration_dir/server.env" --legacy "$legacy_configuration_dir/server.env" \
    --example "$repo_dir/deploy/systemd/server.env.example" --output "$backup_dir/server.new.env"
  local nginx_changed=false service_changed=false site_temp=

  replace_deployment_file() {
    local source=$1 target=$2
    site_temp=$(mktemp "$(dirname -- "$target")/.$(basename -- "$target").XXXXXX")
    cat -- "$source" > "$site_temp"
    chmod --reference="$target" -- "$site_temp"
    chown --reference="$target" -- "$site_temp"
    mv -f -- "$site_temp" "$target"
    site_temp=
  }

  deployment_error() {
    local status=${1:-$?}
    trap - ERR INT TERM
    if [[ -n $site_temp ]]; then rm -f -- "$site_temp"; fi
    if [[ $service_changed == true ]]; then systemctl stop card-together.service || true; fi
    if [[ $nginx_changed == true ]]; then
      replace_deployment_file "$backup_dir/site.conf" "$site_file"
      if [[ -f $backup_dir/snippet.conf ]]; then cp -p "$backup_dir/snippet.conf" "$snippet";
      else rm -f -- "$snippet"; fi
      if [[ -f $backup_dir/http-snippet.conf ]]; then cp -p "$backup_dir/http-snippet.conf" "$http_snippet";
      else rm -f -- "$http_snippet"; fi
      if nginx -t; then systemctl reload nginx || true; fi
    fi
    echo "Deployment failed. Backups: $backup_dir. Inspect: journalctl -u card-together -n 100" >&2
    echo 'Application services remain stopped; review data before rollback or retry.' >&2
    exit "$status"
  }

  trap deployment_error ERR
  trap 'deployment_error 130' INT
  trap 'deployment_error 143' TERM
  service_changed=true
  if systemctl cat bridge-online.service >/dev/null 2>&1; then
    systemctl stop bridge-online.service
    systemctl disable bridge-online.service
  fi
  if systemctl cat card-together.service >/dev/null 2>&1; then systemctl stop card-together.service; fi
  if systemctl is-active --quiet bridge-online.service || systemctl is-active --quiet card-together.service; then
    echo 'A backend is still active; database copying is unsafe.' >&2
    deployment_error 1
  fi
  for directory in "$legacy_state_dir" "$state_dir"; do
    if [[ -d $directory ]]; then cp -a "$directory" "$backup_dir/$(basename "$directory")-data"; fi
  done
  getent passwd card-together >/dev/null || useradd --system --user-group \
    --home-dir "$state_dir" --no-create-home --shell /usr/sbin/nologin card-together
  install -d -m 0700 "$configuration_dir"
  if [[ ! -e $configuration_dir/server.env ]]; then install -m 0600 "$backup_dir/server.new.env" "$configuration_dir/server.env"; fi
  python3 "$repo_dir/deploy/migrate-state.py" --legacy "$legacy_state_dir" --current "$state_dir"
  install -d -o card-together -g card-together -m 0700 "$state_dir"
  chown -R card-together:card-together "$state_dir"
  install_application "$node_binary"
  start_application_service
  python3 "$repo_dir/deploy/wait-for-health.py" http://127.0.0.1:3001/health
  install -d -m 0755 "$snippet_dir"
  cmp -s "$backup_dir/site.conf" "$site_file" || {
    echo 'Nginx site changed during deployment; review the concurrent change before retrying.' >&2
    deployment_error 1
  }
  nginx_changed=true
  install -m 0644 "$repo_dir/deploy/nginx/card-together.conf" "$snippet"
  install -m 0644 "$repo_dir/deploy/nginx/card-together-http.conf" "$http_snippet"
  replace_deployment_file "$backup_dir/site.new.conf" "$site_file"
  nginx -t
  systemctl reload nginx
  python3 "$repo_dir/deploy/wait-for-health.py" https://acserver.csie.org/card-together/health
  trap - ERR INT TERM
  systemctl enable --now card-together-backup.timer \
    || echo 'Warning: could not enable card-together-backup.timer; enable it manually.' >&2
  find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'deploy-*' \
    | sort | head -n -5 | while IFS= read -r stale; do rm -rf -- "$stale"; done || true
  echo 'Deployed: https://acserver.csie.org/card-together/'
  echo "Backups: $backup_dir"
  systemctl status card-together.service --no-pager
)
