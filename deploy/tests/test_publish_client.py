"""Verify guarded frontend publication without touching host services."""

import unittest

from deployment_fixture import DeploymentFixture


class PublishClientTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DeploymentFixture()
        self.addCleanup(self.fixture.close)

    def test_assets_precede_atomic_entry_replacement_and_old_assets_remain(self):
        fixture = self.fixture
        result = fixture.run('publish_client')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((fixture.site / 'index.html').read_text(), '/card-together/assets/new.js')
        self.assertEqual((fixture.site / 'assets/new.js').read_text(), 'new asset')
        self.assertEqual((fixture.site / 'assets/old.js').read_text(), 'old asset')
        calls = fixture.calls()
        asset_copy = next(index for index, call in enumerate(calls) if call[0] == 'rsync')
        entry_replace = next(index for index, call in enumerate(calls) if call[0] == 'mv')
        self.assertLess(asset_copy, entry_replace)
        self.assertEqual(calls[entry_replace][-1], str(fixture.site / 'index.html'))
        backups = list((fixture.host / 'var/backups/card-together').glob('frontend-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'index.html').read_text(), 'old entry')
        self.assertEqual(list(fixture.site.glob('.index-publish-*')), [])
        self.assertFalse(any(call[0] in ('systemctl', 'nginx', 'useradd') for call in calls))

    def test_changed_emoji_catalog_is_rejected_before_any_writes(self):
        fixture = self.fixture
        (fixture.checkout / 'shared/src/provided-emoji.generated.json').write_text('[{"name":"changed"}]')
        result = fixture.run('publish_client')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Site emoji changed', result.stderr)
        self.assertEqual((fixture.site / 'index.html').read_text(), 'old entry')
        self.assertFalse(any(call[0] in ('install', 'cp', 'rsync', 'mv') for call in fixture.calls()))

    def test_copy_or_rename_failure_preserves_entry_point_and_cleans_temporary_file(self):
        for command in ('rsync', 'install -m 0644', 'mv'):
            with self.subTest(command=command):
                fixture = DeploymentFixture()
                try:
                    result = fixture.run('publish_client', FAIL_COMMAND=command)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual((fixture.site / 'index.html').read_text(), 'old entry')
                    self.assertEqual(list(fixture.site.glob('.index-publish-*')), [])
                    self.assertFalse(any(call[0] in ('systemctl', 'nginx') for call in fixture.calls()))
                finally:
                    fixture.close()


if __name__ == '__main__':
    unittest.main()
