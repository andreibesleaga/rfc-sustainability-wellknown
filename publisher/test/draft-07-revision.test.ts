/**
 * The -07 revision after the adversarial review, item by item:
 *
 *  1. the aggregate's non-metric members are specified (step 5);
 *  2. an aggregate that would carry no metric member is a 404;
 *  3. with `period` absent, P is the Basic response's period — its LAST
 *     object's, where the Basic response is an array (step 2);
 *  4. `monthly`/`daily` denote month/day PRECISION, and selection is by
 *     precision (steps 3 and 5);
 *  5. the cache key is computed from the HONORED parameters, in a canonical
 *     order, never from the query string as received (step 7);
 *  6. the ABNF is case-sensitive (RFC 7405 `%s`) and self-contained, and the
 *     rule for a period value is named `period-value`;
 *  7. the payload of `signed` MUST NOT itself contain `signed`, and a
 *     publisher that signs the objects of an array signs all of them;
 *  8. a publisher MUST NOT serve an object whose `signed` payload differs from
 *     the object it accompanies;
 *  9. the Nil and Max UUIDs MUST NOT be used as `extensions` keys (in -07
 *     they are spelled `urn:uuid:…`, one of the two forms of an absolute-URI key);
 * 10. noise disclosure is a MUST, and nothing perturbs a value unopted-in;
 * 11. access control is out of scope: the 200 rule is conditional.
 *
 * and the three corrections made to step 5 afterwards:
 *
 *  A. the aggregate's unit is the one declared by the LAST contributing entry
 *     IN ASCENDING ORDER OF `reporting-period` — a dimension of its own, never
 *     the latest `updated`, which is a separate rule of the same step;
 *  B. the contributing entries are those of ONE PRECISION lying within P, and
 *     they MUST NOT overlap: a month and a day inside it are never summed
 *     together;
 *  C. a summable member is carried only where EVERY contributing entry reports
 *     it, and omitted otherwise;
 *  D. the contributing entries MUST COVER P — or, where P has not yet
 *     completed, the completed portion of it that step 6 provides for — so a
 *     server holding three months of a finished year has no year to serve.
 *
 * Everything here is offline and deterministic.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { staticAdapter } from "../src/adapters";
import { badRequestResult, handleRequest, parseQuery } from "../src/handler";
import {
  assertSignedMatches,
  assertSignedMatchesObject,
  decodeSignedPayload,
  generateSigningKey,
  signDeclaration,
  signDocument,
} from "../src/jws";
import { normalize } from "../src/normalize";
import {
  AggregateDisagreementError,
  AggregateCoverageError,
  AggregateOverlapError,
  aggregatePeriod,
  completedSubPeriods,
  basicResponse,
  basicResponsePeriod,
  contributingEntries,
  granularityPrecision,
  isFiner,
  periodPrecision,
  PRECISION,
  selectPeriod,
  UnservableAggregateError,
} from "../src/period";
import { Publisher } from "../src/publisher";
import { secureReports } from "../src/security";
import { createSustainabilityServer } from "../src/server";
import { ABSOLUTE_URI_RE, extensionNameError, isExtensionName, MAX_UUID_NAME, NIL_UUID_NAME } from "../src/types";
import type { RawMetrics, ServiceQuery, SourceAdapter, SustainabilityMetrics } from "../src/types";
import { validateDocument } from "../src/validate";

const m = (period: string, over: Record<string, unknown> = {}): SustainabilityMetrics =>
  ({
    updated: `${period.slice(0, 4)}-12-31T00:00:00Z`,
    capabilities: "basic",
    provider: "Acme (sustainability@acme.example)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://acme.example/method",
    "reporting-period": period,
    target: "acme.example",
    "target-type": "origin",
    "energy-consumption": 1,
    "energy-unit": "kWh",
    ...over,
  }) as SustainabilityMetrics;

/**
 * FIXED CLOCKS. The aggregation rule reads a clock for ONE purpose: deciding
 * which sub-periods of the requested period have COMPLETED, which draft step 5
 * requires the contributing entries to cover (all of a finished period; the
 * completed portion, per step 6, of one still running). Every test that forms an
 * aggregate pins it — `selectPeriod`/`aggregatePeriod`/`contributingEntries`
 * take it as their last argument and a `Publisher` takes it as `now` — so no
 * outcome here depends on the day the suite runs. Most of the fixtures below are
 * January and February 2026, whose completed portion of 2026 is exactly those
 * two months at `AFTER_FEB`.
 */
const AFTER_JAN = new Date("2026-02-01T00:00:00Z");
const AFTER_FEB = new Date("2026-03-01T00:00:00Z");
/** Only the first two days of March 2026 have completed. */
const IN_MARCH = new Date("2026-03-03T00:00:00Z");

const raw = (over: Partial<RawMetrics> = {}): RawMetrics => ({
  provider: "Acme",
  measurementMethod: "hardware-metered",
  methodologyUri: "https://acme.example/method",
  reportingPeriod: "2026-01",
  target: "acme.example",
  updated: "2026-02-01T00:00:00Z",
  capabilities: "extended",
  energy: { value: 1, unit: "kWh" },
  ...over,
});

/** An extended adapter over a fixed trend that counts how often it was read. */
function trendAdapter(entries: RawMetrics[]): SourceAdapter & { calls: ServiceQuery[] } {
  const calls: ServiceQuery[] = [];
  return {
    name: "trend",
    capabilities: "extended",
    calls,
    async fetch(query: ServiceQuery) {
      calls.push(query);
      return entries;
    },
  };
}

