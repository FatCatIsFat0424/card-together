"""Verify deployment recovery with real temp files and guarded service doubles."""

import unittest
from pathlib import Path

from deployment_fixture import DeploymentFixture

LOCAL_HEALTH = 'http://127.0.0.1:3001/health'
PUBLIC_HEALTH = 'https://acserver.csie.org/card-together/health'


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DeploymentFixture()
        self.addCleanup(self.fixture.close)
        self.site = self.fixture.host / 'etc/nginx/sites-enabled/acserver.csie.org'
        self.original = self.site.read_bytes()
        self.original_mode = self.site.stat().st_mode & 0o777
        self.snippet = self.fixture.host / 'etc/nginx/snippets/card-together.conf'
        self.snippet.write_text('original snippet')
        self.http_snippet = self.fixture.host / 'etc/nginx/snippets/card-together-http.conf'
        self.http_snippet.write_text('original http snippet')

    def assert_recovered(self, fixture, original):
        self.assertEqual((fixture.host / 'etc/nginx/sites-enabled/acserver.csie.org').read_bytes(), original)
        self.assertEqual((fixture.root / 'service-state').read_text(), '')
        self.assertEqual(list((fixture.host / 'etc/nginx/sites-enabled').glob('.*')), [])
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
        self.assertEqual([calls[index][-1] for index in health], [LOCAL_HEALTH, PUBLIC_HEALTH])
        timer = calls.index(['systemctl', 'enable', '--now', 'card-together-backup.timer'])
        self.assertLess(health[-1], timer)
        replacement = next(call for call in calls if call[0] == 'mv' and call[-1] == str(self.site))
        temporary = Path(replacement[-2])
        self.assertEqual(temporary.parent, self.site.parent)
        self.assertTrue(temporary.name.startswith('.' + self.site.name + '.'))
        for command in ('chmod', 'chown'):
            preparation = [command, '--reference=' + str(self.site), '--', str(temporary)]
            self.assertLess(calls.index(preparation), calls.index(replacement))
        self.assertEqual(self.site.stat().st_mode & 0o777, self.original_mode)
        self.assertIn('location /unrelated { return 204; }', self.site.read_text())
        self.assertIn('card-together.conf', self.site.read_text())
        backups = list((fixture.host / 'var/backups/card-together').glob('deploy-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'site.conf').read_bytes(), self.original)
        self.assertEqual((backups[0] / 'card-together-data/database.json').read_bytes(),
                         (fixture.state / 'database.json').read_bytes())
        self.assertEqual(list((fixture.host / 'tmp').iterdir()), [])

    def test_nginx_reload_or_public_health_failure_restores_site_and_snippets(self):
        for failure in ('nginx -t', 'systemctl reload nginx',
                        'python3 ' + str(self.fixture.checkout / 'deploy/wait-for-health.py')):
            with self.subTest(failure=failure):
                fixture = DeploymentFixture()
                try:
                    site = fixture.host / 'etc/nginx/sites-enabled/acserver.csie.org'
                    original = site.read_bytes()
                    snippet = fixture.host / 'etc/nginx/snippets/card-together.conf'
                    snippet.write_text('original snippet')
                    http_snippet = fixture.host / 'etc/nginx/snippets/card-together-http.conf'
                    http_snippet.write_text('original http snippet')
                    if failure.startswith('python3 '):
                        failure = 'python3 ' + str(fixture.checkout / 'deploy/wait-for-health.py')
                    occurrence = '2' if failure.startswith(('nginx', 'python3')) else '1'
                    result = fixture.run('deploy_application', stub_install=True,
                                         FAIL_COMMAND=failure, FAIL_OCCURRENCE=occurrence)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Deployment failed', result.stderr)
                    self.assert_recovered(fixture, original)
                    self.assertEqual(snippet.read_text(), 'original snippet')
                    self.assertEqual(http_snippet.read_text(), 'original http snippet')
                finally:
                    fixture.close()

    def test_backend_health_failure_keeps_original_nginx_configuration_and_stops_backend(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', stub_install=True,
                             FAIL_COMMAND='python3 ' + str(fixture.checkout / 'deploy/wait-for-health.py'))
        self.assertNotEqual(result.returncode, 0)
        self.assert_recovered(fixture, self.original)
        self.assertEqual(self.snippet.read_text(), 'original snippet')
        self.assertEqual(self.http_snippet.read_text(), 'original http snippet')

    def test_installer_failure_runs_recovery_once_without_starting_backend(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', FAIL_COMMAND='systemd-analyze verify')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.count('Deployment failed'), 1)
        self.assert_recovered(fixture, self.original)
        self.assertNotIn(['systemctl', 'enable', '--now', 'card-together.service'], fixture.calls())

    def test_signals_use_recovery_and_preserve_original_configuration(self):
        for requested, code in (('INT', 130), ('TERM', 143)):
            with self.subTest(signal=requested):
                fixture = DeploymentFixture()
                try:
                    original = (fixture.host / 'etc/nginx/sites-enabled/acserver.csie.org').read_bytes()
                    result = fixture.run('deploy_application', stub_install=True, SIGNAL_AT_HEALTH=requested,
                                         SIGNAL_HEALTH_URL=PUBLIC_HEALTH)
                    self.assertEqual(result.returncode, code, result.stderr)
                    self.assert_recovered(fixture, original)
                    self.assertFalse((fixture.host / 'etc/nginx/snippets/card-together.conf').exists())
                    self.assertFalse((fixture.host / 'etc/nginx/snippets/card-together-http.conf').exists())
                finally:
                    fixture.close()

    def test_timer_failure_warns_after_healthy_deployment_without_rollback(self):
        fixture = self.fixture
        result = fixture.run('deploy_application', stub_install=True,
                             FAIL_COMMAND='systemctl enable --now card-together-backup.timer')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Warning: could not enable', result.stderr)
        self.assertIn('card-together.conf', self.site.read_text())
        self.assertEqual((fixture.root / 'service-state').read_text(), 'card-together.service')


if __name__ == '__main__':
    unittest.main()
