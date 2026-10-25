#!/usr/bin/env python3
"""Unit tests for security.py (stdlib unittest, zero dependencies).

Run: python3 -I test_security.py   (or: python3 -I -m unittest test_security)
"""
import json
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from security import (  # noqa: E402
    answer_query,
    canonical_key,
    fuzz_factor_for,
    honored_query,
    is_on_day_boundaries,
    secure_sustainability_report,
)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SERVED = os.path.join(ROOT, "example-responses")
NOISY = {"apply_noise": True, "noise_disclosed": True}


def served_objects(dataset):
    """A dataset of queries.json is the served file of that name; `basic` is example-response.json."""
    name = dataset.replace(".example", "")
    candidates = ["example-response.json"] if name == "basic" else [f"example-response-{name}.json", f"example-response_{name}.json"]
    path = next(os.path.join(SERVED, c) for c in candidates if os.path.exists(os.path.join(SERVED, c)))
    with open(path, encoding="utf-8") as f:
        body = json.load(f)
    return body if isinstance(body, list) else [body]


def day(start, end, target="example.com", **extra):
    obj = {
        "period": {"start": f"{start}T00:00:00Z", "end": f"{end}T00:00:00Z"},
        "target": target,
        "energy-consumption": 100,
        "carbon-footprint": 300,
    }
    obj.update(extra)
    return obj


def six_hours():
    obj = day("2026-01-01", "2026-01-02")
    obj["period"]["end"] = "2026-01-01T06:00:00Z"
    return obj


def starts(objects):
    return [o["period"]["start"] for o in objects]


