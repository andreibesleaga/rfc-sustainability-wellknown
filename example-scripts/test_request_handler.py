#!/usr/bin/env python3
"""
End-to-end tests for request-handler.py: spins up the real server as a
subprocess on a loopback port and exercises it over real HTTP (golden paths,
error paths, ignored query values), including schema validation against the
repo's independent validators, and runs every row of the selection oracle
(schemas-validators/examples/queries.json) against the served example files.

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


SERVED = os.path.join(HERE, "..", "example-responses")
QUERIES = os.path.join(VALIDATORS_DIR, "examples", "queries.json")
PATH = "/.well-known/sustainability-data"


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


class Server:
    """request-handler.py as a subprocess on a free loopback port, serving the built-in
    data or a file; `get` returns (status, headers, body bytes)."""

    def __init__(self, served_file=None):
        self.port = _free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        args = [sys.executable, os.path.join(HERE, "request-handler.py"), str(self.port)]
        self.proc = subprocess.Popen(args + ([served_file] if served_file else []), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                urllib.request.urlopen(self.base + PATH, timeout=0.2)
                return
            except Exception:
                time.sleep(0.1)
        self.stop()
        raise RuntimeError("request-handler.py did not start in time")

    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=5)

    def get(self, query="", headers=None, method="GET", path=PATH):
        url = f"{self.base}{path}" + (f"?{query}" if query else "")
        req = urllib.request.Request(url, headers=headers or {}, method=method)
        try:
            resp = urllib.request.urlopen(req)
            return resp.status, dict(resp.getheaders()), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()


def _members(body):
    """The ordered `target|period.start` list of a response, whether it is an object or an array."""
    objects = body if isinstance(body, list) else [body]
    return [f"{o['target']}|{o['period']['start']}" for o in objects]


class DemoDataTests(unittest.TestCase):
    """The built-in dataset: the origin by the month (January to August 2026) and one path by the day."""

    @classmethod
    def setUpClass(cls):
        cls.server = Server()

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()

    def get(self, query="", **kwargs):
        return self.server.get(query, **kwargs)

    def json(self, query=""):
        status, _, body = self.get(query)
        self.assertEqual(status, 200, query)
        return json.loads(body)

    # --- golden paths ---

    def test_no_parameter_serves_every_object_held_as_a_sorted_array(self):
        status, headers, body = self.get()
        self.assertEqual(status, 200)
        # Successful responses MUST use the dedicated media type.
        self.assertEqual(headers["Content-Type"], "application/sustainability-data+json")
        self.assertIn("public, max-age=86400", headers["Cache-Control"])
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        doc = json.loads(body)
        self.assertEqual(len(doc), 13)
        starts = [o["period"]["start"] for o in doc]
        self.assertEqual(starts, sorted(starts))  # all UTC "Z" here, so text order is instant order
        self.assertNotIn("reporting-period", doc[0])
        _validate_schema(doc)

    def test_granularity_selects_the_whole_calendar_units(self):
        monthly = self.json("granularity=monthly")
        self.assertEqual({o["target"] for o in monthly}, {"example.com"})
        self.assertEqual(len(monthly), 8)
        daily = self.json("granularity=daily")
        self.assertEqual({o["target"] for o in daily}, {"/api/v1"})
        self.assertEqual(len(daily), 5)
        self.assertEqual(self.json("granularity=yearly"), [])
        _validate_schema(monthly + daily)

    def test_start_and_end_select_the_periods_that_overlap_the_half_open_range(self):
        # February and March of the origin, and the five days of March of the path.
        doc = self.json("start=2026-02-01T00:00:00Z&end=2026-04-01T00:00:00Z")
        self.assertEqual([o["target"] for o in doc].count("example.com"), 2)
        self.assertEqual(len(doc), 7)
        # Periods that only meet the range are not selected: May starts where the range ends.
        self.assertEqual(self.json("target=example.com&start=2026-04-01T00:00:00Z&end=2026-05-01T00:00:00Z")[0]["period"]["start"], "2026-04-01T00:00:00Z")
        self.assertEqual(len(self.json("target=example.com&start=2026-04-01T00:00:00Z&end=2026-05-01T00:00:00Z")), 1)

    def test_target_is_matched_by_equality_not_by_prefix(self):
        self.assertEqual(len(self.json("target=/api/v1")), 5)
        self.assertEqual(self.json("target=/api"), [])
        self.assertEqual(len(self.json("target=EXAMPLE.COM")), 8)  # a host name ignores ASCII case
        self.assertEqual(self.json("target=/API/V1"), [])  # a path does not

    def test_objects_come_back_as_held_and_nothing_is_aggregated(self):
        doc = self.json("target=example.com&granularity=monthly")
        self.assertEqual([o["energy-consumption"] for o in doc], [1000 + m * 10 for m in range(1, 9)])
        self.assertEqual(len(self.json("target=example.com&start=2026-01-01T00:00:00Z&end=2027-01-01T00:00:00Z")), 8)

    def test_an_empty_selection_is_200_and_an_empty_array(self):
        for query in ("target=/nope", "start=2030-01-01T00:00:00Z", "granularity=daily&target=example.com"):
            status, headers, body = self.get(query)
            self.assertEqual((status, json.loads(body)), (200, []), query)
            self.assertEqual(headers["Content-Type"], "application/sustainability-data+json")

    def test_head_matches_get_headers_with_no_body(self):
        get_status, get_headers, _ = self.get()
        head_status, head_headers, head_body = self.get(method="HEAD")
        self.assertEqual(head_status, get_status)
        self.assertEqual(head_headers.get("Content-Length"), get_headers.get("Content-Length"))
        self.assertEqual(head_body, b"")

    def test_conditional_get_returns_304(self):
        _, headers, _ = self.get()
        status, _, body = self.get(headers={"If-None-Match": headers["ETag"]})
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")

    # --- values that are ignored: 200, and the answer is the one for no parameter ---

    def test_values_that_do_not_match_the_draft_are_ignored_never_400(self):
        _, bare_headers, bare = self.get()
        for query in (
            "start=2026-02-01",  # a date, the form of the previous revision
            "start=2026-02-01T00:00:00%2B01:00",  # an offset other than Z
            "start=2026-02-01T00:00:00+01:00",  # a raw plus is form-decoded to a space
            "start=2026-02-01t00:00:00z",  # lower case
            "end=2026-02-30T00:00:00Z",  # no such day
            "start=2016-12-31T23:59:60Z",  # second 60 would be read as 59
            "start=x2026-02-01T00:00:00Z",
            "granularity=Monthly",
            "granularity=weekly",
            "granularity=monthly&granularity=daily",  # repeated
            "target=",
            "period=2026&granularity=",  # the previous revision's name
            "nonsense=1&nonsense=2",
        ):
            status, headers, body = self.get(query)
            self.assertEqual(status, 200, query)
            self.assertEqual(body, bare, query)
            self.assertEqual(headers["ETag"], bare_headers["ETag"], query)

    def test_one_matching_and_one_malformed_parameter_honor_only_the_matching_one(self):
        self.assertEqual(self.json("granularity=monthly&start=2026-02-01"), self.json("granularity=monthly"))

    def test_encoded_twins_share_one_answer(self):
        plain = "start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z"
        encoded = "start=2026-02-01T00%3A00%3A00Z&end=2026-03-01T00%3a00%3a00Z"
        self.assertEqual(self.get(plain)[2], self.get(encoded)[2])

    # --- errors ---

    def test_other_methods_get_405_with_allow_and_not_501(self):
        for method in ("POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE", "BREW"):
            status, headers, body = self.get(method=method)
            self.assertEqual(status, 405, method)
            self.assertEqual(headers["Allow"], "GET, HEAD")
            # An error body is not a declaration: it keeps application/json.
            self.assertEqual(headers["Content-Type"], "application/json")
            json.loads(body)

    def test_unknown_path_returns_404(self):
        self.assertEqual(self.get(path="/nope")[0], 404)


class StaticFileTests(unittest.TestCase):
    """A file whose objects are all `basic` is a static file: every parameter is ignored."""

    @classmethod
    def setUpClass(cls):
        cls.server = Server(os.path.join(SERVED, "example-response.json"))

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()

    def test_it_serves_the_one_object_and_ignores_every_parameter(self):
        _, headers, bare = self.server.get()
        doc = json.loads(bare)
        self.assertIsInstance(doc, dict)
        self.assertEqual(doc["target"], "example.com")
        _validate_schema(doc)
        for query in ("granularity=yearly", "target=/nope", "start=2030-01-01T00:00:00Z", "end=2000-01-01T00:00:00Z"):
            status, other_headers, body = self.server.get(query)
            self.assertEqual((status, body, other_headers["ETag"]), (200, bare, headers["ETag"]), query)


class SelectionOracleTests(unittest.TestCase):
    """Every row of queries.json, over HTTP: the dataset is the served file of that name and
    the response lists the expected `target|period.start` values in the expected order."""

    @staticmethod
    def served_file(dataset):
        name = dataset.replace(".example", "")
        if name == "basic":
            return os.path.join(SERVED, "example-response.json")
        for candidate in (f"example-response-{name}.json", f"example-response_{name}.json"):
            if os.path.exists(os.path.join(SERVED, candidate)):
                return os.path.join(SERVED, candidate)
        raise AssertionError(f"no served file for {dataset}")

    def test_every_row_selects_what_the_oracle_says_in_its_order(self):
        with open(QUERIES, encoding="utf-8") as f:
            rows = json.load(f)
        self.assertEqual(len(rows), 75)
        for dataset in sorted({row["dataset"] for row in rows}):
            server = Server(self.served_file(dataset))
            try:
                _, _, bare = server.get()
                for row in (r for r in rows if r["dataset"] == dataset):
                    status, headers, body = server.get(row["query"])
                    self.assertEqual(status, 200, row["id"])
                    self.assertEqual(headers["Content-Type"], "application/sustainability-data+json", row["id"])
                    self.assertEqual(_members(json.loads(body)), row["expect"], f"{row['id']} {row['query']}")
                    if not row["honored"]:
                        self.assertEqual(body, bare, f"{row['id']}: an ignored query answers as no parameter does")
            finally:
                server.stop()


if __name__ == "__main__":
    unittest.main()
