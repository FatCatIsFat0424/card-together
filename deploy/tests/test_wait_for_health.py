"""Exercise health polling against an isolated local HTTP server."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "wait-for-health.py"
HEALTHY = (200, b'{"status":"ok"}')


class WaitForHealthTests(unittest.TestCase):
    def run_health_check(self, responses):
        calls = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                status, body = responses[min(len(calls), len(responses) - 1)]
                calls.append(self.path)
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    # Timeout cases deliberately disconnect before a final response.
                    pass

            def log_message(self, format, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(
                target=server.serve_forever, kwargs={"poll_interval": 0.01},
                daemon=True,
            )
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}/health"
                environment = {
                    **os.environ,
                    "http_proxy": "http://127.0.0.1:1",
                    "HTTP_PROXY": "http://127.0.0.1:1",
                    "no_proxy": "",
                    "NO_PROXY": "",
                }
                result = subprocess.run(
                    [sys.executable, "-B", str(SCRIPT), url,
                     "--timeout", "0.3", "--interval", "0.02"],
                    env=environment, capture_output=True, text=True, timeout=5,
                )
            finally:
                server.shutdown()
                thread.join(timeout=2)
        self.assertTrue(all(path == "/health" for path in calls))
        return result, calls

    def assert_timeout(self, result, calls):
        self.assertNotEqual(result.returncode, 0)
        self.assertGreaterEqual(len(calls), 2)
        self.assertRegex(
            (result.stdout + result.stderr).lower(), r"timeout|timed out",
        )

    def test_retries_http_errors_until_the_health_endpoint_is_ready(self):
        for status, body, retries in ((404, b"Not Found", 2), (502, b"Bad Gateway", 1)):
            with self.subTest(status=status):
                result, calls = self.run_health_check([(status, body)] * retries + [HEALTHY])
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(calls, ["/health"] * (retries + 1))

    def test_invalid_json_does_not_count_as_healthy(self):
        result, calls = self.run_health_check([(200, b"not json")])
        self.assert_timeout(result, calls)

    def test_unhealthy_json_status_times_out(self):
        result, calls = self.run_health_check([(200, b'{"status":"bad"}')])
        self.assert_timeout(result, calls)

    def test_healthy_response_succeeds_immediately_without_proxy(self):
        result, calls = self.run_health_check([HEALTHY])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
