#!/usr/bin/env python3
"""Check every deployment listed in ../implementations.json.

For each origin: GET <origin>/.well-known/sustainability-data, then report the
HTTP status, the media type, whether the body validates against the JTD schema
(response-schema.json), the reporting period, and whether a `signed` member is
present. A single-page application that answers 200 with text/html for any
path is reported as a failure, not as a deployment.

Usage: check-live.py [--list ../implementations.json] [--csv out.csv] [--origin URL ...]
Exit status: 0 if every listed deployment passes, 1 otherwise.
"""
import argparse
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


def check(origin, schema):
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
    errors = [e for obj in objects for e in jtd.validate(schema=schema, instance=obj)]
    row["valid"] = not errors and bool(objects)
    if errors:
        row["note"] = f"{len(errors)} schema error(s)"
    first = objects[0] if objects and isinstance(objects[0], dict) else {}
    row["period"] = first.get("reporting-period", "")
    row["signed"] = "signed" in first
    return row


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", default=os.path.join(HERE, "..", "implementations.json"))
    ap.add_argument("--schema", default=os.path.join(HERE, "response-schema.json"))
    ap.add_argument("--csv", help="append one row per deployment to this CSV file")
    ap.add_argument("--origin", action="append", help="check this origin instead of the list (repeatable)")
    args = ap.parse_args()

    schema = jtd.Schema.from_dict(json.load(open(args.schema)))
    origins = args.origin or [d["origin"] for d in json.load(open(args.list))["deployments"]]
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [check(o, schema) for o in origins]

    print(f"| origin | HTTP | media type | schema-valid | period | signed | note |\n|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['origin']} | {r['status']} | {r['media_type']} | {'yes' if r['valid'] else 'NO'} | {r['period']} | {'yes' if r['signed'] else 'no'} | {r['note']} |")
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
