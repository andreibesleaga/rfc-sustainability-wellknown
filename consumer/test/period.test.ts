import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  compareDateTimes,
  comparePeriodStart,
  DATE_TIME_RE,
  dateTimeError,
  dayPeriod,
  hasLeapSecond,
  isDateTime,
  isFullDate,
  isOnDayBoundaries,
  isUtcDateTime,
  isWholeCalendarPeriod,
  monthPeriod,
  overlapsRange,
  parsePeriod,
  Period,
  periodError,
  PeriodError,
  periodFromFullDates,
  periodFromReportingPeriod,
  periodsOverlap,
  quarterPeriod,
  toPeriod,
  toUtcQueryValue,
  UTC_DATE_TIME_RE,
  wholeCalendarUnit,
  yearPeriod,
} from "../src/period";

const SEED = { seed: 20261024, numRuns: 300 };

const p = (start: string, end: string): Period => ({ start, end });
const Y2025 = p("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

describe("the date-time profile", () => {
  it("is the regular expression of the draft's CDDL, character for character, anchored", () => {
    const cddl = readFileSync(resolve(process.cwd(), "..", "schemas-validators", "response-schema.cddl"), "utf8");
    const rule = (name: string) => {
      const found = new RegExp(`${name} = "(.*)"`).exec(cddl);
      if (!found) throw new Error(`no ${name} in the CDDL`);
      return found[1].replace(/\\\\/g, "\\"); // a CDDL string escapes the backslash
    };
    expect(DATE_TIME_RE.source).toBe(`^${rule("dt-head")}${rule("dt-tail")}$`);
    expect(UTC_DATE_TIME_RE.source).toBe(`^${rule("dt-head")}(\\.[0-9]+)?Z$`);
  });

  it("accepts the values of the draft, each offset as written", () => {
    for (const value of [
      "2025-01-01T00:00:00Z",
      "2026-03-01T00:00:00+08:00",
      "2026-04-01T00:00:00+08:00",
      "2025-01-01T00:00:00-05:00",
      "2025-03-01T00:00:00+01:00",
      "2011-01-01T00:00:00-10:00",
      "2012-01-01T00:00:00+14:00",
      "2026-03-21T00:05:00Z",
      "2025-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.5Z",
      "2025-01-01T00:00:00+23:59",
      "2025-01-01T00:00:00-00:00",
      "2024-02-29T12:30:45.123456789+05:30",
    ]) {
      expect(dateTimeError(value), value).toBeUndefined();
      expect(isDateTime(value), value).toBe(true);
    }
  });

  it("rejects what the CDDL rejects, naming the value", () => {
    for (const value of [
      "2025-01-01",
      "2025-01-01t00:00:00Z",
      "2025-01-01T00:00:00z",
      "2025-01-01T00:00Z",
      "2025-01-01T00:00:00",
      "2025-01-01T00:00:00+0200",
      "2025-01-01T00:00:00Z[Europe/Paris]",
      "2025-01-01 00:00:00Z",
      "2025-01-01T00:00:00 01:00",
      "20250101T000000Z",
      "",
      "2025-01-01T00:00:00Z ",
      " 2025-01-01T00:00:00Z",
      "x2025-01-01T00:00:00Z",
      "2025-01-01T00:00:00Zx",
      "2025-01-01T00:00:00Z\n",
      "+002025-01-01T00:00:00Z",
    ]) {
      expect(isDateTime(value), JSON.stringify(value)).toBe(false);
      expect(dateTimeError(value), JSON.stringify(value)).toContain(JSON.stringify(value));
    }
  });

  it("rejects a value that has the form and names no real date or time", () => {
    for (const value of [
      "2025-02-30T00:00:00Z",
      "2025-13-01T00:00:00Z",
      "2025-00-10T00:00:00Z",
      "2025-04-31T00:00:00Z",
      "2023-02-29T00:00:00Z",
      "2025-01-01T24:00:00Z",
      "2025-01-01T00:60:00Z",
      "2025-01-01T00:00:61Z",
      "2025-01-01T00:00:00.1234567890Z",
      "2025-01-01T00:00:00+14:60",
      "2025-01-01T00:00:00+24:00",
      "2025-01-01T00:00:00+99:99",
    ]) {
      expect(DATE_TIME_RE.test(value), value).toBe(true);
      expect(isDateTime(value), value).toBe(false);
      expect(dateTimeError(value), value).toContain("not a real date and time");
    }
  });

  it("rejects an offset whose hour is above 23 or whose minute is above 59, in every bound", () => {
    for (const offset of ["+14:60", "-14:60", "+00:99", "+24:00", "-24:00", "+99:99", "+23:60"]) {
      const value = `2025-01-01T00:00:00${offset}`;
      expect(isDateTime(value), value).toBe(false);
      expect(dateTimeError(value), value).toContain("not a real date and time");
      expect(periodError(p(value, "2026-01-01T00:00:00Z")), value).toContain("period.start");
      expect(periodError(p("2025-01-01T00:00:00Z", value)), value).toContain("period.end");
    }
    for (const offset of ["+23:59", "-23:59", "+14:00", "-00:00", "+00:00"]) {
      expect(isDateTime(`2025-01-01T00:00:00${offset}`), offset).toBe(true);
    }
  });

  it("is not satisfied by a value that is not a string", () => {
    for (const value of [undefined, null, 20250101, {}, [], true]) expect(isDateTime(value)).toBe(false);
  });

  it("accepts the leap second 23:59:60 and reads it as 23:59:59", () => {
    const leap = "2016-12-31T23:59:60Z";
    expect(isDateTime(leap)).toBe(true);
    expect(hasLeapSecond(leap)).toBe(true);
    expect(hasLeapSecond("2016-12-31T23:59:59Z")).toBe(false);
    expect(compareDateTimes(leap, "2016-12-31T23:59:59Z")).toBe(0);
    expect(toUtcQueryValue(leap)).toBe("2016-12-31T23:59:59Z");
  });

  it("keeps the offset of each bound apart from its instant", () => {
    expect(toUtcQueryValue("2026-03-01T00:00:00+08:00")).toBe("2026-02-28T16:00:00Z");
    expect(toUtcQueryValue("2025-01-01T00:00:00.000Z")).toBe("2025-01-01T00:00:00Z");
    expect(toUtcQueryValue("2025-01-01T00:00:00.5Z")).toBe("2025-01-01T00:00:00.5Z");
    expect(toUtcQueryValue("2025-01-01T00:00:00-00:00")).toBe("2025-01-01T00:00:00Z");
  });
});

describe("a query value (utc-date-time)", () => {
  it("is the profile with the offset Z, and no leap second", () => {
    for (const value of ["2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.5Z", "2026-02-28T16:00:00Z"]) {
      expect(isUtcDateTime(value), value).toBe(true);
    }
    for (const value of [
      "2025-01-01",
      "2025-01-01T00:00:00z",
      "2025-01-01T00:00:00+00:00",
      "2025-01-01T00:00:00+01:00",
      "2025-01-01T00:00:00 01:00",
      "2025-02-30T00:00:00Z",
      "2025-13-01T00:00:00Z",
      "2025-01-01T24:00:00Z",
      "2016-12-31T23:59:60Z",
      "",
      undefined,
    ]) {
      expect(isUtcDateTime(value), String(value)).toBe(false);
    }
  });
});

describe("instants", () => {
  it("compare across offsets, not as strings", () => {
    const values = ["2025-01-01T00:00:00Z", "2025-01-01T00:00:00+01:00", "2024-12-31T23:00:00-01:00"];
    expect([...values].sort(compareDateTimes)).toEqual(["2025-01-01T00:00:00+01:00", "2025-01-01T00:00:00Z", "2024-12-31T23:00:00-01:00"]);
    expect([...values].sort()).not.toEqual([...values].sort(compareDateTimes));
  });

  it("see Z, +00:00 and .000Z as one instant", () => {
    expect(compareDateTimes("2025-01-01T00:00:00Z", "2025-01-01T00:00:00+00:00")).toBe(0);
    expect(compareDateTimes("2025-01-01T00:00:00Z", "2025-01-01T00:00:00.000Z")).toBe(0);
    expect(compareDateTimes("2025-01-01T00:00:00Z", "2025-01-01T00:00:00.001Z")).toBeLessThan(0);
  });
});

describe("a period", () => {
  it("is two date-times with start before end", () => {
    expect(parsePeriod(Y2025)).toEqual(Y2025);
    expect(periodError(Y2025)).toBeUndefined();
  });

  it("keeps the two bounds as written, without other members", () => {
    expect(parsePeriod({ ...Y2025, note: "x" })).toEqual(Y2025);
    const local = p("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00");
    expect(parsePeriod(local)).toEqual(local);
  });

  it("is refused when start is not before end, as instants", () => {
    const equal = p("2025-01-01T00:00:00Z", "2025-01-01T00:00:00+00:00");
    expect(() => parsePeriod(equal)).toThrow(PeriodError);
    expect(periodError(equal)).toContain("period.start must be before period.end");
    expect(() => parsePeriod(p("2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z"))).toThrow(/before/);
    // -12:00 sorts before Z as a string and is later as an instant
    expect(periodError(p("2025-01-01T00:00:00-12:00", "2025-01-01T00:00:00Z"))).toContain("must be before");
    expect(periodError(p("2025-01-01T00:00:00+02:00", "2025-01-01T00:00:00Z"))).toBeUndefined();
    expect(periodError(p("2025-01-01T00:00:00Z", "2025-01-01T00:00:00+02:00"))).toContain("must be before");
  });

  it("is refused with a code that tells the fault", () => {
    const code = (value: unknown): string | undefined => {
      try {
        parsePeriod(value);
      } catch (e) {
        return (e as PeriodError).code;
      }
      return undefined;
    };
    expect(code(p("2025-01-01", "2025-12-31"))).toBe("date-time-form");
    expect(code(p("2025-01-01T00:00:00z", "2026-01-01T00:00:00Z"))).toBe("date-time-form");
    expect(code(p("2025-02-30T00:00:00Z", "2026-01-01T00:00:00Z"))).toBe("date-time-value");
    expect(code(p("2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z"))).toBe("period-order");
    expect(code("2025")).toBe("period-shape");
    expect(code(null)).toBe("period-shape");
    expect(code([Y2025.start, Y2025.end])).toBe("period-shape");
    expect(code({ start: Y2025.start })).toBe("date-time-form");
    expect(code({ start: 5, end: 6 })).toBe("date-time-form");
  });

  it("names the member at fault", () => {
    expect(periodError(p("2025-01-01T00:00:00Z", "2026-01-01"))).toMatch(/^period\.end:/);
    expect(periodError(p("nonsense", "2026-01-01T00:00:00Z"))).toMatch(/^period\.start:/);
  });
});

describe("overlap is half-open on both sides", () => {
  const jan = p("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z");
  const feb = p("2025-02-01T00:00:00Z", "2025-03-01T00:00:00Z");

  it("periods that meet do not overlap", () => {
    expect(periodsOverlap(jan, feb)).toBe(false);
    expect(periodsOverlap(feb, jan)).toBe(false);
    expect(periodsOverlap(jan, jan)).toBe(true);
  });

  it("selects by the range, as instants", () => {
    const range = { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
    expect(overlapsRange(Y2025, range)).toBe(true);
    expect(overlapsRange(jan, range)).toBe(true);
    expect(overlapsRange(p("2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z"), range)).toBe(false); // ends where the range starts
    expect(overlapsRange(p("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"), range)).toBe(false); // starts where the range ends
    expect(overlapsRange(p("2024-12-01T00:00:00Z", "2025-01-01T00:00:01Z"), range)).toBe(true);
    expect(overlapsRange(p("2025-12-31T23:59:59Z", "2026-02-01T00:00:00Z"), range)).toBe(true);
  });

  it("selects a period that strictly contains an instant when start and end are that instant", () => {
    const at = { start: "2025-01-15T00:00:00Z", end: "2025-01-15T00:00:00Z" };
    expect(overlapsRange(jan, at)).toBe(true);
    expect(overlapsRange(feb, at)).toBe(false);
    expect(overlapsRange(p("2025-01-15T00:00:00Z", "2025-02-01T00:00:00Z"), at)).toBe(false); // starts at the instant
    expect(overlapsRange(p("2025-01-01T00:00:00Z", "2025-01-15T00:00:00Z"), at)).toBe(false); // ends at the instant
  });

  it("evaluates an inverted range as written, and treats an absent bound as unbounded", () => {
    const inverted = { start: "2025-03-01T00:00:00Z", end: "2025-01-15T00:00:00Z" };
    expect(overlapsRange(jan, inverted)).toBe(false); // jan.end (Feb 1) is not after Mar 1
    expect(overlapsRange(Y2025, inverted)).toBe(true); // a period straddling both bounds
    expect(overlapsRange(jan, {})).toBe(true);
    expect(overlapsRange(jan, { start: "2025-02-01T00:00:00Z" })).toBe(false);
    expect(overlapsRange(feb, { start: "2025-02-01T00:00:00Z" })).toBe(true);
    expect(overlapsRange(jan, { end: "2025-01-01T00:00:00Z" })).toBe(false);
    expect(overlapsRange(jan, { end: "2025-01-01T00:00:01Z" })).toBe(true);
  });

  it("compares offsets as instants", () => {
    const local = p("2025-02-01T00:00:00+08:00", "2025-03-01T00:00:00+08:00"); // starts 2025-01-31T16:00Z
    expect(periodsOverlap(jan, local)).toBe(true);
    expect(periodsOverlap(feb, local)).toBe(true);
    expect(overlapsRange(local, { start: "2025-03-01T00:00:00+08:00" })).toBe(false);
  });

  it("is symmetric, never holds between periods that meet, and agrees with a count of minutes", () => {
    const base = Date.UTC(2025, 0, 1);
    const at = (minute: number) => new Date(base + minute * 60_000).toISOString().replace(".000Z", "Z");
    const span = fc.tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 400 })).map(([start, length]) => [start, start + length] as const);
    const period = ([start, end]: readonly [number, number]) => p(at(start), at(end));
    fc.assert(
      fc.property(span, span, (a, b) => {
        const expected = Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
        expect(periodsOverlap(period(a), period(b))).toBe(expected);
        expect(periodsOverlap(period(b), period(a))).toBe(expected);
      }),
      SEED,
    );
    fc.assert(
      fc.property(span, fc.integer({ min: 1, max: 400 }), (a, length) => {
        expect(periodsOverlap(period(a), period([a[1], a[1] + length]))).toBe(false);
      }),
      SEED,
    );
    fc.assert(
      fc.property(span, fc.option(fc.integer({ min: -50, max: 500 }), { nil: undefined }), fc.option(fc.integer({ min: -50, max: 500 }), { nil: undefined }), (a, lo, hi) => {
        const expected = (hi === undefined || a[0] < hi) && (lo === undefined || a[1] > lo);
        const range = { start: lo === undefined ? undefined : at(lo), end: hi === undefined ? undefined : at(hi) };
        expect(overlapsRange(period(a), range)).toBe(expected);
      }),
      SEED,
    );
  });
});

