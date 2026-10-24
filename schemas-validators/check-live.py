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
    `period`; -09 date-only bounds get "T00:00:00Z". Anything else is returned
    unchanged so that the schema reports it.
    """
    if not isinstance(obj, dict):
        return obj, "10"
    period = obj.get("period")
    if isinstance(period, dict):
        bounds = [period.get("start"), period.get("end")]
        if all(isinstance(b, str) and len(b) == 10 for b in bounds):
            new = dict(obj, period={**period, "start": bounds[0] + "T00:00:00Z", "end": bounds[1] + "T00:00:00Z"})
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


def check(origin, schema, require):
    row = {"origin": origin, "status": "", "media_type": "", "valid": False, "period": "", "signed": False, "note": ""}
    req = urllib.request.Request(origin.rstrip("/") + PATH, headers={
        "Accept": "application/sustainability-data+json, application/json;q=0.9",
        "User-Agent": "sustainability-data-live-check (+https://github.com/andreibesleaga/rfc-sustainability-wellknown)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            row["status"] = resp.status
            row["media_type"] = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = resp.read(1_000_000)
    except urllib.error.HTTPError as err:
        row["status"], row["note"] = err.code, "HTTP error"
        return row
    except Exception as err:  # network failure, TLS failure, timeout
        row["note"] = type(err).__name__
        return row
    if row["media_type"] not in MEDIA_TYPES:
        row["note"] = "not a JSON media type (a single-page-application fallback looks like this)"
        return row
    try:
        doc = json.loads(body)
    except ValueError:
        row["note"] = "body is not JSON"
        return row
    objects = doc if isinstance(doc, list) else [doc]
    converted = [convert_legacy(obj) for obj in objects]
    forms = {form for _, form in converted}
    errors = [e for obj, _ in converted for e in jtd.validate(schema=schema, instance=obj)]
    ok = not errors and bool(objects)
    legacy = forms - {"10"}
    if errors:
        row["note"] = f"{len(errors)} schema error(s)"
    elif legacy:
        row["note"] = "serves " + "/".join("-" + f for f in sorted(legacy)) + " form"
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
        print(f"| {r['origin']} | {r['status']} | {r['media_type']} | {('legacy' if r['note'].startswith('serves -') else 'yes') if r['valid'] else 'NO'} | {r['period']} | {'yes' if r['signed'] else 'no'} | {r['note']} |")
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
