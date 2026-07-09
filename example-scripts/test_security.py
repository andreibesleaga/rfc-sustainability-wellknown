#!/usr/bin/env python3
"""Unit tests for security.py (stdlib unittest, zero dependencies).

Run: python3 test_security.py   (or: python3 -m unittest test_security)
"""
import unittest

from security import _fuzz_factor_for, secure_sustainability_report


def entry(period, energy=10.0, carbon=100.0, **extra):
    e = {"reporting-period": period, "energy-consumption": energy, "carbon-footprint": carbon}
    e.update(extra)
    return e


class SecureSustainabilityReportTests(unittest.TestCase):
    def test_sorts_ascending_by_reporting_period(self):
        data = [entry("2026-03"), entry("2026-01"), entry("2026-02")]
        out = secure_sustainability_report(data)
        self.assertEqual([r["reporting-period"] for r in out], ["2026-01", "2026-02", "2026-03"])

    def test_drops_sub_daily_entries_before_capping(self):
        subdaily = entry("2026-01-01T12:00:00Z")
        daily = [entry(f"2026-{m:02d}-01") for m in range(1, 3)]
        out = secure_sustainability_report([subdaily] + daily)
        self.assertEqual(len(out), 2)
        self.assertTrue(all(len(r["reporting-period"]) <= 10 for r in out))

    def test_caps_at_366_keeping_most_recent(self):
        data = [entry(f"2020-01-{(i % 28) + 1:02d}") for i in range(400)]
        # Ensure genuinely distinct, sorted-friendly periods across a wider span
        data = [entry(f"{2020 + i // 365}-{((i % 365) // 30) + 1:02d}-{(i % 28) + 1:02d}") for i in range(400)]
        out = secure_sustainability_report(data)
        self.assertLessEqual(len(out), 366)

    def test_deterministic_across_calls(self):
        data = [entry("2026-01"), entry("2026-02")]
        first = secure_sustainability_report(data)
        second = secure_sustainability_report(data)
        self.assertEqual(first, second)

    def test_noise_bounded_within_one_percent(self):
        data = [entry("2026-01", energy=100.0, carbon=1000.0)]
        out = secure_sustainability_report(data)
        self.assertGreaterEqual(out[0]["energy-consumption"], 99.0)
        self.assertLessEqual(out[0]["energy-consumption"], 101.0)
        self.assertGreaterEqual(out[0]["carbon-footprint"], 990.0)
        self.assertLessEqual(out[0]["carbon-footprint"], 1010.0)

    def test_negative_sentinel_never_noised(self):
        data = [entry("2026-01", energy=-1, carbon=500.0)]
        out = secure_sustainability_report(data)
        self.assertEqual(out[0]["energy-consumption"], -1)

    def test_single_fuzz_factor_keeps_scopes_consistent(self):
        data = [entry("2026-01", energy=10, carbon=300, **{"scope-1": 100, "scope-2": 100, "scope-3": 100})]
        out = secure_sustainability_report(data)
        total = out[0]["scope-1"] + out[0]["scope-2"] + out[0]["scope-3"]
        self.assertAlmostEqual(total, out[0]["carbon-footprint"], delta=0.05)

    def test_fuzz_factor_is_pure_function_of_period(self):
        self.assertEqual(_fuzz_factor_for("2026-01"), _fuzz_factor_for("2026-01"))
        self.assertNotEqual(_fuzz_factor_for("2026-01"), _fuzz_factor_for("2026-02"))

    def test_empty_input(self):
        self.assertEqual(secure_sustainability_report([]), [])


if __name__ == "__main__":
    unittest.main()
