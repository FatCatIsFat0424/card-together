"""Exercise backup and frontend retention scripts in temporary directories."""

import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
ROOT = DEPLOY.parent
DAY = 24 * 60 * 60
PASSWORD_HASH = 'scrypt$131072$8$1$' + 'ab' * 16 + '$' + 'cd' * 64


def find_node():
    """Node.js 24 with installed dependencies runs the application's SQLite checks."""
    candidate = os.environ.get('CARD_TOGETHER_NODE') or shutil.which('node')
    if not candidate or not (ROOT / 'node_modules/tsx/package.json').exists():
        return None
    check = subprocess.run([candidate, '-e', 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'],
                           capture_output=True)
    return candidate if check.returncode == 0 else None


NODE = find_node()


def json_database(usernames=('alice',)):
    accounts = [{'id': f'account-{name}', 'username': name, 'usernameNormalized': name, 'nickname': name,
                 'color': '#123456', 'avatar': 'cat', 'avatarImage': None, 'tableBackground': None,
                 'tableBackgroundOpacity': 100, 'cardBack': None, 'cardBackOpacity': 100,
                 'matchesPublic': True, 'passwordHash': PASSWORD_HASH, 'createdAt': 1, 'updatedAt': 1}
                for name in usernames]
    return {'schemaVersion': 7, 'accounts': accounts, 'sessions': [], 'friendships': [], 'matches': [],
            'emojis': [], 'directMessages': [], 'messageReads': [], 'friendNotifications': [],
            'runtime': None}


def make_sqlite_database(path, names=('alice',)):
    """Builds a Card Together SQLite database with the application's own migration tool."""
    source = path.with_name('database.json')
    source.write_text(json.dumps(json_database(names)))
    result = subprocess.run([NODE, '--import', 'tsx', 'src/database/migrate-sqlite-cli.ts', str(source), str(path),
                             '--apply', '--writers-stopped'], cwd=ROOT / 'server', capture_output=True, text=True)
    source.unlink()
    if result.returncode != 0:
        raise AssertionError(result.stderr)


def usernames(path):
    connection = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    try:
        return [row[0] for row in connection.execute('SELECT username_normalized FROM accounts ORDER BY seq')]
    finally:
        connection.close()


def damage(path):
    """Overwrites every page after the header, so the file opens but its tables are unreadable."""
    with path.open('r+b') as database:
        size = database.seek(0, 2)
        database.seek(4096)
        database.write(b'\xab' * (size - 4096))


def fake_commands(directory, active=False):
    """Fixed timestamps and a systemctl that reports the service as stopped (or running)."""
    commands = Path(directory)
    (commands / 'date').write_text('#!/bin/sh\nprintf "%s\\n" "$FIXTURE_STAMP"\n')
    (commands / 'systemctl').write_text(f'#!/bin/sh\nexit {0 if active else 3}\n')
    for name in ('date', 'systemctl'):
        (commands / name).chmod(0o755)
    return commands


def age(path, days):
    stamp = time.time() - days * DAY
    os.utime(path, (stamp, stamp))


class PruneAssetsTests(unittest.TestCase):
    def run_prune(self, build, site, *extra):
        return subprocess.run(["bash", str(DEPLOY / "prune-assets.sh"), str(build), str(site), *extra],
                              capture_output=True, text=True)

    def test_only_stale_files_missing_from_each_build_directory_are_removed(self):
        for subdirectory in ("assets", "provided-emoji", "provided-music"):
            with self.subTest(subdirectory=subdirectory), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                build, site = root / "build", root / "site"
                for base in (build, site):
                    (base / subdirectory).mkdir(parents=True)
                (build / subdirectory / "current file").write_text("new")
                for name, days in (("current file", 40), ("old stale file", 40), ("old recent file", 2)):
                    path = site / subdirectory / name
                    path.write_text(name)
                    age(path, days)
                (site / "index.html").write_text("entry")
                age(site / "index.html", 40)

                result = self.run_prune(build, site)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(sorted(path.name for path in (site / subdirectory).iterdir()),
                                 ["current file", "old recent file"])
                self.assertEqual((site / "index.html").read_text(), "entry")

    def test_invalid_arguments_fail_without_deleting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "assets").mkdir()
            (root / "assets" / "file.js").write_text("x")
            age(root / "assets" / "file.js", 40)
            self.assertNotEqual(self.run_prune(root, root, "abc").returncode, 0)
            self.assertNotEqual(self.run_prune(root / "missing", root).returncode, 0)
            self.assertTrue((root / "assets" / "file.js").exists())


