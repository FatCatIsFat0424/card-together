#!/usr/bin/env bash
set -euo pipefail

# Build as the deployment user first; this script only installs prepared artifacts.
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
node_binary=${1:?Usage: sudo bash deploy/install.sh /absolute/path/to/node}
if [[ $EUID -ne 0 || $node_binary != /* || ! -x $node_binary ]]; then
  echo 'Run as root with an absolute executable Node path.' >&2
  exit 1
fi
source "$repo_dir/deploy/operations.sh"
configure_deployment_paths "$repo_dir" /
install_application "$node_binary"
