"""Check release validation failure propagation in an isolated checkout."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

DEPLOY = Path(__file__).resolve().parents[1]


class BuildWrapperTests(unittest.TestCase):
    def run_build(self, failure=''):
        with tempfile.TemporaryDirectory(prefix='card-build-wrapper-test-') as directory:
            root = Path(directory)
            checkout = root / 'checkout'
            commands = root / 'commands'
            (checkout / 'deploy').mkdir(parents=True)
            commands.mkdir()
            shutil.copyfile(DEPLOY / 'build.sh', checkout / 'deploy/build.sh')
            (checkout / '.node-version').write_text('24.21.0\n')
            node = commands / 'node'
            node.write_text('''#!/bin/bash
case "$*" in
  '-p process.versions.node') cat .node-version;;
  '-p process.execPath') printf '%s\\n' "$FIXTURE_NODE";;
  *) exit 99;;
esac
''')
            node.chmod(0o755)
            npm = commands / 'npm'
            npm.write_text('''#!/bin/bash
printf '%s|%s|%s|%s\\n' "$*" "${VITE_BASE_PATH-}" "${VITE_SERVER_URL-unset}" "${VITE_SOCKET_PATH-}" >> "$CALL_LOG"
if [[ $* == "$FAIL_COMMAND" ]]; then exit 7; fi
case "$*" in
  'ci --include=dev'|'run check -- release') exit 0;;
  *) echo 'Unexpected npm command' >&2; exit 99;;
esac
''')
            npm.chmod(0o755)
            calls = root / 'calls'
            clean_environment = {key: value for key, value in os.environ.items()
                                 if key not in ('VITE_BASE_PATH', 'VITE_SERVER_URL', 'VITE_SOCKET_PATH')}
            environment = {**clean_environment, 'PATH': f"{commands}:{os.environ['PATH']}",
                           'FIXTURE_NODE': str(node), 'CALL_LOG': str(calls), 'FAIL_COMMAND': failure}
            result = subprocess.run(['bash', str(checkout / 'deploy/build.sh')], env=environment,
                                    capture_output=True, text=True, timeout=10)
            log = calls.read_text().splitlines() if calls.exists() else []
            copied = checkout / '.deploy/node'
            return result, log, copied.read_bytes() if copied.exists() else None, node.read_bytes()

    def test_release_validation_receives_production_settings_and_node_is_installed_last(self):
        if os.geteuid() == 0:
            result, calls, copied, _ = self.run_build()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not root', result.stderr)
            self.assertEqual(calls, [])
            self.assertIsNone(copied)
            return
        result, calls, copied, node = self.run_build()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['ci --include=dev||unset|',
                                 'run check -- release|/card-together/||/card-together/socket.io'])
        self.assertEqual(copied, node)

    def test_install_or_validation_failure_prevents_prepared_node_artifact(self):
        for failure in ('ci --include=dev', 'run check -- release'):
            with self.subTest(failure=failure):
                result, calls, copied, _ = self.run_build(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(copied)
                if os.geteuid() != 0:
                    self.assertEqual(result.returncode, 7)
                    self.assertEqual(len(calls), 1 if failure.startswith('ci ') else 2)


if __name__ == '__main__':
    unittest.main()
