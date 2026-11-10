#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 || $# -ne 2 ]]; then
  echo 'Usage: sudo bash deploy/install-secure-deploy.sh RELEASE_CHECKOUT VERIFIED_NODE_BINARY' >&2
  exit 1
fi
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset BASH_ENV ENV PYTHONPATH PYTHONHOME NODE_OPTIONS NODE_PATH
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
checkout=$1
node_binary=$2
policy=/usr/local/lib/card-together-local-deploy
python3 -I - "$checkout" "$node_binary" "$policy" <<'PY'
from pathlib import Path
import stat
import sys
for value in sys.argv[1:]:
    candidate = Path(value)
    if not candidate.is_absolute() or candidate.resolve() != candidate:
        raise SystemExit('Use canonical absolute paths without symlinks.')
if not Path(sys.argv[2]).is_file():
    raise SystemExit('Provide an administrator-owned verified Node.js binary.')
for root in (Path(sys.argv[2]), Path(sys.argv[3])):
    for path in (*reversed(root.parents), root):
        if not path.exists():
            continue
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise SystemExit('Runtime and policy paths must be administrator-owned and not writable by others.')
policy = Path(sys.argv[3])
if policy.exists():
    for path in policy.rglob('*'):
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise SystemExit('Existing deployment policy has unsafe permissions or symlinks.')
PY
umask 077
exec 9>/run/card-together-local-deploy.lock
flock -n 9 || { echo 'A trusted deployment is running; retry after it finishes.' >&2; exit 1; }
# Administrative installation is explicit; future automated releases cannot update this policy.
install -d -o root -g root -m 0755 "$policy" "$policy/deploy" "$policy/deploy/systemd"
for name in operations.sh prune-assets.sh prepare-runtime.py migrate-state.py wait-for-health.py backup-data.sh restore-data.sh; do
  install -o root -g root -m 0644 "$repo_dir/deploy/$name" "$policy/deploy/$name"
done
for name in card-together.service card-together-backup.service card-together-backup.timer server.env.example; do
  install -o root -g root -m 0644 "$repo_dir/deploy/systemd/$name" "$policy/deploy/systemd/$name"
done
install -o root -g root -m 0755 "$node_binary" "$policy/node"
install -o root -g root -m 0644 "$repo_dir/.node-version" "$policy/.node-version"
install -o root -g root -m 0644 "$repo_dir/deploy/secure-deploy.py" "$policy/secure-deploy.py"
python3 -I - "$checkout" <<'PY'
import json
import os
from pathlib import Path
import sys
import tempfile
configuration = Path('/etc/card-together-local-deploy.json')
fd, temporary = tempfile.mkstemp(prefix='.card-together-local-deploy-', dir=configuration.parent)
try:
    with os.fdopen(fd, 'w') as stream:
        json.dump({'checkout': sys.argv[1]}, stream)
        stream.write('\n')
    os.chmod(temporary, 0o644)
    os.replace(temporary, configuration)
finally:
    Path(temporary).unlink(missing_ok=True)
PY
echo 'Trusted deployment policy installed. No application service was stopped or deployed.'
