/**
 * The period builder of the tool: calendar labels to half-open date-times in a
 * stated fixed offset. Pure functions, no clock; the parity test holds them to
 * the consumer's builders when consumer/ is built.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { PeriodError, hasEnded, labelYears, normalizeOffset, periodFromLabel } from "../period.mjs";

const consumerDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "consumer", "dist", "index.js");

test("golden: a year, a month and a day are whole calendar units in Z", () => {
  assert.deepEqual(periodFromLabel("2025"), { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  assert.deepEqual(periodFromLabel("2025-03"), { start: "2025-03-01T00:00:00Z", end: "2025-04-01T00:00:00Z" });
  assert.deepEqual(periodFromLabel("2025-03-14"), { start: "2025-03-14T00:00:00Z", end: "2025-03-15T00:00:00Z" });
});

test("golden: a fiscal year from inclusive dates ends at the first instant of the next day", () => {
  assert.deepEqual(periodFromLabel("2025-04-01/2026-03-31"), { start: "2025-04-01T00:00:00Z", end: "2026-04-01T00:00:00Z" });
});

test("edge: December rolls into the next year, a leap February has 29 days, the last day of a year ends on 1 January", () => {
  assert.equal(periodFromLabel("2025-12").end, "2026-01-01T00:00:00Z");
  assert.equal(periodFromLabel("2024-02").end, "2024-03-01T00:00:00Z");
  assert.equal(periodFromLabel("2024-02-29").end, "2024-03-01T00:00:00Z");
  assert.equal(periodFromLabel("2025-12-31").end, "2026-01-01T00:00:00Z");
  assert.equal(periodFromLabel("2025-01-01/2025-12-31").end, "2026-01-01T00:00:00Z");
  assert.equal(periodFromLabel("2025-03-14/2025-03-14").end, "2025-03-15T00:00:00Z");
});

test("a stated offset is written on both bounds; +00:00 is written Z", () => {
  assert.deepEqual(periodFromLabel("2025", "+08:00"), { start: "2025-01-01T00:00:00+08:00", end: "2026-01-01T00:00:00+08:00" });
  assert.equal(periodFromLabel("2025-03", "-05:30").start, "2025-03-01T00:00:00-05:30");
  assert.equal(periodFromLabel("2025", "+00:00").start, "2025-01-01T00:00:00Z");
  assert.equal(normalizeOffset(), "Z");
  assert.equal(normalizeOffset("-00:00"), "Z");
});

test("error: a label that names no real calendar unit is refused with its reason", () => {
  for (const label of ["2025-02-29", "2025-13", "2025-00", "2025-04-31", "0000", "20250", "25", "2025-1", "2025/2026", "FY2025", ""]) {
    assert.throws(() => periodFromLabel(label), PeriodError, label);
  }
  assert.throws(() => periodFromLabel("2025-02-30"), /not a real calendar date/);
  assert.throws(() => periodFromLabel("2025-04-01/2025-03-31"), /before the first/);
  assert.throws(() => periodFromLabel("9999"), /after year 9999/);
  assert.throws(() => periodFromLabel("9999-12-31"), /after year 9999/);
});

test("error: an offset that is not Z or a real fixed offset is refused", () => {
  for (const offset of ["+24:00", "+02:60", "+0200", "z", "UTC", "+2:00", "Europe/Berlin"]) {
    assert.throws(() => periodFromLabel("2025", offset), /not Z or a fixed offset/, offset);
  }
});

test("the years a label names, for the quote check", () => {
  assert.deepEqual(labelYears("2025"), ["2025"]);
  assert.deepEqual(labelYears("2025-04-01/2026-03-31"), ["2025", "2026"]);
  assert.deepEqual(labelYears("2025-04-01/2025-12-31"), ["2025"]);
});

test("a period has ended when its end is not after now, as instants", () => {
  const period = periodFromLabel("2025", "+02:00"); // ends 2025-12-31T22:00:00Z
  assert.equal(hasEnded(period, new Date("2025-12-31T21:59:59Z")), false);
  assert.equal(hasEnded(period, new Date("2025-12-31T22:00:00Z")), true);
});

test("parity: the builders agree with the consumer's", { skip: !existsSync(consumerDist) && "consumer/ is not built" }, async () => {
  const lib = await import(pathToFileURL(consumerDist).href);
  const same = (ours, theirs) => assert.deepEqual(ours, { start: theirs.start, end: theirs.end });
  for (const zone of ["Z", "+08:00", "-05:30", "+14:00"]) {
    same(periodFromLabel("2025", zone), lib.yearPeriod(2025, zone));
    same(periodFromLabel("2025-12", zone), lib.monthPeriod(2025, 12, zone));
    same(periodFromLabel("2024-02", zone), lib.monthPeriod(2024, 2, zone));
    same(periodFromLabel("2024-02-29", zone), lib.dayPeriod("2024-02-29", zone));
    same(periodFromLabel("2025-04-01/2026-03-31", zone), lib.periodFromFullDates({ start: "2025-04-01", end: "2026-03-31" }, zone));
  }
  // The consumer recognises what the tool writes as whole calendar units.
  assert.equal(lib.wholeCalendarUnit(periodFromLabel("2025", "+08:00")), "yearly");
  assert.equal(lib.wholeCalendarUnit(periodFromLabel("2025-03")), "monthly");
  assert.equal(lib.wholeCalendarUnit(periodFromLabel("2025-03-14")), "daily");
});
