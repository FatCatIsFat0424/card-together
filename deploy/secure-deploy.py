#!/usr/bin/env python3
"""Install fixed-checkout artifacts through an administrator-owned deployment policy."""

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile

POLICY = Path('/usr/local/lib/card-together-local-deploy')
CONFIG = Path('/etc/card-together-local-deploy.json')
LOCK = Path('/run/card-together-local-deploy.lock')
ENVIRONMENT = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root',
               'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}
FILES = ('package.json', 'tsconfig.json', '.node-version',
         'shared/package.json', 'shared/tsconfig.json',
         'server/package.json', 'server/tsconfig.json', 'client/package.json')
DIRECTORIES = ('node_modules', 'shared/src', 'server/src', 'client/dist')
OPTIONAL_DIRECTORIES = ('shared/node_modules', 'server/node_modules', 'client/node_modules')
MAX_FILES = 150_000
MAX_BYTES = 4 * 1024 ** 3


def trusted(path: Path) -> None:
    """Reject writable policy, ancestors, and symlinks before using privileged inputs."""
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Policy paths must be absolute.')
    for candidate in (*reversed(path.parents), path):
        metadata = candidate.lstat()
        if (stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_mode & 0o022):
            raise ValueError(f'Administrator-owned policy required: {candidate}')


@contextmanager
def open_directory(path: Path):
    """Pin every component without following a mutable ancestor symlink."""
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('Checkout must be a canonical absolute path.')
    descriptor = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        yield descriptor
    finally:
        os.close(descriptor)


def safe_link(relative: PurePosixPath, target: str) -> None:
    if not target or target.startswith('/'):
        raise ValueError('Artifact links must stay inside the installed application.')
    components = list(relative.parent.parts)
    for component in PurePosixPath(target).parts:
        if component == '..':
            if not components:
                raise ValueError('Artifact link escapes the installed application.')
            components.pop()
        elif component != '.':
            components.append(component)
    # Policy, build tooling and runtime are never artifact-controlled.
    if not components or components[0] not in {'node_modules', 'shared', 'server', 'client'}:
        raise ValueError('Artifact link targets an unapproved application path.')


def copy_entry(parent: int, name: str, output: Path, relative: PurePosixPath,
               budget: list[int], links: dict[tuple[int, int], list[int]], owner: int, *, allow_link: bool = True) -> None:
    metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
    budget[0] += 1
    if budget[0] > MAX_FILES:
        raise ValueError('Artifact contains too many entries.')
    if stat.S_ISLNK(metadata.st_mode):
        if not allow_link:
            raise ValueError('Artifact entry point cannot be a symlink.')
        target = os.readlink(name, dir_fd=parent)
        safe_link(relative, target)
        output.symlink_to(target)
        return
    if stat.S_ISDIR(metadata.st_mode):
        descriptor = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            output.mkdir(mode=0o755)
            for child in sorted(os.listdir(descriptor)):
                copy_entry(descriptor, child, output / child, relative / child, budget, links, owner)
        finally:
            os.close(descriptor)
        return
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner:
        raise ValueError('Artifacts must contain regular files, directories and internal links only.')
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    try:
        current = os.fstat(descriptor)
        if not stat.S_ISREG(current.st_mode) or current.st_uid != owner:
            raise ValueError('Artifact changed type or owner while copying.')
        identity = (current.st_dev, current.st_ino)
        previous = links.setdefault(identity, [current.st_nlink, 0])
        if previous[0] != current.st_nlink:
            raise ValueError('Artifact hardlinks changed while copying.')
        previous[1] += 1
        with os.fdopen(os.dup(descriptor), 'rb') as source, output.open('xb') as destination:
            while block := source.read(1024 * 1024):
                budget[1] += len(block)
                if budget[1] > MAX_BYTES:
                    raise ValueError('Artifact exceeds the installation size limit.')
                destination.write(block)
        # Never preserve setuid/setgid bits or ownership from the checkout.
        output.chmod(0o755 if current.st_mode & 0o111 else 0o644)
    finally:
        os.close(descriptor)


def snapshot(checkout: Path, destination: Path) -> None:
    budget = [0, 0]
    links = {}
    with open_directory(checkout) as root:
        owner = os.fstat(root).st_uid
        if owner == 0:
            raise ValueError('Build artifacts must belong to a non-root deployment account.')
        for relative in (*FILES, *DIRECTORIES, *OPTIONAL_DIRECTORIES):
            path = PurePosixPath(relative)
            parent = os.dup(root)
            try:
                for component in path.parts[:-1]:
                    child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                    dir_fd=parent)
                    os.close(parent)
                    parent = child
                try:
                    metadata = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    if relative in OPTIONAL_DIRECTORIES:
                        continue
                    raise
                is_directory = relative in (*DIRECTORIES, *OPTIONAL_DIRECTORIES)
                if not (stat.S_ISDIR(metadata.st_mode) if is_directory else stat.S_ISREG(metadata.st_mode)):
                    raise ValueError(f'Artifact entry point has the wrong type: {relative}')
                output = destination / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                copy_entry(parent, path.name, output, path, budget, links, owner, allow_link=False)
            finally:
                os.close(parent)
    if any(expected != copied for expected, copied in links.values()):
        raise ValueError('Artifact hardlink has a name outside the approved runtime inputs.')
    # A link chain must stay confined too; lexical checks alone do not catch redirected '..'.
    for entry in destination.rglob('*'):
        if entry.is_symlink():
            resolved = entry.resolve()
            if not resolved.is_relative_to(destination):
                raise ValueError('Artifact link chain escapes the application.')


def deploy(checkout: Path, policy: Path = POLICY) -> None:
    with tempfile.TemporaryDirectory(prefix='card-together-trusted-', dir='/var/tmp') as temporary:
        candidate = Path(temporary)
        snapshot(checkout, candidate)
        if (candidate / '.node-version').read_text().strip() != (policy / '.node-version').read_text().strip():
            raise ValueError('Node version changed; an administrator must update the deployment policy first.')
        shutil.copytree(policy / 'deploy', candidate / 'deploy', symlinks=False)
        command = ['source "$1/deploy/operations.sh"; configure_deployment_paths "$1" /; '
                   'deploy_application "$2"']
        subprocess.run(['/bin/bash', '--noprofile', '--norc', '-Eeuo', 'pipefail', '-c',
                        *command, 'card-together-local-deploy', str(candidate), str(policy / 'node')],
                       cwd='/', env=ENVIRONMENT, stdin=subprocess.DEVNULL, check=True)


def main() -> int:
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise ValueError('Run the installed helper as root without arguments.')
        os.umask(0o077)
        trusted(CONFIG)
        trusted(POLICY)
        for entry in POLICY.rglob('*'):
            trusted(entry)
        raw = json.loads(CONFIG.read_text())
        if not isinstance(raw, dict) or set(raw) != {'checkout'} or not isinstance(raw['checkout'], str):
            raise ValueError('Policy configuration requires exactly checkout.')
        with LOCK.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            deploy(Path(raw['checkout']))
        return 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'local-deploy: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