class BackupDataTests(unittest.TestCase):
    def run_backup(self, state, backups, keep="14", stamp="20261012T000000Z", failure=""):
        with tempfile.TemporaryDirectory(prefix="backup-command-test-") as directory:
            commands = Path(directory)
            date = commands / "date"
            date.write_text('#!/bin/sh\nprintf "%s\\n" "$FIXTURE_STAMP"\n')
            date.chmod(0o755)
            if failure:
                self.assertIn(failure, ("cp", "rsync"))
                command = commands / failure
                command.write_text('#!/bin/sh\nexit 7\n')
                command.chmod(0o755)
            environment = {**os.environ, "STATE_DIR": str(state), "BACKUP_DIR": str(backups),
                           "KEEP": keep, "FIXTURE_STAMP": stamp,
                           "PATH": f"{commands}:{os.environ['PATH']}"}
            return subprocess.run(["bash", str(DEPLOY / "backup-data.sh")], env=environment,
                                  capture_output=True, text=True, timeout=10)

    def make_state(self, root):
        state = root / "state"
        (state / "media").mkdir(parents=True)
        (state / "database.json").write_text('{"schemaVersion": 3}')
        (state / "media" / "a.png").write_bytes(b"image-a")
        marker = state / "media/owners/account/a.png"
        marker.parent.mkdir(parents=True)
        marker.write_bytes(b"")
        marker.chmod(0o600)
        (state / "replays").mkdir()
        (state / "replays" / "match-a.json").write_text('{"version": 1}')
        return state

    def snapshots(self, backups):
        return sorted(path for path in backups.iterdir() if path.name.startswith("data-"))

    def test_snapshot_contains_database_and_media_and_links_unchanged_media(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            (state / "media" / "b.png").write_bytes(b"image-b")
            result = self.run_backup(state, backups, stamp="20261012T000001Z")
            self.assertEqual(result.returncode, 0, result.stderr)

            first, second = self.snapshots(backups)
            self.assertEqual((second / "database.json").read_text(), '{"schemaVersion": 3}')
            self.assertEqual((second / "media" / "b.png").read_bytes(), b"image-b")
            self.assertEqual((first / "media" / "a.png").stat().st_ino,
                             (second / "media" / "a.png").stat().st_ino)
            self.assertEqual(oct(second.stat().st_mode & 0o777), "0o700")
            marker = second / "media/owners/account/a.png"
            self.assertEqual(marker.read_bytes(), b"")
            self.assertEqual(marker.stat().st_mode & 0o777, 0o600)
            self.assertEqual([path.name for path in backups.iterdir() if path.name.startswith(".staging")], [])

    def test_snapshot_copies_current_replays_even_when_the_directory_is_gone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            (state / "replays" / "match-a.json").unlink()
            (state / "replays" / "match-b.json").write_text('{"version": 1, "id": "b"}')
            self.assertEqual(self.run_backup(state, backups, stamp="20261012T000001Z").returncode, 0)
            (state / "replays" / "match-b.json").unlink()
            (state / "replays").rmdir()
            result = self.run_backup(state, backups, stamp="20261012T000002Z")
            self.assertEqual(result.returncode, 0, result.stderr)

            first, second, third = self.snapshots(backups)
            self.assertEqual(sorted(path.name for path in (first / "replays").iterdir()), ["match-a.json"])
            self.assertEqual(sorted(path.name for path in (second / "replays").iterdir()), ["match-b.json"])
            self.assertEqual((second / "replays" / "match-b.json").read_text(), '{"version": 1, "id": "b"}')
            self.assertEqual(list((third / "replays").iterdir()), [])
            self.assertEqual((first / "media" / "a.png").stat().st_ino, (third / "media" / "a.png").stat().st_ino)

    def test_unchanged_replays_are_hard_linked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            self.assertEqual(self.run_backup(state, backups, stamp="20261012T000001Z").returncode, 0)
            first, second = self.snapshots(backups)
            self.assertEqual((first / "replays" / "match-a.json").stat().st_ino,
                             (second / "replays" / "match-a.json").stat().st_ino)
            self.assertEqual((second / "replays" / "match-a.json").stat().st_mode & 0o777, 0o600)

    def test_retention_keeps_newest_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            backups.mkdir()
            for name in ("data-20240101T000000Z", "data-20240102T000000Z", "data-20240103T000000Z"):
                (backups / name).mkdir()
            self.assertEqual(self.run_backup(state, backups, keep="2").returncode, 0)
            names = [path.name for path in self.snapshots(backups)]
            self.assertEqual(len(names), 2)
            self.assertNotIn("data-20240101T000000Z", names)
            self.assertNotIn("data-20240102T000000Z", names)

    def test_invalid_database_is_discarded_and_older_snapshots_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            (state / "database.json").write_text("{broken")
            result = self.run_backup(state, backups, stamp="20261012T000001Z")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(len(self.snapshots(backups)), 1)
            self.assertEqual([path.name for path in backups.iterdir() if path.name.startswith(".staging")], [])

    def test_missing_database_or_bad_retention_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertNotEqual(self.run_backup(state, backups, keep="0").returncode, 0)
            (state / "database.json").unlink()
            self.assertNotEqual(self.run_backup(state, backups).returncode, 0)

    def test_lock_contention_does_not_create_a_partial_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            backups.mkdir()
            with (backups / ".lock").open("w") as lock:
                fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = self.run_backup(state, backups)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Another data backup", result.stderr)
            self.assertEqual(self.snapshots(backups), [])
            self.assertEqual(list(backups.glob(".staging-*")), [])

    def test_copy_failures_preserve_old_snapshots_and_clean_staging(self):
        for command in ("cp", "rsync"):
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                state, backups = self.make_state(root), root / "backups"
                self.assertEqual(self.run_backup(state, backups).returncode, 0)
                original = self.snapshots(backups)[0]
                saved = (original / "database.json").read_bytes()
                result = self.run_backup(state, backups, stamp="20261012T000001Z", failure=command)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.snapshots(backups), [original])
                self.assertEqual((original / "database.json").read_bytes(), saved)
                self.assertEqual(list(backups.glob(".staging-*")), [])

    def test_timestamp_collision_keeps_the_existing_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            original = self.snapshots(backups)[0]
            saved = (original / "database.json").read_bytes()
            (state / "database.json").write_text('{"schemaVersion": 4}')
            result = self.run_backup(state, backups)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Snapshot already exists", result.stderr)
            self.assertEqual((original / "database.json").read_bytes(), saved)
            self.assertEqual(list(backups.glob(".staging-*")), [])


