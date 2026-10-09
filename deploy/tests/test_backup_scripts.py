"""Exercise backup and frontend retention scripts in temporary directories."""

import json
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

    def test_only_stale_files_missing_from_the_build_are_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build, site = root / "build", root / "site"
            for base in (build, site):
                (base / "assets").mkdir(parents=True)
            (build / "assets" / "current.js").write_text("new")
            (site / "assets" / "current.js").write_text("new")
            (site / "assets" / "old-stale.js").write_text("old")
            (site / "assets" / "old-recent.js").write_text("old")
            age(site / "assets" / "current.js", 40)
            age(site / "assets" / "old-stale.js", 40)
            age(site / "assets" / "old-recent.js", 2)
            (site / "index.html").write_text("entry")
            age(site / "index.html", 40)

            result = self.run_prune(build, site)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((site / "assets" / "current.js").exists())
            self.assertTrue((site / "assets" / "old-recent.js").exists())
            self.assertFalse((site / "assets" / "old-stale.js").exists())
            self.assertTrue((site / "index.html").exists())

    def test_stale_site_emoji_are_removed_after_the_grace_period(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build, site = root / "build", root / "site"
            for base in (build, site):
                (base / "provided-emoji").mkdir(parents=True)
            (build / "provided-emoji" / "wave-new.png").write_text("new")
            for name in ("wave-new.png", "wave-old.png", "cat-recent.png"):
                (site / "provided-emoji" / name).write_text(name)
            age(site / "provided-emoji" / "wave-new.png", 40)
            age(site / "provided-emoji" / "wave-old.png", 40)
            age(site / "provided-emoji" / "cat-recent.png", 2)

            result = self.run_prune(build, site)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sorted(path.name for path in (site / "provided-emoji").iterdir()),
                             ["cat-recent.png", "wave-new.png"])

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
    def run_backup(self, state, backups, keep="14"):
        environment = {**os.environ, "STATE_DIR": str(state), "BACKUP_DIR": str(backups), "KEEP": keep}
        return subprocess.run(["bash", str(DEPLOY / "backup-data.sh")], env=environment,
                              capture_output=True, text=True)

    def make_state(self, root):
        state = root / "state"
        (state / "media").mkdir(parents=True)
        (state / "database.json").write_text('{"schemaVersion": 3}')
        (state / "media" / "a.png").write_bytes(b"image-a")
        return state

    def snapshots(self, backups):
        return sorted(path for path in backups.iterdir() if path.name.startswith("data-"))

    def test_snapshot_contains_database_and_media_and_links_unchanged_media(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state, backups = self.make_state(root), root / "backups"
            self.assertEqual(self.run_backup(state, backups).returncode, 0)
            time.sleep(1.1)
            (state / "media" / "b.png").write_bytes(b"image-b")
            result = self.run_backup(state, backups)
            self.assertEqual(result.returncode, 0, result.stderr)

            first, second = self.snapshots(backups)
            self.assertEqual((second / "database.json").read_text(), '{"schemaVersion": 3}')
            self.assertEqual((second / "media" / "b.png").read_bytes(), b"image-b")
            self.assertEqual((first / "media" / "a.png").stat().st_ino,
                             (second / "media" / "a.png").stat().st_ino)
            self.assertEqual(oct(second.stat().st_mode & 0o777), "0o700")
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
            time.sleep(1.1)
            (state / "database.json").write_text("{broken")
            result = self.run_backup(state, backups)
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


class DeployScriptContractTests(unittest.TestCase):
    def test_scripts_do_not_depend_on_ripgrep(self):
        for script in DEPLOY.glob("*.sh"):
            with self.subTest(script=script.name):
                text = script.read_text()
                self.assertNotRegex(text, r"(?m)(^|[\s;|(])rg\s")

    def test_deploy_recovers_on_signals_and_replaces_site_atomically(self):
        text = (DEPLOY / "deploy.sh").read_text()
        self.assertIn("trap 'on_error 130' INT", text)
        self.assertIn("trap 'on_error 143' TERM", text)
        self.assertIn('replace_file "$backup_dir/site.new.conf" "$site_file"', text)
        self.assertNotIn('> "$site_file"', text)
        self.assertLess(text.index("rsync -a --exclude='/node'"), text.index("systemctl stop card-together.service"))

    def test_client_build_does_not_rely_on_workspace_npm_run(self):
        # npm 9 exits 0 from `npm run` inside a workspace even when the script fails.
        scripts = json.loads((DEPLOY.parent / "package.json").read_text())["scripts"]
        build = scripts["build:client"]
        self.assertIn("npm run emoji:import", build)
        self.assertNotRegex(build, r"cd client && npm run")

    def test_deploy_enables_backup_timer_only_after_success(self):
        text = (DEPLOY / "deploy.sh").read_text()
        handler = text[text.index("on_error() {"):text.index("trap on_error ERR")]
        self.assertNotIn("card-together-backup.timer", handler)
        self.assertLess(text.rindex("trap - ERR INT TERM"), text.index("enable --now card-together-backup.timer"))


if __name__ == "__main__":
    unittest.main()
