"""Prove command doubles retain isolation and the real shell's command boundaries."""

import os
from pathlib import Path
import shlex
import socket
import subprocess
import tempfile
import unittest

from deployment_fixture import DeploymentFixture


class DeploymentFixtureTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DeploymentFixture()
        self.addCleanup(self.fixture.close)

    def command(self, name, *arguments, **changes):
        return subprocess.run([str(self.fixture.bin / name), *arguments],
                              env=self.fixture.environment(**changes), capture_output=True, text=True)

    def test_filesystem_commands_reject_host_paths_and_symlink_escapes(self):
        with tempfile.TemporaryDirectory(prefix=self.fixture.root.name + '-outside-') as directory:
            outside = Path(directory)
            protected = outside / 'protected'
            protected.write_text('preserved')
            escape = self.fixture.root / 'escape'
            escape.symlink_to(outside, target_is_directory=True)
            bare_escape = self.fixture.root / 'bare-escape'
            bare_escape.symlink_to(protected)
            paths = ('/etc/card-together/server.env', str(escape / 'protected'),
                     str(protected), '../outside/file', '..', 'bare-escape')
            for path in paths:
                with self.subTest(path=path):
                    result = self.command('rm', path)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Out-of-root', result.stderr)
            source = self.fixture.root / 'source'
            source.write_text('source')
            for name, arguments in (
                ('chmod', ('--reference=' + str(protected), str(source))),
                ('rsync', ('--link-dest=' + str(outside), str(source), str(self.fixture.root / 'target'))),
                ('useradd', ('--home-dir=' + str(outside), 'card-together')),
            ):
                with self.subTest(option=name):
                    result = self.command(name, *arguments)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Out-of-root', result.stderr)
            self.assertEqual(protected.read_text(), 'preserved')

    def test_filesystem_options_cannot_redirect_commands_outside_the_fixture(self):
        source = self.fixture.root / 'source'
        source.write_text('preserved source')
        target = self.fixture.root / 'target'
        with tempfile.TemporaryDirectory() as directory:
            outside = Path(directory)
            sentinel = outside / 'sentinel'
            sentinel.write_text('preserved sentinel')
            for name, options in (
                ('install', ('--target-directory=' + str(outside),)),
                ('install', ('-t' + str(outside),)),
                ('install', ('-t', str(outside))),
                ('cp', ('--target-directory=' + str(outside),)),
                ('cp', ('-t' + str(outside),)),
                ('mv', ('--target-directory=' + str(outside),)),
                ('mv', ('-t' + str(outside),)),
                ('rsync', ('--backup-dir=' + str(outside),)),
                ('rsync', ('--temp-dir=' + str(outside),)),
                ('rsync', ('--files-from=' + str(sentinel),)),
                ('rsync', ('--log-file=' + str(sentinel),)),
                ('rsync', ('--rsh=sh',)),
                ('mktemp', ('--tmpdir=' + str(outside),)),
                ('rm', ('--unapproved-option',)),
                ('find', ('-exec', 'bash', '-c', 'printf triggered', ';')),
            ):
                with self.subTest(command=name, options=options):
                    result = self.command(name, *options, str(source), str(target))
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Unexpected', result.stderr)
                    self.assertEqual(source.read_text(), 'preserved source')
                    self.assertEqual(sentinel.read_text(), 'preserved sentinel')
                    self.assertEqual(list(outside.iterdir()), [sentinel])
                    self.assertFalse(target.exists())

    def test_rsync_rejects_remote_syntax_without_invoking_a_network_command(self):
        for source in ('fixture.invalid:/outside', 'rsync://fixture.invalid/outside'):
            with self.subTest(source=source):
                result = self.command('rsync', '-a', source, str(self.fixture.root / 'target'))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Unexpected remote rsync path', result.stderr)
                self.assertFalse((self.fixture.root / 'target').exists())

    def test_undeclared_command_and_service_operation_are_rejected(self):
        for command in ('sudo true', 'systemctl reboot'):
            with self.subTest(command=command):
                result = subprocess.run(['/bin/bash', '-c', command],
                                        env=self.fixture.environment(), capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
        unknown = self.fixture.bin / 'unknown'
        unknown.symlink_to(self.fixture.bin / 'dispatcher')
        result = self.command('unknown')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Undeclared fixture command', result.stderr)

    def test_python_and_validator_doubles_reject_unapproved_operations(self):
        for name, arguments in (
            ('python3', ('-',)),
            ('python3', (str(self.fixture.root / 'unapproved.py'),)),
            ('python3', (str(self.fixture.checkout / 'deploy/wait-for-health.py'), 'https://unapproved/health')),
            ('nginx', ('-s', 'reload')),
            ('systemd-analyze', ('security',)),
            ('grep', ('-q', 'pattern', str(self.fixture.site / 'index.html'))),
        ):
            with self.subTest(command=name, arguments=arguments):
                result = self.command(name, *arguments)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Unexpected', result.stderr)

    def test_bash_and_python_cannot_execute_inline_or_same_named_unapproved_scripts(self):
        marker = self.fixture.root / 'executed'
        bash = self.fixture.root / 'prune-assets.sh'
        bash.write_text('printf triggered > ' + shlex.quote(str(marker)) + '\n')
        python = self.fixture.root / 'configure-nginx.py'
        python.write_text('from pathlib import Path\nPath(' + repr(str(marker)) + ').write_text("triggered")\n')
        for name, arguments in (
            ('bash', ('-c', 'printf triggered > executed')),
            ('bash', (str(bash), str(self.fixture.site), str(self.fixture.site))),
            ('python3', (str(python),)),
            ('python3', ('--output=' + str(marker),)),
        ):
            with self.subTest(command=name, arguments=arguments):
                result = self.command(name, *arguments)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Unexpected', result.stderr)
                self.assertFalse(marker.exists())

    def test_real_copy_and_modes_preserve_special_arguments_and_json(self):
        source = self.fixture.root / 'source " $() ` \\ \n\t\x01 台灣'
        target = self.fixture.root / 'target " $() ` \\ \n\t\x01 台灣'
        source.write_bytes(b'fixture data')
        result = self.command('install', '-m', '0600', str(source), str(target))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(target.read_bytes(), source.read_bytes())
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.fixture.calls(), [['install', '-m', '0600', str(source), str(target)]])

    def test_failure_occurrence_preserves_exit_code_and_command_order(self):
        statuses = [self.command('date', '-u', FAIL_COMMAND='date -u', FAIL_OCCURRENCE='2').returncode
                    for _ in range(3)]
        self.assertEqual(statuses, [0, 7, 0])
        self.assertEqual(self.fixture.calls(), [['date', '-u']] * 3)

    def test_flock_keeps_the_parent_descriptor_locked_and_rejects_outside_descriptors(self):
        lock = self.fixture.root / 'lock'
        result = subprocess.run([
            '/bin/bash', '-c', 'exec 9> "$1"; "$2" -n 9; exec 10> "$1"; "$3" -n 10',
            'flock-fixture', str(lock), str(self.fixture.bin / 'flock'), self.fixture.executables['flock'],
        ], env=self.fixture.environment(), capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(self.fixture.calls(), [['flock', '-n', '9']])
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([
                '/bin/bash', '-c', 'exec 9> "$1"; "$2" -n 9', 'flock-fixture',
                str(Path(directory) / 'lock'), str(self.fixture.bin / 'flock'),
            ], env=self.fixture.environment(), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Out-of-root', result.stderr)
        for descriptor in ('999', 'not-a-descriptor'):
            with self.subTest(descriptor=descriptor):
                result = self.command('flock', '-n', descriptor)
                self.assertNotEqual(result.returncode, 0)
        fifo = self.fixture.root / 'fifo'
        os.mkfifo(fifo)
        fifo_descriptor = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
        self.addCleanup(os.close, fifo_descriptor)
        with socket.socket(socket.AF_UNIX) as connection:
            connection.bind(str(self.fixture.root / 'socket'))
            for descriptor in (fifo_descriptor, connection.fileno()):
                with self.subTest(descriptor=descriptor):
                    result = subprocess.run([
                        str(self.fixture.bin / 'flock'), '-n', str(descriptor),
                    ], env=self.fixture.environment(), pass_fds=(descriptor,),
                        capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('regular fixture file', result.stderr)

    def test_path_resolver_failure_prevents_real_filesystem_commands(self):
        resolver = self.fixture.root / 'broken-realpath'
        resolver.write_text('#!/bin/bash\nprintf \'%s\\0\' \"$3\"\nexit 7\n')
        resolver.chmod(0o755)
        dispatcher = self.fixture.bin / 'dispatcher'
        dispatcher.write_text('\n'.join(
            'realpath=' + shlex.quote(str(resolver)) if line.startswith('realpath=') else line
            for line in dispatcher.read_text().splitlines()) + '\n')
        protected = self.fixture.root / 'protected'
        protected.write_text('preserved')
        result = self.command('rm', str(protected))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Could not resolve fixture paths', result.stderr)
        self.assertEqual(protected.read_text(), 'preserved')


if __name__ == '__main__':
    unittest.main()
