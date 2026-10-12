"""Exercise backup and frontend retention scripts in temporary directories."""

import fcntl
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest

DEPLOY = Path(__file__).resolve().parents[1]
DAY = 24 * 60 * 60


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


class DeployScriptContractTests(unittest.TestCase):
    def test_scripts_do_not_depend_on_ripgrep(self):
        for script in DEPLOY.glob("*.sh"):
            with self.subTest(script=script.name):
                text = script.read_text()
                self.assertNotRegex(text, r"(?m)(^|[\s;|(])rg\s")


if __name__ == "__main__":
    unittest.main()