// ── Item 1 ────────────────────────────────────────────────────────────────────
describe("item 1 — the aggregate's non-metric members (step 5)", () => {
  const jan = m("2026-01", {
    updated: "2026-02-01T00:00:00Z",
    "energy-consumption": 1000,
    "energy-unit": "Wh",
    "carbon-footprint": 1,
    "carbon-unit": "kgCO2e",
    "scope-2": 0.5,
    "sci-score": 5,
    "functional-unit": "per-request",
    "renewable-energy": 40,
    "carbon-intensity-gCO2e-per-kWh": 300,
    "estimated-annual-emissions-kgCO2e": 12,
  });
  const feb = m("2026-02", {
    updated: "2026-03-01T00:00:00Z",
    "energy-consumption": 2,
    "energy-unit": "kWh",
    "carbon-footprint": 2000,
    "carbon-unit": "gCO2e",
    "scope-2": 500,
    "sci-score": 7,
    "functional-unit": "per-request",
    "renewable-energy": 60,
  });

  const out = aggregatePeriod([jan, feb], "2026", AFTER_FEB)!;

  it("carries P as reporting-period and `extended` as capabilities", () => {
    expect(out["reporting-period"]).toBe("2026");
    // Both contributing entries say "basic"; the aggregate is `extended`.
    expect(jan.capabilities).toBe("basic");
    expect(out.capabilities).toBe("extended");
  });

  it("sums energy, carbon and the scope members in the unit the AGGREGATE declares", () => {
    // 1000 Wh + 2 kWh = 3 kWh, in the unit the aggregate declares.
    expect(out["energy-unit"]).toBe("kWh");
    expect(out["energy-consumption"]).toBe(3);
    // 1 kgCO2e + 2000 gCO2e = 3000 gCO2e.
    expect(out["carbon-unit"]).toBe("gCO2e");
    expect(out["carbon-footprint"]).toBe(3000);
    // 0.5 kgCO2e + 500 gCO2e = 1000 gCO2e.
    expect(out["scope-2"]).toBe(1000);
  });

  it("carries the latest `updated` of the contributing entries", () => {
    expect(out.updated).toBe("2026-03-01T00:00:00Z");
  });

  it("carries provider, measurement-method, methodology-uri, target and target-type", () => {
    expect(out.provider).toBe(jan.provider);
    expect(out["measurement-method"]).toBe(jan["measurement-method"]);
    expect(out["methodology-uri"]).toBe(jan["methodology-uri"]);
    expect(out.target).toBe(jan.target);
    expect(out["target-type"]).toBe("origin");
  });

  it("omits every other metric member (nothing is recomputed here)", () => {
    for (const member of [
      "sci-score",
      "functional-unit",
      "renewable-energy",
      "carbon-intensity-gCO2e-per-kWh",
      "estimated-annual-emissions-kgCO2e",
    ]) {
      expect(out).not.toHaveProperty(member);
    }
  });

  it("is itself a conformant declaration object", () => {
    expect(validateDocument(out)).toEqual({ valid: true, errors: [] });
  });

  it("refuses to aggregate entries that disagree on a member that MUST agree", () => {
    for (const disagreement of [
      { provider: "Someone else" },
      { "measurement-method": "cloud-billing" },
      { "methodology-uri": "https://other.example/method" },
      { target: "other.example" },
      { "target-type": "service" },
    ]) {
      expect(() => aggregatePeriod([jan, m("2026-02", { ...disagreement })], "2026", AFTER_FEB)).toThrow(
        AggregateDisagreementError,
      );
    }
  });

  it("treats a member present in one entry and absent from another as a disagreement", () => {
    const noType = m("2026-02");
    delete (noType as Record<string, unknown>)["target-type"];
    expect(() => aggregatePeriod([jan, noType], "2026", AFTER_FEB)).toThrow(/target-type/);
  });

  it("answers a disagreement as NO DATA (404), never as a silently wrong aggregate", async () => {
    // Draft step 5: "where they do not, the server MUST NOT serve an aggregate,
    // since it could only misdescribe what the figures are about, and responds
    // as it does when it has no data" — for this resource, 404, not a 503: the
    // request is not at fault and the server is not broken.
    const disagreeing = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-02", provider: "Someone else" }),
      ]),
      { cacheTtlMs: 0, now: () => AFTER_FEB },
    );
    const errors: unknown[] = [];
    const r = await handleRequest(disagreeing, { period: "2026" }, { onError: (e) => errors.push(e) });
    expect(r.status).toBe(404);

    // "as it does when it has no data": byte for byte the response a period
    // with nothing inside it gets, so nothing about the disagreement leaks.
    const empty = new Publisher(trendAdapter([raw({ reportingPeriod: "2026-01" })]), { cacheTtlMs: 0 });
    const noData = await handleRequest(empty, { period: "2020" }, { onError: () => {} });
    expect(noData.status).toBe(404);
    expect(r.body).toBe(noData.body);

    // The operator still hears about it, with the disagreeing member and its
    // values named: a misconfigured data set, not a vanished aggregate.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AggregateDisagreementError);
    expect((errors[0] as AggregateDisagreementError).member).toBe("provider");
    expect((errors[0] as Error).message).toContain("provider");
    expect((errors[0] as Error).message).toContain("Someone else");
  });

  it("writes NOTHING to the console when no onError hook is configured", async () => {
    // An unservable aggregate is a diagnostic about the published data set, not
    // a fault: the server is not broken and the request is not at fault, so
    // there is no failure to be silent about. It also recurs on every request
    // that touches the period, and its message names the periods held and the
    // members that disagree — the coverage information Privacy Considerations
    // keeps out of the response. So it goes to the operator's hook and nowhere
    // else; with no hook, nothing is written to any stream.
    const unservable = [
      // a disagreement…
      trendAdapter([
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-02", methodologyUri: "https://other.example/m" }),
      ]),
      // …a gap in the coverage…
      trendAdapter([raw({ reportingPeriod: "2026-01" })]),
      // …and the same period held twice.
      trendAdapter([
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-02" }),
      ]),
    ];
    const logged: unknown[] = [];
    const spied = ["error", "warn", "log", "info", "debug"] as const;
    const original = Object.fromEntries(spied.map((k) => [k, console[k]])) as Record<string, typeof console.log>;
    for (const k of spied) console[k] = (...args: unknown[]) => void logged.push(args);
    try {
      for (const adapter of unservable) {
        const publisher = new Publisher(adapter, { cacheTtlMs: 0, now: () => AFTER_FEB });
        expect((await handleRequest(publisher, { period: "2026" })).status).toBe(404);
      }
    } finally {
      for (const k of spied) console[k] = original[k];
    }
    expect(logged).toEqual([]);

    // The information is not lost — it is in the hook payload, for an operator
    // that asks for it.
    const errors: unknown[] = [];
    const publisher = new Publisher(unservable[0], { cacheTtlMs: 0, now: () => AFTER_FEB });
    expect((await handleRequest(publisher, { period: "2026" }, { onError: (e) => errors.push(e) })).status).toBe(404);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(UnservableAggregateError);
  });

  it("still falls back to the console for a FAULT, which is a different thing", async () => {
    // An adapter that throws is a deployment that cannot publish at all: the
    // request is answered 503 and the cause is never swallowed just because no
    // hook was passed.
    const broken = new Publisher(
      { name: "broken", capabilities: "extended", fetch: async () => { throw new Error("upstream is down"); } },
      { cacheTtlMs: 0 },
    );
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      expect((await handleRequest(broken, {})).status).toBe(503);
    } finally {
      console.error = original;
    }
    expect(logged).toHaveLength(1);
  });

  it("declares the unit of the LAST contributing entry in ascending order of reporting-period", () => {
    // Draft step 5: the sums are taken "after converting the contributing
    // entries to the unit the aggregate declares in `energy-unit` and
    // `carbon-unit`, which is the unit declared by the last contributing entry
    // in ascending order of `reporting-period`" — never the entry with the
    // latest `updated`, which step 5 governs separately. Here February is the
    // last period, so kWh and gCO2e.
    expect(out["energy-unit"]).toBe(feb["energy-unit"]);
    expect(out["carbon-unit"]).toBe(feb["carbon-unit"]);

    // Make January the last period instead and the aggregate declares ITS
    // units, the same figures converted the other way: 1000 Wh + 2 kWh = 3000
    // Wh, 1 kgCO2e + 2000 gCO2e = 3 kgCO2e.
    const asOf = (entry: SustainabilityMetrics, period: string): SustainabilityMetrics =>
      ({ ...entry, "reporting-period": period }) as SustainabilityMetrics;
    const reversed = aggregatePeriod([asOf(feb, "2026-01"), asOf(jan, "2026-02")], "2026", AFTER_FEB)!;
    expect(reversed["energy-unit"]).toBe("Wh");
    expect(reversed["energy-consumption"]).toBe(3000);
    expect(reversed["carbon-unit"]).toBe("kgCO2e");
    expect(reversed["carbon-footprint"]).toBe(3);
  });

  it("takes the last entry by ascending period, whatever order the caller passes", () => {
    // `aggregatePeriod` is exported, so the rule is stated in terms of the
    // periods rather than of the array index: the same two entries handed over
    // in either order declare the same unit, February's.
    expect(aggregatePeriod([feb, jan], "2026", AFTER_FEB)!["energy-unit"]).toBe("kWh");
    expect(aggregatePeriod([feb, jan], "2026", AFTER_FEB)!["energy-consumption"]).toBe(3);
  });

  it("carries a non-metric optional member only where EVERY entry carries it with the same value", () => {
    const link = "https://acme.example/disclosures.json";
    const both = aggregatePeriod(
      [m("2026-01", { "disclosure-uri": link }), m("2026-02", { "disclosure-uri": link })],
      "2026",
      AFTER_FEB,
    )!;
    expect(both["disclosure-uri"]).toBe(link);

    // A different value: omitted.
    const differing = aggregatePeriod(
      [m("2026-01", { "disclosure-uri": link }), m("2026-02", { "disclosure-uri": "https://acme.example/other.json" })],
      "2026",
      AFTER_FEB,
    )!;
    expect(differing).not.toHaveProperty("disclosure-uri");

    // Carried by one entry only — "carries it with the same value" is not
    // satisfied by "agrees where present", so it is omitted either way round.
    for (const pair of [
      [m("2026-01", { "disclosure-uri": link }), m("2026-02")],
      [m("2026-01"), m("2026-02", { "disclosure-uri": link })],
    ]) {
      expect(aggregatePeriod(pair, "2026", AFTER_FEB)!).not.toHaveProperty("disclosure-uri");
    }
  });
});

