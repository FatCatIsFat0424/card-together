"""Verify official runtime acquisition and failure boundaries without network access."""

from contextlib import ExitStack
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.request import Request


SCRIPT = Path(__file__).resolve().parents[1] / 'with-node.py'
SPEC = importlib.util.spec_from_file_location('card_with_node', SCRIPT)
NODE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NODE)
NAME = 'node-v24.22.1-linux-x64'


class OfficialNodeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='card-official-node-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / '.node-version').write_text('24.22.1\n')

    def archive(self, members=None):
        path = self.root / f'{NAME}.tar.xz'
        entries = members if members is not None else [
            (f'{NAME}/bin/node', b'#!/bin/sh\necho 24.22.1\n', None),
            (f'{NAME}/lib/node_modules/npm/bin/npm-cli.js', b'#!/bin/sh\nexit 0\n', None),
            (f'{NAME}/bin/npm', None, '../lib/node_modules/npm/bin/npm-cli.js'),
        ]
        with tarfile.open(path, 'w:xz') as archive:
            for name, data, target in entries:
                member = tarfile.TarInfo(name)
                member.mode = 0o755
                if target is not None:
                    member.type = tarfile.SYMTYPE
                    member.linkname = target
                    archive.addfile(member)
                else:
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
        return path

    def manifest(self, archive):
        path = self.root / 'SHASUMS256.txt'
        path.write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n')
        return path

    def runtime_context(self, *, version='24.22.1', result=0, download_error=None):
        archive = self.archive()
        manifest = self.manifest(archive)

        def download(url, destination):
            self.assertTrue(url.startswith('https://nodejs.org/dist/v24.22.1/'))
            if download_error:
                raise download_error
            destination.write_bytes((manifest if url.endswith('SHASUMS256.txt') else archive).read_bytes())

        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(NODE.os, 'geteuid', return_value=1000))
        stack.enter_context(patch.object(NODE.platform, 'system', return_value='Linux'))
        stack.enter_context(patch.object(NODE.platform, 'machine', return_value='x86_64'))
        downloader = stack.enter_context(patch.object(NODE, 'download', side_effect=download))
        runner = stack.enter_context(patch.object(NODE.subprocess, 'run', side_effect=[
            subprocess.CompletedProcess([], 0, stdout=f'{version}\n'),
            subprocess.CompletedProcess([], result),
        ]))
        return downloader, runner

    def test_platform_mapping_and_invalid_inputs_fail_before_download(self):
        for machine, expected in [('x86_64', 'x64'), ('aarch64', 'arm64')]:
            with self.subTest(machine=machine), patch.object(NODE.platform, 'system', return_value='Linux'), \
                    patch.object(NODE.platform, 'machine', return_value=machine):
                self.assertEqual(NODE.distribution_name('24.22.1'), f'node-v24.22.1-linux-{expected}')
        for system, machine, version in [('Darwin', 'x86_64', '24.22.1'),
                                          ('Linux', 'unknown', '24.22.1'),
                                          ('Linux', 'x86_64', '../24.22.1')]:
            with self.subTest(system=system, machine=machine, version=version), \
                    patch.object(NODE.platform, 'system', return_value=system), \
                    patch.object(NODE.platform, 'machine', return_value=machine):
                with self.assertRaises(ValueError):
                    NODE.distribution_name(version)

    def test_checksum_requires_exact_unique_manifest_entry_and_matching_bytes(self):
        archive = self.archive()
        manifest = self.manifest(archive)
        valid = manifest.read_text()
        NODE.verify_archive(archive, manifest)
        for content in ['', valid + valid, 'invalid  ' + archive.name,
                        valid.replace(archive.name, 'another.tar.xz'), '0' * 64 + '  ' + archive.name]:
            with self.subTest(manifest=content):
                manifest.write_text(content)
                with self.assertRaises(ValueError):
                    NODE.verify_archive(archive, manifest)

    def test_archive_accepts_internal_npm_link(self):
        archive = self.archive()
        runtime = NODE.extract_runtime(archive, self.root, NAME)
        self.assertTrue((runtime / 'bin/node').is_file())
        self.assertTrue((runtime / 'bin/npm').is_symlink())
        self.assertTrue((runtime / 'bin/npm').resolve().is_relative_to(runtime))

    def test_archive_rejects_traversal_foreign_root_and_escaping_links(self):
        for name, target in [(f'{NAME}/../../escape', None), ('/absolute', None),
                             ('other/bin/node', None), (f'{NAME}/bin/node', '/bin/sh'),
                             (f'{NAME}/bin/node', '../../../escape')]:
            with self.subTest(name=name, target=target):
                archive = self.archive([(name, b'invalid', target)])
                with self.assertRaises((ValueError, tarfile.FilterError)):
                    NODE.extract_runtime(archive, self.root, NAME)

    def test_archive_rejects_missing_or_non_executable_runtime(self):
        archive = self.archive([(f'{NAME}/README.md', b'incomplete', None)])
        with self.assertRaises(ValueError):
            NODE.extract_runtime(archive, self.root, NAME)

    def test_command_uses_private_node_and_npm_and_propagates_status_then_cleans_up(self):
        downloader, runner = self.runtime_context(result=7)
        self.assertEqual(NODE.run_command(self.root, ['npm', 'run', 'check', '--', 'full']), 7)
        self.assertEqual(downloader.call_count, 2)
        self.assertEqual(runner.call_args.args[0], ['npm', 'run', 'check', '--', 'full'])
        self.assertEqual(runner.call_args.kwargs['cwd'], self.root)
        runtime_bin = Path(runner.call_args.kwargs['env']['PATH'].split(os.pathsep)[0])
        self.assertEqual(runtime_bin.parent.name, NAME)
        self.assertFalse(runtime_bin.parent.parent.exists())

    def test_node_version_mismatch_never_runs_requested_command(self):
        _, runner = self.runtime_context(version='24.21.0')
        with self.assertRaisesRegex(ValueError, 'pinned version'):
            NODE.run_command(self.root, ['npm', 'ci'])
        self.assertEqual(runner.call_count, 1)

    def test_corrupt_archive_never_extracts_or_runs(self):
        downloader, runner = self.runtime_context()
        original_download = downloader.side_effect

        def corrupt(url, destination):
            original_download(url, destination)
            if url.endswith('.tar.xz'):
                destination.write_bytes(b'corrupt archive')

        downloader.side_effect = corrupt
        with patch.object(NODE, 'extract_runtime') as extract:
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                NODE.run_command(self.root, ['npm', 'ci'])
            extract.assert_not_called()
        runner.assert_not_called()

    def test_failed_download_never_runs_command_and_removes_partial_files(self):
        downloader, runner = self.runtime_context(download_error=OSError('fixture network failure'))
        with self.assertRaises(OSError):
            NODE.run_command(self.root, ['npm', 'ci'])
        runner.assert_not_called()
        self.assertFalse(downloader.call_args.args[1].parent.exists())

    def test_signalled_command_returns_shell_status(self):
        self.runtime_context(result=-15)
        self.assertEqual(NODE.run_command(self.root, ['npm', 'ci']), 143)

    def test_root_and_empty_command_fail_without_network(self):
        with patch.object(NODE, 'download') as download:
            with patch.object(NODE.os, 'geteuid', return_value=0):
                with self.assertRaisesRegex(ValueError, 'not root'):
                    NODE.run_command(self.root, ['npm', 'ci'])
            with patch.object(NODE.os, 'geteuid', return_value=1000):
                with self.assertRaisesRegex(ValueError, 'command'):
                    NODE.run_command(self.root, [])
            download.assert_not_called()

    def test_redirects_cannot_downgrade_or_leave_official_origin(self):
        handler = NODE.OfficialRedirectHandler()
        request = Request('https://nodejs.org/dist/example')
        for destination in ['http://nodejs.org/file', 'https://example.com/file',
                            'https://nodejs.org.example.com/file', 'https://user@nodejs.org/file']:
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                handler.redirect_request(request, None, 302, 'Found', {}, destination)
        redirect = handler.redirect_request(request, None, 302, 'Found', {}, 'https://nodejs.org/file')
        self.assertEqual(redirect.full_url, 'https://nodejs.org/file')


if __name__ == '__main__':
    unittest.main()
