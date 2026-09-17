#!/usr/bin/env python3
"""
Minimal, zero-dependency reference request handler for `/.well-known/sustainability-data`,
using only the Python standard library (`http.server`). Complements `security.py`
(which only implements the client/defensive array safeguards) by showing the
surrounding request logic: method handling, the Extended Query Parameters
procedure (draft -07 "Extended Query Parameters", steps 1-7) — repeated defined-name
rejection, period validation, granularity filtering, target-prefix matching,
entry selection and aggregation — the single-object-vs-array response-shape
rule, and the required headers.

This is a teaching reference for hand-rolled (non-Node) deployments, not a
production implementation — for a full, tested, production-grade gateway with ten
source adapters, see `publisher/` in this repository.

Run:
    python3 request-handler.py [port]        # default port 8080
Try:
    curl -s http://localhost:8080/.well-known/sustainability-data | python3 -m json.tool
    curl -s "http://localhost:8080/.well-known/sustainability-data?period=2026&granularity=monthly"
    curl -s "http://localhost:8080/.well-known/sustainability-data?target=/api/v1&period=2026-03-02"
    curl -i "http://localhost:8080/.well-known/sustainability-data?period=2026&period=2027"  # 400
    curl -i -X POST http://localhost:8080/.well-known/sustainability-data   # 405 + Allow
"""
import hashlib
import json
import sys
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import unquote, urlparse

from security import secure_sustainability_report

WELL_KNOWN_PATH = "/.well-known/sustainability-data"

ORIGIN_TARGET = "example.com"

# The publisher's published set of path prefixes honored by the `target` query
# parameter (draft -07 "Extended Query Parameters", step 4). This document
# defines no in-band list — a real deployment states its set in the
# methodology document. The origin-wide subject itself (ORIGIN_TARGET) is
# reached by *omitting* `target`, not by naming it here.
PUBLISHED_TARGET_PREFIXES = {"/api/v1"}

# Illustrative in-memory dataset. A real deployment reads this from wherever its
# metrics actually live (billing export, monitoring system, enterprise platform).
# Two subjects, at two different held precisions, so both branches of step 5
# (an exact-period hit, and an aggregate-of-finer-entries hit) are reachable:
#   - ORIGIN_TARGET: monthly entries only (no yearly entry is ever stored, so
#     `?period=2026` demonstrates the aggregation branch).
#   - "/api/v1": daily entries only, within March 2026, so `?target=/api/v1&
#     period=2026-03&granularity=daily` demonstrates the array branch and
#     `?target=/api/v1&period=2026-03` demonstrates aggregation to month
#     precision from held daily entries.
REPORTS_BY_TARGET = {
    ORIGIN_TARGET: [
        {
            "updated": "2026-09-01T00:00:00Z",
            "capabilities": "extended",
            "provider": "Example Corp (sustain@example.org)",
            "measurement-method": "cloud-billing",
            "methodology-uri": "https://example.com/sustainability/methodology",
            "reporting-period": f"2026-{m:02d}",
            "target": ORIGIN_TARGET,
            "target-type": "origin",
            "energy-consumption": 1000 + m * 10,
            "energy-unit": "kWh",
            "carbon-footprint": (1000 + m * 10) * 270,
            "carbon-unit": "gCO2e",
        }
        for m in range(1, 9)  # Jan..Aug 2026
    ],
    "/api/v1": [
        {
            "updated": "2026-04-01T00:00:00Z",
            "capabilities": "extended",
            "provider": "Example Corp (sustain@example.org)",
            "measurement-method": "third-party-modeled",
            "methodology-uri": "https://example.com/sustainability/api-modeling",
            "reporting-period": f"2026-03-{d:02d}",
            "target": "/api/v1",
            "energy-consumption": 1.4 + d * 0.02,
            "energy-unit": "kWh",
            "carbon-footprint": 380 + d * 5,
            "carbon-unit": "gCO2e",
            "sci-score": 12,
            "functional-unit": "per-thousand-requests",
        }
        for d in range(1, 6)  # 2026-03-01 .. 2026-03-05
    ],
}

# The additive members an aggregate sums; every other metric member is
# omitted from an aggregate unless the publisher recomputes it (draft -07
# "Extended Query Parameters", step 5) — this reference does not recompute
# sci-score/carbon-intensity/etc., so it omits them from aggregates.
_AGGREGATE_SUM_KEYS = ("energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3")
_GRANULARITY_PRECISION = {"monthly": "month", "daily": "day"}
_PRECISION_RANK = {"year": 0, "month": 1, "day": 2}


