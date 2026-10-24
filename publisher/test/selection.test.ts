/**
 * The selection rule of the draft (§Query Parameters) in three layers: the pieces
 * of `selection.ts` (target equality, the order, the honored subset of a query),
 * the properties that hold for any input, and the query matrix of the example
 * set, run through the publisher with a static-array adapter.
 *
 * The matrix rows below are the publisher-side rows of the query matrix; the
 * datasets are built here from the draft's own periods. The same rows are checked
 * against other implementations by the shared matrix file of the example set.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { staticAdapter } from "../src/adapters";
import { parseQuery, queryFromSearchParams } from "../src/handler";
import { monthPeriod, yearPeriod, dayPeriod } from "../src/period";
import type { Period } from "../src/period";
import { Publisher } from "../src/publisher";
import { compareDeclarations, honoredQuery, honorsAny, selectDeclarations, sortDeclarations, targetEquals } from "../src/selection";
import type { RawMetrics, ServiceQuery, SustainabilityMetrics, TargetType } from "../src/types";

const object = (period: Period, target = "example.com", over: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics => ({
  updated: "2026-10-01T00:00:00Z",
  capabilities: "extended",
  provider: "p",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://example.com/m",
  period,
  target,
  ...over,
});

const at = (start: string, end: string): Period => ({ start, end });

describe("targetEquals (draft §Mandatory Members)", () => {
  const host = object(yearPeriod(2025), "example.com", { "target-type": "origin" });

  it("compares a host name without regard to ASCII case", () => {
    expect(targetEquals(host, "example.com")).toBe(true);
    expect(targetEquals(host, "EXAMPLE.COM")).toBe(true);
    expect(targetEquals(object(yearPeriod(2025), "Example.COM"), "example.com")).toBe(true);
  });

  it("compares a host-shaped target without a type the same way, and any other target as a string", () => {
    expect(targetEquals(object(yearPeriod(2025), "shop.example.org"), "SHOP.example.org")).toBe(true);
    expect(targetEquals(object(yearPeriod(2025), "/API/v1"), "/api/v1")).toBe(false);
    expect(targetEquals(object(yearPeriod(2025), "Acme Retail plc"), "acme retail plc")).toBe(false);
    expect(targetEquals(object(yearPeriod(2025), "Acme.Retail plc"), "acme.retail plc")).toBe(false);
  });

  it("does not fold the case of a non-ASCII letter, normalize, or match by prefix", () => {
    expect(targetEquals(object(yearPeriod(2025), "Grün GmbH"), "GRÜN GMBH")).toBe(false);
    expect(targetEquals(object(yearPeriod(2025), "Café Org"), "Café Org")).toBe(false);
    expect(targetEquals(host, "example.co")).toBe(false);
    expect(targetEquals(object(yearPeriod(2025), "/api/v1"), "/api")).toBe(false);
  });

  it("treats an origin without a dot as a host", () => {
    expect(targetEquals(object(yearPeriod(2025), "localhost", { "target-type": "origin" }), "LOCALHOST")).toBe(true);
    expect(targetEquals(object(yearPeriod(2025), "localhost"), "LOCALHOST")).toBe(false);
  });
});

describe("the order of a returned array", () => {
  const label = (o: SustainabilityMetrics) => o.provider;
  const labelled = (provider: string, period: Period, target = "example.com") => object(period, target, { provider });

  it("sorts by the instant of start, whatever the offsets written", () => {
    const sorted = sortDeclarations([
      labelled("z", at("2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z")),
      labelled("-05", at("2026-03-01T00:00:00-05:00", "2026-04-01T00:00:00-05:00")),
      labelled("+08", at("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00")),
    ]);
    expect(sorted.map(label)).toEqual(["+08", "z", "-05"]);
  });

  it("breaks ties by end, then by target in code point order, then keeps the held order", () => {
    const sorted = sortDeclarations([
      labelled("year", at("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z")),
      labelled("b2", at("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"), "b"),
      labelled("a-astral", at("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"), "\u{1F331}"),
      labelled("a-bmp", at("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"), "Ａ"),
      labelled("b1", at("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z"), "b"),
    ]);
    // U+FF21 sorts before U+1F331 by code point, although its UTF-16 code unit is the greater one.
    expect(sorted.map(label)).toEqual(["b2", "b1", "a-bmp", "a-astral", "year"]);
  });

  it("returns a new array and leaves the one held as it is", () => {
    const held = [object(monthPeriod(2025, 2)), object(monthPeriod(2025, 1))];
    const sorted = sortDeclarations(held);
    expect(held.map((o) => o.period.start.slice(5, 7))).toEqual(["02", "01"]);
    expect(sorted).not.toBe(held);
  });

  it("is a total order whatever the input (property)", () => {
    const arbitraryObject = fc
      .record({ month: fc.integer({ min: 1, max: 12 }), target: fc.constantFrom("a", "b", "/c", "\u{1F331}") })
      .map(({ month, target }) => object(monthPeriod(2025, month), target));
    fc.assert(
      fc.property(fc.array(arbitraryObject, { maxLength: 20 }), (held) => {
        const sorted = sortDeclarations(held);
        expect(sorted).toHaveLength(held.length);
        for (let i = 1; i < sorted.length; i++) expect(compareDeclarations(sorted[i - 1], sorted[i])).toBeLessThanOrEqual(0);
      }),
    );
  });
});

describe("honoredQuery", () => {
  it("keeps what matches the ABNF and drops the rest, never repairing it", () => {
    expect(
      honoredQuery({ target: "/a", start: "2026-01-01T00:00:00Z", end: "2026-01-01", granularity: "weekly" as never }),
    ).toEqual({ target: "/a", start: "2026-01-01T00:00:00Z" });
    expect(honoredQuery({ start: "2016-12-31T23:59:60Z", target: "" })).toEqual({});
    expect(honorsAny({})).toBe(false);
    expect(honorsAny({ granularity: "daily" })).toBe(true);
  });
});

describe("selectDeclarations: properties", () => {
  const held = [...Array.from({ length: 12 }, (_, i) => object(monthPeriod(2025, i + 1))), object(yearPeriod(2025))];

  it("returns the objects as held, never a sum, a merge or a copy of another period", () => {
    const selected = selectDeclarations(held, { granularity: "monthly" });
    for (const s of selected) expect(held).toContain(s);
    expect(selectDeclarations(held, {})).toHaveLength(13);
  });

  it("is the whole set when no parameter is given, and a subset in order for any range (property)", () => {
    const instant = fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2027, 0, 1) }).map((t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
    fc.assert(
      fc.property(fc.option(instant, { nil: undefined }), fc.option(instant, { nil: undefined }), (start, end) => {
        const query: ServiceQuery = { ...(start ? { start } : {}), ...(end ? { end } : {}) };
        const selected = selectDeclarations(held, query);
        const full = selectDeclarations(held, {});
        expect(selected.every((s) => full.includes(s))).toBe(true);
        expect(selected).toEqual(full.filter((s) => selected.includes(s)));
        for (const s of selected) {
          if (start) expect(Date.parse(s.period.end)).toBeGreaterThan(Date.parse(start));
          if (end) expect(Date.parse(s.period.start)).toBeLessThan(Date.parse(end));
        }
      }),
    );
  });

  it("does not select by the spelling of an offset (property)", () => {
    const offset = fc.constantFrom("Z", "+00:00");
    fc.assert(
      fc.property(offset, offset, (a, b) => {
        const spelled = (o: string) => object(at(`2025-03-01T00:00:00${o}`, `2025-04-01T00:00:00${o}`));
        const query = { start: "2025-03-15T00:00:00Z", end: "2025-03-16T00:00:00Z" };
        expect(selectDeclarations([spelled(a)], query)).toHaveLength(1);
        expect(selectDeclarations([spelled(b)], { start: "2025-04-01T00:00:00Z" })).toHaveLength(0);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// The query matrix, publisher side.
// ---------------------------------------------------------------------------

const raw = (provider: string, period: Period, target: string, over: Partial<RawMetrics> = {}): RawMetrics => ({
  provider,
  measurementMethod: "third-party-modeled",
  methodologyUri: "https://example.com/m",
  period,
  updated: "2026-10-01T00:00:00Z",
  target,
  energy: { value: 1, unit: "kWh" },
  ...over,
});

const label = (m: number) => `2025-${String(m).padStart(2, "0")}`;
const monthsOf2025 = Array.from({ length: 12 }, (_, i) => raw(label(i + 1), monthPeriod(2025, i + 1), "example.com", { targetType: "origin" }));
const yearOf2025 = raw("year 2025", yearPeriod(2025), "example.com", { targetType: "origin" });

const DATASETS: Record<string, { data: RawMetrics | RawMetrics[]; capabilities: "basic" | "extended" }> = {
  yearly: { data: monthsOf2025, capabilities: "extended" },
  "year-and-months": { data: [yearOf2025, ...monthsOf2025], capabilities: "extended" },
  "two-targets": {
    capabilities: "extended",
    data: [
      raw("example.com", at("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"), "example.com", { targetType: "origin" }),
      raw("/api/v1", at("2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"), "/api/v1", { targetType: "path" }),
    ],
  },
  "mixed-offsets": {
    capabilities: "extended",
    data: [
      raw("/americas", at("2026-03-01T00:00:00-05:00", "2026-04-01T00:00:00-05:00"), "/americas", { targetType: "path" }),
      raw("mixed.example", at("2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"), "mixed.example", { targetType: "origin" }),
    ],
  },
  "dst-month": {
    capabilities: "extended",
    data: [raw("dst-month", at("2025-03-01T00:00:00+01:00", "2025-04-01T00:00:00+02:00"), "Paris DC 1", { targetType: "facility" })],
  },
  "dst-days": {
    capabilities: "extended",
    data: [
      raw("2025-03-30", at("2025-03-30T00:00:00+01:00", "2025-03-31T00:00:00+02:00"), "Paris DC 1", { targetType: "facility" }),
      raw("2025-10-26", at("2025-10-26T00:00:00+02:00", "2025-10-27T00:00:00+01:00"), "Paris DC 1", { targetType: "facility" }),
    ],
  },
  "local-days": {
    capabilities: "extended",
    data: [18, 19, 20].map((d) =>
      raw(`2026-03-${d}`, at(`2026-03-${d}T00:00:00+08:00`, `2026-03-${d + 1}T00:00:00+08:00`), "device-1", { targetType: "device" }),
    ),
  },
  "unit-grid": {
    capabilities: "extended",
    data: Array.from({ length: 12 }, (_, i) => raw(`unit-${label(i + 1)}`, monthPeriod(2025, i + 1), "unit-grid.example", { targetType: "origin" })),
  },
  "accounting-pair": {
    capabilities: "basic",
    data: (["location-based", "market-based"] as const).map((accounting) =>
      raw(accounting, yearPeriod(2025), "Retail Pair plc", { targetType: "organization", carbonAccounting: accounting, carbon: { value: 1, unit: "tCO2e" } }),
    ),
  },
  "functional-units": {
    capabilities: "extended",
    data: ["per-request", "per-transaction", "per-page-view", "per-session", "per-user", "per-job", "per-token", "per-inference", "per-gigabyte", "per-gigabyte-hour", "per-vcpu-hour", "per-device"].map(
      (unit) => raw(unit, yearPeriod(2025), "shop.example.org", { targetType: "service", sciScore: 1, functionalUnit: unit as never }),
    ),
  },
  "extended.example": {
    capabilities: "extended",
    data: [raw("daily", dayPeriod("2026-03-20"), "/app/storage", { targetType: "path" })],
  },
  "basic.example": { capabilities: "basic", data: raw("basic", yearPeriod(2025), "basic.example", { targetType: "origin" }) },
  "organization-trend.example": {
    capabilities: "basic",
    data: [raw("2025", yearPeriod(2025), "Acme Retail plc", { targetType: "organization" })],
  },
};

const M = (...months: number[]) => months.map(label);
const ALL_MONTHS = M(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
const IGNORED = "ignored";

/** [id, dataset, query string, expected providers in order, or IGNORED for the response to the bare request] */
const ROWS: Array<[string, string, string, string[] | typeof IGNORED]> = [
  ["Q01", "yearly", "", ALL_MONTHS],
  ["Q02", "yearly", "start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z", ALL_MONTHS],
  ["Q03", "yearly", "start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly", ALL_MONTHS],
  ["Q04", "yearly", "granularity=monthly", ALL_MONTHS],
  ["Q05", "yearly", "granularity=yearly", []],
  ["Q06", "yearly", "granularity=daily", []],
  ["Q07", "yearly", "start=2025-03-01T00:00:00Z&end=2025-04-01T00:00:00Z", M(3)],
  ["Q08", "yearly", "start=2025-03-15T00:00:00Z&end=2025-03-16T00:00:00Z", M(3)],
  ["Q09", "yearly", "start=2025-03-31T23:59:59Z&end=2025-04-01T00:00:01Z", M(3, 4)],
  ["Q10", "yearly", "start=2025-03-15T00:00:00Z&end=2025-03-15T00:00:00Z", M(3)],
  ["Q11", "yearly", "start=2025-03-01T00:00:00Z&end=2025-03-01T00:00:00Z", []],
  ["Q12", "yearly", "start=2025-06-01T00:00:00Z&end=2025-03-01T00:00:00Z", []],
  ["Q13", "year-and-months", "start=2025-06-01T00:00:00Z&end=2025-03-01T00:00:00Z", ["year 2025"]],
  ["Q14", "yearly", "start=2025-11-01T00:00:00Z", M(11, 12)],
  ["Q15", "yearly", "end=2025-02-01T00:00:00Z", M(1)],
  ["Q16", "yearly", "start=2024-01-01T00:00:00Z&end=2025-01-01T00:00:00Z", []],
  ["Q17", "yearly", "start=2026-01-01T00:00:00Z&end=2027-01-01T00:00:00Z", []],
  ["Q18", "yearly", "start=2025-03-01", IGNORED],
  ["Q19", "yearly", "start=2025-03-01&granularity=monthly", ALL_MONTHS],
  ["Q20", "yearly", "start=2025-03-01T00:00:00%2B01:00", IGNORED],
  ["Q21", "yearly", "start=2025-03-01T00:00:00+01:00", IGNORED],
  ["Q22", "yearly", "start=2025-03-01t00:00:00z", IGNORED],
  ["Q23", "yearly", "start=2025-03-01T00%3A00%3A00Z&end=2025-04-01T00%3a00%3a00Z", M(3)],
  ["Q24", "yearly", "start=2025-03-31T23:59:59.999Z&end=2025-04-01T00:00:00.001Z", M(3, 4)],
  ["Q25", "yearly", "start=2025-02-30T00:00:00Z", IGNORED],
  ["Q26", "yearly", "granularity=Monthly", IGNORED],
  ["Q27", "yearly", "granularity=weekly", IGNORED],
  ["Q28", "yearly", "granularity=monthly&granularity=daily", IGNORED],
  ["Q29", "yearly", "target=example.com", ALL_MONTHS],
  ["Q30", "yearly", "target=EXAMPLE.COM", ALL_MONTHS],
  ["Q31", "yearly", "target=/other", []],
  ["Q32", "two-targets", "target=/api", []],
  ["Q33", "two-targets", "target=/api/v1", ["/api/v1"]],
  ["Q34", "two-targets", "target=/API/V1", []],
  ["Q35", "two-targets", "target=Example.COM", ["example.com"]],
  ["Q36", "two-targets", "start=2026-02-28T16:00:00Z&end=2026-03-31T16:00:00Z", ["/api/v1", "example.com"]],
  ["Q37", "two-targets", "start=2026-03-31T16:00:00Z", []],
  ["Q38", "two-targets", "granularity=monthly", ["/api/v1", "example.com"]],
  ["Q39", "two-targets", "granularity=daily", []],
  ["Q40", "mixed-offsets", "start=2026-03-01T00:00:00Z&end=2026-03-01T06:00:00Z", ["mixed.example", "/americas"]],
  ["Q41", "mixed-offsets", "start=2026-03-01T00:00:00Z&end=2026-03-01T04:00:00Z", ["mixed.example"]],
  ["Q42", "mixed-offsets", "", ["mixed.example", "/americas"]],
  ["Q43", "dst-month", "granularity=monthly", ["dst-month"]],
  ["Q44", "dst-days", "granularity=daily", ["2025-03-30", "2025-10-26"]],
  ["Q45", "dst-days", "granularity=monthly", []],
  ["Q46", "local-days", "start=2026-03-19T16:00:00Z&end=2026-03-20T16:00:00Z", ["2026-03-20"]],
  ["Q47", "local-days", "granularity=daily", ["2026-03-18", "2026-03-19", "2026-03-20"]],
  ["Q48", "year-and-months", "", [label(1), "year 2025", ...ALL_MONTHS.slice(1)]],
  ["Q49", "year-and-months", "granularity=yearly", ["year 2025"]],
  ["Q50", "year-and-months", "granularity=monthly", ALL_MONTHS],
  ["Q51", "year-and-months", "start=2025-06-01T00:00:00Z&end=2025-07-01T00:00:00Z", ["year 2025", label(6)]],
  ["Q52", "year-and-months", "start=2025-01-01T00:00:00Z&end=2025-02-01T00:00:00Z", [label(1), "year 2025"]],
  ["Q53", "unit-grid", "granularity=monthly", ALL_MONTHS.map((m) => `unit-${m}`)],
  ["Q54", "accounting-pair", "", ["location-based", "market-based"]],
  ["Q55", "accounting-pair", "granularity=yearly", ["location-based", "market-based"]],
  [
    "Q56",
    "functional-units",
    "start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z",
    ["per-request", "per-transaction", "per-page-view", "per-session", "per-user", "per-job", "per-token", "per-inference", "per-gigabyte", "per-gigabyte-hour", "per-vcpu-hour", "per-device"],
  ],
  ["Q57", "extended.example", "target=/app/storage", ["daily"]],
  ["Q58", "extended.example", "target=/other", []],
  ["Q59", "extended.example", "granularity=daily", ["daily"]],
  ["Q60", "extended.example", "granularity=monthly", []],
  ["Q61", "basic.example", "start=2023-01-01T00:00:00Z&granularity=monthly", IGNORED],
  ["Q62", "organization-trend.example", "granularity=yearly", IGNORED],
  ["Q63", "year-and-months", "target=example.com&start=2025-11-01T00:00:00Z", ["year 2025", label(11), label(12)]],
  ["Q64", "year-and-months", "target=example.com&end=2025-02-01T00:00:00Z", [label(1), "year 2025"]],
  ["Q65", "year-and-months", "target=example.com&granularity=yearly", ["year 2025"]],
  ["Q66", "year-and-months", "start=2025-11-01T00:00:00Z&granularity=monthly", M(11, 12)],
  ["Q67", "year-and-months", "end=2025-03-01T00:00:00Z&granularity=monthly", M(1, 2)],
  ["Q68", "year-and-months", "target=example.com&start=2025-03-01T00:00:00Z&end=2025-04-01T00:00:00Z", ["year 2025", label(3)]],
  ["Q69", "year-and-months", "target=example.com&start=2025-12-01T00:00:00Z&granularity=monthly", M(12)],
  ["Q70", "year-and-months", "target=example.com&end=2025-02-01T00:00:00Z&granularity=monthly", M(1)],
  ["Q71", "year-and-months", "target=example.com&start=2025-06-01T00:00:00Z&end=2025-08-01T00:00:00Z&granularity=monthly", M(6, 7)],
  ["Q72", "year-and-months", "target=/other&start=2025-06-01T00:00:00Z&end=2025-08-01T00:00:00Z&granularity=monthly", []],
  ["Q73", "yearly", "start=x2025-03-01T00:00:00Z", IGNORED],
  ["Q74", "yearly", "end=2025-04-01T00:00:00Zx", IGNORED],
  ["Q75", "yearly", "start=2016-12-31T23:59:60Z", IGNORED],
];

