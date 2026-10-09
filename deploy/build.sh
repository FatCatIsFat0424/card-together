#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"
if [[ $EUID -eq 0 ]]; then
  echo 'Build as the deployment user, not root.' >&2
  exit 1
fi
expected_node=$(tr -d '[:space:]' < .node-version)
[[ $(node -p 'process.versions.node') == "$expected_node" ]] || {
  echo "Use Node.js $expected_node: npm exec --yes --package=node@$expected_node -- bash deploy/build.sh" >&2
  exit 1
}
for script in deploy/*.sh; do bash -n "$script"; done
python3 -B -m unittest discover -s deploy/tests
npm ci --include=dev
npm run typecheck
npm run lint
npm test
VITE_BASE_PATH=/card-together/ VITE_SERVER_URL='' VITE_SOCKET_PATH=/card-together/socket.io npm run build:client
install -d -m 0755 .deploy
install -m 0755 "$(node -p 'process.execPath')" .deploy/node
echo 'Build ready. Deploy with: bash deploy/deploy.sh'