class SecureSustainabilityReportTests(unittest.TestCase):
    def test_sorts_by_the_instant_of_period_start_whatever_the_offsets(self):
        plus_five = day("2026-03-01", "2026-03-02")
        plus_five["period"] = {"start": "2026-03-01T00:00:00+05:00", "end": "2026-03-02T00:00:00+05:00"}
        out = secure_sustainability_report([day("2026-03-01", "2026-03-02"), plus_five, day("2026-02-01", "2026-02-02")])
        self.assertEqual(
            starts(out), ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00+05:00", "2026-03-01T00:00:00Z"]
        )

    def test_ties_on_start_go_by_end_then_by_target(self):
        out = secure_sustainability_report(
            [day("2026-01-01", "2026-02-01", "/b"), day("2026-01-01", "2026-01-02", "/z"), day("2026-01-01", "2026-02-01", "/a")]
        )
        self.assertEqual(
            [f"{o['target']}|{o['period']['end']}" for o in out],
            ["/z|2026-01-02T00:00:00Z", "/a|2026-02-01T00:00:00Z", "/b|2026-02-01T00:00:00Z"],
        )

    def test_day_floor_drops_by_default_with_a_warning(self):
        warnings = []
        out = secure_sustainability_report([six_hours(), day("2026-01-02", "2026-01-03")], on_warning=warnings.append)
        self.assertEqual(starts(out), ["2026-01-02T00:00:00Z"])
        self.assertEqual(len(warnings), 1)

    def test_day_floor_warn_keeps_and_off_keeps_silently(self):
        warnings = []
        self.assertEqual(len(secure_sustainability_report([six_hours()], day_floor="warn", on_warning=warnings.append)), 1)
        self.assertEqual(len(warnings), 1)
        self.assertEqual(len(secure_sustainability_report([six_hours()], day_floor="off", on_warning=warnings.append)), 1)
        self.assertEqual(len(warnings), 1)

    def test_a_23_hour_day_of_a_daylight_saving_change_is_a_calendar_day(self):
        self.assertTrue(is_on_day_boundaries({"start": "2026-03-29T00:00:00+01:00", "end": "2026-03-30T00:00:00+02:00"}))
        self.assertFalse(is_on_day_boundaries({"start": "2026-03-29T01:00:00+01:00", "end": "2026-03-30T01:00:00+02:00"}))

    def test_refuses_more_than_366_held_objects_after_the_day_floor(self):
        first = date(2025, 1, 1)
        data = [day((first + timedelta(i)).isoformat(), (first + timedelta(i + 1)).isoformat()) for i in range(400)]
        with self.assertRaisesRegex(ValueError, "max_objects"):
            secure_sustainability_report([six_hours()] + data)
        # the day floor drops the six-hour object first, so 366 held objects are fine
        self.assertEqual(len(secure_sustainability_report([six_hours()] + data[:366])), 366)

    def test_values_are_exact_unless_noise_is_turned_on(self):
        out = secure_sustainability_report([day("2026-01-01", "2026-01-02")])
        self.assertEqual(out[0]["energy-consumption"], 100)

    def test_noise_needs_the_operators_confirmation_that_it_is_disclosed(self):
        with self.assertRaises(ValueError):
            secure_sustainability_report([], apply_noise=True)

    def test_one_factor_within_one_percent_moves_every_perturbed_member(self):
        obj = day(
            "2026-01-01", "2026-02-01",
            **{
                "scope-1": -50, "scope-2": 250, "scope-3": 100,
                "estimated-annual-emissions-kgCO2e": 3650, "sci-score": 2,
                "carbon-intensity-gCO2e-per-kWh": 270, "renewable-energy": 100,
            },
        )
        (out,) = secure_sustainability_report([obj], **NOISY)
        fuzz = fuzz_factor_for(canonical_key(obj["period"]))
        self.assertTrue(0.99 <= fuzz <= 1.01)
        for member in ("energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
                       "estimated-annual-emissions-kgCO2e", "sci-score"):
            self.assertEqual(out[member], float(f"{obj[member] * fuzz:.5e}"), member)
        self.assertLess(out["scope-1"], 0)
        self.assertEqual(out["carbon-intensity-gCO2e-per-kWh"], 270)
        self.assertEqual(out["renewable-energy"], 100)

    def test_the_factor_depends_on_the_instants_of_the_period_not_its_spelling(self):
        key = "2026-01-01T00:00:00Z/2026-02-01T00:00:00Z"
        for start, end in (
            ("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
            ("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00Z"),
            ("2026-01-01T01:00:00+01:00", "2026-02-01T01:00:00+01:00"),
        ):
            self.assertEqual(canonical_key({"start": start, "end": end}), key)
        self.assertEqual(fuzz_factor_for(key), 1.00418)  # the same value in the JavaScript and PHP kits

    def test_a_bound_that_is_not_a_date_time_of_the_draft_is_an_error(self):
        for bad in ("2026-01-01", "2026-01-01t00:00:00z", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z"):
            with self.assertRaises(ValueError, msg=bad):
                canonical_key({"start": bad, "end": "2026-02-01T00:00:00Z"})

    def test_query_values_that_do_not_match_the_draft_are_ignored_never_an_error(self):
        self.assertEqual(honored_query("start=2025-03-01&end=2025-04-01t00:00:00z&granularity=Monthly&target="), {})
        self.assertEqual(honored_query("start=2025-03-01T00:00:00%2B01:00&end=2025-02-30T00:00:00Z"), {})
        self.assertEqual(honored_query("start=2016-12-31T23:59:60Z"), {})  # second 60 would be read as 59
        self.assertEqual(honored_query("granularity=monthly&granularity=daily&period=2025"), {})  # repeated, and the name of the previous revision
        self.assertEqual(honored_query("start=2025-03-01T00%3A00%3A00Z"), {"start": "2025-03-01T00:00:00Z"})

    def test_every_row_of_queries_json_selects_what_the_oracle_says_in_its_order(self):
        with open(os.path.join(ROOT, "schemas-validators", "examples", "queries.json"), encoding="utf-8") as f:
            rows = json.load(f)
        self.assertEqual(len(rows), 75)
        for row in rows:
            got = [f"{o['target']}|{o['period']['start']}" for o in answer_query(served_objects(row["dataset"]), row["query"])]
            self.assertEqual(got, row["expect"], f"{row['id']} {row['query']}")

    def test_empty_input(self):
        self.assertEqual(secure_sustainability_report([]), [])


if __name__ == "__main__":
    unittest.main()