describe("order and key", () => {
  it("orders by the instant of start, then of end", () => {
    const list = [
      p("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      p("2025-01-01T00:00:00+01:00", "2025-02-01T00:00:00+01:00"),
      p("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"),
      p("2024-12-01T00:00:00Z", "2025-01-01T00:00:00Z"),
    ];
    expect([...list].sort(comparePeriodStart).map((x) => `${x.start} ${x.end}`)).toEqual([
      "2024-12-01T00:00:00Z 2025-01-01T00:00:00Z",
      "2025-01-01T00:00:00+01:00 2025-02-01T00:00:00+01:00",
      "2025-01-01T00:00:00Z 2025-02-01T00:00:00Z",
      "2025-01-01T00:00:00Z 2026-01-01T00:00:00Z",
    ]);
    expect(comparePeriodStart(list[2], p("2025-01-01T00:00:00+00:00", "2025-02-01T00:00:00.000Z"))).toBe(0);
  });

  it("is the same for one period however its bounds are spelled", () => {
    const keys = [
      p("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
      p("2025-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
      p("2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      p("2025-01-01T01:00:00+01:00", "2026-01-01T01:00:00+01:00"),
    ].map(canonicalKey);
    expect(new Set(keys)).toEqual(new Set(["2025-01-01T00:00:00Z/2026-01-01T00:00:00Z"]));
    expect(canonicalKey(p("2025-01-01T00:00:00Z", "2025-01-01T00:00:01Z"))).not.toBe(keys[0]);
  });
});

describe("whole calendar periods are read in the offset of each bound", () => {
  const unit = (start: string, end: string) => wholeCalendarUnit(p(start, end));

  it("recognizes a year, a month and a day", () => {
    expect(unit("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("yearly");
    expect(unit("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z")).toBe("monthly");
    expect(unit("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")).toBe("daily");
    expect(unit("2024-02-01T00:00:00Z", "2024-03-01T00:00:00Z")).toBe("monthly"); // 29 days
    expect(unit("2025-02-01T00:00:00Z", "2025-03-01T00:00:00Z")).toBe("monthly"); // 28 days
    expect(unit("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z")).toBe("daily");
    expect(unit("2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("daily");
    expect(unit("2024-01-01T00:00:00Z", "2025-01-01T00:00:00Z")).toBe("yearly"); // 366 days
  });

  it("answers per unit", () => {
    const year = Y2025;
    expect(isWholeCalendarPeriod(year, "yearly")).toBe(true);
    expect(isWholeCalendarPeriod(year, "monthly")).toBe(false);
    expect(isWholeCalendarPeriod(year, "daily")).toBe(false);
    const jan = p("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z");
    expect(isWholeCalendarPeriod(jan, "monthly")).toBe(true);
    expect(isWholeCalendarPeriod(jan, "yearly")).toBe(false);
  });

  it("is not satisfied by a span of the right length that starts elsewhere", () => {
    expect(unit("2025-04-01T00:00:00Z", "2026-04-01T00:00:00Z")).toBeUndefined(); // a reporting year ending on 31 March
    expect(unit("2025-01-01T00:00:00Z", "2025-03-01T00:00:00Z")).toBeUndefined(); // two whole months
    expect(unit("2025-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).toBeUndefined(); // a year and a day
    expect(unit("2025-01-01T00:00:00Z", "2025-01-08T00:00:00Z")).toBeUndefined(); // a week
    expect(unit("2025-01-15T00:00:00Z", "2025-02-15T00:00:00Z")).toBeUndefined();
    expect(unit("2025-01-01T06:00:00Z", "2025-01-02T06:00:00Z")).toBeUndefined(); // 24 hours from 06:00
    expect(unit("2025-01-01T00:00:00Z", "2025-01-01T12:00:00Z")).toBeUndefined();
    expect(unit("2025-01-01T00:00:00.123Z", "2025-01-02T00:00:00Z")).toBeUndefined();
    expect(unit("2025-01-01T00:00:00Z", "2025-12-31T00:00:00Z")).toBeUndefined();
  });

  it("holds with an offset on both bounds, and with bounds of different offsets", () => {
    expect(unit("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00")).toBe("monthly");
    expect(unit("2025-01-01T00:00:00-05:00", "2026-01-01T00:00:00-05:00")).toBe("yearly");
    expect(unit("2025-03-01T00:00:00+01:00", "2025-04-01T00:00:00+02:00")).toBe("monthly"); // daylight-saving month, 743 hours
    expect(unit("2025-03-30T00:00:00+01:00", "2025-03-31T00:00:00+02:00")).toBe("daily"); // 23 hours
    expect(unit("2025-10-26T00:00:00+02:00", "2025-10-27T00:00:00+01:00")).toBe("daily"); // 25 hours
    expect(unit("2011-12-01T00:00:00-10:00", "2012-01-01T00:00:00+14:00")).toBe("monthly"); // Samoa
    expect(unit("2011-01-01T00:00:00-10:00", "2012-01-01T00:00:00+14:00")).toBe("yearly");
    expect(unit("2025-01-01T00:00:00+01:00", "2025-02-01T00:00:00Z")).toBe("monthly"); // each bound in its own offset
    expect(unit("2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe("yearly");
  });

  it("holds for every generated month, with the offsets of its bounds free", () => {
    const offset = fc.integer({ min: -14 * 60, max: 14 * 60 }).map((m) => {
      const sign = m < 0 ? "-" : "+";
      return `${sign}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;
    });
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 }), offset, offset, (year, month, a, b) => {
        const next = month === 12 ? [year + 1, 1] : [year, month + 1];
        const pad = (n: number) => String(n).padStart(2, "0");
        const period = p(`${year}-${pad(month)}-01T00:00:00${a}`, `${next[0]}-${pad(next[1])}-01T00:00:00${b}`);
        expect(periodError(period)).toBeUndefined();
        expect(wholeCalendarUnit(period)).toBe("monthly");
      }),
      SEED,
    );
  });

  it("day boundaries: both bounds are the first instant of a day in their own offset", () => {
    expect(isOnDayBoundaries(Y2025)).toBe(true);
    expect(isOnDayBoundaries(p("2026-03-01T00:00:00+08:00", "2026-03-02T00:00:00+08:00"))).toBe(true);
    expect(isOnDayBoundaries(p("2025-03-30T00:00:00+01:00", "2025-03-31T00:00:00+02:00"))).toBe(true);
    expect(isOnDayBoundaries(p("2025-01-01T00:00:00Z", "2025-01-01T12:00:00Z"))).toBe(false);
    expect(isOnDayBoundaries(p("2025-01-01T06:00:00Z", "2025-01-02T06:00:00Z"))).toBe(false);
    expect(isOnDayBoundaries(p("2025-01-01T00:00:00.123Z", "2025-01-02T00:00:00Z"))).toBe(false);
    expect(isOnDayBoundaries(p("2025-01-01T00:00:00Z", "2025-01-01T23:59:60Z"))).toBe(false);
  });
});

describe("builders", () => {
  it("write whole calendar periods with bounds at midnight UTC, as Z", () => {
    expect(yearPeriod(2025)).toEqual(Y2025);
    expect(monthPeriod(2025, 12)).toEqual(p("2025-12-01T00:00:00Z", "2026-01-01T00:00:00Z"));
    expect(monthPeriod(2024, 2)).toEqual(p("2024-02-01T00:00:00Z", "2024-03-01T00:00:00Z"));
    expect(dayPeriod("2024-02-29")).toEqual(p("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z"));
    expect(quarterPeriod(2026, 1)).toEqual(p("2026-01-01T00:00:00Z", "2026-04-01T00:00:00Z"));
    expect(quarterPeriod(2026, 4)).toEqual(p("2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"));
  });

  it("write the offset in force at each bound", () => {
    expect(monthPeriod(2026, 3, "+08:00")).toEqual(p("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"));
    expect(monthPeriod(2025, 3, "Europe/Berlin")).toEqual(p("2025-03-01T00:00:00+01:00", "2025-04-01T00:00:00+02:00"));
    expect(dayPeriod("2025-03-30", "Europe/Berlin")).toEqual(p("2025-03-30T00:00:00+01:00", "2025-03-31T00:00:00+02:00"));
    expect(monthPeriod(2011, 12, "Pacific/Apia")).toEqual(p("2011-12-01T00:00:00-10:00", "2012-01-01T00:00:00+14:00"));
    expect(yearPeriod(2025, "-05:00")).toEqual(p("2025-01-01T00:00:00-05:00", "2026-01-01T00:00:00-05:00"));
  });

  it("refuse a calendar day that does not exist in the zone", () => {
    // Pacific/Apia went from 2011-12-29 to 2011-12-31 when it crossed the date line.
    expect(() => dayPeriod("2011-12-30", "Pacific/Apia")).toThrow(PeriodError);
    expect(() => dayPeriod("2011-12-30", "Pacific/Apia")).toThrow(/no length in "Pacific\/Apia"/);
    expect(() => periodFromReportingPeriod("2011-12-30", "Pacific/Apia")).toThrow(PeriodError);
    expect(dayPeriod("2011-12-29", "Pacific/Apia")).toEqual(p("2011-12-29T00:00:00-10:00", "2011-12-31T00:00:00+14:00"));
    expect(dayPeriod("2011-12-31", "Pacific/Apia")).toEqual(p("2011-12-31T00:00:00+14:00", "2012-01-01T00:00:00+14:00"));
  });

  it("write +00:00 and UTC as Z", () => {
    expect(yearPeriod(2025, "+00:00")).toEqual(Y2025);
    expect(yearPeriod(2025, "UTC")).toEqual(Y2025);
    expect(yearPeriod(2025, "-00:00")).toEqual(Y2025);
  });

  it("build periods that are whole in their unit, in any zone", () => {
    for (const zone of ["Z", "+08:00", "-05:00", "Europe/Berlin", "Pacific/Apia", "Asia/Kolkata"]) {
      for (const [period, unit] of [
        [yearPeriod(2025, zone), "yearly"],
        [monthPeriod(2025, 3, zone), "monthly"],
        [monthPeriod(2025, 10, zone), "monthly"],
        [dayPeriod("2025-03-30", zone), "daily"],
        [dayPeriod("2025-10-26", zone), "daily"],
      ] as const) {
        expect(periodError(period), `${zone} ${period.start}`).toBeUndefined();
        expect(wholeCalendarUnit(period), `${zone} ${period.start}`).toBe(unit);
      }
    }
  });

  it("refuse what names no date", () => {
    expect(() => monthPeriod(2026, 13)).toThrow(PeriodError);
    expect(() => monthPeriod(2026, 0)).toThrow(/calendar date/);
    expect(() => dayPeriod("2026-02-30")).toThrow(PeriodError);
    expect(() => dayPeriod("2026-4-1")).toThrow(/YYYY-MM-DD/);
    expect(() => yearPeriod(0)).toThrow(PeriodError);
    expect(() => yearPeriod(10000)).toThrow(PeriodError);
    expect(() => yearPeriod(2025.5)).toThrow(PeriodError);
    expect(() => quarterPeriod(2026, 5 as 1)).toThrow(/1 to 4/);
    expect(() => yearPeriod(2025, "Mars/Phobos")).toThrow(/time zone/);
    expect(() => yearPeriod(2025, "+25:00")).toThrow(PeriodError);
  });
});

describe("the forms of earlier revisions", () => {
  it("reads a reporting-period label as the whole year, month or day", () => {
    expect(periodFromReportingPeriod("2025")).toEqual(Y2025);
    expect(periodFromReportingPeriod("2025-02")).toEqual(p("2025-02-01T00:00:00Z", "2025-03-01T00:00:00Z"));
    expect(periodFromReportingPeriod("2024-02-29")).toEqual(p("2024-02-29T00:00:00Z", "2024-03-01T00:00:00Z"));
    expect(periodFromReportingPeriod("2026-03", "+08:00")).toEqual(p("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"));
  });

  it("refuses a label that names no such date", () => {
    for (const label of ["2026-13", "2026-00", "2026-02-30", "2026-04-31", "2025-02-29", "FY26", "2026-Q1", "2026-1", "", "20260101", "2026-01-01T00:00:00Z"]) {
      expect(() => periodFromReportingPeriod(label), label).toThrow(PeriodError);
    }
  });

  it("reads a pair of inclusive full-dates as the half-open range to the next midnight", () => {
    expect(periodFromFullDates({ start: "2025-01-01", end: "2025-12-31" })).toEqual(Y2025);
    expect(periodFromFullDates({ start: "2026-03-20", end: "2026-03-20" })).toEqual(p("2026-03-20T00:00:00Z", "2026-03-21T00:00:00Z"));
    expect(periodFromFullDates({ start: "2024-02-01", end: "2024-02-29" })).toEqual(p("2024-02-01T00:00:00Z", "2024-03-01T00:00:00Z"));
  });

  it("refuses full-dates that name no date, or an end before the start", () => {
    expect(() => periodFromFullDates({ start: "2025-01-01", end: "2025-02-30" })).toThrow(PeriodError);
    expect(() => periodFromFullDates({ start: "2025-01-01", end: "2025-12-31T00:00:00Z" })).toThrow(PeriodError);
    expect(() => periodFromFullDates({ start: "2025-03-01", end: "2025-02-01" })).toThrow(/before/);
    expect(isFullDate("2025-01-01")).toBe(true);
    expect(isFullDate("2025-01-01T00:00:00Z")).toBe(false);
    expect(isFullDate(20250101)).toBe(false);
  });

  it("toPeriod takes a period or a label", () => {
    expect(toPeriod(Y2025)).toEqual(Y2025);
    expect(toPeriod("2025")).toEqual(Y2025);
    expect(() => toPeriod({ start: "2025-01-01", end: "2025-12-31" })).toThrow(PeriodError);
    expect(() => toPeriod("March 2026")).toThrow(PeriodError);
  });
});

describe("a bound that breaks the profile by one character", () => {
  it("is never a date-time", () => {
    const valid = "2025-03-01T10:20:30.5+08:00";
    expect(isDateTime(valid)).toBe(true);
    fc.assert(
      fc.property(fc.constantFrom(4, 7, 10, 13, 16, 19, 22), fc.constantFrom(" ", "t", "/", "_", "", ".", ":"), (index, replacement) => {
        const mutated = valid.slice(0, index) + replacement + valid.slice(index + 1);
        fc.pre(mutated !== valid);
        expect(isDateTime(mutated), mutated).toBe(false);
      }),
      SEED,
    );
    expect(isDateTime("2025-03-01T10:20:30Z".replace("Z", "z"))).toBe(false);
  });
});