function publisherFor(dataset: string, representation?: "single"): Publisher {
  const { data, capabilities } = DATASETS[dataset];
  return new Publisher(staticAdapter({ data, capabilities }), { cacheTtlMs: 0, ...(representation ? { representation } : {}) });
}

const queryOf = (qs: string): ServiceQuery => parseQuery(queryFromSearchParams(new URLSearchParams(qs))).query;

describe("the query matrix: publisher-side rows", () => {
  it("has every publisher-side row, once", () => {
    expect(new Set(ROWS.map(([id]) => id)).size).toBe(ROWS.length);
    expect(ROWS).toHaveLength(75);
  });

  for (const [id, dataset, qs, expected] of ROWS) {
    it(`${id}: ${dataset} ?${qs}`, async () => {
      const publisher = publisherFor(dataset);
      const answer = await publisher.getSerialized(queryOf(qs));
      const bare = await publisher.getSerialized({});
      if (expected === IGNORED) {
        // Byte for byte the response to the request without the parameter, entity tag included.
        expect(answer.body).toBe(bare.body);
        expect(answer.etag).toBe(bare.etag);
        return;
      }
      const selected = JSON.parse(answer.body) as SustainabilityMetrics[];
      expect(Array.isArray(selected)).toBe(true);
      expect(selected.map((o) => o.provider)).toEqual(expected);
    });
  }

  it("Q01 and Q42, for a deployment configured for a single current object: the latest object", async () => {
    const december = JSON.parse((await publisherFor("yearly", "single").getSerialized({})).body);
    expect(december.provider).toBe(label(12));
    const mixed = JSON.parse((await publisherFor("mixed-offsets", "single").getSerialized({})).body);
    expect(mixed.provider).toBe("/americas"); // the later instant of start
  });

  it("Q61, Q62: a Basic publisher serves what it holds, as it holds it", async () => {
    const object = JSON.parse((await publisherFor("basic.example").getSerialized({})).body);
    expect(Array.isArray(object)).toBe(false);
    const array = JSON.parse((await publisherFor("organization-trend.example").getSerialized({})).body);
    expect(array).toHaveLength(1);
  });

  it("Z and .000Z spellings of one bound give one response and one entity tag", async () => {
    const publisher = publisherFor("yearly");
    const a = await publisher.getSerialized(queryOf("start=2025-03-01T00:00:00Z"));
    const b = await publisher.getSerialized(queryOf("start=2025-03-01T00:00:00.000Z"));
    expect(b.etag).toBe(a.etag);
    expect(publisher.cacheKeyFor(queryOf("start=2025-03-01T00:00:00.000Z"))).toBe(publisher.cacheKeyFor(queryOf("start=2025-03-01T00:00:00Z")));
  });
});
