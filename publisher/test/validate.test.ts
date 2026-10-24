import { describe, expect, it } from "vitest";
import { assertValid, validateDocument, validateMetrics, ValidationError } from "../src/validate";

const base = (): Record<string, any> => ({
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustain@example.com)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "/sustainability/methodology",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "Example Corp",
  "target-type": "organization",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e",
});

const strict = { legacyCompat: false };
const check = (doc: unknown) => validateMetrics(doc, strict);
const codes = (doc: unknown) => check(doc).warnings.map((w) => w.code);

describe("the mandatory members and the schema", () => {
  it("accepts the Introduction's object without a word", () => {
    const r = check(base());
    expect(r).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("requires each of the seven, and names it", () => {
    for (const member of ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"]) {
      const doc = base();
      delete doc[member];
      const r = check(doc);
      expect(r.valid, member).toBe(false);
      expect(r.errors.join(";"), member).toContain(`/properties/${member}`);
    }
  });

  it("refuses a value of the wrong type, and null for a mandatory or optional member", () => {
    expect(check({ ...base(), target: null }).valid).toBe(false);
    expect(check({ ...base(), "carbon-footprint": "4140" }).valid).toBe(false);
    expect(check({ ...base(), "carbon-footprint": null }).valid).toBe(false);
    expect(check({ ...base(), signed: {} }).valid).toBe(false);
    expect(check({ ...base(), "verifiable-attestation-uri": ["a", "b"] }).valid).toBe(false);
  });

  it("refuses a token outside its set", () => {
    for (const [member, value] of [
      ["capabilities", "full"],
      ["measurement-method", "Hardware-Metered"],
      ["measurement-method", "metered"],
      ["energy-unit", "TWh"],
      ["carbon-unit", "mtCO2e"],
      ["carbon-accounting", "hourly-market-based"],
      ["target-type", "datacenter"],
      ["functional-unit", "per-thousand-requests"],
    ] as const) {
      expect(check({ ...base(), "sci-score": 1, "functional-unit": "per-request", [member]: value }).valid, `${member} ${value}`).toBe(false);
    }
  });

  it("refuses a root that is not an object or an array of objects; an empty array is valid", () => {
    for (const root of ["x", 1, null, true]) expect(validateDocument(root as never, strict).valid).toBe(false);
    expect(validateDocument([1] as never, strict).valid).toBe(false);
    expect(validateDocument([], strict)).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

describe("date-times: the profile, then a real moment", () => {
  const bad = (member: "updated" | "start" | "end", value: string) => {
    const doc = base();
    if (member === "updated") doc.updated = value;
    else doc.period = { ...doc.period, [member]: value };
    return check(doc);
  };

  it("refuses what the JTD timestamp type accepts and the draft's profile does not", () => {
    for (const value of ["2026-03-01t12:00:00Z", "2026-03-01T12:00:00z", "2026-03-01 12:00:00Z", "2026-03-01T12:00:00+0100"]) {
      for (const member of ["updated", "start", "end"] as const) {
        const r = bad(member, value);
        expect(r.valid, `${member} ${value}`).toBe(false);
        expect(r.errors.join(";"), `${member} ${value}`).toContain(JSON.stringify(value));
      }
    }
  });

  it("refuses a value with the form of a date-time and no real date or time", () => {
    for (const value of ["2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-03-01T24:00:00Z", "2026-03-01T00:00:00+99:99", "2026-03-01T00:00:00+14:60", "2026-03-01T00:00:00-24:00"]) {
      expect(bad("updated", value).valid, value).toBe(false);
      expect(bad("start", value).errors.join(";"), value).toContain("/period/start");
    }
  });

  it("refuses a date and a missing offset", () => {
    for (const value of ["2026-03-01", "2026-03-01T12:00:00", "2026-03-01T12:00Z"]) expect(bad("end", value).valid, value).toBe(false);
  });

  it("accepts an offset, a fraction and -00:00 in any of the three", () => {
    const doc = base();
    doc.updated = "2026-03-01T12:00:00.5+01:00";
    doc.period = { start: "2025-01-01T00:00:00.000Z", end: "2026-01-01T00:00:00-00:00" };
    expect(check(doc).valid).toBe(true);
  });

  it("requires start before end as instants", () => {
    const equal = base();
    equal.period = { start: "2025-01-01T00:00:00Z", end: "2025-01-01T00:00:00+00:00" };
    expect(check(equal).errors).toEqual(["/period/start must be before /period/end (got 2025-01-01T00:00:00Z and 2025-01-01T00:00:00+00:00)"]);
    const reversed = base();
    reversed.period = { start: "2026-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z" };
    expect(check(reversed).valid).toBe(false);
    const offsets = base();
    offsets.period = { start: "2025-01-01T00:00:00-12:00", end: "2025-01-01T00:00:00Z" };
    expect(check(offsets).valid).toBe(false);
    offsets.period = { start: "2025-01-01T00:00:00+02:00", end: "2025-01-01T00:00:00Z" };
    expect(check(offsets).valid).toBe(true);
  });

  it("reads 23:59:60 as 23:59:59 and says so, in a declaration", () => {
    const doc = base();
    doc.period = { start: "2016-12-01T00:00:00Z", end: "2016-12-31T23:59:60Z" };
    doc.updated = "2017-01-02T09:00:00Z";
    const r = check(doc);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["leap-second-read-as-59"]);
    expect(r.warnings[0].message).toContain("/period/end");
    const updated = base();
    updated.updated = "2026-12-31T23:59:60Z";
    expect(codes(updated)).toEqual(["leap-second-read-as-59"]);
  });
});

describe("what the draft recommends is a warning", () => {
  const withPeriod = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
    ...base(),
    updated: "2030-01-01T00:00:00Z",
    period: { start, end },
    ...extra,
  });

  it("a period below the day floor: not on day boundaries in each bound's own offset", () => {
    expect(codes(withPeriod("2026-03-01T00:00:00Z", "2026-03-01T12:00:00Z"))).toEqual(["period-below-day-floor"]);
    expect(codes(withPeriod("2026-03-01T06:00:00Z", "2026-03-02T06:00:00Z"))).toEqual(["period-below-day-floor"]);
    expect(codes(withPeriod("2026-03-01T00:00:00.123Z", "2026-03-02T00:00:00Z"))).toEqual(["period-below-day-floor"]);
    expect(check(withPeriod("2026-03-01T00:00:00Z", "2026-03-01T12:00:00Z")).valid).toBe(true);
  });

  it("not for a whole day, a 23-hour or 25-hour day, an offset day, or a longer period", () => {
    for (const [start, end] of [
      ["2026-03-01T00:00:00Z", "2026-03-02T00:00:00Z"],
      ["2026-03-29T00:00:00+01:00", "2026-03-30T00:00:00+02:00"],
      ["2026-10-25T00:00:00+02:00", "2026-10-26T00:00:00+01:00"],
      ["2026-03-01T00:00:00+08:00", "2026-04-01T00:00:00+08:00"],
      ["2025-04-01T00:00:00Z", "2026-04-01T00:00:00Z"],
      ["2025-01-01T00:00:00Z", "2025-01-08T00:00:00Z"],
    ]) {
      expect(codes(withPeriod(start, end)), `${start} ${end}`).toEqual([]);
    }
  });

  it("updated before period.end: a forecast, or a period still running", () => {
    const doc = withPeriod("2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z", { updated: "2026-03-15T12:00:00Z" });
    const r = check(doc);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["updated-before-period-end"]);
    expect(codes({ ...doc, updated: "2026-04-01T00:00:00Z" })).toEqual([]); // equal is not before
    expect(codes({ ...doc, updated: "2026-04-01T01:00:00+02:00" })).toEqual(["updated-before-period-end"]); // an instant before, in another offset
  });

  it("scopes that accompany carbon-footprint and do not account for it", () => {
    const scopes = (s1: number, s2: number, s3: number, footprint: number) => ({
      ...base(),
      "carbon-footprint": footprint,
      "scope-1": s1,
      "scope-2": s2,
      "scope-3": s3,
    });
    expect(codes(scopes(90, 220, 300, 610))).toEqual([]);
    expect(codes(scopes(90, 220, 100, 610))).toEqual(["scopes-do-not-account-for-footprint"]);
    expect(codes(scopes(0, 2.1, 1.1, 3.2))).toEqual([]); // to the precision of the least precise figure
    expect(codes(scopes(0, 2.1, 1.1, 3.9))).toEqual(["scopes-do-not-account-for-footprint"]);
    expect(codes(scopes(0.5, 2.1, 1.1, 3.2))).toEqual(["scopes-do-not-account-for-footprint"]);
    expect(codes(scopes(-12, 200, 300, 488))).toEqual([]); // removals
    expect(codes({ ...base(), "scope-1": 5 })).toEqual([]); // not all three
    expect(check(scopes(1, 1, 1, 610)).valid).toBe(true);
  });

  it("a host-shaped target in U-label form, naming the A-label", () => {
    const r = check({ ...base(), target: "grün.example", "target-type": "origin" });
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["origin-u-label"]);
    expect(r.warnings[0].message).toContain("xn--grn-ioa.example");
    expect(codes({ ...base(), target: "xn--grn-ioa.example", "target-type": "origin" })).toEqual([]);
    expect(codes({ ...base(), target: "Grün GmbH" })).toEqual([]);
  });

  it("a personal contact address in provider; a role address passes", () => {
    for (const role of ["sustain", "sustainability", "esg", "ops", "compliance", "contact", "info", "admin", "support", "security", "ESG"]) {
      expect(codes({ ...base(), provider: `Acme (${role}@acme.example)` }), role).toEqual([]);
    }
    const r = check({ ...base(), provider: "Acme (jane.doe@acme.example)" });
    expect(r.warnings.map((w) => w.code)).toEqual(["provider-personal-contact"]);
    expect(r.warnings[0].message).toContain("jane.doe@");
    expect(codes({ ...base(), provider: "Acme plc" })).toEqual([]);
    expect(codes({ ...base(), provider: "Acme (ops@acme.example, jane@acme.example)" })).toEqual(["provider-personal-contact"]);
  });

  it("a URI-valued member that is not a URI reference; any scheme and any relative reference is fine", () => {
    const r = check({ ...base(), "methodology-uri": "not a uri" });
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(["uri-not-a-reference"]);
    for (const member of ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"]) {
      expect(codes({ ...base(), [member]: "https://x/<y>" }), member).toEqual(["uri-not-a-reference"]);
      for (const ok of ["/a", "a/b", "../x", "//host/path", "#top", "?q", "http://x/y", "ftp://x/y", "mailto:a@b.example", "https://x/%20y", ""]) {
        expect(codes({ ...base(), [member]: ok }), `${member} ${ok}`).toEqual([]);
      }
    }
    expect(codes({ ...base(), upstream: [{ declaration: "a b" }] })).toEqual(["uri-not-a-reference"]);
    expect(codes({ ...base(), upstream: [{ declaration: "/tenant.json" }, { declaration: "https://p.example/d" }] })).toEqual([]);
    expect(codes({ ...base(), "methodology-uri": "1a:b" })).toEqual(["uri-not-a-reference"]); // a colon in the first segment of a relative reference
    expect(codes({ ...base(), "methodology-uri": "x/a:b" })).toEqual([]);
  });

  it("a member the draft does not define, at the top, in period and in an upstream entry", () => {
    const doc = {
      ...base(),
      version: 2,
      period: { ...base().period, note: "x" },
      upstream: [{ declaration: "/d", role: "cloud", comment: "y" }],
    };
    const r = check(doc);
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.message.split(" ")[0]).sort()).toEqual(["/period/note", "/upstream/0/comment", "/version"]);
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(new Set(["unknown-member"]));
  });

  it("warnings never make a document invalid, and valid documents can carry several", () => {
    const doc = {
      ...base(),
      "methodology-uri": "no good",
      period: { start: "2026-03-01T06:00:00Z", end: "2026-03-02T06:00:00Z" },
      extra: 1,
    };
    const r = check(doc);
    expect(r.valid).toBe(true);
    expect(new Set(r.warnings.map((w) => w.code))).toEqual(new Set(["uri-not-a-reference", "period-below-day-floor", "unknown-member"]));
  });
});

