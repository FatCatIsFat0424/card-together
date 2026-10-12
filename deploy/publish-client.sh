#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$repo_dir/deploy/operations.sh"
configure_deployment_paths "$repo_dir" /
validate_client_publish
if [[ $EUID -ne 0 ]]; then
  exec sudo bash "$repo_dir/deploy/publish-client.sh"
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
publish_client
