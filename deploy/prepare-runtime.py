#!/usr/bin/env python3
"""Prepare runtime settings without overwriting a deployed configuration."""

import argparse
import re
from pathlib import Path
import sys

LEGACY_DATABASE = '/var/lib/bridge-online/database.json'
DATABASE = '/var/lib/card-together/database.json'
REQUIRED = {
    'NODE_ENV': 'production',
    'HOST': '127.0.0.1',
    'PORT': '3001',
    'TRUST_PROXY_LOOPBACK': 'true',
    'CLIENT_ORIGIN': 'https://acserver.csie.org',
}


def prepare(source: str, legacy: bool) -> str:
    values = {}
    lines = source.splitlines(keepends=True)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        key, separator, value = stripped.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values:
            raise ValueError('Runtime configuration requires unique KEY=value entries')
        values[key] = value
        if key == 'DATABASE_PATH' and legacy and value == LEGACY_DATABASE:
            lines[index] = f'DATABASE_PATH={DATABASE}\n'
            values[key] = DATABASE
    for key, value in {**REQUIRED, 'DATABASE_PATH': DATABASE}.items():
        if values.get(key) != value:
            raise ValueError(f'Review {key} before automated deployment')
    return ''.join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current', type=Path, required=True)
    parser.add_argument('--legacy', type=Path, required=True)
    parser.add_argument('--example', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        source = args.current if args.current.exists() else (
            args.legacy if args.legacy.exists() else args.example)
        if args.output.resolve() in {path.resolve() for path in (
                args.current, args.legacy, args.example)}:
            raise ValueError('Candidate output must not overwrite runtime configuration')
        candidate = prepare(source.read_text(), source == args.legacy)
        args.output.write_text(candidate)
        args.output.chmod(0o600)
    except (OSError, ValueError) as error:
        print(f'prepare-runtime: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
