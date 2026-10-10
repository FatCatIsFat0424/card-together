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


def directives(location, name):
    return [child.words for child in location.children if child.words[0] == name]


class ConfigureTests(unittest.TestCase):
    def test_preservation_and_idempotency(self):
        result = MODULE.configure(SITE)
        self.assertEqual(MODULE.configure(result), result)
        restored = result
        for block in MODULE.BLOCKS.values():
            self.assertEqual(result.count(block), 1)
            restored = restored.replace(block, "")
        self.assertEqual(restored, SITE)

    def test_cookie_rewrite_preserves_explicit_expiry_paths(self):
        location = self.snippet_locations()['/card-together/api/']
        directive = next(child.words for child in location.children
                         if child.words[0] == 'proxy_cookie_path')
        self.assertEqual(directive, ['proxy_cookie_path', '~^/$', '/card-together/'])

    def test_duplicate_managed_block(self):
        with self.assertRaises(ValueError):
            MODULE.configure(MODULE.configure(SITE) + MODULE.BLOCKS['http'])

    def test_proxy_paths_remove_service_prefix(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        nodes = MODULE.parse(snippet)
        expected = {
            '/card-together/api/': 'http://127.0.0.1:3001/api/',
            '/card-together/socket.io/': 'http://127.0.0.1:3001/socket.io/',
            '/card-together/health': 'http://127.0.0.1:3001/health',
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

    def test_hashed_assets_are_immutable_and_never_fall_back_to_index(self):
        locations = self.snippet_locations()
        assets = locations['/card-together/assets/']
        self.assertEqual(directives(assets, 'try_files'), [['try_files', '$uri', '=404']])
        self.assertIn(
            ['add_header', 'Cache-Control', 'public, max-age=31536000, immutable'],
            directives(assets, 'add_header'),
        )
        shell = locations['/card-together/']
        self.assertIn('/card-together/index.html', directives(shell, 'try_files')[0])
        self.assertIn(['add_header', 'Cache-Control', 'no-cache'], directives(shell, 'add_header'))

    def test_site_emoji_are_immutable_and_never_fall_back_to_index(self):
        emoji = self.snippet_locations()['/card-together/provided-emoji/']
        self.assertEqual(emoji.words[:2], ['location', '^~'])
        self.assertEqual(directives(emoji, 'root'), [['root', '/opt/card-together/www']])
        self.assertEqual(directives(emoji, 'try_files'), [['try_files', '$uri', '=404']])
        self.assertIn(
            ['add_header', 'Cache-Control', 'public, max-age=31536000, immutable'],
            directives(emoji, 'add_header'),
        )

    def test_security_headers_are_repeated_where_add_header_is_used(self):
        required = {'X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy-Report-Only'}
        locations = self.snippet_locations()
        for path in ('/card-together/assets/', '/card-together/provided-emoji/', '/card-together/'):
            names = {words[1] for words in directives(locations[path], 'add_header')}
            self.assertTrue(required <= names, path)
        api = {words[1] for words in directives(locations['/card-together/api/'], 'add_header')}
        self.assertIn('X-Content-Type-Options', api)
        policy = next(words[2] for words in directives(locations['/card-together/'], 'add_header')
                      if words[1] == 'Content-Security-Policy-Report-Only')
        self.assertIn("frame-ancestors 'self'", policy)
        self.assertIn("object-src 'none'", policy)
        for words in directives(locations['/card-together/'], 'add_header'):
            self.assertNotEqual(words[1], 'Content-Security-Policy')

    def test_text_assets_are_compressed(self):
        locations = self.snippet_locations()
        for path in ('/card-together/assets/', '/card-together/'):
            self.assertIn(['gzip', 'on'], directives(locations[path], 'gzip'))
            types = directives(locations[path], 'gzip_types')[0][1:]
            for mime in ('image/svg+xml', 'text/css', 'application/javascript'):
                self.assertIn(mime, types)

    def snippet_locations(self):
        snippet = (Path(__file__).resolve().parents[1] / 'nginx/card-together.conf').read_text()
        return {node.words[-1]: node for node in MODULE.parse(snippet) if node.words[0] == 'location'}

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
        unrelated = 'server { listen 80; server_name example.org; location /unrelated {} }\n'
        result = MODULE.configure(SITE + unrelated)
        self.assertTrue(result.endswith(unrelated))


if __name__ == '__main__':
    unittest.main()
