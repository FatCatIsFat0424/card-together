"""Exercise automatic deployment using isolated Git trees and fake CI/install steps."""

from contextlib import ExitStack, contextmanager, redirect_stdout, redirect_stderr
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


DEPLOY = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('card_auto_deploy', DEPLOY / 'auto-deploy.py')
AUTO = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUTO
SPEC.loader.exec_module(AUTO)


class AutoDeployTests(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        os.umask(previous_umask)
        self.addCleanup(os.umask, previous_umask)
        self.temporary = tempfile.TemporaryDirectory(prefix='card-auto-deploy-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.git(self.source, 'init', '-b', 'main')
        self.git(self.source, 'config', 'user.name', 'Deployment Test')
        self.git(self.source, 'config', 'user.email', 'deployment-test@example.invalid')
        (self.source / 'client').mkdir()
        (self.source / 'client/package.json').write_text('{}\n')
        (self.source / '.gitignore').write_text('local-music/\nlocal-emoji/\n.env*\n.deploy/\n')
        (self.source / '.node-version').write_text('24.21.0\n')
        (self.source / 'application.txt').write_text('first\n')
        self.git(self.source, 'add', '.')
        self.git(self.source, 'commit', '-m', 'Initial fixture')
        self.sha = self.git(self.source, 'rev-parse', 'HEAD')
        self.git(self.source, 'remote', 'add', 'origin', 'git@github.com:example/cards.git')
        self.checkout = self.root / 'release'
        self.state_dir = self.root / 'state'
        self.music = self.root / 'music'
        self.emoji = self.root / 'emoji'
        for directory in (self.state_dir, self.music, self.emoji):
            directory.mkdir()
        (self.music / 'track.ogg').write_bytes(b'owner music fixture')
        (self.emoji / 'smile.png').write_bytes(b'owner emoji fixture')
        self.frontend_env = self.root / 'frontend.env'
        self.frontend_env.write_text('VITE_EXAMPLE=fixture\n')
        self.config_path = self.root / 'config.json'
        self.raw_config = {
            'repository': 'example/cards', 'source': str(self.source),
            'checkout': str(self.checkout), 'state_dir': str(self.state_dir),
            'music_dir': str(self.music), 'emoji_dir': str(self.emoji),
            'frontend_env': str(self.frontend_env), 'workflows': ['ci.yml'],
        }
        self.config_path.write_text(json.dumps(self.raw_config))
        self.config = AUTO.load_config(self.config_path)

    @staticmethod
    def git(directory, *arguments):
        result = subprocess.run(['git', '-C', str(directory), *arguments],
                                capture_output=True, text=True, check=True, timeout=10)
        return result.stdout.strip()

    def run(self, result=None):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return super().run(result)

    def workflow_run(self, **changes):
        run = {'head_sha': self.sha, 'head_branch': 'main', 'event': 'push',
               'path': '.github/workflows/ci.yml', 'id': 100, 'run_number': 1,
               'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}
        run.update(changes)
        return run

    def api_response(self, runs=None):
        selected = runs if runs is not None else [self.workflow_run()]
        return json.dumps([{'total_count': len(selected), 'workflow_runs': selected}])

    def test_build_uses_revision_official_node_bootstrap(self):
        AUTO.prepare_checkout(self.config, self.sha)
        with patch.object(AUTO.subprocess, 'run') as run:
            AUTO.build_checkout(self.config)
        run.assert_called_once_with(
            [sys.executable, '-B', 'deploy/with-node.py', '--', 'bash', 'deploy/build.sh'],
            cwd=self.checkout, stdin=subprocess.DEVNULL, check=True)

    def test_invalid_pinned_version_never_starts_bootstrap(self):
        AUTO.prepare_checkout(self.config, self.sha)
        (self.checkout / '.node-version').write_text('../invalid\n')
        with patch.object(AUTO.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                AUTO.build_checkout(self.config)
        run.assert_not_called()

    @contextmanager
    def fake_cycle(self, *, ci_results=None, build=None, install=None, sha=None):
        responses = iter(ci_results) if ci_results is not None else None
        original_output = AUTO.output
        api_calls = []

        def output(arguments, **kwargs):
            if arguments[0] != 'gh':
                return original_output(arguments, **kwargs)
            api_calls.append(arguments)
            response = next(responses) if responses is not None else self.api_response()
            if isinstance(response, BaseException):
                raise response
            return response

        with ExitStack() as stack:
            target = stack.enter_context(patch.object(AUTO, 'target_sha', return_value=sha or self.sha))
            stack.enter_context(patch.object(AUTO, 'output', side_effect=output))
            builder = stack.enter_context(patch.object(AUTO, 'build_checkout', side_effect=build))
            installer = stack.enter_context(patch.object(AUTO, 'install_checkout', side_effect=install))
            yield target, builder, installer, api_calls

    def new_commit(self):
        (self.source / 'application.txt').write_text('second\n')
        self.git(self.source, 'add', 'application.txt')
        self.git(self.source, 'commit', '-m', 'Second fixture')
        self.sha = self.git(self.source, 'rev-parse', 'HEAD')
        return self.sha

    def test_configuration_requires_exact_keys_canonical_independent_paths_and_workflows(self):
        changes = [
            {'repository': 'https://github.com/example/cards'}, {'source': 'relative'},
            {'checkout': str(self.source)}, {'checkout': str(self.source / 'release')},
            {'checkout': str(self.source.parent)}, {'music_dir': str(self.checkout / 'music')},
            {'emoji_dir': str(self.checkout)}, {'state_dir': str(self.checkout / 'state')},
            {'workflows': []}, {'workflows': ['ci.yml', 'ci.yml']},
            {'workflows': ['../ci.yml']}, {'workflows': 'ci.yml'}, {'unknown': 'value'},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.config_path.write_text(json.dumps({**self.raw_config, **change}))
                with self.assertRaises(ValueError):
                    AUTO.load_config(self.config_path)
        alias = self.root / 'source-alias'
        alias.symlink_to(self.source, target_is_directory=True)
        self.config_path.write_text(json.dumps({**self.raw_config, 'source': str(alias)}))
        with self.assertRaises(ValueError):
            AUTO.load_config(self.config_path)
        self.config_path.write_text(json.dumps({**self.raw_config, 'frontend_env': None}))
        self.assertIsNone(AUTO.load_config(self.config_path).frontend_env)

    def test_origin_validation_prevents_fetching_other_repositories_or_embedded_credentials(self):
        for origin in ('https://github.com/other/cards.git',
                       'https://secret@github.com/example/cards.git'):
            with self.subTest(origin=origin), patch.object(AUTO, 'git', return_value=origin) as git:
                with self.assertRaises(ValueError):
                    AUTO.target_sha(self.config)
                self.assertEqual(git.call_count, 1)
        with patch.object(AUTO, 'git', side_effect=[
                'git@github.com:example/cards.git', '', self.sha]) as git:
            self.assertEqual(AUTO.target_sha(self.config), self.sha)
            self.assertIn('+refs/heads/main:refs/remotes/origin/main', git.call_args_list[1].args)

    def test_ci_requires_same_sha_main_push_workflow_and_valid_run_metadata(self):
        for change in ({'head_sha': 'f' * 40}, {'head_branch': 'feature/example'},
                       {'event': 'pull_request'}, {'path': '../other.yml'},
                       {'id': True}, {'run_number': 0}, {'run_attempt': '1'}):
            with self.subTest(change=change), patch.object(
                    AUTO, 'output', return_value=self.api_response([self.workflow_run(**change)])):
                with self.assertRaises(ValueError):
                    AUTO.ci_success(self.config, self.sha)
        with patch.object(AUTO, 'output', return_value=self.api_response()) as output:
            self.assertTrue(AUTO.ci_success(self.config, self.sha))
            endpoint = output.call_args.args[0][-1]
            self.assertIn('actions/runs?', endpoint)
            for query in ('branch=main', 'event=push', f'head_sha={self.sha}'):
                self.assertIn(query, endpoint)

    def test_ci_latest_run_and_attempt_override_previous_success(self):
        for change in ({'run_number': 2, 'id': 101, 'status': 'in_progress', 'conclusion': None},
                       {'run_number': 2, 'id': 101, 'conclusion': 'failure'},
                       {'run_attempt': 2, 'conclusion': 'cancelled'}):
            with self.subTest(change=change), patch.object(AUTO, 'output', return_value=self.api_response(
                    [self.workflow_run(**change), self.workflow_run()])):
                self.assertFalse(AUTO.ci_success(self.config, self.sha))
        pages = [{'total_count': 2, 'workflow_runs': [self.workflow_run()]},
                 {'total_count': 2, 'workflow_runs': [
                     self.workflow_run(run_number=2, id=101, conclusion='failure')]}]
        with patch.object(AUTO, 'output', return_value=json.dumps(pages)):
            self.assertFalse(AUTO.ci_success(self.config, self.sha))

    def test_ci_no_run_malformed_response_or_api_failure_never_prepares_or_installs(self):
        cases = [self.api_response([]), 'not json', '{}', '[]', '[{}]',
                 '[{"workflow_runs": null}]', RuntimeError('API unavailable')]
        for response in cases:
            with self.subTest(response=response), self.fake_cycle(ci_results=[response]) as cycle:
                if response == self.api_response([]):
                    AUTO.poll(self.config)
                else:
                    with self.assertRaises((ValueError, RuntimeError)):
                        AUTO.poll(self.config)
                cycle[1].assert_not_called()
                cycle[2].assert_not_called()
                self.assertFalse(self.checkout.exists())
                self.assertEqual(AUTO.read_state(self.config), {})

    def test_every_configured_workflow_must_succeed(self):
        self.config_path.write_text(json.dumps({**self.raw_config, 'workflows': ['ci.yml', 'release.yml']}))
        config = AUTO.load_config(self.config_path)
        second = self.workflow_run(path='.github/workflows/release.yml')
        with patch.object(AUTO, 'output', return_value=self.api_response([self.workflow_run(), second])):
            self.assertTrue(AUTO.ci_success(config, self.sha))
        second['conclusion'] = 'failure'
        with patch.object(AUTO, 'output', return_value=self.api_response([self.workflow_run(), second])):
            self.assertFalse(AUTO.ci_success(config, self.sha))
        with patch.object(AUTO, 'output', return_value=self.api_response()):
            self.assertFalse(AUTO.ci_success(config, self.sha))

    def test_additional_workflows_must_succeed_and_cannot_replace_required_ci(self):
        other = self.workflow_run(path='.github/workflows/security.yml', conclusion='failure')
        with patch.object(AUTO, 'output', return_value=self.api_response([self.workflow_run(), other])):
            self.assertFalse(AUTO.ci_success(self.config, self.sha))
        other['conclusion'] = 'success'
        with patch.object(AUTO, 'output', return_value=self.api_response([self.workflow_run(), other])):
            self.assertTrue(AUTO.ci_success(self.config, self.sha))
        with patch.object(AUTO, 'output', return_value=self.api_response([other])):
            self.assertFalse(AUTO.ci_success(self.config, self.sha))

    def test_incomplete_excessive_or_invalid_count_ci_response_fails_closed(self):
        for count in (2, 1001, True, -1, '1', None):
            with self.subTest(count=count), patch.object(AUTO, 'output', return_value=json.dumps([
                    {'total_count': count, 'workflow_runs': [self.workflow_run()]}])):
                with self.assertRaises(ValueError):
                    AUTO.ci_success(self.config, self.sha)

    def test_release_worktree_requires_clean_detached_linked_root(self):
        AUTO.prepare_checkout(self.config, self.sha)
        (self.checkout / 'application.txt').write_text('unfinished\n')
        with self.assertRaises(ValueError):
            AUTO.validate_worktree(self.config)
        self.git(self.checkout, 'checkout', '--', 'application.txt')
        (self.checkout / 'untracked.txt').write_text('unexpected\n')
        with self.assertRaises(ValueError):
            AUTO.validate_worktree(self.config)
        (self.checkout / 'untracked.txt').unlink()
        self.git(self.checkout, 'checkout', '-b', 'release-test')
        with self.assertRaises(ValueError):
            AUTO.validate_worktree(self.config)
        self.git(self.checkout, 'checkout', '--detach', self.sha)
        unrelated = self.root / 'unrelated'
        unrelated.mkdir()
        self.git(unrelated, 'init', '-b', 'main')
        self.git(unrelated, 'config', 'user.name', 'Fixture')
        self.git(unrelated, 'config', 'user.email', 'fixture@example.invalid')
        self.git(unrelated, 'commit', '--allow-empty', '-m', 'Fixture')
        self.git(unrelated, 'checkout', '--detach')
        wrong = AUTO.Config(**{**self.config.__dict__, 'checkout': unrelated})
        with self.assertRaises(ValueError):
            AUTO.validate_worktree(wrong)
        nested = AUTO.Config(**{**self.config.__dict__, 'checkout': self.checkout / 'client'})
        with self.assertRaises(ValueError):
            AUTO.validate_worktree(nested)

    def test_deployment_preserves_source_index_working_files_and_head(self):
        (self.source / 'application.txt').write_text('my unfinished change\n')
        (self.source / 'client/package.json').write_text('{"development": true}\n')
        self.git(self.source, 'add', 'client/package.json')
        (self.source / 'untracked.txt').write_text('my notes\n')
        before = (self.git(self.source, 'status', '--porcelain'),
                  self.git(self.source, 'diff', '--cached'),
                  self.git(self.source, 'rev-parse', 'HEAD'))
        with self.fake_cycle():
            AUTO.poll(self.config)
        after = (self.git(self.source, 'status', '--porcelain'),
                 self.git(self.source, 'diff', '--cached'),
                 self.git(self.source, 'rev-parse', 'HEAD'))
        self.assertEqual(before, after)
        self.assertEqual((self.source / 'application.txt').read_text(), 'my unfinished change\n')
        self.assertEqual((self.source / 'untracked.txt').read_text(), 'my notes\n')
        self.assertEqual((self.checkout / 'application.txt').read_text(), 'first\n')

    def test_owner_inputs_must_exist_and_reject_directory_file_and_env_symlinks(self):
        missing = AUTO.Config(**{**self.config.__dict__, 'music_dir': self.root / 'missing'})
        with self.assertRaises(ValueError):
            AUTO.validate_inputs(missing)
        for destination, source in ((self.music / 'linked.ogg', self.music / 'track.ogg'),
                                    (self.emoji / 'linked-directory', self.music)):
            destination.symlink_to(source)
            with self.assertRaises(ValueError):
                AUTO.validate_inputs(self.config)
            destination.unlink()
        linked_env = self.root / 'linked.env'
        linked_env.symlink_to(self.frontend_env)
        config = AUTO.Config(**{**self.config.__dict__, 'frontend_env': linked_env})
        with self.assertRaises(ValueError):
            AUTO.validate_inputs(config)
        directory_env = AUTO.Config(**{**self.config.__dict__, 'frontend_env': self.music})
        with self.assertRaises(ValueError):
            AUTO.validate_inputs(directory_env)
        empty = self.root / 'empty'
        empty.mkdir()
        config = AUTO.Config(**{**self.config.__dict__, 'music_dir': empty, 'emoji_dir': empty})
        AUTO.validate_inputs(config)

    def test_owner_inputs_are_snapshots_and_frontend_settings_are_private(self):
        AUTO.prepare_checkout(self.config, self.sha)
        copied_music = self.checkout / 'local-music/track.ogg'
        self.assertEqual(copied_music.read_bytes(), (self.music / 'track.ogg').read_bytes())
        (self.music / 'track.ogg').write_bytes(b'changed original')
        self.assertEqual(copied_music.read_bytes(), b'owner music fixture')
        self.assertEqual((self.checkout / 'client/.env.local').stat().st_mode & 0o777, 0o600)
        config = AUTO.Config(**{**self.config.__dict__, 'frontend_env': None})
        AUTO.prepare_checkout(config, self.sha)
        self.assertFalse((self.checkout / 'client/.env.local').exists())

    def test_owner_input_destination_symlinks_are_not_followed(self):
        AUTO.prepare_checkout(self.config, self.sha)
        shutil.rmtree(self.checkout / 'local-music')
        (self.checkout / 'local-music').symlink_to(self.music)
        with self.assertRaises(ValueError):
            AUTO.prepare_checkout(self.config, self.sha)
        self.assertEqual((self.music / 'track.ogg').read_bytes(), b'owner music fixture')

    def test_success_receipt_is_written_only_after_install_and_prevents_duplicate_deploy(self):
        def install(config):
            self.assertEqual(AUTO.read_state(config), {'installing_sha': self.sha})
            self.assertEqual(self.git(config.checkout, 'rev-parse', 'HEAD'), self.sha)
        with self.fake_cycle(install=install) as cycle:
            AUTO.poll(self.config)
            self.assertEqual(AUTO.read_state(self.config), {'last_success_sha': self.sha})
            AUTO.poll(self.config)
            self.assertEqual(cycle[1].call_count, 1)
            self.assertEqual(cycle[2].call_count, 1)
            self.assertEqual(len(cycle[3]), 2)

    def test_build_failure_blocks_same_sha_but_new_commit_can_deploy(self):
        with self.fake_cycle(build=RuntimeError('fixture build failed')) as cycle:
            with self.assertRaises(RuntimeError):
                AUTO.poll(self.config)
            self.assertEqual(AUTO.read_state(self.config), {'failed_build_sha': self.sha})
            AUTO.poll(self.config)
            self.assertEqual(cycle[1].call_count, 1)
            cycle[2].assert_not_called()
        self.new_commit()
        with self.fake_cycle() as cycle:
            AUTO.poll(self.config)
            cycle[2].assert_called_once()
        self.assertEqual(AUTO.read_state(self.config), {'last_success_sha': self.sha})

    def test_install_failure_or_interrupt_preserves_halt_and_previous_success(self):
        for failure in (subprocess.CalledProcessError(1, ['fixture-install']), KeyboardInterrupt()):
            with self.subTest(failure=type(failure).__name__):
                AUTO.save_state(self.config, {'last_success_sha': 'a' * 40})
                with self.fake_cycle(install=failure) as cycle:
                    with self.assertRaises(type(failure)):
                        AUTO.poll(self.config)
                    self.assertEqual(AUTO.read_state(self.config), {
                        'last_success_sha': 'a' * 40, 'installing_sha': self.sha})
                with self.fake_cycle() as cycle:
                    AUTO.poll(self.config)
                    cycle[0].assert_not_called()
                    cycle[1].assert_not_called()
                    cycle[2].assert_not_called()

    def test_ci_rerun_during_build_revokes_install_approval(self):
        revoked = self.api_response([self.workflow_run(run_attempt=2, status='in_progress', conclusion=None)])
        with self.fake_cycle(ci_results=[self.api_response(), revoked]) as cycle:
            AUTO.poll(self.config)
            cycle[1].assert_called_once()
            cycle[2].assert_not_called()
        self.assertEqual(AUTO.read_state(self.config), {})

    def test_postbuild_api_error_does_not_block_same_sha_after_api_recovery(self):
        with self.fake_cycle(ci_results=[self.api_response(), RuntimeError('API unavailable')]) as cycle:
            with self.assertRaises(RuntimeError):
                AUTO.poll(self.config)
            cycle[1].assert_called_once()
            cycle[2].assert_not_called()
        self.assertEqual(AUTO.read_state(self.config), {})
        with self.fake_cycle() as cycle:
            AUTO.poll(self.config)
            cycle[2].assert_called_once()
        self.assertEqual(AUTO.read_state(self.config), {'last_success_sha': self.sha})

    def test_changed_release_head_during_build_prevents_install(self):
        original_sha = self.sha
        self.new_commit()
        def build(config):
            self.git(config.checkout, 'checkout', '--detach', self.sha)
        with self.fake_cycle(sha=original_sha, ci_results=[self.api_response([
                self.workflow_run(head_sha=original_sha)])], build=build) as cycle:
            with self.assertRaises(ValueError):
                AUTO.poll(self.config)
            cycle[2].assert_not_called()
        self.assertEqual(AUTO.read_state(self.config), {'failed_build_sha': original_sha})

    def test_lock_covers_entire_cycle_and_cli_does_nothing_when_busy(self):
        with AUTO.cycle_lock(self.config) as acquired:
            self.assertTrue(acquired)
            with AUTO.cycle_lock(self.config) as second:
                self.assertFalse(second)
            with patch.object(sys, 'argv', ['auto-deploy.py', '--config', str(self.config_path)]), \
                    patch.object(AUTO, 'poll') as poll:
                self.assertEqual(AUTO.main(), 0)
                poll.assert_not_called()
        with AUTO.cycle_lock(self.config) as acquired:
            self.assertTrue(acquired)

    def test_cli_recovery_changes_only_requested_block_and_never_installs(self):
        for action, cleared in (('--resume', 'installing_sha'), ('--retry-build', 'failed_build_sha')):
            with self.subTest(action=action):
                state = {'last_success_sha': 'a' * 40, 'installing_sha': self.sha,
                         'failed_build_sha': self.sha}
                AUTO.save_state(self.config, state)
                with patch.object(sys, 'argv', ['auto-deploy.py', '--config', str(self.config_path), action]), \
                        self.fake_cycle() as cycle:
                    self.assertEqual(AUTO.main(), 0)
                    cycle[0].assert_not_called()
                    cycle[1].assert_not_called()
                    cycle[2].assert_not_called()
                state.pop(cleared)
                self.assertEqual(AUTO.read_state(self.config), state)

    def test_inspection_checks_ci_without_preparing_building_or_installing(self):
        with self.fake_cycle() as cycle:
            AUTO.poll(self.config, inspect=True)
            cycle[1].assert_not_called()
            cycle[2].assert_not_called()
        self.assertFalse(self.checkout.exists())
        self.assertEqual(AUTO.read_state(self.config), {})

    def test_inspection_reports_missing_inputs_and_dirty_existing_release(self):
        missing = AUTO.Config(**{**self.config.__dict__, 'emoji_dir': self.root / 'missing'})
        with self.fake_cycle() as cycle:
            with self.assertRaises(ValueError):
                AUTO.poll(missing, inspect=True)
            cycle[0].assert_not_called()
            cycle[2].assert_not_called()
        AUTO.prepare_checkout(self.config, self.sha)
        (self.checkout / 'application.txt').write_text('dirty\n')
        with self.fake_cycle() as cycle:
            with self.assertRaises(ValueError):
                AUTO.poll(self.config, inspect=True)
            cycle[0].assert_not_called()
            cycle[2].assert_not_called()

    def test_invalid_deployment_state_fails_closed(self):
        for state in ({'installing_sha': 'invalid'}, {'unknown': self.sha}, [],
                      {'last_success_sha': 123}):
            with self.subTest(state=state), self.fake_cycle() as cycle:
                (self.state_dir / 'state.json').write_text(json.dumps(state))
                with self.assertRaises(ValueError):
                    AUTO.poll(self.config)
                cycle[0].assert_not_called()
                cycle[2].assert_not_called()

    def notified(self):
        key_file = self.root / 'notify.key'
        key_file.write_text('k' * 40 + '\n')
        self.raw_config['notification'] = {
            'url': 'http://127.0.0.1:4100/notifications/card-together-deploy', 'key_file': str(key_file)}
        self.config_path.write_text(json.dumps(self.raw_config))
        return AUTO.load_config(self.config_path)

    @contextmanager
    def fake_relay(self, failure=None):
        requests = []

        def urlopen(request, timeout):
            requests.append((request.get_method(), request.full_url, request.get_header('Authorization'),
                             json.loads(request.data)))
            if failure:
                raise failure
            return io.BytesIO(b'{}')

        with patch.object(AUTO, 'urlopen', side_effect=urlopen):
            yield requests

    @staticmethod
    def states(body):
        return [(stage['label'], stage['state']) for stage in body['stages']]

    def test_notification_configuration_is_optional_and_validated(self):
        self.assertIsNone(self.config.notification)
        self.assertEqual(self.notified().notification.url, 'http://127.0.0.1:4100/notifications/card-together-deploy')
        for change in ({'url': 'http://relay.example/notifications/deploy'},
                       {'url': 'https://user:pass@relay.example/notifications/deploy'},
                       {'url': 'https://relay.example/notifications/Deploy'},
                       {'url': 'https://relay.example/notifications/deploy?key=1'},
                       {'key_file': 'relative.key'}, {'extra': True}):
            with self.subTest(change=change):
                self.raw_config['notification'] = {**self.raw_config['notification'], **change}
                self.config_path.write_text(json.dumps(self.raw_config))
                with self.assertRaises(ValueError):
                    AUTO.load_config(self.config_path)
                self.notified()

    def test_successful_deployment_updates_one_relay_notification(self):
        config = self.notified()
        with self.fake_cycle(), self.fake_relay() as requests:
            AUTO.poll(config)
        self.assertEqual(len(requests), 4)
        self.assertEqual({method for method, *_ in requests}, {'PUT'})
        self.assertEqual(len({url for _, url, *_ in requests}), 1)
        self.assertRegex(requests[0][1], r'/notifications/card-together-deploy/[0-9a-f]{12}-[0-9]+$')
        self.assertTrue(all(auth == 'Bearer ' + 'k' * 40 for _, _, auth, _ in requests))
        first, installing, done = requests[0][3], requests[2][3], requests[3][3]
        self.assertEqual(first['description'], '- Initial fixture')
        self.assertEqual(first['url'], f'https://github.com/example/cards/commit/{self.sha}')
        self.assertEqual(first['status'], 'running')
        self.assertEqual(self.states(first)[1], ('建置與發布檢查', 'running'))
        self.assertEqual(self.states(installing)[3], ('安裝與健康檢查', 'running'))
        self.assertEqual(done['status'], 'succeeded')
        self.assertEqual({state for _, state in self.states(done)}, {'done'})
        self.assertIn('部署成功', done['summary'])

    def test_failure_notification_matches_the_failed_stage(self):
        config = self.notified()
        with self.fake_cycle(build=RuntimeError('fixture build failed')), self.fake_relay() as requests:
            with self.assertRaises(RuntimeError):
                AUTO.poll(config)
        self.assertEqual(requests[-1][3]['status'], 'failed')
        self.assertEqual(self.states(requests[-1][3])[1:], [
            ('建置與發布檢查', 'failed'), ('重新確認 CI', 'pending'), ('安裝與健康檢查', 'pending')])
        self.assertIn('--retry-build', requests[-1][3]['summary'])
        self.new_commit()
        with self.fake_cycle(install=subprocess.CalledProcessError(1, ['fixture-install'])), \
                self.fake_relay() as requests:
            with self.assertRaises(subprocess.CalledProcessError):
                AUTO.poll(config)
        self.assertEqual(self.states(requests[-1][3])[3], ('安裝與健康檢查', 'failed'))
        self.assertIn('--resume', requests[-1][3]['summary'])

    def test_ci_rerun_during_build_cancels_the_notification(self):
        config = self.notified()
        revoked = self.api_response([self.workflow_run(run_attempt=2, status='in_progress', conclusion=None)])
        with self.fake_cycle(ci_results=[self.api_response(), revoked]), self.fake_relay() as requests:
            AUTO.poll(config)
        self.assertEqual(requests[-1][3]['status'], 'cancelled')
        self.assertEqual(self.states(requests[-1][3])[2], ('重新確認 CI', 'skipped'))

    def test_notification_failures_never_change_deployment_or_leak_the_key(self):
        config = self.notified()
        stderr = io.StringIO()
        with self.fake_cycle() as cycle, self.fake_relay(OSError('k' * 40)) as requests, redirect_stderr(stderr):
            AUTO.poll(config)
            cycle[2].assert_called_once()
        self.assertEqual(len(requests), 4)
        self.assertEqual(AUTO.read_state(config), {'last_success_sha': self.sha})
        self.assertIn('Deployment notification failed: OSError.', stderr.getvalue())
        self.assertNotIn('k' * 40, stderr.getvalue())
        config.notification.key_file.write_text('short\n')
        with self.assertRaises(ValueError):
            AUTO.read_key(config.notification)

    def test_undelivered_updates_are_resent_next_cycle_then_cleared(self):
        config = self.notified()
        with self.fake_cycle(), self.fake_relay(OSError('relay restarting')), redirect_stderr(io.StringIO()):
            AUTO.poll(config)
        pending = AUTO.read_pending(config.state_dir)
        self.assertEqual(len(pending), 1)
        key, entry = next(iter(pending.items()))
        self.assertEqual(entry['body']['status'], 'succeeded')
        with self.fake_relay() as requests, redirect_stdout(io.StringIO()):
            AUTO.flush_pending(config)
        self.assertEqual(len(requests), 1)
        self.assertTrue(requests[0][1].endswith('/' + key))
        self.assertEqual(requests[0][3]['status'], 'succeeded')
        self.assertFalse((config.state_dir / AUTO.PENDING_NOTIFICATIONS).exists())

    def test_relay_recovery_mid_deployment_clears_the_pending_update(self):
        config = self.notified()
        calls = []

        def urlopen(request, timeout):
            calls.append(request.full_url)
            if len(calls) < 3:
                raise OSError('relay restarting')
            return io.BytesIO(b'{}')

        with self.fake_cycle(), patch.object(AUTO, 'urlopen', side_effect=urlopen), redirect_stderr(io.StringIO()):
            AUTO.poll(config)
        self.assertEqual(AUTO.read_pending(config.state_dir), {})

    def test_stale_or_damaged_pending_updates_are_dropped_without_requests(self):
        config = self.notified()
        AUTO.write_json(config.state_dir, AUTO.PENDING_NOTIFICATIONS, {
            'abc-1': {'body': {'status': 'running'}, 'since': time.time() - AUTO.PENDING_TTL_SECONDS - 1},
            'bad key': {'body': {}, 'since': 0}})
        with self.fake_relay() as requests, redirect_stderr(io.StringIO()):
            AUTO.flush_pending(config)
        self.assertEqual(requests, [])
        self.assertFalse((config.state_dir / AUTO.PENDING_NOTIFICATIONS).exists())
        (config.state_dir / AUTO.PENDING_NOTIFICATIONS).write_text('{not json')
        with redirect_stderr(io.StringIO()):
            self.assertEqual(AUTO.read_pending(config.state_dir), {})

if __name__ == '__main__':
    unittest.main()
