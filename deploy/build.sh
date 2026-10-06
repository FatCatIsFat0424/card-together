#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"
if [[ $EUID -eq 0 ]]; then
  echo 'Build as the deployment user, not root.' >&2
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 13)) process.exit(1)' || {
  echo 'Use Node.js 24: npm exec --yes --package=node@24 -- bash deploy/build.sh' >&2
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