describe("the rules no schema states", () => {
  it("figures that must not be negative; scopes may be", () => {
    for (const field of ["energy-consumption", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh", "estimated-annual-emissions-kgCO2e"]) {
      expect(check({ ...base(), [field]: -1 }).errors.join(";"), field).toContain(`/${field} must not be negative`);
      expect(check({ ...base(), [field]: 0 }).valid, field).toBe(true);
    }
    expect(check({ ...base(), "sci-score": -1, "functional-unit": "per-request" }).valid).toBe(false);
    for (const scope of ["scope-1", "scope-2", "scope-3"]) expect(check({ ...base(), [scope]: -50 }).valid, scope).toBe(true);
  });

  it("renewable-energy between 0 and 100 inclusive", () => {
    for (const [value, valid] of [[-0.01, false], [0, true], [45, true], [100, true], [100.01, false], [4500, false]] as const) {
      expect(check({ ...base(), "renewable-energy": value }).valid, String(value)).toBe(valid);
    }
  });

  it("sci-score with functional-unit", () => {
    expect(check({ ...base(), "sci-score": 1 }).errors).toEqual(["/sci-score requires functional-unit to be present"]);
    expect(check({ ...base(), "sci-score": 1, "functional-unit": "per-session" }).valid).toBe(true);
    expect(check({ ...base(), "functional-unit": "per-vcpu-hour" }).valid).toBe(true);
  });

  it("at least one metric or evidence link", () => {
    const { "carbon-footprint": _f, "carbon-unit": _u, ...none } = base();
    expect(check(none).errors.join(";")).toContain("carries no numeric metric member");
    expect(check({ ...none, "energy-unit": "kWh" }).valid).toBe(false);
    expect(check({ ...none, extensions: { "urn:x:y": { a: 1 } } }).valid).toBe(false);
    expect(check({ ...none, upstream: [{ declaration: "/d" }] }).valid).toBe(false);
    expect(check({ ...none, "disclosure-uri": "/d" }).valid).toBe(true);
    expect(check({ ...none, "verifiable-attestation-uri": "/vc" }).valid).toBe(true);
    expect(check({ ...none, "renewable-energy": 0 }).valid).toBe(true);
    expect(check({ ...none, "disclosure-uri": "" }).valid).toBe(false);
  });

  it("provider and target are not empty; a path target begins with a slash", () => {
    expect(check({ ...base(), provider: "" }).errors).toEqual(["/provider must not be empty"]);
    expect(check({ ...base(), target: "" }).valid).toBe(false);
    expect(check({ ...base(), target: "api/v1", "target-type": "path" }).errors.join(";")).toContain('begins with "/"');
    expect(check({ ...base(), target: "/api/v1", "target-type": "path" }).valid).toBe(true);
    expect(check({ ...base(), target: "api/v1", "target-type": "service" }).valid).toBe(true);
  });

  it("upstream holds at least one entry", () => {
    expect(check({ ...base(), upstream: [] }).errors).toEqual(["/upstream must carry at least one entry"]);
    expect(check({ ...base(), upstream: [{ role: "cloud" }] }).valid).toBe(false);
    expect(check({ ...base(), upstream: [{ declaration: "/d", role: "transit" }] }).valid).toBe(false);
  });

  it("extension names are URIs and their values objects", () => {
    expect(check({ ...base(), extensions: {} }).valid).toBe(true);
    expect(check({ ...base(), extensions: { "HTTPS://Example.com/x": { a: 1 }, "urn:oid:1.2.3": {}, "urn:uuid:00000000-0000-0000-0000-000000000000": {} } }).valid).toBe(true);
    expect(check({ ...base(), extensions: { "not a uri": { a: 1 } } }).errors.join(";")).toContain("/extensions/not a uri");
    expect(check({ ...base(), extensions: { water: { a: 1 } } }).valid).toBe(false);
    for (const value of [5, "x", null, [1]]) expect(check({ ...base(), extensions: { "urn:x:y": value } }).valid, String(value)).toBe(false);
    expect(check({ ...base(), extensions: [] }).valid).toBe(false);
  });
});

describe("I-JSON: finite numbers and well-formed strings", () => {
  it("refuses NaN and the infinities, wherever they are", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(check({ ...base(), "energy-consumption": value }).errors.join(";"), String(value)).toContain("not a finite number");
    }
    expect(check({ ...base(), extensions: { "urn:x:y": { n: { deeper: [Infinity] } } } }).errors).toEqual([
      "/extensions/urn:x:y/n/deeper/0 is not a finite number (Infinity)",
    ]);
  });

  it("refuses an unpaired surrogate in a string, in a member name and in an extension", () => {
    expect(check({ ...base(), provider: "Acme \ud800" }).errors.join(";")).toContain("/provider holds an unpaired surrogate");
    expect(check({ ...base(), extensions: { "urn:x:y": { ["k\udc00"]: 1 } } }).errors.join(";")).toContain("unpaired surrogate");
    expect(check({ ...base(), extensions: { "urn:x:y": { text: "ok 😀" } } }).valid).toBe(true);
  });
});

