#!/usr/bin/env python3
"""
Minimal, zero-dependency reference request handler for `/.well-known/sustainability-data`,
using only the Python standard library (`http.server`). Complements `security.py`, which
holds the selection rule and the safeguards, by showing the surrounding request logic:
method handling, the media type, conditional requests and the headers.

The query parameters follow the draft (Query Parameters):

  * a server that supports them (its objects say `capabilities: extended`) answers with a
    JSON array of the objects that satisfy every parameter it honors, in ascending order of
    `period.start` as instants, ties by `period.end` and `target`; an empty selection is
    `200` and `[]`; objects come back as held, nothing is aggregated;
  * a value that does not match the draft's ABNF (`start` and `end` in UTC with `Z`; a leap
    second, 23:59:60, is ignored rather than read as 59; `granularity` yearly, monthly or
    daily), a name that is repeated, and any name
    the draft does not define are ignored, never a `400` and never read as another value;
  * a server whose objects are all `basic` is a static file: it ignores every parameter and
    answers with what it holds, as it holds it.

A teaching reference for hand-rolled (non-Node) deployments, not a production
implementation; for a full, tested gateway see `publisher/` in this repository.

Run:
    python3 request-handler.py [port] [file]     # default port 8080; file: JSON object or array to serve
Try:
    curl -s http://localhost:8080/.well-known/sustainability-data | python3 -m json.tool
    curl -s "http://localhost:8080/.well-known/sustainability-data?granularity=monthly"
    curl -s "http://localhost:8080/.well-known/sustainability-data?start=2026-02-01T00:00:00Z&end=2026-04-01T00:00:00Z"
    curl -s "http://localhost:8080/.well-known/sustainability-data?target=/api/v1&granularity=daily"
    curl -s "http://localhost:8080/.well-known/sustainability-data?start=2026-02-01"   # ignored: not a utc-date-time
    curl -i -X POST http://localhost:8080/.well-known/sustainability-data               # 405 + Allow
"""
import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from security import answer_query, secure_sustainability_report, supports_parameters  # noqa: E402

WELL_KNOWN_PATH = "/.well-known/sustainability-data"
MEDIA_TYPE = "application/sustainability-data+json"

ORIGIN_TARGET = "example.com"


def _month(m):
    """The whole calendar month m of 2026, in UTC, as a period."""
    end = f"2026-{m + 1:02d}-01T00:00:00Z"
    return {"start": f"2026-{m:02d}-01T00:00:00Z", "end": end}


def _day(d):
    """The whole calendar day d of March 2026, in UTC, as a period."""
    return {"start": f"2026-03-{d:02d}T00:00:00Z", "end": f"2026-03-{d + 1:02d}T00:00:00Z"}


# Illustrative in-memory dataset. A real deployment reads this from wherever its metrics
# actually live (billing export, monitoring system, enterprise platform): the origin's
# months January to August 2026, and one path of it by the day for the first five days of March.
DEMO_OBJECTS = [
    {
        "updated": "2026-09-01T00:00:00Z",
        "capabilities": "extended",
        "provider": "Example Corp (sustain@example.org)",
        "measurement-method": "cloud-billing",
        "methodology-uri": "https://example.com/sustainability/methodology",
        "period": _month(m),
        "target": ORIGIN_TARGET,
        "target-type": "origin",
        "energy-consumption": 1000 + m * 10,
        "energy-unit": "kWh",
        "carbon-footprint": (1000 + m * 10) * 270,
        "carbon-unit": "gCO2e",
    }
    for m in range(1, 9)
] + [
    {
        "updated": "2026-04-01T00:00:00Z",
        "capabilities": "extended",
        "provider": "Example Corp (sustain@example.org)",
        "measurement-method": "third-party-modeled",
        "methodology-uri": "https://example.com/sustainability/api-modeling",
        "period": _day(d),
        "target": "/api/v1",
        "target-type": "path",
        "energy-consumption": round(1.4 + d * 0.02, 2),
        "energy-unit": "kWh",
        "carbon-footprint": 380 + d * 5,
        "carbon-unit": "gCO2e",
        "sci-score": 0.012,
        "functional-unit": "per-request",
    }
    for d in range(1, 6)
]

# The safeguards of security.py, applied once to what is held: sorted, capped, and, were
# `apply_noise=True, noise_disclosed=True` passed, perturbed. By default the values are exact.
DEMO_HELD = secure_sustainability_report(DEMO_OBJECTS)


def load_held(path):
    """The objects of a JSON file holding one declaration or an array of them."""
    with open(path, encoding="utf-8") as f:
        body = json.load(f)
    return body if isinstance(body, list) else [body]


def response_body(held, raw_query):
    """The JSON value to serve: the selected objects as an array. A server that supports
    no parameter and holds one current object serves that object, as a static file does."""
    objects = answer_query(held, raw_query)
    if len(objects) == 1 and not supports_parameters(held):
        return objects[0]
    return objects


def _etag_for(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


class Handler(BaseHTTPRequestHandler):
    server_version = "SustainabilityRefHandler/2.0"
    held = DEMO_HELD

    def _send_json_error(self, status: int, message: str):
        body = json.dumps({"error": message}).encode()
        self.send_response(status)
        # Not a declaration: an error body stays application/json (the dedicated media type is for 200 responses).
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

        # Whatever the query holds, the answer is 200: a value that does not match is ignored,
        # and a selection that matches nothing is an empty array.
        body = json.dumps(response_body(self.held, parsed.query)).encode()
        etag = _etag_for(body)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return

        self.send_response(200)
        # Successful responses use the dedicated media type.
        self.send_header("Content-Type", MEDIA_TYPE)
        # Not required by the specification; ordinary web hardening.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("ETag", etag)
        # Deployment practice (not a draft requirement): allow browser clients.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def do_GET(self):
        self._serve(include_body=True)

    def do_HEAD(self):
        self._serve(include_body=False)

    def __getattr__(self, name):
        # Any method other than GET and HEAD gets 405 with Allow (RFC 9110). Without this
        # catch-all, http.server answers OPTIONS, TRACE and any other method with its own 501.
        # (__getattr__ runs only when normal lookup fails, so do_GET and do_HEAD are unaffected.)
        if name.startswith("do_"):
            return self._send_405
        raise AttributeError(name)

    def log_message(self, fmt, *args):
        pass  # keep example output quiet; use the default logger in production


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if len(sys.argv) > 2:
        Handler.held = load_held(sys.argv[2])
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving {WELL_KNOWN_PATH} on http://127.0.0.1:{port} (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
