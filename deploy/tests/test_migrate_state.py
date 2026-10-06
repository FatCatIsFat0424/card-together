"""Verify that databases and account media move together without overwriting data."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'migrate-state.py'
SPEC = importlib.util.spec_from_file_location('migrate_state', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MigrateStateTests(unittest.TestCase):
    def test_database_and_uploaded_media_are_copied_together(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy, current = root / 'legacy', root / 'current'
            (legacy / 'media/avatars').mkdir(parents=True)
            (legacy / 'database.json').write_text('{"accounts": []}')
            (legacy / 'media/avatars/account.png').write_bytes(b'avatar-content')
            (legacy / '.metadata').write_text('metadata')
            self.assertTrue(MODULE.migrate(legacy, current))
            self.assertEqual((current / 'database.json').read_bytes(),
                             (legacy / 'database.json').read_bytes())
            self.assertEqual((current / 'media/avatars/account.png').read_bytes(), b'avatar-content')
            self.assertTrue((current / '.metadata').exists())
            self.assertEqual(current.stat().st_mode & 0o777, 0o700)
            self.assertEqual((current / 'media/avatars/account.png').stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(root.glob('.card-together-state-*')), [])

    def test_current_database_and_media_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy, current = root / 'legacy', root / 'current'
            legacy.mkdir()
            current.mkdir()
            (legacy / 'database.json').write_text('old')
            (current / 'database.json').write_text('current')
            (current / 'media').mkdir()
            (current / 'media/avatar').write_text('current avatar')
            self.assertFalse(MODULE.migrate(legacy, current))
            self.assertEqual((current / 'database.json').read_text(), 'current')
            self.assertEqual((current / 'media/avatar').read_text(), 'current avatar')

    def test_partial_destination_requires_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy, current = root / 'legacy', root / 'current'
            legacy.mkdir()
            (legacy / 'database.json').write_text('old')
            current.mkdir()
            (current / 'media').mkdir()
            with self.assertRaises(ValueError):
                MODULE.migrate(legacy, current)
            self.assertFalse((current / 'database.json').exists())

    def test_existing_empty_state_directory_can_be_migrated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy, current = root / 'legacy', root / 'current'
            legacy.mkdir()
            current.mkdir()
            (legacy / 'database.json').write_text('old')
            self.assertTrue(MODULE.migrate(legacy, current))

    def test_overlapping_directories_require_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                MODULE.migrate(root, root / 'current')
            with self.assertRaises(ValueError):
                MODULE.migrate(root, root)

    def test_symlinks_require_manual_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy, current = root / 'legacy', root / 'current'
            legacy.mkdir()
            (legacy / 'database.json').write_text('old')
            (legacy / 'media').symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                MODULE.migrate(legacy, current)
            self.assertFalse(current.exists())
            self.assertEqual(list(root.glob('.card-together-state-*')), [])


if __name__ == '__main__':
    unittest.main()
