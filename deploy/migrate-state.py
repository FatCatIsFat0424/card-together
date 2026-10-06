#!/usr/bin/env python3
"""Copy a stopped legacy backend's complete state without replacing current data."""

import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile


def migrate(legacy: Path, current: Path) -> bool:
    if legacy.is_symlink() or current.is_symlink():
        raise ValueError('State directory symbolic links require manual review')
    old_path, new_path = legacy.resolve(), current.resolve()
    if old_path == new_path or old_path in new_path.parents or new_path in old_path.parents:
        raise ValueError('Legacy and current state directories must be separate')
    if (current / 'database.json').exists() or not (legacy / 'database.json').exists():
        return False
    if current.exists() and any(current.iterdir()):
        raise ValueError('Current state contains files without a database; reconcile it before migration')
    current.parent.mkdir(parents=True, exist_ok=True)
    candidate = Path(tempfile.mkdtemp(prefix='.card-together-state-', dir=current.parent))
    try:
        for entry in legacy.rglob('*'):
            if entry.is_symlink():
                raise ValueError('Legacy state contains a symbolic link; review it before migration')
        shutil.copytree(legacy, candidate, dirs_exist_ok=True)
        for entry in candidate.rglob('*'):
            entry.chmod(0o700 if entry.is_dir() else 0o600)
        candidate.chmod(0o700)
        # An existing empty directory is safe to replace atomically on Linux.
        os.replace(candidate, current)
    finally:
        if candidate.exists():
            shutil.rmtree(candidate)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy', type=Path, required=True)
    parser.add_argument('--current', type=Path, required=True)
    args = parser.parse_args()
    try:
        migrate(args.legacy, args.current)
    except (OSError, ValueError) as error:
        print(f'migrate-state: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