def _precision(period: str) -> str:
    return {4: "year", 7: "month", 10: "day"}[len(period)]


def _within(period: str, container: str) -> bool:
    """True when every instant of `period` is an instant of `container`."""
    return period == container or period.startswith(container + "-")


def _is_real_period(value: str) -> bool:
    """draft -07 ABNF: date-fullyear ["-" date-month ["-" date-mday]], and the
    value must name a real calendar date, not just match the syntax."""
    parts = value.split("-")
    if len(parts) not in (1, 2, 3) or not all(p.isdigit() for p in parts):
        return False
    if len(parts) == 1:
        return len(parts[0]) == 4
    if len(parts[0]) != 4:
        return False
    if len(parts) == 2:
        if len(parts[1]) != 2:
            return False
        month = int(parts[1])
        return 1 <= month <= 12
    if len(parts[1]) != 2 or len(parts[2]) != 2:
        return False
    try:
        date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return False
    return True


class BadRequest(Exception):
    pass


NO_DATA_MESSAGE = "no sustainability metadata available"


class NotFound(Exception):
    """No data for this request.

    Every no-data outcome carries the SAME message, and an unmatched ``target``
    is one of them: the draft's Privacy Considerations has a server honouring
    ``target`` answer "every value outside that set with the same ``404 Not
    Found`` it returns when it holds no data", and SHOULD make the two
    "indistinguishable in body and in timing as well". Two different bodies
    would tell a prober which of the two it hit, which is the path disclosure
    the published-prefix-set restriction exists to prevent. What failed is a
    matter for the operator's log, not for the response.
    """

    def __init__(self, reason: str = "") -> None:  # reason: operator-facing only
        super().__init__(NO_DATA_MESSAGE)
        self.reason = reason or NO_DATA_MESSAGE


DEFINED_PARAMETERS = ("target", "period", "granularity")


def _parse_query(raw_query: str):
    """draft -07 "Extended Query Parameters", step 1: split at "&", each part
    at its first "=", percent-decode names and values; ignore any name other
    than the three defined ones; a repeat of one of those three is a 400,
    because the request would otherwise be ambiguous."""
    seen = {}
    for part in raw_query.split("&") if raw_query else []:
        if not part:
            continue
        name, _, value = part.partition("=")
        name = unquote(name)
        value = unquote(value)
        if name not in DEFINED_PARAMETERS:
            continue
        if name in seen:
            raise BadRequest(f"duplicate query parameter: {name}")
        seen[name] = value
    return seen


def _resolve(params: dict):
    """Runs the full step 2-5 procedure and returns the response body (a dict
    or a list of dicts) for the resolved subject, or raises BadRequest /
    NotFound. Step 6 (report only the completed portion of an in-progress
    period) is not implemented against wall-clock time in this reference —
    the dataset above is fixed and illustrative, and this repository's tests
    are deterministic; a real deployment applies step 6 against its own
    clock. Step 7 (an origin server computes the cache key of its own response
    cache from the parameters it honors, in a canonical order, rather than from
    the query string as received) is satisfied by the caller: the response body,
    and so its ETag, differs by construction for every distinct selection made
    here, and for no other reason."""
    # Step 4 (resolve first so later steps operate on the right dataset).
    target_param = params.get("target")
    if target_param is not None:
        if target_param not in PUBLISHED_TARGET_PREFIXES:
            raise NotFound(f"unpublished target prefix: {target_param}")  # body: the no-data message
        subject = target_param
    else:
        subject = ORIGIN_TARGET
    entries = REPORTS_BY_TARGET[subject]

    # Step 2.
    period_param = params.get("period")
    if period_param is not None:
        if not _is_real_period(period_param):
            raise BadRequest(f"malformed or unreal period: {period_param}")
        P = period_param
    else:
        # The period of the Basic response for this subject: its most
        # recently held (i.e. most recent chronologically) entry.
        P = sorted(entries, key=lambda e: e["reporting-period"])[-1]["reporting-period"]

    # Step 3.
    granularity_param = params.get("granularity")
    G = None
    if granularity_param is not None:
        g_precision = _GRANULARITY_PRECISION.get(granularity_param)
        if g_precision is not None and _PRECISION_RANK[g_precision] > _PRECISION_RANK[_precision(P)]:
            G = granularity_param

    # Step 5.
    if G is not None:
        g_precision = _GRANULARITY_PRECISION[G]
        matches = sorted(
            (e for e in entries if _precision(e["reporting-period"]) == g_precision and _within(e["reporting-period"], P)),
            key=lambda e: e["reporting-period"],
        )
        if not matches:
            raise NotFound(f"no entries of granularity {G} within {P}")  # body: the no-data message
        return secure_sustainability_report(matches)

    exact = [e for e in entries if e["reporting-period"] == P]
    if exact:
        return exact[0]

    finer = sorted((e for e in entries if _within(e["reporting-period"], P)), key=lambda e: e["reporting-period"])
    if not finer:
        raise NotFound(f"nothing lies within {P}")  # body: the no-data message
    return _aggregate(finer, P)


