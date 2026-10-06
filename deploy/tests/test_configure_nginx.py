"""Regression tests for safe, repeatable nginx site candidate generation."""

import importlib.util
from pathlib import Path
import sys
import unittest

SPEC = importlib.util.spec_from_file_location(
    "configure_nginx", Path(__file__).resolve().parents[1] / "configure-nginx.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

SITE = '''# Existing routes must remain byte-for-byte intact.
server {
    listen 192.168.10.10:80;
    server_name acserver.csie.org;
    location /larp { return 308 https://acserver.csie.org$request_uri; }
}
server {
    listen 192.168.10.10:443 ssl;
    server_name acserver.csie.org;
    ssl_certificate /etc/cert.pem;
    location /trading/ { proxy_pass http://127.0.0.1:8765; }
}
'''


class ConfigureTests(unittest.TestCase):
    def test_preservation_and_idempotency(self):
        result = MODULE.configure(SITE)
        self.assertEqual(MODULE.configure(result), result)
        restored = result
        for block in MODULE.BLOCKS.values():
            self.assertEqual(result.count(block), 1)
            restored = restored.replace(block, "")
        self.assertEqual(restored, SITE)

    def test_legacy_http_block_migration(self):
        legacy = MODULE.configure(SITE).replace(
            MODULE.BLOCKS['http'], MODULE.LEGACY_BLOCKS['http']
        )
        result = MODULE.configure(legacy)
        self.assertEqual(result, MODULE.configure(SITE))
        self.assertEqual(MODULE.configure(result), result)

    def test_previous_include_blocks_migrate(self):
        previous = MODULE.configure(SITE)
        for protocol, block in MODULE.BLOCKS.items():
            previous = previous.replace(block, MODULE.PREVIOUS_BLOCKS[protocol])
        self.assertEqual(MODULE.configure(previous), MODULE.configure(SITE))

    def test_legacy_page_redirect_preserves_suffix_and_query(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        location = next(node for node in MODULE.parse(snippet)
                        if node.words == ['location', '/bridge_online/'])
        rewrite = next(child.words for child in location.children
                       if child.words[0] == 'rewrite')
        self.assertEqual(rewrite, ['rewrite', '^/bridge_online/(.*)$',
                                  '/card-together/$1', 'permanent'])
        self.assertNotIn('?', rewrite[2])

    def test_cookie_rewrite_preserves_explicit_migration_paths(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        for path in ('/card-together/api/', '/bridge_online/api/'):
            location = next(node for node in MODULE.parse(snippet) if node.words[-1] == path)
            directive = next(child.words for child in location.children
                             if child.words[0] == 'proxy_cookie_path')
            expected = '/bridge_online/' if path.startswith('/bridge_online/') else '/card-together/'
            self.assertEqual(directive, ['proxy_cookie_path', '~^/$', expected])

    def test_duplicate_legacy_and_current_block(self):
        with self.assertRaises(ValueError):
            MODULE.configure(MODULE.configure(SITE) + MODULE.LEGACY_BLOCKS['http'])

    def test_modified_legacy_block_is_rejected(self):
        legacy = MODULE.configure(SITE).replace(
            MODULE.BLOCKS['http'], MODULE.LEGACY_BLOCKS['http'].replace('308', '301')
        )
        with self.assertRaises(ValueError):
            MODULE.configure(legacy)

    def test_proxy_paths_remove_service_prefix(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        nodes = MODULE.parse(snippet)
        expected = {
            '/card-together/api/': 'http://127.0.0.1:3001/api/',
            '/card-together/socket.io/': 'http://127.0.0.1:3001/socket.io/',
            '/card-together/health': 'http://127.0.0.1:3001/health',
            '/bridge_online/api/': 'http://127.0.0.1:3001/api/',
            '/bridge_online/socket.io/': 'http://127.0.0.1:3001/socket.io/',
            '/bridge_online/health': 'http://127.0.0.1:3001/health',
        }
        actual = {
            node.words[-1]: child.words[1]
            for node in nodes if node.words[0] == 'location'
            for child in node.children if child.words[0] == 'proxy_pass'
        }
        self.assertEqual(actual, expected)

    def test_api_upload_limit_accepts_base64_background(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        location = next(node for node in MODULE.parse(snippet)
                        if node.words[-1] == '/card-together/api/')
        limit = next(child.words[1] for child in location.children
                     if child.words[0] == 'client_max_body_size')
        self.assertEqual(limit, '3m')
        maximum_background_json = 4 * ((2 * 1024 * 1024 + 2) // 3) + 64
        self.assertLess(maximum_background_json, 3 * 1024 * 1024)

    def test_comments_quotes_escapes_and_variables(self):
        site = SITE.replace('ssl_certificate /etc/cert.pem;', r'''
    # } { ignored comment
    set $example "quoted } { # ;";
    set $other 'single { }';
    set $escaped escaped\{brace\};
    set $variable ${request_uri};
''')
        result = MODULE.configure(site)
        for block in MODULE.BLOCKS.values():
            result = result.replace(block, "")
        self.assertEqual(result, site)

    def test_conflicting_routes_and_includes(self):
        for directive in (
            'location = /bridge_online { return 404; }',
            'location ^~ /bridge_online/ { return 404; }',
            'location ~ "^/bridge_online" { return 404; }',
            'include /etc/nginx/snippets/bridge-online.conf;',
            'location ^~ /card-together/ { return 404; }',
            'include /etc/nginx/snippets/card-together.conf;',
        ):
            with self.subTest(directive=directive), self.assertRaises(ValueError):
                MODULE.configure(SITE.replace('ssl_certificate /etc/cert.pem;', directive))

    def test_duplicate_server(self):
        with self.assertRaises(ValueError):
            MODULE.configure(SITE + SITE)

    def test_missing_server(self):
        with self.assertRaises(ValueError):
            MODULE.configure(SITE.replace('443 ssl', '8443 ssl'))

    def test_malformed_syntax(self):
        for suffix in ('}', 'server {', 'dangling', 'set $x "unterminated;', 'set $x trailing\\'):
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                MODULE.configure(SITE + suffix)

    def test_modified_markers(self):
        result = MODULE.configure(SITE)
        with self.assertRaises(ValueError):
            MODULE.configure(result.replace('card-together-http.conf', 'modified.conf'))

    def test_wrong_managed_block_placement(self):
        with self.assertRaises(ValueError):
            MODULE.configure(SITE + MODULE.BLOCKS['https'])

    def test_unrelated_server_remains_untouched(self):
        unrelated = 'server { listen 80; server_name example.org; location /bridge_online {} }\n'
        result = MODULE.configure(SITE + unrelated)
        self.assertTrue(result.endswith(unrelated))


if __name__ == '__main__':
    unittest.main()