// ── Item 2 ────────────────────────────────────────────────────────────────────
describe("item 2 — an aggregate that would carry no metric is a 404", () => {
  const sciOnly = (period: string) =>
    m(period, {
      "energy-consumption": undefined,
      "energy-unit": undefined,
      "sci-score": 5,
      "functional-unit": "per-request",
      "disclosure-uri": "https://acme.example/disclosures.json",
    });

  it("returns undefined rather than an object with no metric member", () => {
    const entries = [sciOnly("2026-01"), sciOnly("2026-02")].map((e) => {
      const copy = { ...e } as Record<string, unknown>;
      delete copy["energy-consumption"];
      delete copy["energy-unit"];
      return copy as unknown as SustainabilityMetrics;
    });
    // Every contributing entry reports only `sci-score`, which the aggregate
    // does not recompute — and the evidence link does not stand in for a
    // metric here.
    expect(aggregatePeriod(entries, "2026", AFTER_FEB)).toBeUndefined();
  });

  it("answers 404 end to end", async () => {
    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01", energy: undefined, sciScore: 5, functionalUnit: "per-request" }),
        raw({ reportingPeriod: "2026-02", energy: undefined, sciScore: 7, functionalUnit: "per-request" }),
      ]),
      { cacheTtlMs: 0, now: () => AFTER_FEB },
    );
    // The finer periods are served normally …
    expect((await handleRequest(publisher, { period: "2026-01" })).status).toBe(200);
    // … but the year they would aggregate to carries no metric at all.
    expect((await handleRequest(publisher, { period: "2026" })).status).toBe(404);
  });
});

// ── Item 3 ────────────────────────────────────────────────────────────────────
describe("item 3 — the period of the Basic response when it is an array", () => {
  it("reads the LAST object's reporting-period from an array", () => {
    const trend = [m("2026-01"), m("2026-02"), m("2026-03")];
    expect(basicResponsePeriod(trend)).toBe("2026-03");
    expect(basicResponsePeriod(m("2026-07"))).toBe("2026-07");
    expect(basicResponsePeriod([])).toBeUndefined();
  });

  it("uses it as P when `period` is absent", () => {
    const entries = [m("2026-01"), m("2026-02"), m("2026-02-14"), m("2026-02-15")];
    expect(basicResponsePeriod(basicResponse(entries)!)).toBe("2026-02-15");
    // P is then the day 2026-02-15, which `daily` is not finer than: step 3
    // ignores the parameter and the answer is one object, not an array.
    const one = selectPeriod(entries, { granularity: "daily" }, "extended");
    expect(Array.isArray(one)).toBe(false);
    expect((one as SustainabilityMetrics)["reporting-period"]).toBe("2026-02-15");
  });

  it("scopes a granularity-only request to the Basic response's own period", () => {
    // The Basic response is the LAST object of the ascending trend, so no held
    // entry lies strictly inside its period. `daily` IS finer than the month
    // 2026-02, so it is in effect and the response would be the array of the
    // daily entries inside 2026-02 — of which there are none, which step 5
    // makes 404 rather than a fallback to the month's own object. The daily
    // entries the publisher does hold belong to January, and are reached by
    // naming that period.
    const entries = secureReports([m("2026-01-14"), m("2026-01-15"), m("2026-02")]);
    expect(basicResponsePeriod(basicResponse(entries)!)).toBe("2026-02");
    expect(selectPeriod(entries, { granularity: "daily" }, "extended")).toBeUndefined();
    const arr = selectPeriod(entries, { period: "2026-01", granularity: "daily" }, "extended");
    expect((arr as SustainabilityMetrics[]).map((e) => e["reporting-period"])).toEqual([
      "2026-01-14",
      "2026-01-15",
    ]);
  });
});

