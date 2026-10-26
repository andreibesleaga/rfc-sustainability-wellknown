/**
 * Validation of an incoming declaration under draft -10: the verdict on the
 * document as served, with a coded warning for what a consumer only notes.
 * The example corpus carries the verdict of every file, strict and with the
 * warning codes; the cases below name the rules one by one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv/dist/jtd";
import { describe, expect, it } from "vitest";
import { parseStrict } from "../src/json";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";
import { isolate } from "../src/text";
import {
  assertValid,
  carriesAtLeastOne,
  extensionNameError,
  isExtensionName,
  isUriReference,
  KNOWN_MEMBERS,
  METRIC_MEMBERS,
  URI_MEMBERS,
  validateDocument,
  ValidationError,
} from "../src/validate";

const CORPUS = resolve(process.cwd(), "..", "schemas-validators", "examples");

interface Entry {
  id: string;
  path: string;
  ajv: boolean;
  strict: "ok" | "reject";
  warn: string[];
}

const manifest: Entry[] = JSON.parse(readFileSync(resolve(CORPUS, "manifest.json"), "utf8"));
const text = (entry: Entry): string => readFileSync(resolve(CORPUS, entry.path), "utf8");

const schemaOnly = new Ajv({ allErrors: true }).compile(RESPONSE_JTD_SCHEMA as unknown as object);
const schemaAccepts = (doc: unknown): boolean => (Array.isArray(doc) ? doc : [doc]).every((item) => schemaOnly(item));

// The schema's rule that an extension value is an object is stricter than the manifest records for this file.
const SCHEMA_STRICTER_THAN_MANIFEST = new Set(["I35"]);

// Warnings that come from verifying `signed`, not from validating the document: the manifest lists them, the signature tests check them.
const SIGNATURE_WARNINGS = new Set(["deprecated-alg", "modified-after-signing"]);

const codes = (warnings: { code: string }[]): string[] => [...new Set(warnings.map((w) => w.code))].sort();

describe("the example corpus, read as served", () => {
  it("lists the files of the corpus", () => {
    expect(manifest.length).toBeGreaterThan(100);
  });

  for (const entry of manifest) {
    it(`${entry.id} ${entry.path}: ${entry.strict}${entry.warn.length ? ` with ${entry.warn.join(", ")}` : ""}`, () => {
      const doc = JSON.parse(text(entry));
      const result = validateDocument(doc);
      expect(result.valid, result.errors.join("; ")).toBe(entry.strict === "ok");
      expect(codes(result.warnings)).toEqual(entry.warn.filter((code) => !SIGNATURE_WARNINGS.has(code)).sort());
      if (!SCHEMA_STRICTER_THAN_MANIFEST.has(entry.id)) expect(schemaAccepts(doc), "the JTD schema alone").toBe(entry.ajv);
    });
  }

  it("parses as I-JSON, except for the one file whose number exceeds binary64", () => {
    const refused = manifest.filter((entry) => {
      try {
        parseStrict(text(entry));
        return false;
      } catch {
        return true;
      }
    });
    expect(refused.map((entry) => entry.path)).toEqual(["prose/number-overflow.json"]);
  });
});

const good = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustainability@example.com)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "https://example.com/methodology",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "example.com",
  "energy-consumption": 100,
  "carbon-footprint": 50,
};
const object = (over: Record<string, unknown> = {}, drop: string[] = []): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...good, ...over };
  for (const name of drop) delete copy[name];
  return copy;
};
const errorsOf = (doc: unknown): string => validateDocument(doc).errors.join("; ");

describe("a member outside a closed set names the set", () => {
  const sets: [string, string, string[]][] = [
    ["functional-unit", "per-minute", ["per-request", "per-device"]],
    ["measurement-method", "metered", ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"]],
    ["carbon-unit", "mtCO2e", ["gCO2e", "kgCO2e", "tCO2e"]],
    ["energy-unit", "kwh", ["Wh", "kWh", "MWh", "GWh"]],
  ];
  for (const [member, value, allowed] of sets) {
    it(member, () => {
      const errors = errorsOf(object({ [member]: value, ...(member === "functional-unit" ? { "sci-score": 1 } : {}) }));
      expect(errors).toContain(`/${member} must be one of `);
      for (const token of allowed) expect(errors).toContain(token);
    });
  }
});

describe("a valid object", () => {
  it("has no errors and no warnings", () => {
    expect(validateDocument(good)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("is accepted alone and as an array of one", () => {
    expect(validateDocument([good]).valid).toBe(true);
  });
});

describe("the body", () => {
  it("accepts an empty array", () => {
    expect(validateDocument([])).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it.each([[null, "null"], [4, "a JSON number"], ["text", "a JSON string"], [true, "a JSON boolean"]])(
    "says plainly that %j is not a declaration",
    (body, what) => {
      const result = validateDocument(body);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(what);
    },
  );

  it("refuses an array with an entry that is not an object", () => {
    expect(validateDocument([good, 4]).valid).toBe(false);
    expect(errorsOf([good, 4])).toContain("[1]");
  });

  it("prefixes each error and warning with the index of its entry", () => {
    const result = validateDocument([good, object({ "energy-consumption": -1, "disclosure-uri": "not a uri" })]);
    expect(result.errors.every((e) => e.startsWith("[1]"))).toBe(true);
    expect(result.warnings.every((w) => w.message.startsWith("[1]"))).toBe(true);
  });
});

describe("array rules under -10", () => {
  const month = (m: string, over: Record<string, unknown> = {}) =>
    object({ period: { start: `2025-${m}-01T00:00:00Z`, end: `2025-${String(Number(m) + 1).padStart(2, "0")}-01T00:00:00Z` }, ...over });

  it("accepts objects for different targets and different target-types", () => {
    expect(validateDocument([good, object({ target: "/api", "target-type": "path" }), object({ target: "Example", "target-type": "organization" })]).valid).toBe(true);
  });

  it("accepts periods that overlap, a year beside its months", () => {
    expect(validateDocument([good, month("01"), month("02")]).valid).toBe(true);
  });

  it("accepts any order: order is a rule for a server, not for the body", () => {
    expect(validateDocument([month("03"), month("01"), month("02")])).toMatchObject({ valid: true, warnings: [] });
  });

  it("accepts two objects that differ only in their accounting method", () => {
    expect(validateDocument([object({ "carbon-accounting": "location-based" }), object({ "carbon-accounting": "market-based" })]).valid).toBe(true);
  });

  it("accepts two objects of one target and period that differ in their functional-unit", () => {
    const withScore = (unit: string) => object({ "functional-unit": unit, "sci-score": 1 });
    expect(validateDocument([withScore("per-request"), withScore("per-job")]).valid).toBe(true);
  });
});

describe("the period", () => {
  const withPeriod = (start: unknown, end: unknown) => object({ period: { start, end } });

  it("accepts bounds in other offsets and with a zero fraction", () => {
    expect(validateDocument(withPeriod("2025-01-01T00:00:00+08:00", "2025-02-01T00:00:00+08:00")).valid).toBe(true);
    expect(validateDocument(withPeriod("2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).valid).toBe(true);
  });

  it("accepts members of period a later revision may define, with a warning", () => {
    const result = validateDocument(object({ period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z", zone: "UTC" } }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.message)).toEqual([`/period/${isolate("zone")} is not a member the draft defines; this consumer ignores it`]);
  });

  it.each([
    ["a date without a time (the -09 form)", "2025-01-01", "2025-12-31"],
    ["a lower-case t", "2025-01-01t00:00:00Z", "2026-01-01T00:00:00Z"],
    ["a lower-case z", "2025-01-01T00:00:00Z", "2026-01-01T00:00:00z"],
    ["no offset", "2025-01-01T00:00:00", "2026-01-01T00:00:00Z"],
    ["an offset without a colon", "2025-01-01T00:00:00+0100", "2026-01-01T00:00:00Z"],
    ["a space for the T", "2025-01-01 00:00:00Z", "2026-01-01T00:00:00Z"],
    ["a zone in brackets", "2025-01-01T00:00:00Z[Europe/Paris]", "2026-01-01T00:00:00Z"],
    ["a date that does not exist", "2025-02-30T00:00:00Z", "2026-01-01T00:00:00Z"],
    ["hour 24", "2025-01-01T24:00:00Z", "2026-01-01T00:00:00Z"],
    ["an offset out of range", "2025-01-01T00:00:00+99:99", "2026-01-01T00:00:00Z"],
    ["a bound that is not a string", 20250101, "2026-01-01T00:00:00Z"],
  ])("refuses %s", (_what, start, end) => {
    expect(validateDocument(withPeriod(start, end)).valid).toBe(false);
  });

  it("refuses an end equal to the start, and an end before it, compared as instants", () => {
    expect(errorsOf(withPeriod("2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"))).toContain("must be before");
    expect(errorsOf(withPeriod("2025-02-01T00:00:00Z", "2025-01-01T00:00:00Z"))).toContain("must be before");
    // The same instant written in two offsets.
    expect(errorsOf(withPeriod("2025-01-01T00:00:00Z", "2025-01-01T01:00:00+01:00"))).toContain("must be before");
    // A start that is later as text but earlier as an instant.
    expect(validateDocument(withPeriod("2025-01-01T01:00:00+05:00", "2025-01-01T00:00:00Z")).valid).toBe(true);
  });

  it("refuses a missing period, a period that is not an object, and a missing bound", () => {
    expect(validateDocument(object({}, ["period"])).valid).toBe(false);
    expect(validateDocument(object({ period: "2025" })).valid).toBe(false);
    expect(validateDocument(object({ period: { start: "2025-01-01T00:00:00Z" } })).valid).toBe(false);
  });

  it("refuses a malformed updated", () => {
    expect(errorsOf(object({ updated: "2026-03-01 12:00:00Z" }))).toContain("/updated");
    expect(errorsOf(object({ updated: "2026-03-01" }))).toContain("/updated");
  });

  it("warns, and does not refuse, a period below the day floor", () => {
    const twelveHours = validateDocument(withPeriod("2025-01-01T00:00:00Z", "2025-01-01T12:00:00Z"));
    expect(twelveHours.valid).toBe(true);
    expect(codes(twelveHours.warnings)).toEqual(["period-below-day-floor"]);
  });

  it("does not warn about a 23-hour day across a change of daylight-saving time", () => {
    const result = validateDocument(withPeriod("2025-03-30T00:00:00+01:00", "2025-03-31T00:00:00+02:00"));
    expect(result.warnings).toEqual([]);
  });

  it("warns about the leap second 23:59:60, which is read as 23:59:59", () => {
    const result = validateDocument(object({ updated: "2025-06-30T23:59:60Z" }));
    expect(result.valid).toBe(true);
    expect(codes(result.warnings)).toContain("leap-second-read-as-59");
  });

  it("warns when updated is before the end of the period", () => {
    expect(codes(validateDocument(object({ updated: "2025-06-01T00:00:00Z" })).warnings)).toEqual(["updated-before-period-end"]);
  });
});

describe("the forms of earlier revisions are invalid as served", () => {
  it("names the -08 label", () => {
    const { period: _period, ...rest } = good;
    const result = validateDocument({ ...rest, "reporting-period": "2025" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toMatch(/reporting-period .?"2025".? is the -08 form/);
  });

  it("names the -09 full-dates", () => {
    const result = validateDocument(object({ period: { start: "2025-01-01", end: "2025-12-31" } }));
    expect(result.valid).toBe(false);
    expect(result.errors.join("; ")).toContain("the -09 form");
  });

  it.each([
    ["measurement-method", "Hardware-Metered"],
    ["functional-unit", "per-thousand-requests"],
    ["carbon-unit", "mtCO2e"],
    ["target-type", "datacenter"],
    ["energy-unit", "TWh"],
    ["carbon-accounting", "hourly"],
    ["capabilities", "full"],
  ])("refuses %s %j", (member, value) => {
    expect(validateDocument(object({ [member]: value, ...(member === "functional-unit" ? { "sci-score": 1 } : {}) })).valid).toBe(false);
  });

  it("refuses an upstream role outside its six", () => {
    expect(validateDocument(object({ upstream: [{ declaration: "https://a.example/x", role: "transit" }] })).valid).toBe(false);
    expect(validateDocument(object({ upstream: [{ declaration: "https://a.example/x", role: "colocation" }] })).valid).toBe(true);
  });
});

describe("the figures", () => {
  it.each(["energy-consumption", "carbon-footprint", "sci-score", "carbon-intensity-gCO2e-per-kWh", "estimated-annual-emissions-kgCO2e"])(
    "refuses a negative %s",
    (member) => {
      expect(errorsOf(object({ [member]: -1, "functional-unit": "per-request", "sci-score": member === "sci-score" ? -1 : 1 }))).toContain("must not be negative");
    },
  );

  it("accepts a negative scope: removals under net accounting", () => {
    expect(validateDocument(object({ "scope-1": -5 })).valid).toBe(true);
  });

  it("keeps renewable-energy between 0 and 100 inclusive", () => {
    expect(validateDocument(object({ "renewable-energy": 0 })).valid).toBe(true);
    expect(validateDocument(object({ "renewable-energy": 100 })).valid).toBe(true);
    expect(validateDocument(object({ "renewable-energy": 100.1 })).valid).toBe(false);
    expect(validateDocument(object({ "renewable-energy": -0.1 })).valid).toBe(false);
  });

  it.each([[null], ["12"], [true], [[1]]])("refuses %j as a metric", (value) => {
    expect(validateDocument(object({ "energy-consumption": value })).valid).toBe(false);
  });

  it("refuses a sci-score without a functional-unit", () => {
    expect(errorsOf(object({ "sci-score": 1.2 }))).toContain("requires functional-unit");
  });

  it("requires a metric or an evidence link", () => {
    const bare = object({}, ["energy-consumption", "carbon-footprint"]);
    expect(validateDocument(bare).valid).toBe(false);
    expect(validateDocument({ ...bare, "disclosure-uri": "https://example.com/report" }).valid).toBe(true);
    expect(validateDocument({ ...bare, "verifiable-attestation-uri": "https://example.com/vc" }).valid).toBe(true);
    expect(validateDocument({ ...bare, "energy-unit": "kWh", upstream: [{ declaration: "https://a.example/x" }], extensions: { "urn:x:y": {} } }).valid).toBe(false);
  });

  it("counts a metric of 0 as carried", () => {
    expect(validateDocument(object({ "energy-consumption": 0 }, ["carbon-footprint"])).valid).toBe(true);
    expect(carriesAtLeastOne({ "energy-consumption": 0 })).toBe(true);
    expect(carriesAtLeastOne({ "energy-consumption": Infinity })).toBe(false);
    expect(carriesAtLeastOne({ "disclosure-uri": "" })).toBe(false);
    expect(carriesAtLeastOne(null)).toBe(false);
  });

  it("lists the nine metric members", () => {
    expect(METRIC_MEMBERS).toHaveLength(9);
  });

  it("refuses a number the parser read as an infinity, and an unpaired surrogate", () => {
    expect(errorsOf(object({ "energy-consumption": Infinity }))).toContain("not a finite number");
    expect(errorsOf(object({ provider: "Example \ud800" }))).toContain("unpaired surrogate");
    expect(errorsOf(object({ extensions: { "urn:x:\ud800": {} } }))).toContain("unpaired surrogate");
  });

  it("warns when the scopes do not account for the footprint, to the precision of the least precise figure", () => {
    expect(codes(validateDocument(object({ "scope-1": 10, "scope-2": 10, "scope-3": 10, "carbon-footprint": 50 })).warnings)).toEqual([
      "scopes-do-not-account-for-footprint",
    ]);
    expect(validateDocument(object({ "scope-1": 10, "scope-2": 10, "scope-3": 30, "carbon-footprint": 50 })).warnings).toEqual([]);
    expect(validateDocument(object({ "scope-1": 0.1, "scope-2": 0.2, "scope-3": 0.3, "carbon-footprint": 0.6 })).warnings).toEqual([]);
  });
});

describe("the text members", () => {
  it("refuses an empty provider and an empty target", () => {
    expect(validateDocument(object({ provider: "" })).valid).toBe(false);
    expect(validateDocument(object({ target: "" })).valid).toBe(false);
  });

  it("requires a path target to begin with a slash", () => {
    expect(errorsOf(object({ target: "api/v1", "target-type": "path" }))).toContain('begins with "/"');
    expect(validateDocument(object({ target: "/api/v1", "target-type": "path" })).valid).toBe(true);
  });

  it("warns about a host written in U-label form, and about a personal contact address", () => {
    const u = validateDocument(object({ target: "bücher.example" }));
    expect(u.valid).toBe(true);
    expect(u.warnings[0].message).toContain("xn--bcher-kva.example");
    expect(codes(u.warnings)).toEqual(["origin-u-label"]);
    expect(codes(validateDocument(object({ provider: "Example (jane.doe@example.com)" })).warnings)).toEqual(["provider-personal-contact"]);
    expect(validateDocument(object({ provider: "Example (esg@example.com)" })).warnings).toEqual([]);
    for (const role of ["nachhaltigkeit", "data", "registry"]) expect(validateDocument(object({ provider: `Example (${role}@example.com)` })).warnings, role).toEqual([]);
    // Every local@domain pair in a word is seen, left to right: a handle with a leading "@", two addresses run together.
    expect(codes(validateDocument(object({ provider: "Example @jane@mastodon.social" })).warnings)).toEqual(["provider-personal-contact"]);
    // The second pair is seen too: a role address first, then a personal one (each code is reported once).
    expect(codes(validateDocument(object({ provider: "esg@a.example@bob@b.example" })).warnings)).toEqual(["provider-personal-contact"]);
    expect(validateDocument(object({ provider: "esg@a.example@bob@b.example" })).warnings[0].message).toContain("bob@");
    expect(validateDocument(object({ provider: "Example a@@b" })).warnings).toEqual([]);
  });

  it("isolates a value from the document in the message that quotes it", () => {
    const warning = validateDocument(object({ "disclosure-uri": "not a uri \u202e" })).warnings[0];
    expect(warning.message).toContain("\u2068");
    expect(warning.message).toContain("\u2069");
  });
});

describe("URI-valued members", () => {
  it("keeps the three members and the upstream declaration as references", () => {
    expect([...URI_MEMBERS]).toEqual(["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"]);
  });

  it.each([
    ["http://example.com/report"],
    ["ftp://example.com/report"],
    ["/sustainability/methodology"],
    ["../report.pdf"],
    ["//example.com/report"],
    ["?x=1"],
    ["#section"],
    [""],
  ])("does not warn about the reference %j", (value) => {
    expect(validateDocument(object({ "methodology-uri": value, "disclosure-uri": value })).warnings).toEqual([]);
  });

  it("warns, and keeps the object valid, when a value is not a URI reference", () => {
    const result = validateDocument(object({ "methodology-uri": "not a uri", "disclosure-uri": "http://exa mple.com", "verifiable-attestation-uri": "<x>" }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(["uri-not-a-reference", "uri-not-a-reference", "uri-not-a-reference"]);
    expect(result.warnings[0].message).toContain("/methodology-uri");
    expect(result.warnings[0].message).toContain("never dereferences");
  });

  it("checks the upstream declaration the same way, and requires an entry", () => {
    const warned = validateDocument(object({ upstream: [{ declaration: "ok" }, { declaration: "not a uri" }] }));
    expect(warned.valid).toBe(true);
    expect(warned.warnings.map((w) => w.message)).toEqual([expect.stringContaining("/upstream/1/declaration")]);
    expect(errorsOf(object({ upstream: [] }))).toContain("at least one entry");
  });

  it("tells a scheme from a relative path that holds a colon", () => {
    expect(isUriReference("urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845")).toBe(true);
    expect(isUriReference("./a:b")).toBe(true);
    expect(isUriReference("1a:b")).toBe(false);
    expect(isUriReference("a b")).toBe(false);
    expect(isUriReference("%zz")).toBe(false);
    expect(isUriReference("é")).toBe(false);
  });
});

describe("extension names", () => {
  it.each([
    ["https://example.com/extensions/water"],
    ["HTTPS://Example.com/x"],
    ["urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845"],
    ["urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845"],
    ["urn:uuid:00000000-0000-0000-0000-000000000000"],
    ["urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff"],
    ["urn:oid:1.3.6.1.4.1.32473.1"],
    ["https://example.com/x#water"],
    ["tag:example.com,2026:water"],
    ["mailto:x@example.com"],
  ])("accepts %s", (name) => {
    expect(extensionNameError(name)).toBeUndefined();
    expect(isExtensionName(name)).toBe(true);
    expect(validateDocument(object({ extensions: { [name]: { a: 1 } } })).valid).toBe(true);
  });

  it.each([
    ["", "is empty"],
    ["water", "is not a URI"],
    ["example.com/x", "is not a URI"],
    ["a b:c", "whitespace"],
    ["https://example.com/a\tb", "whitespace"],
    ["https://exämple.com/x", "not ASCII"],
    ['https://example.com/"x"', "is not a URI"],
    ["1http://example.com", "is not a URI"],
    ["https://example.com/%zz", "is not a URI"],
  ])("refuses %j", (name, why) => {
    expect(extensionNameError(name)).toContain(why);
    expect(validateDocument(object({ extensions: { [name]: { a: 1 } } })).valid).toBe(false);
  });

  it("requires a value that is an object", () => {
    for (const value of [1, "x", null, [1], true]) {
      expect(validateDocument(object({ extensions: { "urn:x:y": value } })).valid).toBe(false);
    }
    expect(validateDocument(object({ extensions: {} })).valid).toBe(true);
    expect(validateDocument(object({ extensions: { "urn:x:y": {} } })).valid).toBe(true);
  });

  it("refuses an extensions member that is not an object", () => {
    expect(validateDocument(object({ extensions: [] })).valid).toBe(false);
  });
});

describe("members the draft does not define", () => {
  it("ignores a top-level member, with a warning, and does not treat it as an error", () => {
    const result = validateDocument(object({ version: 2, "x-note": "hello" }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.message)).toEqual([
      `/${isolate("version")} is not a member the draft defines; this consumer ignores it`,
      `/${isolate("x-note")} is not a member the draft defines; this consumer ignores it`,
    ]);
    expect(codes(result.warnings)).toEqual(["unknown-member"]);
  });

  it("notes an unknown member of an upstream entry", () => {
    const result = validateDocument(object({ upstream: [{ declaration: "https://a.example/x", weight: 0.5 }] }));
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.message)).toEqual([`/upstream/0/${isolate("weight")} is not a member the draft defines; this consumer ignores it`]);
  });

  it("derives the defined members from the schema", () => {
    expect(KNOWN_MEMBERS).toHaveLength(26);
    for (const name of ["period", "signed", "extensions", "upstream", "target-type"]) expect(KNOWN_MEMBERS).toContain(name);
    expect(KNOWN_MEMBERS).not.toContain("reporting-period");
  });
});

describe("assertValid", () => {
  it("returns a valid document as it is", () => {
    expect(assertValid(good)).toBe(good);
  });

  it("throws a ValidationError that lists the errors", () => {
    try {
      assertValid(object({ "energy-consumption": -1 }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).errors[0]).toContain("must not be negative");
      expect((e as ValidationError).message).toContain("must not be negative");
    }
  });
});
