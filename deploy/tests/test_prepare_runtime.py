"""Check migration of existing deployment settings without exposing their values."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'prepare-runtime.py'
SPEC = importlib.util.spec_from_file_location('prepare_runtime', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
EXAMPLE = (SCRIPT.parent / 'systemd/server.env.example').read_text()


class PrepareRuntimeTests(unittest.TestCase):
    def test_migration_preserves_extra_settings_and_comments(self):
        source = '# Operator configuration\n' + EXAMPLE.replace(
            MODULE.DATABASE, MODULE.LEGACY_DATABASE) + 'OPTIONAL_SETTING=preserved\n'
        self.assertEqual(MODULE.prepare(source, True),
                         source.replace(MODULE.LEGACY_DATABASE, MODULE.DATABASE))

    def test_existing_configuration_is_not_renamed_again(self):
        self.assertEqual(MODULE.prepare(EXAMPLE, False), EXAMPLE)

    def test_custom_database_or_proxy_settings_require_review(self):
        for source in (EXAMPLE.replace(MODULE.DATABASE, '/custom/database.json'),
                       EXAMPLE.replace('PORT=3001', 'PORT=4000'),
                       EXAMPLE.replace(MODULE.DATABASE, MODULE.LEGACY_DATABASE)):
            with self.subTest(source=source), self.assertRaises(ValueError):
                MODULE.prepare(source, False)

    def test_duplicate_and_invalid_entries_fail(self):
        for suffix in ('PORT=3001\n', 'export PORT=3001\n', 'INVALID\n'):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                MODULE.prepare(EXAMPLE + suffix, False)

    def test_current_configuration_wins_and_remains_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            current, legacy, example, output = (root / name for name in
                                                ('current', 'legacy', 'example', 'output'))
            current.write_text(EXAMPLE + 'OPTIONAL_SETTING=current\n')
            legacy.write_text('invalid legacy configuration')
            example.write_text(EXAMPLE)
            result = subprocess.run(['python3', '-B', str(SCRIPT), '--current', str(current),
                                     '--legacy', str(legacy), '--example', str(example),
                                     '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.read_text(), current.read_text())
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(legacy.read_text(), 'invalid legacy configuration')


if __name__ == '__main__':
    unittest.main()