// ── Item 4 ────────────────────────────────────────────────────────────────────
describe("item 4 — granularity denotes a precision, and selection is by precision", () => {
  it("maps the two values onto month and day precision", () => {
    expect(granularityPrecision("monthly")).toBe(PRECISION.month);
    expect(granularityPrecision("daily")).toBe(PRECISION.day);
    expect(periodPrecision("2026")).toBe(PRECISION.year);
    expect(periodPrecision("2026-02")).toBe(PRECISION.month);
    expect(periodPrecision("2026-02-03")).toBe(PRECISION.day);
  });

  it("orders year coarser than month coarser than day", () => {
    expect(isFiner(PRECISION.month, PRECISION.year)).toBe(true);
    expect(isFiner(PRECISION.day, PRECISION.month)).toBe(true);
    expect(isFiner(PRECISION.month, PRECISION.month)).toBe(false);
    expect(isFiner(PRECISION.year, PRECISION.day)).toBe(false);
  });

  it("selects the entries WHOSE PRECISION IS G, not merely those within P", () => {
    const entries = secureReports([m("2026-01"), m("2026-01-15"), m("2026-02")]);
    const monthly = selectPeriod(entries, { period: "2026", granularity: "monthly" }, "extended");
    expect((monthly as SustainabilityMetrics[]).map((e) => e["reporting-period"])).toEqual([
      "2026-01",
      "2026-02",
    ]);
    const daily = selectPeriod(entries, { period: "2026", granularity: "daily" }, "extended");
    expect((daily as SustainabilityMetrics[]).map((e) => e["reporting-period"])).toEqual(["2026-01-15"]);
  });

  it("ignores a granularity whose precision is not finer than the period's", () => {
    const entries = secureReports([m("2026-01"), m("2026-02")]);
    const one = selectPeriod(entries, { period: "2026-02", granularity: "monthly" }, "extended");
    expect(Array.isArray(one)).toBe(false);
    expect((one as SustainabilityMetrics)["reporting-period"]).toBe("2026-02");
  });
});

// ── Item 5 ────────────────────────────────────────────────────────────────────
describe("item 5 — the cache key is computed from the honored parameters", () => {
  it("collapses requests differing only in parameters the publisher ignores", async () => {
    const adapter = trendAdapter([raw({ reportingPeriod: "2026-01" })]);
    const publisher = new Publisher(adapter, { cacheTtlMs: 60_000, normalize: { target: "acme.example" } });

    const first = await publisher.getSerialized({});
    for (let i = 0; i < 50; i++) {
      // `target` with no published prefix set is not supported, so not honored.
      const r = await publisher.getSerialized({ target: `/p${i}` });
      expect(r.etag).toBe(first.etag);
      expect(r.body).toBe(first.body);
    }
    expect(publisher.cacheSize).toBe(1);
    expect(adapter.calls.length).toBe(1);
    // The adapter never even sees a parameter the publisher does not honor.
    expect(adapter.calls[0]).toEqual({});
  });

  it("keys on the MATCHED PREFIX, so every value under one prefix shares an entry", async () => {
    const adapter = trendAdapter([raw({ reportingPeriod: "2026-01" })]);
    const publisher = new Publisher(adapter, {
      cacheTtlMs: 60_000,
      targetPrefixes: ["/api/v1"],
    });
    expect(publisher.cacheKeyFor({ target: "/api/v1/users" })).toBe(
      publisher.cacheKeyFor({ target: "/api/v1/orders" }),
    );
    const a = await publisher.getSerialized({ target: "/api/v1/users" });
    const b = await publisher.getSerialized({ target: "/api/v1/orders" });
    expect(b.etag).toBe(a.etag);
    expect(publisher.cacheSize).toBe(1);
  });

  it("drops a granularity that step 3 ignores from the key", () => {
    const publisher = new Publisher(trendAdapter([raw()]), {});
    expect(publisher.cacheKeyFor({ period: "2026-02", granularity: "monthly" })).toBe(
      publisher.cacheKeyFor({ period: "2026-02" }),
    );
    expect(publisher.cacheKeyFor({ period: "2026", granularity: "monthly" })).not.toBe(
      publisher.cacheKeyFor({ period: "2026" }),
    );
  });

  it("honors none of the three for a Basic publisher", () => {
    const publisher = new Publisher(staticAdapter({ data: raw() }), {});
    const basic = publisher.cacheKeyFor({});
    expect(publisher.cacheKeyFor({ target: "/x", period: "2026", granularity: "daily" })).toBe(basic);
  });

  it("uses a canonical order: target, period, granularity", () => {
    const publisher = new Publisher(trendAdapter([raw()]), { targetPrefixes: ["/a"] });
    expect(publisher.cacheKeyFor({ granularity: "daily", period: "2026", target: "/a" })).toBe(
      JSON.stringify(["/a", "2026", "daily"]),
    );
  });

  it("collapses every unmatched target onto one key (and caches nothing for it)", async () => {
    const publisher = new Publisher(trendAdapter([raw()]), {
      cacheTtlMs: 60_000,
      targetPrefixes: ["/a"],
    });
    expect(publisher.cacheKeyFor({ target: "/nope" })).toBe(publisher.cacheKeyFor({ target: "/also-nope" }));
    for (let i = 0; i < 20; i++) {
      expect((await handleRequest(publisher, { target: `/nope${i}` })).status).toBe(404);
    }
    expect(publisher.cacheSize).toBe(0);
  });
});

