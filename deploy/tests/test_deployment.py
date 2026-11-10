"""Verify deployment recovery with real temp files and guarded service doubles."""

import unittest

from deployment_fixture import DeploymentFixture

LOCAL_HEALTH = 'http://127.0.0.1:3001/health'


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DeploymentFixture()
        self.addCleanup(self.fixture.close)

    def assert_recovered(self, fixture):
        self.assertEqual((fixture.root / 'service-state').read_text(), '')
        self.assertEqual(list((fixture.host / 'tmp').iterdir()), [])
        self.assertNotIn(['systemctl', 'enable', '--now', 'card-together-backup.timer'], fixture.calls())

    def test_success_backs_up_application_before_shutdown_and_state_after_shutdown(self):
        fixture = self.fixture
        result = fixture.run('deploy_application')
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = fixture.calls()
        application_backup = next(index for index, call in enumerate(calls)
                                  if call[0] == 'rsync' and '--exclude=/node' in call)
        shutdown = calls.index(['systemctl', 'stop', 'card-together.service'])
        state_backup = next(index for index, call in enumerate(calls)
                            if call[:2] == ['cp', '-a'] and call[2] == str(fixture.state))
        self.assertLess(application_backup, shutdown)
        self.assertLess(shutdown, state_backup)
        health = [index for index, call in enumerate(calls)
                  if call[0] == 'python3' and call[1].endswith('wait-for-health.py')]
        self.assertEqual([calls[index][-1] for index in health], [LOCAL_HEALTH])
        timer = calls.index(['systemctl', 'enable', '--now', 'card-together-backup.timer'])
        self.assertLess(health[-1], timer)
        self.assertFalse(any(call[0] == 'nginx' or 'nginx' in ' '.join(call) for call in calls))
        backups = list((fixture.host / 'var/backups/card-together').glob('deploy-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'card-together-data/database.json').read_bytes(),
                         (fixture.state / 'database.json').read_bytes())
        self.assertEqual(list((fixture.host / 'tmp').iterdir()), [])

    def test_invalid_build_fails_before_service_shutdown_or_backup(self):
        for case in ('development-base', 'missing-build'):
            with self.subTest(case=case):
                fixture = DeploymentFixture()
                try:
                    entry = fixture.checkout / 'client/dist/index.html'
                    if case == 'development-base':
                        entry.write_text('/assets/new.js')
                    else:
                        entry.unlink()
                    result = fixture.run('deploy_application')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('build.sh', result.stderr)
                    self.assertEqual((fixture.root / 'service-state').read_text(), 'card-together.service')
                    self.assertFalse(any(call[:2] == ['systemctl', 'stop'] for call in fixture.calls()))
                    self.assertEqual(list((fixture.host / 'var/backups/card-together').glob('deploy-*')), [])
                finally:
                    fixture.close()

    def test_backend_health_failure_stops_backend(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', stub_install=True,
                             FAIL_COMMAND='python3 ' + str(fixture.checkout / 'deploy/wait-for-health.py'))
        self.assertNotEqual(result.returncode, 0)
        self.assert_recovered(fixture)

    def test_installer_failure_runs_recovery_once_without_starting_backend(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', FAIL_COMMAND='systemd-analyze verify')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.count('Deployment failed'), 1)
        self.assert_recovered(fixture)
        self.assertNotIn(['systemctl', 'enable', '--now', 'card-together.service'], fixture.calls())

    def test_signals_use_recovery(self):
        for requested, code in (('INT', 130), ('TERM', 143)):
            with self.subTest(signal=requested):
                fixture = DeploymentFixture()
                try:
                    result = fixture.run('deploy_application', stub_install=True, SIGNAL_AT_HEALTH=requested,
                                         SIGNAL_HEALTH_URL=LOCAL_HEALTH)
                    self.assertEqual(result.returncode, code, result.stderr)
                    self.assert_recovered(fixture)
                finally:
                    fixture.close()

    def test_timer_failure_warns_after_healthy_deployment_without_rollback(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', stub_install=True,
                             FAIL_COMMAND='systemctl enable --now card-together-backup.timer')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Warning: could not enable', result.stderr)
        self.assertEqual((fixture.root / 'service-state').read_text(), 'card-together.service')


if __name__ == '__main__':
    unittest.main()
