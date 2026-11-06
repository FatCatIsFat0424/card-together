#!/usr/bin/env bash
set -Eeuo pipefail

# The administrator-owned helper selects the checkout; never run release scripts as root.
if [[ $# -ne 0 ]]; then
  echo 'Usage: bash deploy/deploy.sh' >&2
  exit 1
fi
exec sudo /usr/bin/python3 -I /usr/local/lib/card-together-local-deploy/secure-deploy.py