// ── Item 6 ────────────────────────────────────────────────────────────────────
describe("item 6 — the ABNF is case-sensitive and self-contained", () => {
  it("does not treat `Period=`, `TARGET=` or `Granularity=` as the defined parameters", () => {
    const parsed = parseQuery({ Period: "2026-99", TARGET: "/x", Granularity: "daily" });
    expect(parsed).toEqual({ ok: true, query: { target: undefined, period: undefined, granularity: undefined } });
  });

  it("does not treat `MONTHLY` or `Daily` as granularity-values", () => {
    for (const value of ["MONTHLY", "Monthly", "Daily", "DAILY", "weekly"]) {
      const parsed = parseQuery({ granularity: value });
      expect(parsed.ok && parsed.query.granularity).toBeUndefined();
    }
    expect(parseQuery({ granularity: "monthly" })).toMatchObject({ ok: true, query: { granularity: "monthly" } });
  });

  it("does not reject a repeated undefined name, however it is spelled", () => {
    expect(parseQuery({ Period: ["2026", "2027"] }).ok).toBe(true);
    expect(parseQuery({ period: ["2026", "2027"] }).ok).toBe(false);
  });

  it("matches a percent-encoded `&`/`=` inside a target value after decoding", async () => {
    const publisher = new Publisher(trendAdapter([raw({ reportingPeriod: "2026-01" })]), {
      cacheTtlMs: 0,
      targetPrefixes: ["/a=b&c"],
    });
    const server = createSustainabilityServer(publisher);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}/.well-known/sustainability-data`;
    try {
      // On the wire the value carries its own "&" and "=" percent-encoded.
      const ok = await fetch(`${base}?target=%2Fa%3Db%26c`);
      expect(ok.status).toBe(200);
      expect((await ok.json()).target).toBe("/a=b&c");
      // Unencoded, the "&" splits the query and the value no longer matches.
      expect((await fetch(`${base}?target=/a=b&c`)).status).toBe(404);
      // A capitalized name is an undefined name: ignored, so the Basic answer.
      const ignored = await fetch(`${base}?Period=2026-13&TARGET=/nope`);
      expect(ignored.status).toBe(200);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("still applies step 2 to a well-spelled `period`", () => {
    expect(parseQuery({ period: "2026-02-30" }).ok).toBe(false);
    expect(parseQuery({ period: "2026-2" }).ok).toBe(false);
    expect(parseQuery({ period: "2026-02" }).ok).toBe(true);
  });
});

// ── Items 7 and 8 ─────────────────────────────────────────────────────────────
describe("items 7 and 8 — what `signed` carries, and never serving a stale one", () => {
  it("never puts a `signed` member inside the payload, even when re-signing", async () => {
    const key = await generateSigningKey();
    const once = await signDeclaration(m("2026-01"), key);
    const twice = await signDeclaration(once, key);
    for (const obj of [once, twice]) {
      const payload = JSON.parse(decodeSignedPayload(obj.signed!));
      expect(payload).not.toHaveProperty("signed");
      const { signed: _s, ...rest } = obj;
      expect(payload).toEqual(rest);
    }
  });

  it("signs every object of an array, and rejects a partly signed one", async () => {
    const key = await generateSigningKey();
    const doc = (await signDocument([m("2026-01"), m("2026-02"), m("2026-03")], key)) as SustainabilityMetrics[];
    expect(doc.every((o) => typeof o.signed === "string")).toBe(true);
    expect(() => assertSignedMatches(doc)).not.toThrow();
    const partly = [doc[0], { ...doc[1], signed: undefined }, doc[2]] as SustainabilityMetrics[];
    delete (partly[1] as Record<string, unknown>).signed;
    expect(() => assertSignedMatches(partly)).toThrow(/signs all of them/);
  });

  it("rejects a signature whose payload differs from the object it accompanies", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(m("2026-01"), key);
    const tampered = { ...signed, "energy-consumption": 999 };
    expect(() => assertSignedMatchesObject(tampered)).toThrow(/differs from the object it accompanies/);
    const relabelled = { ...signed, "reporting-period": "2026-02" };
    expect(() => assertSignedMatchesObject(relabelled)).toThrow(/differs from the object it accompanies/);
  });

  it("rejects a payload that is not a declaration object", async () => {
    const key = await generateSigningKey();
    const signed = await signDeclaration(m("2026-01"), key);
    const parts = signed.signed!.split(".");
    const foreign = [parts[0], Buffer.from("[1,2,3]").toString("base64url"), parts[2]].join(".");
    expect(() => assertSignedMatchesObject({ ...signed, signed: foreign })).toThrow(/not a declaration object/);
    expect(() => assertSignedMatchesObject({ ...signed, signed: "not-a-jws" })).toThrow(/Compact Serialization/);
  });

  it("serves a signature that matches the served body, from the cache and on revalidation", async () => {
    const key = await generateSigningKey();
    const publisher = new Publisher(trendAdapter([raw({ reportingPeriod: "2026-01" })]), {
      cacheTtlMs: 60_000,
      signing: { key },
    });
    const first = await handleRequest(publisher, {});
    const second = await handleRequest(publisher, {}); // served from the cache
    expect(second.body).toBe(first.body);
    expect(second.headers.ETag).toBe(first.headers.ETag);
    const served = JSON.parse(first.body) as SustainabilityMetrics;
    expect(() => assertSignedMatchesObject(served)).not.toThrow();
    // The conditional-request path returns the SAME validator, so a 304 can
    // never point a consumer at a body whose signature has moved on.
    const notModified = await handleRequest(publisher, {}, {}, first.headers.ETag);
    expect(notModified.status).toBe(304);
    expect(notModified.headers.ETag).toBe(first.headers.ETag);
  });

  it("signs the aggregate itself, never carrying a contributor's signature into it", async () => {
    const key = await generateSigningKey();
    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-02" }),
      ]),
      { cacheTtlMs: 0, signing: { key }, now: () => AFTER_FEB },
    );
    const r = await handleRequest(publisher, { period: "2026" });
    expect(r.status).toBe(200);
    const doc = JSON.parse(r.body) as SustainabilityMetrics;
    expect(doc["reporting-period"]).toBe("2026");
    expect(doc["energy-consumption"]).toBe(2);
    const payload = JSON.parse(decodeSignedPayload(doc.signed!));
    expect(payload["reporting-period"]).toBe("2026");
    expect(payload).not.toHaveProperty("signed");
    expect(() => assertSignedMatchesObject(doc)).not.toThrow();
  });

  it("signs every object of an array response", async () => {
    const key = await generateSigningKey();
    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01" }),
        raw({ reportingPeriod: "2026-02" }),
      ]),
      { cacheTtlMs: 0, signing: { key } },
    );
    const r = await handleRequest(publisher, { period: "2026", granularity: "monthly" });
    const doc = JSON.parse(r.body) as SustainabilityMetrics[];
    expect(doc).toHaveLength(2);
    expect(() => assertSignedMatches(doc)).not.toThrow();
  });

  it("never lets a source document's `signed` member survive into a served object", async () => {
    // Source data that already carries someone else's signature.
    const stale = { ...raw({ reportingPeriod: "2026-01" }), signed: "eyJhbGciOiJFZERTQSJ9.e30.sig" };
    const publisher = new Publisher(
      {
        name: "wire",
        capabilities: "basic",
        async fetch() {
          return stale as unknown as RawMetrics;
        },
      },
      { cacheTtlMs: 0, normalize: { target: "acme.example" } },
    );
    const doc = (await publisher.build()) as SustainabilityMetrics;
    expect(doc).not.toHaveProperty("signed");
  });
});

// ── Item 9 ────────────────────────────────────────────────────────────────────
describe("item 9 — the Nil and Max UUIDs are not usable extension keys", () => {
  it("is rejected at normalization", () => {
    for (const uuid of [NIL_UUID_NAME, MAX_UUID_NAME]) {
      expect(() => normalize(raw({ extensions: { [uuid]: { a: 1 } } }))).toThrow(
        /guaranteed collision/,
      );
    }
  });

  it("is rejected by the validation gate", () => {
    for (const uuid of [NIL_UUID_NAME, MAX_UUID_NAME]) {
      const doc = { ...m("2026-01"), extensions: { [uuid]: { a: 1 } } } as SustainabilityMetrics;
      const r = validateDocument(doc);
      expect(r.valid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/MUST NOT be used as an extensions key/);
    }
  });

  it("still accepts an ordinary urn:uuid key, and an https one", () => {
    const doc = normalize(raw({ extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { pue: 1.15 } } }));
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
    const httpsDoc = normalize(
      raw({ extensions: { "https://example.com/sustainability/extensions/water-and-waste": { pue: 1.15 } } }),
    );
    expect(validateDocument(httpsDoc)).toEqual({ valid: true, errors: [] });
  });

  it("a bare UUID is no longer an extensions key at all (-07 absolute-URI rule)", () => {
    expect(() => normalize(raw({ extensions: { "16c36135-e6ae-40f9-a972-015eefc68845": { a: 1 } } }))).toThrow(
      /is not an absolute URI/,
    );
  });

  // The CDDL `ext-name` rule is
  //   tstr .regexp "[a-z][a-z0-9+.-]*:[!$-;=?-Z\\[\\]_a-z~]+"
  // so the characters RFC 3986 never allows in a URI are rejected outright.
  it("rejects the characters RFC 3986 does not allow, and accepts an IP-literal host", () => {
    for (const bad of [
      'https://example.com/a"b',
      "https://example.com/{x}",
      "https://example.com/a|b",
      "https://example.com/<x>",
      "https://example.com/a\\b",
      "https://example.com/a^b",
      "https://example.com/a`b",
    ]) {
      expect(isExtensionName(bad), bad).toBe(false);
      expect(extensionNameError(bad), bad).toMatch(/RFC 3986 does not allow/);
      expect(() => normalize(raw({ extensions: { [bad]: { a: 1 } } })), bad).toThrow(
        /RFC 3986 does not allow/,
      );
    }
    expect(isExtensionName("https://[::1]/x")).toBe(true);
    expect(extensionNameError("https://[::1]/x")).toBeUndefined();
    expect(validateDocument(normalize(raw({ extensions: { "https://[::1]/x": { a: 1 } } })))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("ABSOLUTE_URI_RE is the CDDL ext-name class, character for character", () => {
    const allowed = new Set(
      ("!$%&'()*+,-./0123456789:;=?@" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_" + "abcdefghijklmnopqrstuvwxyz~").split(""),
    );
    for (let c = 0; c < 128; c++) {
      const ch = String.fromCharCode(c);
      expect(ABSOLUTE_URI_RE.test(`x:${ch}`), `U+${c.toString(16).padStart(4, "0")}`).toBe(allowed.has(ch));
    }
  });
});

// ── Items 10 and 11 ───────────────────────────────────────────────────────────
describe("item 10 — noise is opt-in and must be disclosed", () => {
  const entries = [m("2026-01", { "energy-consumption": 100, "carbon-footprint": 1000, "carbon-unit": "gCO2e" })];

  it("does not perturb a value unless the operator opts in", () => {
    const untouched = secureReports(entries);
    expect(untouched[0]["energy-consumption"]).toBe(100);
    expect(untouched[0]["carbon-footprint"]).toBe(1000);
    // The default of the option bag, not merely of this call.
    expect(secureReports(entries, {})[0]["energy-consumption"]).toBe(100);
  });

  it("perturbs only when asked, deterministically, and within 1%", () => {
    const noised = secureReports(entries, { applyNoise: true });
    const again = secureReports(entries, { applyNoise: true });
    expect(noised[0]["energy-consumption"]).toBe(again[0]["energy-consumption"]);
    expect(Math.abs(noised[0]["energy-consumption"]! - 100)).toBeLessThanOrEqual(1);
  });

  it("is documented as a disclosure obligation on the publisher", () => {
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    const usage = readFileSync(join(__dirname, "..", "USAGE.md"), "utf8");
    expect(readme).toMatch(/methodology document MUST state that noise is applied/);
    expect(usage).toMatch(/methodology document MUST state that noise is applied/);
  });
});

describe("item 11 — access control is out of scope", () => {
  it("does not claim the resource must be served to everyone", () => {
    for (const file of ["README.md", "USAGE.md"]) {
      const text = readFileSync(join(__dirname, "..", file), "utf8");
      expect(text).not.toMatch(/MUST be answered with `?200/);
      expect(text).not.toMatch(/must be served to (everyone|all)/i);
    }
    const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");
    expect(readme).toMatch(/Access control is outside the scope/);
  });

  it("answers 404, not 200, when there is nothing to serve for the request", async () => {
    const publisher = new Publisher(trendAdapter([raw({ reportingPeriod: "2026-01" })]), { cacheTtlMs: 0 });
    expect((await handleRequest(publisher, { period: "2019" })).status).toBe(404);
  });

  it("leaves a rejected query to the caller, as RFC 9110 defines", () => {
    const rejected = parseQuery({ period: "nope" });
    expect(rejected.ok).toBe(false);
    expect(badRequestResult((rejected as { error: string }).error).status).toBe(400);
  });
});

// ── Corrections A, B and C to step 5 ──────────────────────────────────────────
const periodsOf = (entries: SustainabilityMetrics[]): string[] =>
  entries.map((e) => e["reporting-period"]);

describe("correction A — the unit is the LAST entry in ascending order of reporting-period", () => {
  // The two dimensions are deliberately crossed: January is the entry with the
  // LATEST `updated` (it was revised a year later), February is the LAST in
  // ascending order of `reporting-period`. The aggregate must take its unit
  // from February and its `updated` from January.
  const janRevisedLate = m("2026-01", {
    updated: "2027-06-01T00:00:00Z",
    "energy-consumption": 1000,
    "energy-unit": "Wh",
  });
  const feb = m("2026-02", {
    updated: "2026-03-01T00:00:00Z",
    "energy-consumption": 2,
    "energy-unit": "kWh",
  });

  it("takes the unit from the last period, not from the entry updated last", () => {
    const year = aggregatePeriod([janRevisedLate, feb], "2026", AFTER_FEB)!;
    expect(year["energy-unit"]).toBe("kWh"); // February's, though January was updated later
    expect(year["energy-consumption"]).toBe(3); // 1000 Wh + 2 kWh, in kWh
  });

  it("still takes `updated` from its own separate rule: the latest of them", () => {
    const year = aggregatePeriod([janRevisedLate, feb], "2026", AFTER_FEB)!;
    expect(year.updated).toBe("2027-06-01T00:00:00Z");
  });

  it("is a property of the periods, not of the array order", () => {
    const shuffled = aggregatePeriod([feb, janRevisedLate], "2026", AFTER_FEB)!;
    expect(shuffled["energy-unit"]).toBe("kWh");
    expect(shuffled["energy-consumption"]).toBe(3);
  });
});

describe("correction B — the contributing entries are of ONE precision and MUST NOT overlap", () => {
  // The draft's own double-counting shape: a month, and a day INSIDE that
  // month, both held, both inside the requested year.
  const jan = m("2026-01", { "energy-consumption": 10 });
  const janDay = m("2026-01-15", { "energy-consumption": 3 });
  const feb = m("2026-02", { "energy-consumption": 20 });

  it("does not count a day inside a held month twice", () => {
    const year = aggregatePeriod([jan, janDay, feb], "2026", AFTER_FEB)!;
    // 10 + 20 = 30, the two months; NOT 33, which would count 2026-01-15 both
    // on its own and inside January.
    expect(year["energy-consumption"]).toBe(30);
  });

  it("chooses the coarsest precision held inside P, whatever order it is given", () => {
    for (const order of [
      [jan, janDay, feb],
      [janDay, feb, jan],
      [feb, janDay, jan],
    ]) {
      expect(periodsOf(contributingEntries(order, "2026", AFTER_FEB)!)).toEqual(["2026-01", "2026-02"]);
    }
  });

  it("falls back to the finer precision only where no coarser one lies inside P", () => {
    // The two days are the whole completed portion of March at `IN_MARCH`, so
    // they cover it (correction D) and, no month lying inside March, they are
    // the contributing entries.
    const marchDays = [m("2026-03-01", { "energy-consumption": 4 }), m("2026-03-02", { "energy-consumption": 5 })];
    expect(periodsOf(contributingEntries(marchDays, "2026-03", IN_MARCH)!)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(aggregatePeriod(marchDays, "2026-03", IN_MARCH)!["energy-consumption"]).toBe(9);
  });

  it("never contributes an entry for P itself, or one outside it", () => {
    expect(contributingEntries([m("2026"), jan, feb], "2026", AFTER_FEB)!.length).toBe(2);
    // At `AFTER_JAN` January is the whole completed portion of 2026, so the
    // December entry outside P is the only one dropped here.
    expect(contributingEntries([m("2025-12"), jan], "2026", AFTER_JAN)!.map((e) => e["reporting-period"])).toEqual(["2026-01"]);
    expect(contributingEntries([m("2026")], "2026", AFTER_FEB)).toBeUndefined();
    expect(aggregatePeriod([], "2026", AFTER_FEB)).toBeUndefined();
  });

  it("refuses to aggregate a period held twice: that is an overlap", () => {
    // The same no-data outcome as a gap in the coverage, and told to the
    // operator the same way: an `UnservableAggregateError` naming the period
    // held twice, which the handler answers with the ordinary 404.
    const twice = [jan, m("2026-01", { "energy-consumption": 99 })];
    expect(() => contributingEntries(twice, "2026", AFTER_JAN)).toThrow(AggregateOverlapError);
    expect(() => aggregatePeriod(twice, "2026", AFTER_JAN)).toThrow(/2026-01 held more than once/);
    expect(new AggregateOverlapError("2026", ["2026-01"])).toBeInstanceOf(UnservableAggregateError);
  });

  it("answers the month itself with its own entry, never with the day inside it", () => {
    const entries = secureReports([jan, janDay, feb]);
    const month = selectPeriod(entries, { period: "2026-01" }, "extended", AFTER_FEB) as SustainabilityMetrics;
    expect(month["reporting-period"]).toBe("2026-01");
    expect(month["energy-consumption"]).toBe(10);
  });

  it("serves the un-double-counted year end to end", async () => {
    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01", energy: { value: 10, unit: "kWh" } }),
        raw({ reportingPeriod: "2026-01-15", energy: { value: 3, unit: "kWh" } }),
        raw({ reportingPeriod: "2026-02", energy: { value: 20, unit: "kWh" } }),
      ]),
      { cacheTtlMs: 0, now: () => AFTER_FEB },
    );
    const year = await handleRequest(publisher, { period: "2026" });
    expect(year.status).toBe(200);
    expect(JSON.parse(year.body)["energy-consumption"]).toBe(30);
    // The day is still reachable as itself, and as a daily slice of its month.
    const daily = await handleRequest(publisher, { period: "2026-01", granularity: "daily" });
    expect(periodsOf(JSON.parse(daily.body))).toEqual(["2026-01-15"]);
  });
});

describe("correction C — a summable member not reported by EVERY contributor is omitted", () => {
  const withScopes = (period: string, over: Record<string, unknown> = {}) =>
    m(period, {
      "carbon-footprint": 100,
      "carbon-unit": "gCO2e",
      "scope-1": 1,
      "scope-2": 2,
      "scope-3": 3,
      ...over,
    });

  it("omits the one scope member a contributor is silent about, and sums the rest", () => {
    const feb = withScopes("2026-02") as unknown as Record<string, unknown>;
    delete feb["scope-3"]; // February reports scope-1 and scope-2 but not scope-3
    const year = aggregatePeriod([withScopes("2026-01"), feb as unknown as SustainabilityMetrics], "2026", AFTER_FEB)!;
    expect(year["scope-1"]).toBe(2);
    expect(year["scope-2"]).toBe(4);
    expect(year).not.toHaveProperty("scope-3"); // summing 3 + silence would understate 2026
    expect(year["carbon-footprint"]).toBe(200);
    expect(validateDocument(year)).toEqual({ valid: true, errors: [] });
  });

  it("is judged over the CONTRIBUTING entries, not over everything held", () => {
    // The day inside January is not a contributor (correction B), so its
    // silence about scope-1 cannot suppress the months' scope-1.
    const silentDay = withScopes("2026-01-15") as unknown as Record<string, unknown>;
    delete silentDay["scope-1"];
    const year = aggregatePeriod(
      [withScopes("2026-01"), silentDay as unknown as SustainabilityMetrics, withScopes("2026-02")],
      "2026",
      AFTER_FEB,
    )!;
    expect(year["scope-1"]).toBe(2);
  });

  it("leaves nothing to carry when one precision reports different lone metrics: 404", async () => {
    // B and C together with the at-least-one-metric rule: two months, one
    // precision, no overlap — but energy is reported only by January and carbon
    // only by February, so both are omitted and the aggregate carries nothing.
    const energyOnly = m("2026-01", { "energy-consumption": 5, "energy-unit": "kWh" });
    const carbonOnly = m("2026-02", { "carbon-footprint": 500, "carbon-unit": "gCO2e" }) as unknown as Record<string, unknown>;
    delete carbonOnly["energy-consumption"];
    delete carbonOnly["energy-unit"];
    expect(aggregatePeriod([energyOnly, carbonOnly as unknown as SustainabilityMetrics], "2026", AFTER_FEB)).toBeUndefined();

    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2026-01", energy: { value: 5, unit: "kWh" } }),
        raw({ reportingPeriod: "2026-02", energy: undefined, carbon: { value: 500, unit: "gCO2e" } }),
      ]),
      { cacheTtlMs: 0, now: () => AFTER_FEB },
    );
    // Each month is served on its own …
    expect((await handleRequest(publisher, { period: "2026-01" })).status).toBe(200);
    expect((await handleRequest(publisher, { period: "2026-02" })).status).toBe(200);
    // … but their year would report nothing, so there is no aggregate to serve.
    expect((await handleRequest(publisher, { period: "2026" })).status).toBe(404);
  });
});

describe("correction D — the contributing entries MUST COVER the period", () => {
  // Draft step 5: the contributing entries "MUST cover P, or, where P has not
  // yet completed, the completed portion of it that step 6 provides for: a
  // server holding figures for only part of a finished period cannot present
  // their sum as a figure for the whole of it. A server whose held data cannot
  // meet these conditions has no aggregate it can honestly serve and responds as
  // it does when it has no data."
  //
  // WHAT COUNTS AS COVERAGE is a TILING of the period, not a count of entries:
  // every sub-period of P at the contributing precision that has COMPLETED by
  // the clock must be held. The clock is `PublisherOptions.now` (a parameter of
  // `selectPeriod`, `aggregatePeriod` and `contributingEntries`), so every test
  // below pins it and none depends on the day the suite runs.
  const monthsOf = (year: number, first: number, last: number): SustainabilityMetrics[] =>
    Array.from({ length: last - first + 1 }, (_, i) =>
      m(`${year}-${String(first + i).padStart(2, "0")}`, { "energy-consumption": 1 }),
    );
  /** 2025 is over; the whole of it must be covered. */
  const AFTER_2025 = new Date("2026-01-01T00:00:00Z");
  /** 2026 is running: January to August have completed, September has not. */
  const MID_SEPTEMBER = new Date("2026-09-16T12:00:00Z");

  it("knows the completed portion of a period at a given precision", () => {
    expect(completedSubPeriods("2025", PRECISION.month, AFTER_2025)).toHaveLength(12);
    expect(completedSubPeriods("2026", PRECISION.month, MID_SEPTEMBER)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
    ]);
    // A day ends at midnight UTC: the 15th has completed on the 16th, the 16th has not.
    expect(completedSubPeriods("2026-09", PRECISION.day, MID_SEPTEMBER)).toHaveLength(15);
    // Nothing of a period still to come has completed, and a precision that is
    // not finer than the period's has no sub-periods at all.
    expect(completedSubPeriods("2027", PRECISION.month, MID_SEPTEMBER)).toEqual([]);
    expect(completedSubPeriods("2026-09", PRECISION.month, MID_SEPTEMBER)).toEqual([]);
  });

  it("serves a COMPLETED period that its entries cover in full", () => {
    const year = aggregatePeriod(monthsOf(2025, 1, 12), "2025", AFTER_2025)!;
    expect(year["reporting-period"]).toBe("2025");
    expect(year["energy-consumption"]).toBe(12); // twelve months, each 1 kWh
    expect(validateDocument(year)).toEqual({ valid: true, errors: [] });
  });

  it("refuses a COMPLETED period with a month missing in the MIDDLE", () => {
    // Eleven months of a finished year: their sum is not a figure for 2025,
    // and no reordering of the held entries makes it one.
    const juneless = monthsOf(2025, 1, 12).filter((e) => e["reporting-period"] !== "2025-06");
    expect(() => aggregatePeriod(juneless, "2025", AFTER_2025)).toThrow(AggregateCoverageError);
    expect(() => aggregatePeriod(juneless, "2025", AFTER_2025)).toThrow(/2025-06/);
    expect(() => aggregatePeriod([...juneless].reverse(), "2025", AFTER_2025)).toThrow(AggregateCoverageError);
  });

  it("refuses a COMPLETED period with months missing at the END", () => {
    // The case the correction is about: a publisher holding three months of a
    // finished year would otherwise serve a "2025" figure understating it by
    // three quarters. It is now the no-data outcome.
    const firstQuarter = monthsOf(2025, 1, 3);
    expect(() => aggregatePeriod(firstQuarter, "2025", AFTER_2025)).toThrow(AggregateCoverageError);
    try {
      aggregatePeriod(firstQuarter, "2025", AFTER_2025);
    } catch (err) {
      expect((err as AggregateCoverageError).missing).toHaveLength(9); // April to December
      expect((err as AggregateCoverageError).period).toBe("2025");
    }
  });

  it("serves a period STILL RUNNING whose completed portion its entries cover (step 6)", () => {
    // January to August are the whole completed portion of 2026 in mid-September,
    // so the year has an aggregate: the completed portion to date, labelled with
    // the period requested, exactly as step 6 provides.
    const year = aggregatePeriod(monthsOf(2026, 1, 8), "2026", MID_SEPTEMBER)!;
    expect(year["reporting-period"]).toBe("2026");
    expect(year["energy-consumption"]).toBe(8);

    // September itself is not required — but where the publisher does hold it,
    // it still contributes: what its entries cover is the publisher's own
    // statement, which step 6 leaves to it.
    const withSeptember = aggregatePeriod(monthsOf(2026, 1, 9), "2026", MID_SEPTEMBER)!;
    expect(withSeptember["energy-consumption"]).toBe(9);
  });

  it("refuses a period still running with a gap inside its completed portion", () => {
    const gappy = monthsOf(2026, 1, 8).filter((e) => e["reporting-period"] !== "2026-03");
    expect(() => aggregatePeriod(gappy, "2026", MID_SEPTEMBER)).toThrow(/2026-03/);
    // The same eight months are a complete year-to-date only while August is the
    // last completed month: once 2026 is over, they cover a third of it.
    expect(() => aggregatePeriod(monthsOf(2026, 1, 8), "2026", new Date("2027-01-01T00:00:00Z"))).toThrow(
      AggregateCoverageError,
    );
  });

  it("applies the same tiling at DAY precision", () => {
    // No month lies inside the requested month, so the days are the contributing
    // entries — and they must tile the fifteen days of September that have
    // completed by mid-September.
    const days = (first: number, last: number) =>
      Array.from({ length: last - first + 1 }, (_, i) =>
        m(`2026-09-${String(first + i).padStart(2, "0")}`, { "energy-consumption": 1 }),
      );
    expect(aggregatePeriod(days(1, 15), "2026-09", MID_SEPTEMBER)!["energy-consumption"]).toBe(15);
    expect(() => aggregatePeriod(days(1, 10), "2026-09", MID_SEPTEMBER)).toThrow(AggregateCoverageError);
  });

  it("answers a gap as NO DATA (404) and still tells the operator", async () => {
    const publisher = new Publisher(
      trendAdapter([
        raw({ reportingPeriod: "2025-01", energy: { value: 1, unit: "kWh" } }),
        raw({ reportingPeriod: "2025-02", energy: { value: 1, unit: "kWh" } }),
        raw({ reportingPeriod: "2025-03", energy: { value: 1, unit: "kWh" } }),
      ]),
      { cacheTtlMs: 0, now: () => AFTER_2025 },
    );
    const errors: unknown[] = [];
    const r = await handleRequest(publisher, { period: "2025" }, { onError: (e) => errors.push(e) });
    expect(r.status).toBe(404);

    // "responds as it does when it has no data": byte for byte the response a
    // period with nothing inside it gets, so the shape of the held data leaks
    // nothing to the requester.
    const noData = await handleRequest(publisher, { period: "2020" }, { onError: () => {} });
    expect(noData.status).toBe(404);
    expect(r.body).toBe(noData.body);

    // The operator is the other audience, as for a disagreement and an overlap:
    // one `UnservableAggregateError`, naming what is missing.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AggregateCoverageError);
    expect(errors[0]).toBeInstanceOf(UnservableAggregateError);
    expect((errors[0] as AggregateCoverageError).missing).toContain("2025-04");
    expect((errors[0] as Error).message).toContain("do not cover");

    // The months themselves are served as before: only the aggregate is refused.
    expect((await handleRequest(publisher, { period: "2025-02" })).status).toBe(200);
    const sliced = await handleRequest(publisher, { period: "2025", granularity: "monthly" });
    expect(sliced.status).toBe(200);
    expect(periodsOf(JSON.parse(sliced.body))).toEqual(["2025-01", "2025-02", "2025-03"]);
  });
});