@unittest.skipUnless(NODE, 'SQLite backups need Node.js 24 and installed dependencies')
class SqliteBackupDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_directory = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_directory.name) / 'database.sqlite'
        make_sqlite_database(cls.template, ('alice', 'bravo'))

    @classmethod
    def tearDownClass(cls):
        cls.template_directory.cleanup()

    def make_state(self, root):
        state = root / 'state'
        (state / 'media').mkdir(parents=True)
        (state / 'replays').mkdir()
        shutil.copy(self.template, state / 'database.sqlite')
        (state / 'media' / 'a.png').write_bytes(b'image-a')
        (state / 'replays' / 'match-a.json').write_text('{"version": 1}')
        return state

    def run_backup(self, state, backups, stamp='20261012T000000Z', **overrides):
        with tempfile.TemporaryDirectory(prefix='backup-command-test-') as directory:
            environment = {**os.environ, 'STATE_DIR': str(state), 'BACKUP_DIR': str(backups), 'KEEP': '2',
                           'FIXTURE_STAMP': stamp, 'DATABASE_ENGINE': 'sqlite', 'APP_DIR': str(ROOT),
                           'NODE_BINARY': NODE, 'PATH': f"{fake_commands(directory)}:{os.environ['PATH']}",
                           'DATABASE_PATH': str(state / 'database.sqlite'), **overrides}
            return subprocess.run(['bash', str(DEPLOY / 'backup-data.sh')], env=environment,
                                  capture_output=True, text=True, timeout=60)

    def test_online_snapshot_is_a_verified_copy_with_media_and_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / 'backups'
            # A writer holds the database in WAL mode with an uncommitted change, like a busy server.
            writer = sqlite3.connect(state / 'database.sqlite', isolation_level=None)
            try:
                writer.execute('PRAGMA journal_mode = WAL')
                writer.execute('BEGIN IMMEDIATE')
                writer.execute("UPDATE accounts SET nickname_search = 'uncommitted'")
                result = self.run_backup(state, backups)
            finally:
                writer.execute('ROLLBACK')
                writer.close()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"quickCheck":"ok"', result.stdout)
            snapshot = backups / 'data-20261012T000000Z'
            copy = snapshot / 'database.sqlite'
            self.assertEqual(usernames(copy), ['alice', 'bravo'])
            connection = sqlite3.connect(f'file:{copy}?mode=ro', uri=True)
            try:
                self.assertEqual(connection.execute('PRAGMA quick_check').fetchone()[0], 'ok')
                self.assertEqual(connection.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
                self.assertEqual(connection.execute(
                    "SELECT COUNT(*) FROM accounts WHERE nickname_search = 'uncommitted'").fetchone()[0], 0)
            finally:
                connection.close()
            self.assertEqual(copy.stat().st_mode & 0o777, 0o600)
            self.assertEqual((snapshot / 'media' / 'a.png').read_bytes(), b'image-a')
            self.assertEqual((snapshot / 'replays' / 'match-a.json').read_text(), '{"version": 1}')
            self.assertEqual(sorted(path.name for path in state.iterdir()), ['database.sqlite', 'media', 'replays'])
            self.assertEqual(list(backups.glob('.staging-*')), [])

    def test_damaged_database_is_discarded_and_older_snapshots_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / 'backups'
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            damage(state / 'database.sqlite')
            result = self.run_backup(state, backups, stamp='20261012T000001Z')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('snapshot discarded', result.stderr)
            self.assertEqual([path.name for path in backups.iterdir() if path.name.startswith('data-')],
                             ['data-20261012T000000Z'])
            self.assertEqual(list(backups.glob('.staging-*')), [])
            self.assertEqual(list(state.glob('.backup-*')), [])

    def test_engine_and_path_must_match_the_state_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / 'backups'
            for overrides, message in (({'DATABASE_ENGINE': 'postgres'}, 'DATABASE_ENGINE'),
                                       ({'DATABASE_PATH': str(root / 'database.sqlite')}, 'DATABASE_PATH'),
                                       ({'DATABASE_ENGINE': 'json'}, 'DATABASE_PATH')):
                with self.subTest(overrides=overrides):
                    result = self.run_backup(state, backups, **overrides)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(message, result.stderr)
            self.assertFalse(backups.exists())

    def test_stale_copies_from_an_interrupted_run_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / 'backups'
            stale = state / '.backup-20261011T000000Z-abcdef'
            stale.mkdir()
            (stale / 'database.sqlite').write_bytes(b'partial')
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            self.assertEqual(list(state.glob('.backup-*')), [])


@unittest.skipUnless(NODE, 'Restore checks need Node.js 24 and installed dependencies')
class RestoreDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template_directory = tempfile.TemporaryDirectory()
        cls.template = Path(cls.template_directory.name) / 'database.sqlite'
        make_sqlite_database(cls.template, ('alice', 'bravo'))
        cls.current = Path(cls.template_directory.name) / 'current' / 'database.sqlite'
        cls.current.parent.mkdir()
        make_sqlite_database(cls.current, ('current',))

    @classmethod
    def tearDownClass(cls):
        cls.template_directory.cleanup()

    def fixture(self, root, engine='sqlite'):
        state, snapshot, config = root / 'state', root / 'snapshot', root / 'server.env'
        for directory in (state / 'media', state / 'replays', snapshot / 'media', snapshot / 'replays'):
            directory.mkdir(parents=True)
        config.write_text(f'NODE_ENV=production\nDATABASE_ENGINE={engine}\n')
        shutil.copy(self.current, state / 'database.sqlite')
        (state / 'database.sqlite-wal').write_bytes(b'stale journal')
        (state / 'database.json').write_text(json.dumps(json_database(('fallback',))))
        (state / 'media' / 'new.png').write_bytes(b'newer upload')
        (state / 'replays' / 'match-new.json').write_text('{"version": 1, "id": "new"}')
        shutil.copy(self.template, snapshot / 'database.sqlite')
        (snapshot / 'media' / 'a.png').write_bytes(b'image-a')
        (snapshot / 'replays' / 'match-a.json').write_text('{"version": 1}')
        return state, snapshot, config

    def run_restore(self, root, snapshot, config, active=False):
        with tempfile.TemporaryDirectory(prefix='restore-command-test-') as directory:
            environment = {**os.environ, 'STATE_DIR': str(root / 'state'), 'BACKUP_DIR': str(root / 'backups'),
                           'CONFIG_FILE': str(config), 'APP_DIR': str(ROOT), 'NODE_BINARY': NODE,
                           'FIXTURE_STAMP': '20261012T000000Z',
                           'PATH': f"{fake_commands(directory, active)}:{os.environ['PATH']}"}
            return subprocess.run(['bash', str(DEPLOY / 'restore-data.sh'), str(snapshot)], env=environment,
                                  capture_output=True, text=True, timeout=60)

    def test_restores_database_media_and_replays_after_copying_the_current_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, snapshot, config = self.fixture(root)
            result = self.run_restore(root, snapshot, config)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((state / 'database.sqlite-wal').exists())
            self.assertEqual(usernames(state / 'database.sqlite'), ['alice', 'bravo'])
            self.assertEqual((state / 'database.sqlite').stat().st_mode & 0o777, 0o600)
            self.assertEqual(sorted(path.name for path in (state / 'media').iterdir()), ['a.png'])
            self.assertEqual(sorted(path.name for path in (state / 'replays').iterdir()), ['match-a.json'])
            # The other engine's file, such as the JSON fallback, is left alone.
            self.assertIn('fallback', (state / 'database.json').read_text())
            [previous] = (root / 'backups').glob('pre-restore-20261012T000000Z-*')
            self.assertEqual((previous / 'database.sqlite').read_bytes(), self.current.read_bytes())
            self.assertEqual((previous / 'database.sqlite-wal').read_bytes(), b'stale journal')
            self.assertEqual((previous / 'media' / 'new.png').read_bytes(), b'newer upload')
            self.assertTrue((previous / 'replays' / 'match-new.json').exists())

    def test_refuses_running_services_locks_mismatched_engines_and_invalid_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, snapshot, config = self.fixture(root)
            before = (state / 'database.sqlite').read_bytes()
            self.assertIn('Stop the service first', self.run_restore(root, snapshot, config, active=True).stderr)
            (state / 'database.sqlite.lock').write_text('{}')
            self.assertIn('may still own the database', self.run_restore(root, snapshot, config).stderr)
            (state / 'database.sqlite.lock').unlink()
            json_config = root / 'json.env'
            json_config.write_text('DATABASE_ENGINE=json\n')
            self.assertIn('selects database.json', self.run_restore(root, snapshot, json_config).stderr)
            shutil.rmtree(snapshot / 'replays')
            self.assertIn('no replays/', self.run_restore(root, snapshot, config).stderr)
            (snapshot / 'replays').mkdir()
            (snapshot / 'database.sqlite-wal').write_bytes(b'uncheckpointed')
            self.assertIn('not a complete single-file copy', self.run_restore(root, snapshot, config).stderr)
            (snapshot / 'database.sqlite-wal').unlink()
            damage(snapshot / 'database.sqlite')
            result = self.run_restore(root, snapshot, config)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('nothing was restored', result.stderr)
            self.assertEqual((state / 'database.sqlite').read_bytes(), before)
            self.assertEqual((state / 'database.sqlite-wal').read_bytes(), b'stale journal')
            self.assertFalse((root / 'backups').exists())

    def test_restores_json_snapshots_for_the_json_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, snapshot, config = self.fixture(root, engine='json')
            (snapshot / 'database.sqlite').unlink()
            (snapshot / 'database.json').write_text(json.dumps(json_database(('restored',))))
            result = self.run_restore(root, snapshot, config)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('restored', (state / 'database.json').read_text())
            self.assertEqual((state / 'database.sqlite').read_bytes(), self.current.read_bytes())


class DeployScriptContractTests(unittest.TestCase):
    def test_scripts_do_not_depend_on_ripgrep(self):
        for script in DEPLOY.glob("*.sh"):
            with self.subTest(script=script.name):
                text = script.read_text()
                self.assertNotRegex(text, r"(?m)(^|[\s;|(])rg\s")


if __name__ == "__main__":
    unittest.main()
