#!/usr/bin/env python3
"""
End-to-end tests for request-handler.py: spins up the real server as a
subprocess and exercises it over real HTTP (golden paths, error paths, edge
cases), including schema validation against the repo's independent validators.

Run: python3 test_request_handler.py
"""
import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VALIDATORS_DIR = os.path.join(HERE, "..", "schemas-validators")


def _free_port() -> int:
    """Ask the OS for a free ephemeral port, to avoid colliding with anything
    else running on a fixed port (this exact flake happened once already)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = _free_port()
BASE = f"http://127.0.0.1:{PORT}"
WELL_KNOWN = f"{BASE}/.well-known/sustainability"


def _validate_schema(doc) -> None:
    """Cross-check a response body against both independent validators."""
    path = os.path.abspath(os.path.join(HERE, "_rh_test_tmp.json"))
    with open(path, "w") as f:
        json.dump(doc, f)
    try:
        for script in ("validator-json.py", "validator-cddl.py"):
            # The validators resolve response-schema.{json,cddl} relative to
            # their own cwd, so this must run with cwd=VALIDATORS_DIR.
            r = subprocess.run(
                [sys.executable, script, path],
                cwd=VALIDATORS_DIR,
                capture_output=True,
                text=True,
            )
            if r.returncode != 0:
                raise AssertionError(f"{script} failed:\n{r.stdout}\n{r.stderr}")
    finally:
        os.remove(path)


class RequestHandlerE2ETests(unittest.TestCase):
    proc = None

    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "request-handler.py"), str(PORT)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(50):
            try:
                urllib.request.urlopen(WELL_KNOWN, timeout=0.2)
                break
            except Exception:
                time.sleep(0.1)
        else:
            cls.proc.terminate()
            raise RuntimeError("request-handler.py did not start in time")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)

    def _get(self, path="", headers=None, method="GET"):
        req = urllib.request.Request(f"{WELL_KNOWN}{path}", headers=headers or {}, method=method)
        try:
            resp = urllib.request.urlopen(req)
            return resp.status, dict(resp.getheaders()), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    # --- golden paths ---

    def test_basic_returns_single_object(self):
        status, headers, body = self._get()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertIn("public, max-age=86400", headers["Cache-Control"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        doc = json.loads(body)
        self.assertIsInstance(doc, dict)
        # -03: `target` (the reporting subject) is mandatory; these are
        # origin-wide reports, so it carries the origin's host. `version`
        # is an informational label; "2.0" denotes the -03 field set.
        self.assertEqual(doc["target"], "example.com")
        self.assertEqual(doc["version"], "2.0")
        _validate_schema(doc)

    def test_extended_with_granularity_returns_sorted_array(self):
        status, _, body = self._get("?period=2026&granularity=monthly")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertIsInstance(doc, list)
        self.assertGreater(len(doc), 1)
        periods = [d["reporting-period"] for d in doc]
        self.assertEqual(periods, sorted(periods))
        # -03: all entries of a trend array MUST share the same `target`.
        self.assertEqual({d["target"] for d in doc}, {"example.com"})
        _validate_schema(doc)

    def test_head_matches_get_headers_with_no_body(self):
        get_status, get_headers, _ = self._get()
        head_status, head_headers, head_body = self._get(method="HEAD")
        self.assertEqual(head_status, get_status)
        self.assertEqual(head_headers.get("Content-Length"), get_headers.get("Content-Length"))
        self.assertEqual(head_body, b"")

    def test_conditional_get_returns_304(self):
        _, headers, _ = self._get()
        etag = headers["ETag"]
        status, _, body = self._get(headers={"If-None-Match": etag})
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")

    # --- error paths ---

    def test_post_returns_405_with_allow_header(self):
        status, headers, body = self._get(method="POST")
        self.assertEqual(status, 405)
        self.assertEqual(headers["Allow"], "GET, HEAD")
        self.assertEqual(headers["Content-Type"], "application/json")
        json.loads(body)  # body is valid JSON

    def test_put_and_delete_also_405(self):
        for method in ("PUT", "DELETE", "PATCH"):
            status, headers, _ = self._get(method=method)
            self.assertEqual(status, 405, f"{method} should be 405")
            self.assertEqual(headers["Allow"], "GET, HEAD")

    def test_other_methods_also_405_not_501(self):
        # Draft: ANY method other than GET/HEAD SHOULD get 405 — not http.server's
        # default 501. Covers OPTIONS/TRACE and an arbitrary custom method.
        for method in ("OPTIONS", "TRACE", "BREW"):
            status, headers, _ = self._get(method=method)
            self.assertEqual(status, 405, f"{method} should be 405, not 501")
            self.assertEqual(headers["Allow"], "GET, HEAD")

    def test_unknown_path_returns_404(self):
        req = urllib.request.Request(f"{BASE}/nope")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 404)

    # --- edge cases ---

    def test_period_with_no_matching_data_returns_404(self):
        status, _, _ = self._get("?period=1999")
        self.assertEqual(status, 404)

    def test_basic_request_never_returns_an_array(self):
        _, _, body = self._get()
        self.assertIsInstance(json.loads(body), dict)

    def test_period_without_granularity_is_still_a_single_object(self):
        status, _, body = self._get("?period=2026-02")
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(body), dict)


if __name__ == "__main__":
    unittest.main()