describe("the reading of earlier periods", () => {
  const older = (period: unknown) => {
    const { period: _p, ...rest } = base();
    return { ...rest, ...(typeof period === "string" ? { "reporting-period": period } : { period }) };
  };

  it("reads a -08 label and -09 full-dates as the period they stand for, and says so", () => {
    const label = validateMetrics(older("2025"));
    expect(label.valid).toBe(true);
    expect(label.warnings.map((w) => w.code)).toEqual(["period-read-from-older-form"]);
    expect(label.warnings[0].message).toContain("2025-01-01T00:00:00Z to 2026-01-01T00:00:00Z");
    const dates = validateMetrics(older({ start: "2025-01-01", end: "2025-12-31" }));
    expect(dates.valid).toBe(true);
    expect(dates.warnings[0].code).toBe("period-read-from-older-form");
    expect(validateMetrics(older("2025-03"), { legacyCompat: true }).valid).toBe(true);
  });

  it("refuses them with legacyCompat false, with a way forward", () => {
    for (const doc of [older("2025"), older({ start: "2025-01-01", end: "2025-12-31" })]) {
      const r = check(doc);
      expect(r.valid).toBe(false);
      expect(r.errors.join(";")).toContain("sustainability-publisher upgrade");
    }
  });

  it("refuses a label that names no date even when reading older forms", () => {
    const r = validateMetrics(older("2025-13"));
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("2025-13");
    expect(validateMetrics(older({ start: "2025-01-01", end: "2025-02-30" })).valid).toBe(false);
  });

  it("reads nothing else: a token of the earlier revisions stays invalid", () => {
    expect(validateMetrics({ ...older("2025"), "measurement-method": "free text" }).valid).toBe(false);
    expect(validateMetrics({ ...older("2025"), "carbon-unit": "mtCO2e" }).valid).toBe(false);
  });
});

