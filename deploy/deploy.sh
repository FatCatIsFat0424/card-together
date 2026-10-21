#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_binary="$repo_dir/.deploy/node"
if [[ ! -x $node_binary || ! -f $repo_dir/client/dist/index.html ]]; then
  echo 'Build first: python3 -B deploy/with-node.py -- bash deploy/build.sh' >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$repo_dir/deploy/deploy.sh"
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
source "$repo_dir/deploy/operations.sh"
configure_deployment_paths "$repo_dir" /
deploy_application "$node_binary"
