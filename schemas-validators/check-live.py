#!/usr/bin/env python3
"""Check every deployment listed in ../implementations.json.

For each origin: GET <origin>/.well-known/sustainability-data, then report the
HTTP status, the media type, whether the body validates against the JTD schema
(response-schema.json), the period (start/end), and whether a `signed` member is
present. A single-page application that answers 200 with text/html for any
path is reported as a failure, not as a deployment.

An origin that still serves the -08 form (`reporting-period`, a calendar string)
or the -09 form (`period` with date-only bounds) is converted in memory for
reporting only: its period column carries "(-08 form)" or "(-09 form)" and its
schema-valid column says "legacy" when the converted object validates. Nothing
is written. `--require 10` turns every such
origin into a failure; it is switched on once the last origin serves -10.

Usage: check-live.py [--list ../implementations.json] [--csv out.csv] [--origin URL ...] [--require 10]
Exit status: 0 if every listed deployment passes, 1 otherwise.
"""
import argparse
import calendar
import csv
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

import jtd

HERE = os.path.dirname(os.path.abspath(__file__))
MEDIA_TYPES = ("application/sustainability-data+json", "application/json")
PATH = "/.well-known/sustainability-data"


def convert_legacy(obj):
    """Return (object in the -10 form, form) where form is "10", "09" or "08".

    -08 `reporting-period` ("YYYY", "YYYY-MM" or "YYYY-MM-DD") becomes a UTC
    `period`; -09 date-only bounds become midnight UTC, and the -09 end date is
    inclusive, so the converted end is the start of the next day. Anything else is returned
    unchanged so that the schema reports it.
    """
    if not isinstance(obj, dict):
        return obj, "10"
    period = obj.get("period")
    if isinstance(period, dict):
        bounds = [period.get("start"), period.get("end")]
        if all(isinstance(b, str) and len(b) == 10 for b in bounds):
            try:
                end = (datetime.date.fromisoformat(bounds[1]) + datetime.timedelta(days=1)).isoformat()
            except ValueError:
                return obj, "09"  # not a date: the schema reports it
            new = dict(obj, period={**period, "start": bounds[0] + "T00:00:00Z", "end": end + "T00:00:00Z"})
            return new, "09"
        return obj, "10"
    text = obj.get("reporting-period")
    if isinstance(text, str):
        try:
            parts = [int(x) for x in text.split("-")]
            if len(parts) == 1:
                start, end = (parts[0], 1, 1), (parts[0] + 1, 1, 1)
            elif len(parts) == 2:
                y, m = parts
                start, end = (y, m, 1), ((y + (m == 12)), m % 12 + 1, 1)
            else:
                y, m, d = parts
                days = calendar.monthrange(y, m)[1]
                start = (y, m, d)
                end = (y, m, d + 1) if d < days else ((y + (m == 12)), m % 12 + 1, 1)
            fmt = "{:04d}-{:02d}-{:02d}T00:00:00Z"
            new = {k: v for k, v in obj.items() if k != "reporting-period"}
            new["period"] = {"start": fmt.format(*start), "end": fmt.format(*end)}
            return new, "08"
        except (ValueError, TypeError, calendar.IllegalMonthError):
            return obj, "08"
    return obj, "10"


def period_label(obj, form):
    period = obj.get("period") if isinstance(obj.get("period"), dict) else {}
    label = f"{period.get('start', '')}/{period.get('end', '')}" if period else str(obj.get("reporting-period", ""))
    return label if form == "10" else f"{label} (-{form} form)"


class HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to an https URL (the declaration is published over HTTPS)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise urllib.error.URLError(f"redirect to a URL that is not https: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def add_note(row, text):
    row["note"] = f"{row['note']}; {text}" if row["note"] else text


def check(origin, schema, require):
    row = {"origin": origin, "status": "", "media_type": "", "valid": False, "period": "", "signed": False, "note": ""}
    req = urllib.request.Request(origin.rstrip("/") + PATH, headers={
        "Accept": "application/sustainability-data+json, application/json;q=0.9",
        "User-Agent": "sustainability-data-live-check (+https://github.com/andreibesleaga/rfc-sustainability-wellknown)"})
    try:
        with urllib.request.build_opener(HttpsOnlyRedirects).open(req, timeout=30) as resp:
            if resp.geturl() != req.full_url:
                add_note(row, f"redirected to {resp.geturl()}")
            row["status"] = resp.status
            row["media_type"] = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = resp.read(1_000_000)
    except urllib.error.HTTPError as err:
        row["status"] = err.code
        add_note(row, "HTTP error")
        return row
    except Exception as err:  # network failure, TLS failure, timeout, a redirect to http
        reason = f": {err.reason}" if isinstance(err, urllib.error.URLError) else ""
        add_note(row, type(err).__name__ + reason)
        return row
    if row["media_type"] not in MEDIA_TYPES:
        add_note(row, "not a JSON media type (a single-page-application fallback looks like this)")
        return row
    try:
        doc = json.loads(body)
    except ValueError:
        add_note(row, "body is not JSON")
        return row
    objects = doc if isinstance(doc, list) else [doc]
    converted = [convert_legacy(obj) for obj in objects]
    forms = {form for _, form in converted}
    errors = [e for obj, _ in converted for e in jtd.validate(schema=schema, instance=obj)]
    ok = not errors  # an empty array is a valid answer: the server holds nothing for the request
    legacy = forms - {"10"}
    if errors:
        add_note(row, f"{len(errors)} schema error(s)")
    elif legacy:
        add_note(row, "serves " + "/".join("-" + f for f in sorted(legacy)) + " form")
    elif not objects:
        add_note(row, "empty array (valid; nothing held)")
    # a -08 or -09 file converted for reporting passes unless -10 is required; the note names its form
    row["valid"] = ok and (not legacy or require != "10")
    first, first_form = converted[0] if converted and isinstance(converted[0][0], dict) else ({}, "10")
    row["period"] = period_label(first, first_form)
    row["signed"] = "signed" in first
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", default=os.path.join(HERE, "..", "implementations.json"))
    ap.add_argument("--schema", default=os.path.join(HERE, "response-schema.json"))
    ap.add_argument("--require", choices=["10"], help="fail an origin that still serves the -08 or -09 form")
    ap.add_argument("--csv", help="append one row per deployment to this CSV file")
    ap.add_argument("--origin", action="append", help="check this origin instead of the list (repeatable)")
    args = ap.parse_args()

    schema = jtd.Schema.from_dict(json.load(open(args.schema)))
    origins = args.origin or [d["origin"] for d in json.load(open(args.list))["deployments"]]
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [check(o, schema, args.require) for o in origins]

    print(f"| origin | HTTP | media type | schema-valid | period | signed | note |\n|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['origin']} | {r['status']} | {r['media_type']} | {('legacy' if 'serves -' in r['note'] else 'yes') if r['valid'] else 'NO'} | {r['period']} | {'yes' if r['signed'] else 'no'} | {r['note']} |")
    if args.csv:
        new = not os.path.exists(args.csv)
        with open(args.csv, "a", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=["checked"] + list(rows[0].keys()))
            if new:
                w.writeheader()
            for r in rows:
                w.writerow({"checked": now, **r})
    return 0 if all(r["valid"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
