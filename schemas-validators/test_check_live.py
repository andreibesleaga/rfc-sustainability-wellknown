"""Tests for check-live.py: the -09 conversion, the empty array, and the https-only redirect rule.

Run with: python3 -m unittest test_check_live   (needs the jtd package, like check-live.py)
"""
import importlib.util
import os
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("check_live", os.path.join(HERE, "check-live.py"))
check_live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_live)


class ConvertLegacy(unittest.TestCase):
    def test_09_inclusive_end_date_becomes_the_start_of_the_next_day(self):
        obj, form = check_live.convert_legacy({"period": {"start": "2025-03-14", "end": "2025-03-14"}})
        self.assertEqual(form, "09")
        self.assertEqual(obj["period"], {"start": "2025-03-14T00:00:00Z", "end": "2025-03-15T00:00:00Z"})

    def test_09_end_of_a_year_rolls_over(self):
        obj, _ = check_live.convert_legacy({"period": {"start": "2025-01-01", "end": "2025-12-31"}})
        self.assertEqual(obj["period"]["end"], "2026-01-01T00:00:00Z")

    def test_09_bounds_that_are_not_dates_are_left_for_the_schema(self):
        obj, form = check_live.convert_legacy({"period": {"start": "2025-13-45", "end": "2025-13-45"}})
        self.assertEqual((obj["period"]["end"], form), ("2025-13-45", "09"))


class Redirects(unittest.TestCase):
    def test_a_redirect_to_http_is_refused(self):
        handler = check_live.HttpsOnlyRedirects()
        req = urllib.request.Request("https://example.com/.well-known/sustainability-data")
        with self.assertRaises(urllib.error.URLError):
            handler.redirect_request(req, None, 302, "Found", {}, "http://example.com/x")

    def test_a_redirect_to_https_is_followed(self):
        handler = check_live.HttpsOnlyRedirects()
        req = urllib.request.Request("https://example.com/a")
        new = handler.redirect_request(req, None, 302, "Found", {}, "https://example.org/b")
        self.assertEqual(new.full_url, "https://example.org/b")


class Notes(unittest.TestCase):
    def test_notes_accumulate(self):
        row = {"note": ""}
        check_live.add_note(row, "redirected to https://a/")
        check_live.add_note(row, "empty array (valid; nothing held)")
        self.assertEqual(row["note"], "redirected to https://a/; empty array (valid; nothing held)")


if __name__ == "__main__":
    unittest.main()