def _aggregate(entries: list, period: str) -> dict:
    """draft -07 "Extended Query Parameters", step 5: energy-consumption,
    carbon-footprint, and the scope members are summed (the held entries
    already share a unit in this dataset); every other metric member is
    omitted unless recomputed, which this reference does not do."""
    base = entries[0]
    out = {
        "updated": max(e["updated"] for e in entries),
        "capabilities": base["capabilities"],
        "provider": base["provider"],
        "measurement-method": base["measurement-method"],
        "methodology-uri": base["methodology-uri"],
        "reporting-period": period,
        "target": base["target"],
    }
    if "target-type" in base:
        out["target-type"] = base["target-type"]
    if "energy-unit" in base:
        out["energy-unit"] = base["energy-unit"]
    if "carbon-unit" in base:
        out["carbon-unit"] = base["carbon-unit"]
    for key in _AGGREGATE_SUM_KEYS:
        if all(key in e for e in entries):
            total = sum(e[key] for e in entries)
            out[key] = round(total, 6)
    return out


def _etag_for(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


class Handler(BaseHTTPRequestHandler):
    server_version = "SustainabilityRefHandler/1.0"

    def _send_json_error(self, status: int, message: str):
        body = json.dumps({"error": message}).encode()
        self.send_response(status)
        # Not a Sustainability Metadata Document — an error body stays
        # application/json (the -07 media type rule applies to successful
        # (200) responses only; see _serve() below).
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_405(self):
        body = json.dumps({"error": "method not allowed"}).encode()
        self.send_response(405)
        self.send_header("Content-Type", "application/json")
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve(self, include_body: bool):
        parsed = urlparse(self.path)
        if parsed.path != WELL_KNOWN_PATH:
            return self._send_json_error(404, "not found")

        try:
            params = _parse_query(parsed.query)
            doc = _resolve(params)
        except BadRequest as exc:
            return self._send_json_error(400, str(exc))
        except NotFound as exc:
            return self._send_json_error(404, str(exc))

        body = json.dumps(doc).encode()
        etag = _etag_for(body)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return

        self.send_response(200)
        # Mandatory: correct media type (draft -07 "Mandatory Minimum
        # Supported Service"). Successful (200) responses MUST use the
        # dedicated application/sustainability-data+json media type and
        # MUST NOT use another.
        self.send_header("Content-Type", "application/sustainability-data+json")
        # Not required by the specification; ordinary web hardening.
        self.send_header("X-Content-Type-Options", "nosniff")
        # Compatible with documents published before the dedicated media
        # type was registered (not -07 conformant):
        # self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("ETag", etag)
        # Draft -07 "Mandatory Minimum Supported Service": successful
        # responses SHOULD include this CORS header (public document,
        # browser-based clients; WebFinger practice).
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def do_GET(self):
        self._serve(include_body=True)

    def do_HEAD(self):
        self._serve(include_body=False)

    def do_POST(self):
        self._send_405()

    def do_PUT(self):
        self._send_405()

    def do_DELETE(self):
        self._send_405()

    def do_PATCH(self):
        self._send_405()

    def __getattr__(self, name):
        # The draft: "Any other method SHOULD receive 405 Method Not Allowed
        # with Allow: GET, HEAD." Without this catch-all, http.server answers
        # OPTIONS/TRACE/any-other-method with its own default 501 Not
        # Implemented. BaseHTTPRequestHandler dispatches via getattr(self,
        # "do_<METHOD>"); synthesizing a 405 handler for every do_* we didn't
        # define explicitly makes all non-GET/HEAD methods return 405.
        # (__getattr__ runs only when normal lookup fails, so the real
        # do_GET/do_HEAD/do_POST/... above are unaffected.)
        if name.startswith("do_"):
            return self._send_405
        raise AttributeError(name)

    def log_message(self, fmt, *args):
        pass  # keep example output quiet; use the default logger in production


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving {WELL_KNOWN_PATH} on http://127.0.0.1:{port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
