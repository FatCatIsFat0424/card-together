#!/usr/bin/env bash
set -euo pipefail

# Restores a data snapshot (database, media, and replays together) into the stopped service's state
# directory. The snapshot must hold the database of the configured engine and pass the same checks
# as a backup; the current state is copied aside first. The service is left stopped.
state_dir=${STATE_DIR:-/var/lib/card-together}
backup_root=${BACKUP_DIR:-/var/backups/card-together}
config_file=${CONFIG_FILE:-/etc/card-together/server.env}
app_dir=${APP_DIR:-/opt/card-together}
node_binary=${NODE_BINARY:-$app_dir/node}
service=${SERVICE:-card-together.service}

if [[ $# -ne 1 ]]; then
  echo 'Usage: restore-data.sh <snapshot directory>' >&2
  exit 1
fi
if [[ -L $1 || ! -d $1 ]]; then
  echo 'The snapshot must be a directory, not a symbolic link.' >&2
  exit 1
fi
snapshot=$(cd -- "$1" && pwd -P)

if systemctl is-active --quiet "$service"; then
  echo "Stop the service first: sudo systemctl stop $service" >&2
  exit 1
fi
for lock in "$state_dir/database.json.lock" "$state_dir/database.sqlite.lock"; do
  if [[ -e $lock ]]; then
    echo "$lock exists; a process may still own the database. See docs/storage.md before restoring." >&2
    exit 1
  fi
done

if [[ ! -f $config_file ]]; then
  echo "Runtime configuration not found: $config_file" >&2
  exit 1
fi
engine=$(sed -n 's/^DATABASE_ENGINE=//p' "$config_file" | tail -n 1)
case ${engine:-json} in
  json) database_name=database.json; other_name=database.sqlite ;;
  sqlite) database_name=database.sqlite; other_name=database.json ;;
  *) echo "DATABASE_ENGINE in $config_file must be json or sqlite." >&2; exit 1 ;;
esac
if [[ ! -f $snapshot/$database_name || -L $snapshot/$database_name ]]; then
  if [[ -f $snapshot/$other_name ]]; then
    echo "The snapshot holds $other_name, but $config_file selects $database_name. Restore a matching snapshot or switch the engine first." >&2
  else
    echo "The snapshot has no $database_name." >&2
  fi
  exit 1
fi
for suffix in -wal -shm -journal; do
  # A journal beside the copy means it is not a complete single file; opening it would also change it.
  if [[ -e $snapshot/$database_name$suffix ]]; then
    echo "The snapshot has $database_name$suffix and is not a complete single-file copy; use a data-* snapshot." >&2
    exit 1
  fi
done
for directory in media replays; do
  if [[ -L $snapshot/$directory || ! -d $snapshot/$directory ]]; then
    echo "The snapshot has no $directory/ directory; restore complete snapshots only." >&2
    exit 1
  fi
done
if [[ -n $(find "$snapshot/media" "$snapshot/replays" -type l -print -quit) ]]; then
  echo 'The snapshot contains symbolic links; review it before restoring.' >&2
  exit 1
fi

# The schema must be one this version can start from; the checks never modify the snapshot.
(cd "$app_dir/server" && "$node_binary" --import tsx src/database/sqlite-snapshot-cli.ts verify "$snapshot/$database_name") || {
  echo 'The snapshot database failed its checks; nothing was restored.' >&2
  exit 1
}

umask 077
install -d -m 0700 "$backup_root"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous_state=$(mktemp -d "$backup_root/pre-restore-$stamp-XXXXXX")
cp -a -- "$state_dir/." "$previous_state/"
echo "Current state copied to $previous_state"

owner=$(stat -c %u -- "$state_dir")
group=$(stat -c %g -- "$state_dir")
ownership=()
if [[ $EUID -eq 0 ]]; then ownership=(-o "$owner" -g "$group"); fi

# Journals of the replaced database would be applied to the restored file, so they go too.
rm -f -- "$state_dir/$database_name-wal" "$state_dir/$database_name-shm" "$state_dir/$database_name-journal"
install -m 0600 ${ownership[@]+"${ownership[@]}"} -- "$snapshot/$database_name" "$state_dir/.$database_name.restore"
mv -f -- "$state_dir/.$database_name.restore" "$state_dir/$database_name"
for directory in media replays; do
  rsync_options=(-rlt --delete --chmod=D700,F600)
  if [[ $EUID -eq 0 ]]; then rsync_options+=(--chown="$owner:$group"); fi
  rsync "${rsync_options[@]}" "$snapshot/$directory/" "$state_dir/$directory/"
done

echo "Restored $database_name, media/, and replays/ from $snapshot."
echo "Start one service and verify login, history, replays, friends, media, and resume: sudo systemctl start $service"
