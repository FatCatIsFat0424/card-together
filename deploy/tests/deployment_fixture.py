"""Run sourced orchestration with guarded filesystem tools and host-service doubles."""

import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile

DEPLOY = Path(__file__).resolve().parents[1]
TOOLS = ('bash', 'basename', 'cat', 'chmod', 'chown', 'cmp', 'cp', 'date', 'dirname',
         'find', 'flock', 'getent', 'grep', 'head', 'install', 'mkdir', 'mktemp', 'mv',
         'nginx', 'python3', 'readlink', 'rm', 'rsync', 'sort', 'systemctl',
         'systemd-analyze', 'tail', 'useradd')

DISPATCH = r'''#!/bin/bash
set -euo pipefail
export LC_ALL=C
__FIXTURE_SETUP__
name=${0##*/}
args=("$@")
cd -- "$root"

reject() { printf '%s\n' "$1" >&2; exit 1; }
json_string() {
    local value=$1 character escaped code
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    if [[ $value =~ [[:cntrl:]] ]]; then
        escaped=
        for ((code=0; code<${#value}; code++)); do
            character=${value:code:1}
            if [[ $character =~ [[:cntrl:]] ]]; then
                printf -v character '\\u%04x' "'$character"
            fi
            escaped+=$character
        done
        value=$escaped
    fi
    printf -v escaped_string '"%s"' "$value"
}
# Build one log record before writing so commands in pipelines cannot interleave it.
json_string "$name"
record=$escaped_string
for argument in "${args[@]}"; do
    json_string "$argument"
    record+=", $escaped_string"
done
printf '[%s]\n' "$record" >> "$root/commands.jsonl"

paths=()
path_arguments=("${args[@]}")
if [[ $name == grep ]]; then
    [[ ${#args[@]} == 3 && ${args[0]} == -qF ]] || reject 'Unexpected grep operation'
    path_arguments=("${args[2]}")
fi
end_options=false
for argument in "${path_arguments[@]}"; do
    if [[ $end_options == false && $argument == -* ]]; then
        case $name:$argument in
            *:--) end_options=true ;;
            install:-d|install:-m|install:-o|install:-g|mkdir:-p|mktemp:-d|chmod:--reference=*|chown:--reference=*|chown:-R|\
            cp:-a|cp:-p|mv:-f|rm:-rf|rm:-f|readlink:-f|cmp:-s|flock:-n|head:-n|tail:-n|\
            rsync:-a|rsync:--delete|rsync:--exclude=*|rsync:--chown=*|rsync:--chmod=a+rX|rsync:--chmod=D755,F644|rsync:--link-dest=*|\
            find:-mindepth|find:-maxdepth|find:-type|find:-name|find:-mtime|find:-print0|find:-exec|find:-rf|\
            python3:--input|python3:--output|python3:--current|python3:--legacy|python3:--example|\
            systemctl:--quiet|systemctl:--now|systemctl:--no-pager|nginx:-t|date:-u|\
            useradd:--system|useradd:--user-group|useradd:--home-dir=*|useradd:--no-create-home|useradd:--shell) ;;
            head:-*|tail:-*) [[ $argument =~ ^-[0-9]+$ ]] || reject 'Unexpected line count' ;;
            *) reject "Unexpected fixture option: $name $argument" ;;
        esac
        if [[ $argument == --reference=* || $argument == --link-dest=* || $argument == --home-dir=* ]]; then
            paths+=("${argument#*=}")
        fi
    else
        if [[ $name == rsync ]]; then
            [[ $argument != *://* && ! $argument =~ ^[^/]*: ]] || reject 'Unexpected remote rsync path'
        fi
        if [[ $argument != *://* ]]; then paths+=("$argument"); fi
    fi
done
if [[ $name == find ]]; then
    for index in "${!args[@]}"; do
        if [[ ${args[index]} == -exec ]]; then
            [[ ${args[*]:index} == '-exec rm -rf -- {} +' ]] || reject 'Unexpected find execution'
        fi
    done
fi
if [[ $name == flock ]]; then
    [[ ${#args[@]} == 2 && ${args[0]} == -n ]] || reject 'Unexpected lock operation'
    [[ ${args[-1]} =~ ^[0-9]+$ ]] || reject 'Unexpected lock descriptor'
    [[ -f /proc/$$/fd/${args[-1]} ]] || reject 'Lock descriptor must refer to a regular fixture file'
    paths+=("/proc/$$/fd/${args[-1]}")
fi
if ((${#paths[@]})); then
    resolved=0
    resolver_status=1
    while IFS= read -r -d '' path; do
        if [[ -z $path ]]; then
            IFS= read -r -d '' resolver_status || resolver_status=1
            break
        fi
        [[ $path == "$root" || $path == "$root/"* ]] || reject "Out-of-root fixture path: $path"
        ((resolved+=1))
    done < <(
        status=0
        "$realpath" -zm -- "${paths[@]}" || status=$?
        printf '\0%s\0' "$status"
    )
    [[ $resolver_status == 0 && $resolved == ${#paths[@]} ]] || reject 'Could not resolve fixture paths'
fi

failure=${FAIL_COMMAND:-}
rendered=$name
if ((${#args[@]})); then rendered+=" ${args[*]}"; fi
printf '%s\0' "$rendered" >> "$root/command-occurrences"
if [[ -n $failure && $rendered == "$failure"* ]]; then
    matches=0
    while IFS= read -r -d '' prior; do
        if [[ $prior == "$failure"* ]]; then ((matches+=1)); fi
    done < "$root/command-occurrences"
    if [[ $matches == ${FAIL_OCCURRENCE:-1} ]]; then exit 7; fi
fi
write_service_state() {
    local contents= separator= entry
    for entry in "$@"; do contents+="$separator$entry"; separator=$'\n'; done
    printf '%s' "$contents" > "$root/service-state"
}
case $name in
    bash)
        [[ ${args[0]:-} == "$root/checkout/deploy/prune-assets.sh" &&
           (${#args[@]} == 3 || ${#args[@]} == 4) ]] || reject 'Unexpected Bash script' ;;
    systemctl)
        mapfile -t active < "$root/service-state"
        operation=${args[0]}
        unit=
        if ((${#args[@]} > 1)); then unit=${args[-1]}; fi
        case $operation in
            is-active)
                if [[ $unit == nginx ]]; then exit 0; fi
                for entry in "${active[@]}"; do [[ $entry != "$unit" ]] || exit 0; done
                exit 3 ;;
            is-failed) exit 1 ;;
            cat|is-enabled) exit 0 ;;
            stop)
                remaining=()
                for entry in "${active[@]}"; do
                    if [[ $entry != "$unit" ]]; then remaining+=("$entry"); fi
                done
                write_service_state "${remaining[@]}" ;;
            enable)
                if [[ $unit == *.service ]]; then
                    write_service_state "${active[@]}" "$unit"
                fi ;;
            disable|reset-failed|reload|daemon-reload|status) ;;
            *) reject 'Unexpected systemctl operation' ;;
        esac
        exit 0 ;;
    nginx|systemd-analyze)
        expected=-t
        if [[ $name == systemd-analyze ]]; then expected=verify; fi
        [[ ${args[0]:-} == "$expected" ]] || reject 'Unexpected service validator operation'
        exit 0 ;;
    getent|useradd|chown) exit 0 ;;
    date) printf '%s\n' "${FIXTURE_STAMP:-20261012T000000Z}"; exit 0 ;;
    python3)
        [[ ${args[0]:--} != - ]] || reject 'Unexpected inline Python execution'
        case ${args[0]} in
            "$root/checkout/deploy/configure-nginx.py"|"$root/checkout/deploy/prepare-runtime.py"|\
            "$root/checkout/deploy/migrate-state.py"|"$root/checkout/deploy/wait-for-health.py") ;;
            *) reject 'Unexpected Python script' ;;
        esac
        script=${args[0]##*/}
        if [[ $script == wait-for-health.py ]]; then
            [[ ${#args[@]} == 2 ]] || reject 'Unexpected health URL'
            [[ ${args[1]} == http://127.0.0.1:3001/health ||
               ${args[1]} == https://acserver.csie.org/card-together/health ]] || reject 'Unexpected health URL'
            if [[ -n ${SIGNAL_AT_HEALTH:-} && ${args[1]} == "${SIGNAL_HEALTH_URL:-${args[1]}}" ]]; then
                kill -s "$SIGNAL_AT_HEALTH" "$PPID"
            fi
            exit 0
        fi
        ;;
    install)
        filtered=()
        skip=false
        for argument in "${args[@]}"; do
            if [[ $skip == true ]]; then skip=false
            elif [[ $argument == -o || $argument == -g ]]; then skip=true
            else filtered+=("$argument"); fi
        done
        args=("${filtered[@]}") ;;
    rsync)
        filtered=()
        for argument in "${args[@]}"; do
            if [[ $argument != --chown=* ]]; then filtered+=("$argument"); fi
        done
        args=("${filtered[@]}") ;;
esac
[[ -v 'executables[$name]' ]] || reject "Undeclared fixture command: $name"
exec "${executables[$name]}" "${args[@]}"
'''


