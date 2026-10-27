#!/usr/bin/env bash
set -euo pipefail

# Snapshot the database, uploaded media, and match replays while the service keeps running.
# JSON: the database is replaced by atomic rename, so one read sees a complete file.
# SQLite: VACUUM INTO copies one consistent read transaction into a single file; the copy then
# passes PRAGMA quick_check and the application's startup validation.
# Media files are content-addressed and never rewritten, so copying them after the database yields
# a superset of everything the copied database references. Replay files are written once per match,
# but retention may delete one between the copies; that match then has no replay in this snapshot,
# and files without a flagged match are swept at startup. Unchanged media and replays are
# hard-linked to the previous snapshot to keep daily copies small.
state_dir=${STATE_DIR:-/var/lib/card-together}
backup_root=${BACKUP_DIR:-/var/backups/card-together/data}
keep=${KEEP:-14}
engine=${DATABASE_ENGINE:-json}
app_dir=${APP_DIR:-/opt/card-together}
node_binary=${NODE_BINARY:-$app_dir/node}
if [[ ! $keep =~ ^[1-9][0-9]*$ ]]; then
  echo 'KEEP must be a positive integer.' >&2
  exit 1
fi
case $engine in
  json) database_name=database.json ;;
  sqlite) database_name=database.sqlite ;;
  *) echo 'DATABASE_ENGINE must be json or sqlite.' >&2; exit 1 ;;
esac
database="$state_dir/$database_name"
if [[ -n ${DATABASE_PATH:-} && $DATABASE_PATH != "$database" ]]; then
  echo "DATABASE_PATH must be $database to back it up with the state directory." >&2
  exit 1
fi
if [[ ! -f $database || -L $database ]]; then
  echo "No database found at $database" >&2
  exit 1
fi

umask 077
install -d -m 0700 "$backup_root"
exec 9>"$backup_root/.lock"
flock -n 9 || { echo 'Another data backup is running.' >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_root/data-$stamp"
staging=$(mktemp -d "$backup_root/.staging-$stamp-XXXXXX")
transient=
trap 'rm -rf -- "$staging" ${transient:+"$transient"}' EXIT

previous=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'data-*' | sort | tail -n 1)

require_space() {
  local directory=$1 needed=$2 available
  available=$(df -P -B1 -- "$directory" | awk 'NR == 2 { print $4 }')
  if [[ ! $available =~ ^[0-9]+$ ]] || (( available < needed )); then
    echo "Not enough free space in $directory for a $needed-byte database copy; snapshot skipped." >&2
    exit 1
  fi
}

backup_sqlite() {
  local needed owner group run_as=()
  needed=$(stat -c %s -- "$database")
  if [[ -f $database-wal ]]; then needed=$((needed + $(stat -c %s -- "$database-wal"))); fi
  require_space "$state_dir" "$needed"
  require_space "$backup_root" "$needed"
  # Copies left by an interrupted run; the backup lock excludes a concurrent one.
  find "$state_dir" -mindepth 1 -maxdepth 1 -type d -name '.backup-*' -exec rm -rf -- {} +
  # SQLite readers share the WAL index with the server, so the copy runs as the database owner:
  # any -wal or -shm file it creates keeps the service's ownership. That user can write only in
  # the state directory, so the copy is staged there and then moved into the snapshot.
  transient=$(mktemp -d "$state_dir/.backup-$stamp-XXXXXX")
  if [[ $EUID -eq 0 ]]; then
    owner=$(stat -c %u -- "$database")
    group=$(stat -c %g -- "$database")
    chown "$owner:$group" "$transient"
    run_as=(setpriv --reuid="$owner" --regid="$group" --clear-groups --)
  fi
  (cd "$app_dir/server" && ${run_as[@]+"${run_as[@]}"} "$node_binary" --import tsx \
    src/database/sqlite-snapshot-cli.ts backup "$database" "$transient/database.sqlite") || {
    echo 'SQLite copy failed its checks; snapshot discarded.' >&2
    exit 1
  }
  mv -- "$transient/database.sqlite" "$staging/database.sqlite"
  if [[ $EUID -eq 0 ]]; then chown 0:0 -- "$staging/database.sqlite"; fi
  chmod 0600 -- "$staging/database.sqlite"
}

if [[ $engine == sqlite ]]; then
  backup_sqlite
else
  cp -- "$database" "$staging/database.json"
  python3 -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$staging/database.json" || {
    echo 'Copied database is not valid JSON; snapshot discarded.' >&2
    exit 1
  }
fi

for directory in media replays; do
  mkdir "$staging/$directory"
  if [[ -d $state_dir/$directory ]]; then
    link_option=()
    if [[ -n $previous && -d $previous/$directory ]]; then link_option=(--link-dest="$previous/$directory"); fi
    rsync -rlt --no-owner --no-group ${link_option[@]+"${link_option[@]}"} "$state_dir/$directory/" "$staging/$directory/"
  fi
done

if [[ -e $target ]]; then
  echo "Snapshot already exists: $target" >&2
  exit 1
fi
mv -- "$staging" "$target"
echo "Backup written: $target"

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'data-*' | sort | head -n "-$keep" \
  | while IFS= read -r stale; do rm -rf -- "$stale"; done
