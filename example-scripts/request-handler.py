#!/usr/bin/env python3
"""
Minimal, zero-dependency reference request handler for `/.well-known/sustainability`,
using only the Python standard library (`http.server`). Complements `security.py`
(which only implements the array safeguards) by showing the surrounding request
logic: method handling, query-parameter parsing, Basic vs Extended routing, the
single-object-vs-array response-shape rule, and the required headers.

This is a teaching reference for hand-rolled (non-Node) deployments, not a
production implementation — for a full, tested, production-grade gateway with ten
source adapters, see `publisher/` in this repository.

Run:
    python3 request-handler.py [port]        # default port 8080
Try:
    curl -s http://localhost:8080/.well-known/sustainability | python3 -m json.tool
    curl -s "http://localhost:8080/.well-known/sustainability?period=2026&granularity=monthly"
    curl -i -X POST http://localhost:8080/.well-known/sustainability   # 405 + Allow
"""
import hashlib
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from security import secure_sustainability_report

WELL_KNOWN_PATH = "/.well-known/sustainability"

# Illustrative in-memory dataset. A real deployment reads this from wherever its
# metrics actually live (billing export, monitoring system, enterprise platform).
REPORTS = [
    {
        "version": "1.1",
        "updated": "2026-06-01T00:00:00Z",
        "capabilities": "basic",
        "provider": "Example Corp (sustain@example.org)",
        "measurement-method": "cloud-billing",
        "methodology-uri": "https://example.com/sustainability/methodology",
        "reporting-period": f"2026-{m:02d}",
        "energy-consumption": 1000 + m * 10,
        "energy-unit": "kWh",
        "carbon-footprint": (1000 + m * 10) * 270,
        "carbon-unit": "gCO2e",
    }
    for m in range(1, 6)  # Jan..May 2026
]


def _etag_for(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


def _select(target, period, granularity):
    """Draft §Optional Extended Query Parameters / §Payload Format rules:
    - no `granularity` (or not finer than `period`) -> a single object, never an array;
    - a `granularity` finer than `period` -> an array, sorted ascending (see security.py).
    This illustrative selector ignores `target` scoping (no per-path data here) and,
    for `period` without `granularity`, returns the most recent matching entry rather
    than aggregating across entries — a real deployment MUST aggregate or 404 per the
    draft's rule; see publisher/src/publisher.ts for the fully-specified behavior.
    """
    candidates = REPORTS
    if period:
        candidates = [r for r in candidates if r["reporting-period"].startswith(period)]
    if not candidates:
        return None
    if granularity:
        return secure_sustainability_report(candidates)
    return candidates[-1]  # most recent (REPORTS is already chronological)


class Handler(BaseHTTPRequestHandler):
    server_version = "SustainabilityRefHandler/1.0"

    def _send_405(self):
        body = json.dumps({"error": "method not allowed"}).encode()
        self.send_response(405)
        self.send_header("Content-Type", "application/json")
        self.send_header("Allow", "GET, HEAD")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_404(self):
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _serve(self, include_body: bool):
        parsed = urlparse(self.path)
        if parsed.path != WELL_KNOWN_PATH:
            return self._send_404()

        q = parse_qs(parsed.query)
        target = q.get("target", [None])[0]
        period = q.get("period", [None])[0]
        granularity = q.get("granularity", [None])[0]

        doc = _select(target, period, granularity)
        if doc is None:
            return self._send_404()

        body = json.dumps(doc).encode()
        etag = _etag_for(body)
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("ETag", etag)
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