class DeploymentFixture:
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='card-deployment-test-')
        self.root = Path(self.temporary.name)
        self.checkout = self.root / 'checkout'
        self.host = self.root / 'host'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        shutil.copytree(DEPLOY, self.checkout / 'deploy', ignore=shutil.ignore_patterns('tests'))
        self.application = self.host / 'opt/card-together'
        self.state = self.host / 'var/lib/card-together'
        self.site = self.application / 'www/card-together'
        for directory in ('run/lock', 'tmp', 'etc/nginx/sites-enabled', 'etc/nginx/snippets',
                          'etc/systemd/system', 'var/lib/card-together', 'etc/card-together'):
            (self.host / directory).mkdir(parents=True, exist_ok=True)
        self.executables = {name: shutil.which(name) for name in TOOLS if shutil.which(name)}
        realpath = shutil.which('realpath')
        if realpath is None:
            raise RuntimeError('Deployment tests require the coreutils realpath command')
        setup = '\n'.join((
            'root=' + shlex.quote(str(self.root.resolve())),
            'realpath=' + shlex.quote(realpath),
            'declare -A executables=(' + ' '.join(
                '[' + name + ']=' + shlex.quote(path) for name, path in self.executables.items()) + ')',
        ))
        dispatcher = self.bin / 'dispatcher'
        dispatcher.write_text(DISPATCH.replace('__FIXTURE_SETUP__', setup))
        dispatcher.chmod(0o755)
        for name in TOOLS:
            os.link(dispatcher, self.bin / name)
        self.node = self.checkout / '.deploy/node'
        self.node.parent.mkdir()
        self.node.write_text('#!/bin/bash\nexit 0\n')
        self.node.chmod(0o755)
        for workspace in ('shared', 'server', 'client'):
            target = self.checkout / workspace
            target.mkdir()
            (target / 'package.json').write_text('{}')
            (target / 'tsconfig.json').write_text('{}')
            (target / 'src').mkdir()
            (target / 'src/module.ts').write_text('export {};')
        (self.checkout / 'package.json').write_text('{}')
        (self.checkout / 'tsconfig.json').write_text('{}')
        (self.checkout / 'node_modules/tsx').mkdir(parents=True)
        (self.checkout / 'node_modules/tsx/package.json').write_text('{}')
        (self.checkout / 'client/dist/assets').mkdir(parents=True)
        (self.checkout / 'client/dist/assets/new.js').write_text('new asset')
        (self.checkout / 'client/dist/index.html').write_text('/card-together/assets/new.js')
        (self.checkout / 'shared/src/provided-emoji.generated.json').write_text('[]')
        self.site.mkdir(parents=True)
        (self.site / 'assets').mkdir()
        (self.site / 'assets/old.js').write_text('old asset')
        (self.site / 'index.html').write_text('old entry')
        (self.application / 'shared/src').mkdir(parents=True)
        (self.application / 'shared/src/provided-emoji.generated.json').write_text('[]')
        (self.root / 'service-state').write_text('card-together.service')
        (self.state / 'database.json').write_text('{"schemaVersion": 5}')
        (self.host / 'etc/card-together/server.env').write_text(
            (self.checkout / 'deploy/systemd/server.env.example').read_text())
        (self.host / 'etc/nginx/sites-enabled/acserver.csie.org').write_text('''server {
  listen 192.168.10.10:80;
  server_name acserver.csie.org;
  location /unrelated { return 204; }
}
server {
  listen 192.168.10.10:443 ssl;
  server_name acserver.csie.org;
  ssl_certificate /etc/cert.pem;
  location /unrelated { return 204; }
}
''')

    def close(self):
        self.temporary.cleanup()

    def environment(self, **changes):
        return {**os.environ, 'PATH': str(self.bin), 'FIXTURE_ROOT': str(self.root),
                **changes}

    def run(self, function, *, stub_install=False, **changes):
        if function not in ('install_application', 'publish_client', 'deploy_application'):
            raise ValueError('Unknown orchestration function')
        if stub_install and function != 'deploy_application':
            raise ValueError('Only deployment recovery may isolate the installer boundary')
        orchestration = 'source "$1/deploy/operations.sh"; configure_deployment_paths "$1" "$2"; '
        if stub_install:
            # Installation has its own filesystem cases; recovery only needs its completion.
            orchestration += ('install_application() { '
                              'printf \'["install_application", "%s"]\\n\' "$1" '
                              '>> "$FIXTURE_ROOT/commands.jsonl"; }; ')
        orchestration += '"$3" "$4"'
        return subprocess.run([
            '/bin/bash', '-Eeuo', 'pipefail', '-c',
            orchestration,
            'deployment-fixture', str(self.checkout), str(self.host), function, str(self.node),
        ], cwd=self.root, env=self.environment(**changes), capture_output=True, text=True, timeout=15)

    def calls(self):
        path = self.root / 'commands.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
