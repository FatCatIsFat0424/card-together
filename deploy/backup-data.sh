#!/usr/bin/env bash
set -euo pipefail

# Snapshot the database and uploaded media while the service keeps running.
# The database is replaced by atomic rename, so one read sees a complete file. Media files are
# content-addressed and never rewritten, so copying them after the database yields a superset
# of everything the copied database references. Unchanged media is hard-linked to the previous
# snapshot to keep daily copies small.
state_dir=${STATE_DIR:-/var/lib/card-together}
backup_root=${BACKUP_DIR:-/var/backups/card-together/data}
keep=${KEEP:-14}
if [[ ! $keep =~ ^[1-9][0-9]*$ ]]; then
  echo 'KEEP must be a positive integer.' >&2
  exit 1
fi
if [[ ! -f $state_dir/database.json ]]; then
  echo "No database found at $state_dir/database.json" >&2
  exit 1
fi

umask 077
install -d -m 0700 "$backup_root"
exec 9>"$backup_root/.lock"
flock -n 9 || { echo 'Another data backup is running.' >&2; exit 1; }

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_root/data-$stamp"
staging=$(mktemp -d "$backup_root/.staging-$stamp-XXXXXX")
trap 'rm -rf -- "$staging"' EXIT

previous=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'data-*' | sort | tail -n 1)

cp -- "$state_dir/database.json" "$staging/database.json"
python3 -c 'import json, sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$staging/database.json" || {
  echo 'Copied database is not valid JSON; snapshot discarded.' >&2
  exit 1
}

mkdir "$staging/media"
if [[ -d $state_dir/media ]]; then
  link_option=()
  if [[ -n $previous && -d $previous/media ]]; then link_option=(--link-dest="$previous/media"); fi
  rsync -rlt --no-owner --no-group ${link_option[@]+"${link_option[@]}"} "$state_dir/media/" "$staging/media/"
fi

if [[ -e $target ]]; then
  echo "Snapshot already exists: $target" >&2
  exit 1
fi
mv -- "$staging" "$target"
echo "Backup written: $target"

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name 'data-*' | sort | head -n "-$keep" \
  | while IFS= read -r stale; do rm -rf -- "$stale"; done