describe("validateDocument", () => {
  it("prefixes what it reports with the index of the object, and allows any mix", () => {
    const a = base();
    const b = { ...base(), period: { start: "2024-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z" }, target: "/api", "target-type": "path" };
    const c = { ...base(), "energy-consumption": -1, "methodology-uri": "bad uri" };
    const r = validateDocument([a, b, c] as never, strict);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual(["[2]/energy-consumption must not be negative (got -1); omit unreported metrics"]);
    expect(r.warnings.map((w) => w.message.slice(0, 3))).toEqual(["[2]"]);
  });

  it("accepts an array in any order, overlapping, of different targets", () => {
    const jan = { ...base(), period: { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" } };
    const year = base();
    const other = { ...base(), target: "/api", "target-type": "path" };
    expect(validateDocument([year, jan, other, jan, year] as never, strict)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("answers for a single object the same as for a one-object array", () => {
    expect(validateDocument(base() as never, strict)).toEqual(validateDocument([base()] as never, strict));
  });
});

describe("assertValid, the gate in front of everything published", () => {
  it("returns a valid document unchanged", () => {
    const doc = base();
    expect(assertValid(doc as never)).toBe(doc);
  });

  it("throws a ValidationError listing every error", () => {
    const doc = { ...base(), "energy-consumption": -1, "sci-score": 1 };
    try {
      assertValid(doc as never);
      throw new Error("did not throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors).toHaveLength(2);
      expect((e as Error).message).toContain("failed validation");
    }
  });

  it("refuses a top-level member the draft does not define, in an object or an array", () => {
    expect(() => assertValid({ ...base(), version: 2 } as never)).toThrow(/\/version is not a member the draft defines/);
    expect(() => assertValid([base(), { ...base(), language: "en" }] as never)).toThrow(/\[1\]\/language is not a member/);
  });

  it("does not read an earlier period", () => {
    const { period: _p, ...rest } = base();
    expect(() => assertValid({ ...rest, "reporting-period": "2025" } as never)).toThrow(ValidationError);
    expect(() => assertValid({ ...base(), period: { start: "2025-01-01", end: "2025-12-31" } } as never)).toThrow(/upgrade/);
  });

  it("passes a document that only warns", () => {
    const doc = { ...base(), period: { start: "2026-03-01T00:00:00Z", end: "2026-03-01T12:00:00Z" } };
    expect(() => assertValid(doc as never)).not.toThrow();
  });
});
