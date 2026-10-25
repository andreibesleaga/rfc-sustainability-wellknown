/**
 * Every shipped data file must be conformant AND honest. The first half of this
 * file is schema conformance (JTD, RFC 8927, plus the draft's prose rules); the
 * second half enforces the gateway's own honesty rules, which are the reason
 * this service can point at real organizations at all.
 *
 * CDDL validation is run separately, by `schemas-validators/validator-cddl.py`;
 * see GUIDE.md, "Validating the data files".
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  RESPONSE_JTD_SCHEMA,
  isOnDayBoundaries,
  isWholeCalendarPeriod,
  parsePeriod,
  validateDocument,
  type SustainabilityMetrics,
} from "sustainability-wellknown-publisher";
import { describe, expect, it } from "vitest";
import { DOMAIN_RE, isSyntheticDomain, loadSubjectFile, resolveBaseUrlToken } from "../src/registry";
import { DATA_DIR } from "./helpers";

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .sort();

/**
 * A data file as the gateway SERVES it: the `{base}` token of an
 * `upstream[].declaration` resolved against an origin, exactly as
 * `loadSubjectFile` does, so the conformance checks below see the real
 * absolute "https" URI rather than the template.
 */
const SERVED_BASE = "https://gateway.example";
const load = (f: string) =>
  resolveBaseUrlToken(
    JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")) as SustainabilityMetrics,
    SERVED_BASE,
  );

/** The seven mandatory members (draft -10, Mandatory Members). */
const MANDATORY = [
  "updated",
  "capabilities",
  "provider",
  "measurement-method",
  "methodology-uri",
  "period",
  "target",
] as const;

/** The subjects whose figures cover a fiscal year, so their period states its exact bounds instead of a calendar year. */
const FISCAL_YEAR = new Set(["go.eco", "hmrc.gov.uk"]);

const URI_MEMBERS = ["methodology-uri", "verifiable-attestation-uri", "disclosure-uri"] as const;

/** The closed top-level member set of a -10 declaration object. */
const KNOWN_MEMBERS = new Set([
  ...MANDATORY,
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
  "carbon-accounting",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "functional-unit",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
  "verifiable-attestation-uri",
  "disclosure-uri",
  "target-type",
  "upstream",
  "extensions",
  "signed",
]);

/**
 * This registry's own house style for extension names (lowercase https or a
 * lowercase UUID URN); the draft's `ext-name` is any URI string.
 */
const EXT_KEY_RE = /^[a-z][a-z0-9+.-]*:[!$-;=?-Z\[\]_a-z~]+$/;
const URN_UUID_RE = /^urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

it("ships at least one data file", () => {
  expect(files.length).toBeGreaterThan(0);
});

it("uses the same JTD schema as the repository", () => {
  const repoSchema = resolve(DATA_DIR, "..", "..", "schemas-validators", "response-schema.json");
  if (!existsSync(repoSchema)) return; // packaged deployment: repo not present
  expect(JSON.parse(JSON.stringify(RESPONSE_JTD_SCHEMA))).toEqual(
    JSON.parse(readFileSync(repoSchema, "utf8")),
  );
});

