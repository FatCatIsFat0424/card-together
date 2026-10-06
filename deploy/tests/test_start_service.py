"""Exercise systemd startup states without changing host services."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "start-service.sh"


class StartServiceTests(unittest.TestCase):
    def run_start(self, state, failure=""):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mock = root / "systemctl"
            mock.write_text("""#!/bin/bash
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1" in
  is-failed) [[ $UNIT_STATE == failed ]];;
  reset-failed)
    [[ $UNIT_STATE == failed ]] || exit 1
    [[ $FAIL_COMMAND != reset-failed ]];;
  enable) [[ $FAIL_COMMAND != enable ]];;
  *) exit 99;;
esac
""")
            mock.chmod(0o755)
            log = root / "calls"
            environment = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "CALL_LOG": str(log),
                "UNIT_STATE": state,
                "FAIL_COMMAND": failure,
            }
            result = subprocess.run(["bash", str(SCRIPT)], env=environment,
                                    capture_output=True, text=True)
            return result.returncode, log.read_text().splitlines()

    def test_first_install_does_not_reset_unloaded_unit(self):
        status, calls = self.run_start("unloaded")
        self.assertEqual(status, 0)
        self.assertEqual(calls, ["is-failed --quiet card-together.service",
                                 "enable --now card-together.service"])

    def test_inactive_and_active_units_can_start(self):
        for state in ("inactive", "active"):
            with self.subTest(state=state):
                status, calls = self.run_start(state)
                self.assertEqual(status, 0)
                self.assertEqual(len(calls), 2)

    def test_failed_unit_resets_before_start(self):
        status, calls = self.run_start("failed")
        self.assertEqual(status, 0)
        self.assertEqual(calls, ["is-failed --quiet card-together.service",
                                 "reset-failed card-together.service",
                                 "enable --now card-together.service"])

    def test_start_failure_is_not_suppressed(self):
        status, _ = self.run_start("inactive", "enable")
        self.assertNotEqual(status, 0)

    def test_reset_failure_prevents_start(self):
        status, calls = self.run_start("failed", "reset-failed")
        self.assertNotEqual(status, 0)
        self.assertFalse(any(call.startswith("enable") for call in calls))


if __name__ == "__main__":
    unittest.main()
