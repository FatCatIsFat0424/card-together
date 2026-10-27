"""Check that unit sandboxing leaves every database file writable where the code expects it."""

import importlib.util
from pathlib import Path
import unittest

SYSTEMD = Path(__file__).resolve().parents[1] / 'systemd'
SPEC = importlib.util.spec_from_file_location('prepare_runtime', SYSTEMD.parent / 'prepare-runtime.py')
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)
STATE = '/var/lib/card-together'


def directives(name):
    values = {}
    for line in (SYSTEMD / name).read_text().splitlines():
        key, separator, value = line.partition('=')
        if separator and not line.startswith('#'):
            values.setdefault(key, []).append(value)
    return values


class SystemdUnitTests(unittest.TestCase):
    def test_service_can_write_both_engines_journals_and_lock_in_its_state_directory(self):
        unit = directives('card-together.service')
        self.assertEqual(unit['ProtectSystem'], ['strict'])
        # StateDirectory= makes /var/lib/card-together writable despite ProtectSystem=strict.
        self.assertEqual(unit['StateDirectory'], ['card-together'])
        self.assertNotIn('ReadOnlyPaths', unit)
        self.assertNotIn('InaccessiblePaths', unit)
        for database in RUNTIME.DATABASES.values():
            with self.subTest(database=database):
                # The -wal, -shm, and .lock files share the database's directory.
                self.assertEqual(str(Path(database).parent), STATE)

    def test_backup_reads_the_configured_engine_and_can_share_the_sqlite_index(self):
        unit = directives('card-together-backup.service')
        self.assertEqual(sorted(unit['ConditionPathExists']),
                         sorted(f'|{database}' for database in RUNTIME.DATABASES.values()))
        self.assertEqual(unit['EnvironmentFile'], ['-/etc/card-together/server.env'])
        self.assertEqual(unit['ProtectSystem'], ['strict'])
        writable = ' '.join(unit['ReadWritePaths']).split()
        self.assertIn(STATE, writable)
        self.assertIn('/var/backups/card-together', writable)
        self.assertNotIn('ReadOnlyPaths', unit)
        # setpriv drops to the database owner; the default capability set keeps that possible.
        self.assertNotIn('CapabilityBoundingSet', unit)
        self.assertNotIn('User', unit)


if __name__ == '__main__':
    unittest.main()
