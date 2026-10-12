"""Exercise installer state changes through guarded temporary filesystem tools."""

import unittest

from deployment_fixture import DeploymentFixture


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DeploymentFixture()
        self.addCleanup(self.fixture.close)

    def test_install_removes_stale_dependencies_preserves_config_and_verifies_units(self):
        fixture = self.fixture
        configuration = fixture.host / 'etc/card-together/server.env'
        configuration.write_text('OWNER_SETTING=preserved\n')
        for workspace in ('shared', 'server', 'client'):
            stale = fixture.application / workspace / 'node_modules/stale'
            stale.mkdir(parents=True)
            (stale / 'package.json').write_text('{}')
        result = fixture.run('install_application')
        self.assertEqual(result.returncode, 0, result.stderr)
        for workspace in ('shared', 'server', 'client'):
            self.assertEqual(list((fixture.application / workspace / 'node_modules').iterdir()), [])
        self.assertEqual(configuration.read_text(), 'OWNER_SETTING=preserved\n')
        self.assertEqual((fixture.application / 'node_modules/tsx/package.json').read_text(), '{}')
        self.assertEqual((fixture.site / 'assets/old.js').read_text(), 'old asset')
        self.assertEqual((fixture.site / 'assets/new.js').read_text(), 'new asset')
        calls = fixture.calls()
        verify = next(call for call in calls if call[:2] == ['systemd-analyze', 'verify'])
        self.assertEqual(len(verify), 5)
        for unit in verify[2:]:
            self.assertTrue(unit.startswith(str(fixture.host / 'etc/systemd/system')))
        self.assertLess(calls.index(verify), calls.index(['systemctl', 'daemon-reload']))
        self.assertNotIn(['systemctl', 'enable', '--now', 'card-together.service'], calls)
        self.assertEqual(list((fixture.host / 'tmp').iterdir()), [])

    def test_wrong_base_path_fails_before_host_changes(self):
        fixture = self.fixture
        (fixture.checkout / 'client/dist/index.html').write_text('/assets/new.js')
        result = fixture.run('install_application')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('VITE_BASE_PATH', result.stderr)
        self.assertEqual((fixture.site / 'index.html').read_text(), 'old entry')
        self.assertFalse(any(call[0] in ('install', 'rsync', 'useradd') for call in fixture.calls()))

    def test_unit_validation_failure_prevents_daemon_reload_and_cleans_temporary_files(self):
        fixture = self.fixture
        result = fixture.run('install_application', FAIL_COMMAND='systemd-analyze verify')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(['systemctl', 'daemon-reload'], fixture.calls())
        self.assertEqual(list((fixture.host / 'tmp').iterdir()), [])

    def test_legacy_configuration_or_active_writer_blocks_installation(self):
        for reason in ('configuration', 'writer'):
            with self.subTest(reason=reason):
                fixture = DeploymentFixture()
                try:
                    if reason == 'configuration':
                        (fixture.host / 'etc/card-together/server.env').unlink()
                        legacy = fixture.host / 'etc/bridge-online'
                        legacy.mkdir()
                        (legacy / 'server.env').write_text('LEGACY_SETTING=retained\n')
                    else:
                        (fixture.root / 'service-state').write_text('bridge-online.service')
                    result = fixture.run('install_application')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(any(call[0] in ('install', 'rsync', 'useradd')
                                         for call in fixture.calls()))
                    self.assertEqual((fixture.site / 'index.html').read_text(), 'old entry')
                finally:
                    fixture.close()


if __name__ == '__main__':
    unittest.main()
