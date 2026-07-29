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
  validateDocument,
  type SustainabilityMetrics,
} from "sustainability-wellknown-publisher";
import { describe, expect, it } from "vitest";
import { DOMAIN_RE, isSyntheticDomain } from "../src/registry";
import { DATA_DIR } from "./helpers";

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .sort();

const load = (f: string) =>
  JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")) as SustainabilityMetrics;

/** The 8 mandatory members (draft, Mandatory Response Fields). */
const MANDATORY = [
  "version",
  "updated",
  "capabilities",
  "provider",
  "measurement-method",
  "methodology-uri",
  "reporting-period",
  "target",
] as const;

const URI_MEMBERS = ["methodology-uri", "verifiable-attestation-uri", "disclosure-uri"] as const;

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

  it("is a single JSON object (the Basic service never returns an array)", () => {
    expect(Array.isArray(doc)).toBe(false);
    expect(typeof doc).toBe("object");
  });

  it("passes the JTD schema and the draft's prose rules", () => {
    const r = validateDocument(doc);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("carries every mandatory member", () => {
    for (const m of MANDATORY) expect(doc[m], m).toBeTruthy();
    expect(doc.version).toBe("2.0");
    expect(doc.capabilities).toBe("basic");
  });

  it("uses a full calendar year as its reporting period", () => {
    // The primary case this gateway serves is annual organizational reporting.
    expect(doc["reporting-period"]).toMatch(/^\d{4}$/);
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

  it("uses reverse-domain names for any extension member", () => {
    const known = new Set([
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
    ]);
    for (const k of Object.keys(doc)) {
      if (known.has(k)) continue;
      // Undotted names are reserved for the specification itself.
      expect(k, `extension member ${k}`).toContain(".");
      expect(k).toBe(k.toLowerCase());
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
