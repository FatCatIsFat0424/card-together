"""Exercise the artifact boundary without sudo, host changes, or real service actions."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('secure_deploy', DEPLOY / 'secure-deploy.py')
SECURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SECURE)


class SecureDeployTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='card-secure-deploy-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.checkout = self.root / 'release'
        self.checkout.mkdir()
        for name in SECURE.FILES:
            target = self.checkout / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('24.22.1' if name == '.node-version' else '{}')
        for name in SECURE.DIRECTORIES:
            target = self.checkout / name
            target.mkdir(parents=True, exist_ok=True)
            (target / 'artifact').write_text('application data')
        (self.checkout / 'client/dist/index.html').write_text('/card-together/assets/entry.js')
        self.output = self.root / 'snapshot'
        self.output.mkdir()

    def test_runtime_copies_are_independent_and_preserve_confined_workspace_links(self):
        (self.checkout / 'node_modules/@card').mkdir()
        (self.checkout / 'node_modules/@card/shared').symlink_to('../../shared')
        executable = self.checkout / 'node_modules/tool'
        executable.write_text('release tool')
        executable.chmod(0o6755)
        os.link(executable, self.checkout / 'node_modules/tool-alias')
        SECURE.snapshot(self.checkout, self.output)
        self.assertEqual((self.output / 'node_modules/tool').stat().st_nlink, 1)
        self.assertEqual((self.output / 'node_modules/@card/shared').resolve(), self.output / 'shared')
        self.assertEqual((self.output / 'node_modules/tool').stat().st_mode & 0o7777, 0o755)
        (self.checkout / 'server/src/artifact').write_text('changed release')
        self.assertEqual((self.output / 'server/src/artifact').read_text(), 'application data')

    def test_absolute_escaping_and_policy_links_are_rejected(self):
        for target in ('/etc/shadow', '../../etc/shadow', '../deploy/operations.sh', '../node'):
            with self.subTest(target=target):
                link = self.checkout / 'node_modules/attack'
                link.symlink_to(target)
                with tempfile.TemporaryDirectory(dir=self.root) as destination, self.assertRaises(ValueError):
                    SECURE.snapshot(self.checkout, Path(destination))
                link.unlink()

    def test_link_chain_cannot_redirect_parent_traversal_outside_the_snapshot(self):
        (self.checkout / 'node_modules/root').symlink_to('../shared')
        (self.checkout / 'node_modules/escape').symlink_to('root/../../outside')
        with self.assertRaises(ValueError):
            SECURE.snapshot(self.checkout, self.output)

    def test_symlinked_checkout_ancestor_and_entrypoints_are_rejected(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.checkout, target_is_directory=True)
        with self.assertRaises(OSError):
            SECURE.snapshot(alias, self.output)
        target = self.checkout / 'server/src'
        shutil.rmtree(target)
        target.symlink_to(self.checkout / 'shared/src', target_is_directory=True)
        with self.assertRaises(ValueError):
            SECURE.snapshot(self.checkout, self.output)

    def test_fifo_hardlinks_and_oversized_input_fail_before_install(self):
        attack = self.checkout / 'server/src/attack'
        os.mkfifo(attack)
        with self.assertRaises(ValueError):
            SECURE.snapshot(self.checkout, self.output)
        attack.unlink()
        outside = self.root / 'outside'
        outside.write_text('not an application input')
        os.link(outside, attack)
        with tempfile.TemporaryDirectory(dir=self.root) as destination, self.assertRaises(ValueError):
            SECURE.snapshot(self.checkout, Path(destination))
        attack.unlink()
        with patch.object(SECURE, 'MAX_BYTES', 4), tempfile.TemporaryDirectory(dir=self.root) as destination, \
                self.assertRaises(ValueError):
            SECURE.snapshot(self.checkout, Path(destination))

    def test_replacing_a_directory_with_symlink_during_copy_fails_closed(self):
        original = SECURE.os.open
        switched = False

        def replace(name, flags, **kwargs):
            nonlocal switched
            if name == 'src' and not switched:
                switched = True
                target = self.checkout / 'shared/src'
                shutil.rmtree(target)
                target.symlink_to('/etc')
            return original(name, flags, **kwargs)

        with patch.object(SECURE.os, 'open', side_effect=replace), self.assertRaises(OSError):
            SECURE.snapshot(self.checkout, self.output)

    def test_trusted_orchestration_ignores_release_scripts_units_and_node(self):
        policy = self.root / 'policy'
        (policy / 'deploy').mkdir(parents=True)
        (policy / '.node-version').write_text('24.22.1')
        marker = self.root / 'trusted-result'
        evil = self.root / 'untrusted-code-ran'
        script = f'#!/bin/sh\ntouch "{evil}"\n'
        for name in ('deploy/operations.sh', 'deploy/deploy.sh', '.deploy/node'):
            target = self.checkout / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(script)
            target.chmod(0o755)
        (self.checkout / 'deploy/sitecustomize.py').write_text(f'open("{evil}", "w").close()')
        (policy / 'deploy/operations.sh').write_text(
            'configure_deployment_paths() { repo_dir=$1; }\n'
            f'deploy_application() {{ printf "%s\\n" "$1" > "{marker}"; '
            'test ! -e "$repo_dir/.deploy/node"; test ! -e "$repo_dir/deploy/sitecustomize.py"; }\n')
        environment = {**os.environ, 'BASH_ENV': str(self.checkout / 'deploy/operations.sh'),
                       'NODE_OPTIONS': '--require=malicious', 'PYTHONPATH': str(self.checkout / 'deploy')}
        with patch.dict(os.environ, environment):
            SECURE.deploy(self.checkout, policy)
        self.assertEqual(marker.read_text().strip(), str(policy / 'node'))
        self.assertFalse(evil.exists())

    def test_node_version_change_stops_before_orchestration(self):
        policy = self.root / 'policy'
        policy.mkdir()
        (policy / '.node-version').write_text('25.0.0')
        with patch.object(SECURE.subprocess, 'run') as run, self.assertRaises(ValueError):
            SECURE.deploy(self.checkout, policy)
        run.assert_not_called()

    def test_cli_rejects_arguments_and_nonroot_before_any_install(self):
        for uid, arguments in ((1000, ['secure-deploy.py']), (0, ['secure-deploy.py', '/arbitrary'])):
            with self.subTest(uid=uid), patch.object(SECURE.os, 'geteuid', return_value=uid), \
                    patch.object(sys, 'argv', arguments), patch.object(SECURE, 'deploy') as install:
                self.assertEqual(SECURE.main(), 1)
                install.assert_not_called()

    def test_cli_uses_only_fixed_configured_checkout_under_lock(self):
        config = self.root / 'policy.json'
        config.write_text(json.dumps({'checkout': str(self.checkout)}))
        policy = self.root / 'policy'
        policy.mkdir()
        with patch.object(SECURE.os, 'geteuid', return_value=0), \
                patch.object(sys, 'argv', ['secure-deploy.py']), \
                patch.object(SECURE, 'CONFIG', config), patch.object(SECURE, 'POLICY', policy), \
                patch.object(SECURE, 'LOCK', self.root / 'lock'), \
                patch.object(SECURE, 'trusted') as trusted, patch.object(SECURE, 'deploy') as install:
            old_mask = os.umask(0o077)
            try:
                self.assertEqual(SECURE.main(), 0)
            finally:
                os.umask(old_mask)
            trusted.assert_any_call(config)
            trusted.assert_any_call(policy)
            install.assert_called_once_with(self.checkout)



if __name__ == '__main__':
    unittest.main()
