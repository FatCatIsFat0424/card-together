#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ $EUID -ne 0 || $# -ne 3 ]]; then
  echo 'Usage: sudo bash deploy/install-auto-deploy.sh USER SOURCE_CHECKOUT RELEASE_CHECKOUT' >&2
  exit 1
fi
deploy_user=$1
source_checkout=$2
release_checkout=$3
for tool in python3 git gh visudo systemctl runuser flock; do command -v "$tool" >/dev/null; done
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else "Python 3.12 or newer is required.")'

# Validate all paths and stage configuration before changing host permissions or units.
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
python3 -B - "$repo_dir" "$deploy_user" "$source_checkout" "$release_checkout" "$staging" <<'PY'
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys

repo, username, source, checkout, staging = sys.argv[1:]
if not re.fullmatch(r'[a-z_][a-z0-9_-]*', username):
    raise SystemExit('Invalid deployment username.')
user = pwd.getpwnam(username)
if user.pw_uid == 0:
    raise SystemExit('Build and polling must run as a non-root user.')
for value in (source, checkout, user.pw_dir):
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value) or Path(value).resolve() != Path(value):
        raise SystemExit('Use canonical absolute paths without whitespace or symlinks.')
if not (Path(source) / '.git').exists() or Path(checkout).exists():
    if not (Path(source) / '.git').exists():
        raise SystemExit('Source checkout is missing Git metadata.')
    if not (Path(checkout) / '.git').is_file():
        raise SystemExit('Existing release checkout must be a linked worktree.')
state = Path('/var/lib/card-together-auto-deploy')
inputs = state / 'inputs'
remote = subprocess.run(['runuser', '-u', username, '--', 'git', '-C', source,
                         'remote', 'get-url', 'origin'], capture_output=True, text=True, check=True).stdout.strip()
match = re.fullmatch(r'(?:git@github\.com:|https://github\.com/)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?', remote)
if not match:
    raise SystemExit('origin must be a GitHub SSH or HTTPS URL without embedded credentials.')
config = dict(repository=match[1], source=source, checkout=checkout,
              state_dir=str(state), music_dir=str(inputs / 'local-music'),
              emoji_dir=str(inputs / 'local-emoji'), demo_dir=str(inputs / 'local-demos'),
              frontend_env=None, workflows=['ci.yml'])
if Path(source, 'client/.env.local').exists():
    config['frontend_env'] = str(inputs / 'frontend.env')
installed = Path('/etc/card-together-auto-deploy.json')
if installed.exists():
    existing = json.loads(installed.read_text())
    if existing['source'] != source or existing['checkout'] != checkout:
        raise SystemExit('Existing configuration uses different checkouts; stop the timer and review it first.')
    if 'demo_dir' not in existing:
        # Configurations from before walkthrough videos gain the new owner input on reinstall.
        existing['demo_dir'] = config['demo_dir']
        (Path(staging) / 'config-migrated').touch()
    config = existing
stage = Path(staging)
(stage / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
spec = importlib.util.spec_from_file_location('auto_deploy', Path(repo) / 'deploy/auto-deploy.py')
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
module.load_config(stage / 'config.json')
for name in ('local-music', 'local-emoji', 'local-demos'):
    original = Path(source) / name
    if not original.is_dir() or original.is_symlink():
        raise SystemExit(f'Missing owner inputs: {name}. Create an empty directory only if intentional.')
    for path in original.rglob('*'):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise SystemExit('Owner inputs cannot contain symlinks or special files.')
    shutil.copytree(original, stage / name)
frontend = Path(source, 'client/.env.local')
if frontend.exists():
    if not frontend.is_file() or frontend.is_symlink():
        raise SystemExit('Frontend environment must be a regular file.')
    shutil.copyfile(frontend, stage / 'frontend.env')
import grp
group = grp.getgrgid(user.pw_gid).gr_name
unit = Path(repo, 'deploy/systemd/card-together-auto-deploy.service').read_text()
for key, value in (('@DEPLOY_USER@', username), ('@DEPLOY_GROUP@', group), ('@DEPLOY_HOME@', user.pw_dir)):
    unit = unit.replace(key, value)
(stage / 'service').write_text(unit)
(stage / 'sudoers').write_text(f'{username} ALL=(root) NOPASSWD: /usr/bin/bash {checkout}/deploy/deploy.sh\n')
(stage / 'group').write_text(group)
PY
visudo -cf "$staging/sudoers"
deploy_group=$(cat "$staging/group")
state_dir=/var/lib/card-together-auto-deploy

# Reinstallation updates the controller, but preserves operator settings, inputs and receipts.
systemctl stop card-together-auto-deploy.timer 2>/dev/null || true
service_state=$(systemctl show card-together-auto-deploy.service --property=ActiveState --value 2>/dev/null || true)
case $service_state in
  active|activating|reloading|deactivating)
    echo 'An automatic deployment is running. The timer is paused; wait for it to finish and rerun this installer.' >&2
    exit 1
    ;;
esac
if [[ -e $state_dir/cycle.lock ]]; then
  exec 9>>"$state_dir/cycle.lock"
  flock -n 9 || { echo 'A deployment cycle is running. Wait for it to finish and rerun this installer.' >&2; exit 1; }
fi
install -d -m 0755 /usr/local/lib/card-together-auto-deploy
install -m 0755 "$repo_dir/deploy/auto-deploy.py" /usr/local/lib/card-together-auto-deploy/auto-deploy.py
install -d -o "$deploy_user" -g "$deploy_group" -m 0700 "$state_dir" "$state_dir/inputs"
for name in local-music local-emoji local-demos; do
  if [[ ! -e $state_dir/inputs/$name ]]; then
    cp -a -- "$staging/$name" "$state_dir/inputs/$name"
    chown -R "$deploy_user:$deploy_group" "$state_dir/inputs/$name"
  fi
done
if [[ -f $staging/frontend.env && ! -e $state_dir/inputs/frontend.env ]]; then
  install -o "$deploy_user" -g "$deploy_group" -m 0600 "$staging/frontend.env" "$state_dir/inputs/frontend.env"
fi
if [[ ! -e /etc/card-together-auto-deploy.json || -e $staging/config-migrated ]]; then
  install -m 0644 "$staging/config.json" /etc/card-together-auto-deploy.json
fi
exec 9>&-

# Inspection verifies GitHub/SSH credentials as the service user without installing an application.
runuser -u "$deploy_user" -- python3 -B /usr/local/lib/card-together-auto-deploy/auto-deploy.py --inspect
if [[ ! -e $release_checkout ]]; then
  runuser -u "$deploy_user" -- git -C "$source_checkout" worktree add --detach "$release_checkout" origin/main
fi
install -m 0440 "$staging/sudoers" /etc/sudoers.d/card-together-auto-deploy
install -m 0644 "$staging/service" /etc/systemd/system/card-together-auto-deploy.service
install -m 0644 "$repo_dir/deploy/systemd/card-together-auto-deploy.timer" /etc/systemd/system/card-together-auto-deploy.timer
systemctl daemon-reload
systemctl enable --now card-together-auto-deploy.timer
echo 'Automatic deployment enabled. The first CI-approved main revision will be deployed on the next tick.'
echo 'Inspect: systemctl status card-together-auto-deploy.timer --no-pager'
echo 'Logs: journalctl -u card-together-auto-deploy.service -n 100 --no-pager'
