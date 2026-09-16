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
WELL_KNOWN = f"{BASE}/.well-known/sustainability-data"


def _validator_python() -> str:
    """The interpreter that runs the validators: this one if it has the `jtd`
    module, otherwise the project's virtualenv (see schemas-validators/README.md),
    otherwise fail with a message that says what to install."""
    try:
        import jtd  # noqa: F401
        return sys.executable
    except ImportError:
        pass
    venv = os.path.expanduser("~/.cache/sustain-venv/bin/python3")
    if os.path.exists(venv):
        return venv
    raise AssertionError(
        "validator-json.py needs the `jtd` module: run `python3 -m pip install jtd` "
        "or run this test with a Python that has it (e.g. ~/.cache/sustain-venv/bin/python3)"
    )


def _validator_env() -> dict:
    """PATH for the validators: validator-cddl.py needs the `cddl` gem executable,
    which on a user-gem install lives under ~/.local/share/gem/ruby/<ver>/bin."""
    env = dict(os.environ)
    import glob
    import shutil
    if shutil.which("cddl") is None:
        for d in glob.glob(os.path.expanduser("~/.local/share/gem/ruby/*/bin")):
            env["PATH"] = d + os.pathsep + env.get("PATH", "")
            break
    return env


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
                [_validator_python(), script, path],
                cwd=VALIDATORS_DIR,
                env=_validator_env(),
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
        # draft -07 "Mandatory Minimum Supported Service": successful (200)
        # responses MUST use the dedicated media type.
        self.assertEqual(headers["Content-Type"], "application/sustainability-data+json")
        self.assertIn("public, max-age=86400", headers["Cache-Control"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        doc = json.loads(body)
        self.assertIsInstance(doc, dict)
        # `target` (the reporting subject) is mandatory; these are
        # origin-wide reports, so it carries the origin's host. The
        # `version` member was removed in -07.
        self.assertEqual(doc["target"], "example.com")
        self.assertNotIn("version", doc)
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
        # A 405 error body is not a Sustainability Metadata Document, so it
        # keeps application/json (the -07 media type rule applies to
        # successful (200) responses only).
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

    def test_granularity_not_finer_than_the_period_is_a_single_object(self):
        # Monthly is not finer than a month: one object (draft MUST NOT return an array).
        status, _, body = self._get("?period=2026-02&granularity=monthly")
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(body), dict)
        # An unrecognized granularity is ignored: the default (monthly) period, one object.
        status, _, body = self._get("?granularity=weekly")
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(body), dict)

    # --- draft -07 "Extended Query Parameters" procedure (steps 1-5) ---

    def test_duplicate_parameter_name_returns_400(self):
        # Step 1: one of the three defined names appearing more than once is a
        # 400, even when the values are identical, because the request would
        # otherwise be ambiguous.
        for query in ("?period=2026&period=2026", "?granularity=daily&granularity=monthly", "?target=/api/v1&target=/api/v2"):
            status, _, _ = self._get(query)
            self.assertEqual(status, 400, f"{query} should be 400")

    def test_repeated_undefined_parameter_name_is_ignored(self):
        # Step 1 ignores names this specification does not define, so repeating
        # one (an analytics parameter, say) is not an error.
        status, _, _ = self._get("?nonsense=1&nonsense=2")
        self.assertEqual(status, 200)

    def test_malformed_period_returns_400(self):
        # Step 2: wrong syntax, and syntactically-plausible but unreal dates.
        for period in ("2026-13", "2026-02-30", "26", "2026-1", "not-a-period"):
            status, _, _ = self._get(f"?period={period}")
            self.assertEqual(status, 400, f"period={period} should be 400")

    def test_unmatched_target_returns_404(self):
        # Step 4: a `target` outside the published prefix set is a 404.
        status, _, _ = self._get("?target=/nope")
        self.assertEqual(status, 404)

    def test_matched_target_scopes_the_response(self):
        status, _, body = self._get("?target=/api/v1&period=2026-03-02")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertIsInstance(doc, dict)
        self.assertEqual(doc["target"], "/api/v1")
        self.assertEqual(doc["reporting-period"], "2026-03-02")
        _validate_schema(doc)

    def test_granularity_finer_than_period_returns_sorted_daily_array(self):
        # Step 3 + 5: daily is finer than the month precision of "2026-03",
        # so this is the array branch, sorted ascending.
        status, _, body = self._get("?target=/api/v1&period=2026-03&granularity=daily")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertIsInstance(doc, list)
        self.assertGreater(len(doc), 1)
        periods = [d["reporting-period"] for d in doc]
        self.assertEqual(periods, sorted(periods))
        _validate_schema(doc)

    def test_aggregation_when_no_exact_entry_but_finer_entries_lie_within(self):
        # Step 5: no entry is held for the whole of March 2026, but daily
        # entries within it exist, so the response is their aggregate — a
        # single object (no `granularity` was requested), never an array.
        status, _, body = self._get("?target=/api/v1&period=2026-03")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertIsInstance(doc, dict)
        self.assertEqual(doc["reporting-period"], "2026-03")
        _validate_schema(doc)

    def test_aggregation_of_monthly_entries_to_a_year(self):
        # Step 5: the origin subject holds only monthly entries, so a yearly
        # `period` with no `granularity` aggregates them into one object.
        status, _, body = self._get("?period=2026")
        self.assertEqual(status, 200)
        doc = json.loads(body)
        self.assertIsInstance(doc, dict)
        self.assertEqual(doc["reporting-period"], "2026")
        _validate_schema(doc)


if __name__ == "__main__":
    unittest.main()
