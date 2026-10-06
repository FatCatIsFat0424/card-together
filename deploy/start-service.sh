#!/usr/bin/env bash
set -euo pipefail

# A newly installed inactive unit may be unloaded; reset only retained failures.
if systemctl is-failed --quiet card-together.service; then
  systemctl reset-failed card-together.service
fi
systemctl enable --now card-together.service
