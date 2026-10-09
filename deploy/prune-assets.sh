#!/usr/bin/env bash
set -euo pipefail

# Remove published frontend files that the current build no longer contains and that are
# older than the grace period. Newer files stay so browsers holding a previous entry point
# can still load their lazily imported chunks, tracks, and site emoji.
usage='Usage: prune-assets.sh BUILD_DIR SITE_DIR [GRACE_DAYS]'
build_dir=${1:?$usage}
site_dir=${2:?$usage}
grace_days=${3:-14}
if [[ ! -d $build_dir || ! -d $site_dir ]]; then
  echo "$usage" >&2
  exit 1
fi
if [[ ! $grace_days =~ ^[0-9]+$ ]]; then
  echo 'GRACE_DAYS must be a non-negative integer.' >&2
  exit 1
fi

removed=0
for subdirectory in assets provided-music provided-emoji; do
  [[ -d $site_dir/$subdirectory ]] || continue
  while IFS= read -r -d '' file; do
    name=${file##*/}
    [[ -e $build_dir/$subdirectory/$name ]] && continue
    rm -f -- "$file"
    removed=$((removed + 1))
  done < <(find "$site_dir/$subdirectory" -maxdepth 1 -type f -mtime "+$grace_days" -print0)
done
echo "Pruned $removed stale published file(s) from $site_dir."