describe.each(files)("%s", (file) => {
  const domain = basename(file, ".json");
  const doc = load(file);

  it("is named after a syntactically valid domain", () => {
    expect(DOMAIN_RE.test(domain)).toBe(true);
    expect(domain.length).toBeLessThanOrEqual(253);
  });

  it("is a single JSON object (this registry relays one object per subject file)", () => {
    expect(Array.isArray(doc)).toBe(false);
    expect(typeof doc).toBe("object");
  });

  it("passes the JTD schema and the draft's prose rules", () => {
    const r = validateDocument(doc, { legacyCompat: false });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("carries every mandatory member, and neither `version` nor `reporting-period`", () => {
    for (const m of MANDATORY) expect(doc[m], m).toBeTruthy();
    expect(doc.version).toBeUndefined();
    expect((doc as Record<string, unknown>)["reporting-period"]).toBeUndefined();
    expect(doc.capabilities).toBe("basic");
  });

  it("states a period of twelve months on day boundaries: a calendar year, or the exact bounds of a fiscal year", () => {
    // The primary case this gateway serves is annual organizational reporting.
    const period = parsePeriod(doc.period);
    expect(isOnDayBoundaries(period)).toBe(true);
    if (FISCAL_YEAR.has(domain)) {
      expect(isWholeCalendarPeriod(period, "yearly")).toBe(false);
      expect(period.start.slice(5)).toBe(period.end.slice(5));
      expect(Number(period.end.slice(0, 4)) - Number(period.start.slice(0, 4))).toBe(1);
    } else {
      expect(isWholeCalendarPeriod(period, "yearly")).toBe(true);
    }
  });

  it("is served exactly as the file holds it", async () => {
    const s = await loadSubjectFile(join(DATA_DIR, file), SERVED_BASE);
    expect(JSON.parse((await s.publisher.getSerialized({})).body)).toEqual(doc);
  });

  it("classifies its reporting subject", () => {
    expect(doc["target-type"]).toBeTruthy();
  });

  it("carries at least one reported metric or a disclosure link", () => {
    // Draft, Value Constraints and Omitted Metrics: minimum-reporting rule.
    const hasMetric = [
      "energy-consumption",
      "carbon-footprint",
      "scope-1",
      "scope-2",
      "scope-3",
      "sci-score",
      "carbon-intensity-gCO2e-per-kWh",
      "estimated-annual-emissions-kgCO2e",
      "renewable-energy",
    ].some((k) => typeof doc[k] === "number");
    const hasLink = !!doc["disclosure-uri"] || !!doc["verifiable-attestation-uri"];
    expect(hasMetric || hasLink).toBe(true);
  });

  it("gives absolute https URIs in every URI-valued member", () => {
    for (const m of URI_MEMBERS) {
      const v = doc[m];
      if (v === undefined) continue;
      expect(typeof v, m).toBe("string");
      expect(String(v), m).toMatch(/^https:\/\/\S+$/);
    }
  });

  it("keeps to the closed top-level member set (-10)", () => {
    // The object is closed: a publisher MUST NOT add a top-level member of
    // its own. Anything this specification does not define lives in
    // `extensions`, which the next test checks.
    for (const k of Object.keys(doc)) {
      expect(KNOWN_MEMBERS.has(k), `unexpected top-level member ${k}`).toBe(true);
    }
  });

  it("keys any `extensions` entry with an absolute URI and gives it an object value", () => {
    const ext = doc.extensions as Record<string, unknown> | undefined;
    if (ext === undefined) return;
    for (const [key, value] of Object.entries(ext)) {
      expect(key, `extensions key ${key}`).toMatch(EXT_KEY_RE);
      expect(key.includes("#"), `extensions key ${key} carries a fragment`).toBe(false);
      // The two forms this registry uses: an https URI the definer controls, or urn:uuid:.
      if (key.startsWith("urn:")) {
        expect(key, `extensions key ${key}`).toMatch(URN_UUID_RE);
        expect(key).not.toBe("urn:uuid:00000000-0000-0000-0000-000000000000");
        expect(key).not.toBe("urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff");
      } else {
        expect(key, `extensions key ${key}`).toMatch(/^https:\/\//);
      }
      expect(typeof value, `extensions["${key}"]`).toBe("object");
      expect(Array.isArray(value)).toBe(false);
    }
  });

  it("gives every `upstream` entry an absolute https declaration URI", () => {
    const up = doc.upstream as { declaration?: unknown; role?: unknown }[] | undefined;
    if (up === undefined) return;
    expect(up.length).toBeGreaterThan(0);
    for (const e of up) {
      expect(typeof e.declaration).toBe("string");
      expect(String(e.declaration)).toMatch(/^https:\/\/\S+$/);
      if (e.role !== undefined) expect(typeof e.role).toBe("string");
    }
  });

  it("is internally consistent when scopes and a total are both reported", () => {
    const s1 = doc["scope-1"];
    const s2 = doc["scope-2"];
    const s3 = doc["scope-3"];
    const total = doc["carbon-footprint"];
    if ([s1, s2, s3, total].every((v) => typeof v === "number")) {
      const t = total as number;
      const drift = Math.abs((s1 as number) + (s2 as number) + (s3 as number) - t);
      // Publishers round their own totals (Microsoft's FY25 total is stated to
      // the nearest thousand), so allow 0.1% of the total, or half a unit for
      // small figures — but nothing looser. A real transcription slip is orders
      // of magnitude bigger than either.
      expect(drift).toBeLessThanOrEqual(Math.max(0.51, Math.abs(t) * 0.001));
    }
  });

  // ---- honesty rules ----

  if (isSyntheticDomain(domain)) {
    it("is a reserved name and says IN BAND that it is synthetic", () => {
      expect(doc.provider).toContain("SYNTHETIC");
      expect(doc.provider.toLowerCase()).toMatch(/invented|not a real/);
    });
  } else {
    it("declares in band that it is an unendorsed third-party mapping", () => {
      const p = doc.provider.toLowerCase();
      expect(p).toContain("illustrative mapping");
      expect(p).toContain("gateway operator");
      expect(p).toMatch(/not published[^.]*endorsed|not .*endorsed/);
      expect(p).toContain("endorsed by the reporting subject");
    });

    it("points methodology-uri at the reporting subject's OWN public source", () => {
      // A real subject's figures must be traceable to that subject's document,
      // never to something the gateway operator wrote.
      const uri = String(doc["methodology-uri"]);
      expect(uri).toMatch(/^https:\/\//);
      expect(uri).not.toContain("andreibesleaga");
      expect(uri).not.toContain("rfc-sustainability-wellknown");
    });

    it("classifies the subject as an organization, origin or service", () => {
      expect(["organization", "origin", "service"]).toContain(doc["target-type"]);
    });
  }
});

describe("the withheld documents, which are kept for the record and never served", () => {
  const dir = join(DATA_DIR, "withheld");
  const kept = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  it("are 7, and each passes the strict checks of the -10 draft", () => {
    expect(kept).toHaveLength(7);
    for (const f of kept) {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8")) as SustainabilityMetrics;
      const r = validateDocument(doc, { legacyCompat: false });
      expect(r.errors, f).toEqual([]);
      expect(doc.period, f).toBeDefined();
      expect((doc as Record<string, unknown>)["reporting-period"], f).toBeUndefined();
    }
  });
});

it("has a provenance entry in data/README.md for every data file", () => {
  const readme = readFileSync(join(DATA_DIR, "README.md"), "utf8");
  for (const f of files) expect(readme, f).toContain(f);
});

it("never references an unregistered carbon.txt path", () => {
  // The ISE reviewer asked that /carbon.txt and /.well-known/carbon.txt not be
  // advertised anywhere in this deployment.
  for (const f of files) {
    expect(readFileSync(join(DATA_DIR, f), "utf8"), f).not.toContain("carbon.txt");
  }
});
