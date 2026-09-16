import { describe, expect, it } from "vitest";
import {
  assertValid,
  carriesAtLeastOne,
  extensionNameError,
  isExtensionName,
  isHttpsExtensionName,
  isUrnUuidExtensionName,
  RESERVED_EXTENSION_NAMES,
  URN_UUID_RE,
  ABSOLUTE_URI_RE,
  validateDocument,
  ValidationError,
} from "../src/validate";
import { SustainabilityMetrics } from "../src/types";

function metrics(overrides: Partial<SustainabilityMetrics> = {}): SustainabilityMetrics {
  return {
    updated: "2026-01-01T00:00:00Z",
    capabilities: "basic",
    provider: "example.com",
    "measurement-method": "metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2026-01",
    target: "example.com",
    "energy-consumption": 100,
    "energy-unit": "kWh",
    "carbon-footprint": 50,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

describe("validateDocument: single object", () => {
  it("accepts a valid single object", () => {
    const r = validateDocument(metrics());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a document missing a mandatory field (provider)", () => {
    const doc = metrics() as Record<string, unknown>;
    delete doc["provider"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects a document missing the mandatory target member (-03)", () => {
    const doc = metrics() as Record<string, unknown>;
    delete doc["target"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("accepts a sparse object with no metric at all when it carries an evidence link (at-least-one rule)", () => {
    const doc = metrics({ "disclosure-uri": "https://example.com/disclosures" }) as Record<string, unknown>;
    delete doc["energy-consumption"];
    delete doc["energy-unit"];
    delete doc["carbon-footprint"];
    delete doc["carbon-unit"];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an object with no numeric metric and no evidence link (-07 at-least-one MUST)", () => {
    const doc = metrics() as Record<string, unknown>;
    for (const k of ["energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit"]) delete doc[k];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /at least one/i.test(e))).toBe(true);
    // Any single metric satisfies it, as does either evidence link.
    expect(validateDocument({ ...doc, "renewable-energy": 0 }).valid).toBe(true);
    expect(validateDocument({ ...doc, "scope-1": -5 }).valid).toBe(true);
    expect(validateDocument({ ...doc, "disclosure-uri": "https://x.example/d" }).valid).toBe(true);
    expect(validateDocument({ ...doc, "verifiable-attestation-uri": "https://x.example/vc" }).valid).toBe(true);
    // `upstream` is deliberately NOT evidence for this rule.
    expect(validateDocument({ ...doc, upstream: [{ declaration: "https://u.example/d" }] }).valid).toBe(false);
  });

  it("warns about an unrecognized top-level member, ignores it, and keeps the object valid (-07 closed base)", () => {
    // -07 closes the base object — other data belongs under `extensions` — but
    // a consumer MUST ignore a top-level member it does not recognize, since a
    // later revision may define one. So: a warning, never an error, and the
    // member is left in place.
    const doc = metrics({ version: "2.0", "com.example.pue": 1.4 } as Partial<SustainabilityMetrics>);
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.startsWith("unknown-member"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("version"))).toBe(true);
    expect((doc as Record<string, unknown>)["com.example.pue"]).toBe(1.4);
  });

  it("validates the -07 extensions member: absolute-URI keys, object values", () => {
    // Draft -07 §Extensions names two forms: `urn:uuid:` + a lowercase UUID,
    // and an https URI (documentation for a human, never dereferenced).
    const uuid = "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845";
    const https = "https://example.com/sustainability/extensions/water-and-waste";
    for (const good of [uuid, https, "urn:oid:1.3.6.1.4.1.32473.1"]) {
      const ok = validateDocument(
        metrics({ extensions: { [good]: { "water-consumption-m3": 1250 } } } as Partial<SustainabilityMetrics>),
      );
      expect(ok.valid, good).toBe(true);
      expect(ok.warnings, good).toEqual([]);
    }

    for (const bad of [
      "16c36135-e6ae-40f9-a972-015eefc68845", // a bare UUID
      "urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845", // uppercase hex
      "urn:uuid:00000000-0000-0000-0000-000000000000", // Nil
      "urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff", // Max
      "16c36135e6ae40f9a972015eefc68845",
      "com.example.pue", // a reverse-domain name
      "__proto__",
      "extensions/water-and-waste", // a relative reference
      "https://example.com/ext#water", // a fragment
      "https://example.com/e xt", // whitespace
      "https://exämple.com/ext", // non-ASCII
      "https:water-and-waste", // no host
      "https://", // no host
      "tag:", // a scheme and nothing else
      "HTTPS://example.com/ext", // uppercase scheme
      "URN:UUID:16c36135-e6ae-40f9-a972-015eefc68845",
      "Urn:oid:1.3.6.1.4.1.32473.1",
      "",
    ]) {
      const r = validateDocument(metrics({ extensions: { [bad]: {} } } as Partial<SustainabilityMetrics>));
      expect(r.valid, `extensions key "${bad}" must be rejected`).toBe(false);
      expect(r.errors.some((e) => /extensions key/.test(e)), bad).toBe(true);
    }
    // A non-object value fails at the schema gate.
    expect(validateDocument(metrics({ extensions: { [uuid]: 42 } } as unknown as Partial<SustainabilityMetrics>)).valid).toBe(false);
  });

  it("rejects the Nil and Max UUIDs as extensions keys (-07: guaranteed collisions)", () => {
    // Draft -07 §Extensions: "The Nil and Max UUIDs (RFC 9562, Sections 5.9
    // and 5.10) MUST NOT be used, since they are guaranteed collisions."
    for (const forbidden of RESERVED_EXTENSION_NAMES) {
      const r = validateDocument(metrics({ extensions: { [forbidden]: { x: 1 } } } as Partial<SustainabilityMetrics>));
      expect(r.valid, forbidden).toBe(false);
      expect(r.errors.some((e) => /Nil|Max/.test(e)), forbidden).toBe(true);
      // They are well-formed `urn:uuid:` keys, so the rejection is not the text-form one.
      expect(URN_UUID_RE.test(forbidden)).toBe(true);
    }
    expect(RESERVED_EXTENSION_NAMES).toEqual([
      "urn:uuid:00000000-0000-0000-0000-000000000000",
      "urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]);
  });

  it("isExtensionName and the two form checks agree with the draft's rule", () => {
    const uuid = "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845";
    const https = "https://example.com/sustainability/extensions/water-and-waste";
    expect(isExtensionName(uuid)).toBe(true);
    expect(isExtensionName(https)).toBe(true);
    expect(isExtensionName("urn:oid:1.3.6.1.4.1.32473.1")).toBe(true);
    expect(isUrnUuidExtensionName(uuid)).toBe(true);
    expect(isUrnUuidExtensionName(https)).toBe(false);
    expect(isHttpsExtensionName(https)).toBe(true);
    expect(isHttpsExtensionName("https://example.com")).toBe(true);
    expect(isHttpsExtensionName("https://user@example.com:8443/x?q=1")).toBe(true);
    expect(isHttpsExtensionName("https://")).toBe(false);
    expect(isHttpsExtensionName("https:water")).toBe(false);
    expect(isHttpsExtensionName(uuid)).toBe(false);
    // Neither named form, so neither form check claims it, yet the rule permits it.
    expect(isUrnUuidExtensionName("urn:oid:1.3.6.1.4.1.32473.1")).toBe(false);
    expect(isHttpsExtensionName("urn:oid:1.3.6.1.4.1.32473.1")).toBe(false);
  });

  it("gives a precise reason, citing the draft's Extensions section", () => {
    expect(extensionNameError("16c36135-e6ae-40f9-a972-015eefc68845")).toMatch(/is not an absolute URI/);
    expect(extensionNameError("com.example.pue")).toMatch(/draft, Extensions/);
    expect(extensionNameError("urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845")).toMatch(/lowercase/);
    expect(extensionNameError("urn:uuid:00000000-0000-0000-0000-000000000000")).toMatch(/Nil UUID/);
    expect(extensionNameError("urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff")).toMatch(/Max UUID/);
    expect(extensionNameError("https://example.com/ext#water")).toMatch(/fragment/);
    expect(extensionNameError("https://example.com/e xt")).toMatch(/whitespace/);
    expect(extensionNameError("https://exämple.com/ext")).toMatch(/ASCII/);
    expect(extensionNameError("https://")).toMatch(/host/);
    expect(extensionNameError("")).toMatch(/is empty/);
    // Draft §Extensions: "written in ASCII with the scheme in lowercase".
    for (const upper of ["HTTPS://example.com/ext", "URN:UUID:16c36135-e6ae-40f9-a972-015eefc68845", "Urn:oid:1.3.6.1.4.1.32473.1"]) {
      expect(extensionNameError(upper), upper).toMatch(/scheme in lowercase/);
    }
    expect(isExtensionName("HTTPS://example.com/ext")).toBe(false);
    // No RFC line numbers in a message a publisher reads: the section name.
    expect(extensionNameError("com.example.pue")).not.toMatch(/line \d/);
    expect(extensionNameError("urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845")).toBeUndefined();
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
      const r = validateDocument(metrics({ extensions: { [bad]: { a: 1 } } } as Partial<SustainabilityMetrics>));
      expect(r.valid, bad).toBe(false);
    }
    expect(isExtensionName("https://[::1]/x")).toBe(true);
    expect(isHttpsExtensionName("https://[::1]/x")).toBe(true);
    expect(extensionNameError("https://[::1]/x")).toBeUndefined();
    expect(
      validateDocument(metrics({ extensions: { "https://[::1]/x": { a: 1 } } } as Partial<SustainabilityMetrics>)),
    ).toEqual({ valid: true, errors: [], warnings: [] });
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

  it("compares keys octet for octet: nothing is case-folded or normalized", () => {
    const keys = ["https://EXAMPLE.com/Ext", "https://example.com/ext", "https://example.com/ext%20one"];
    const doc = metrics({ extensions: Object.fromEntries(keys.map((k) => [k, { a: 1 }])) } as Partial<SustainabilityMetrics>);
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(Object.keys((doc as Record<string, any>).extensions)).toEqual(keys);
  });

  it("says a body whose top-level value is neither an object nor an array is not a declaration", () => {
    // Draft -07 §Payload Format.
    for (const body of [42, "a string", true, null]) {
      const r = validateDocument(body);
      expect(r.valid, String(body)).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0], String(body)).toContain("is not a declaration");
      expect(r.errors[0], String(body)).toContain("one declaration object or an array of them");
    }
    expect(validateDocument(null).errors[0]).toContain("null");
    expect(validateDocument(42).errors[0]).toContain("JSON number");
  });

  it("validates the -07 upstream member: an https declaration URI per entry, role optional", () => {
    const ok = validateDocument(
      metrics({
        upstream: [{ declaration: "https://cloud.example/tenants/acme.json", role: "cloud" }, { declaration: "https://grid.example/.well-known/sustainability-data" }],
      } as Partial<SustainabilityMetrics>),
    );
    expect(ok.valid).toBe(true);
    expect(ok.warnings).toEqual([]);

    // A missing declaration member, or a wrong-typed one, is a schema failure.
    expect(validateDocument(metrics({ upstream: [{ role: "cloud" }] } as unknown as Partial<SustainabilityMetrics>)).valid).toBe(false);
    expect(validateDocument(metrics({ upstream: [{ declaration: 42 }] } as unknown as Partial<SustainabilityMetrics>)).valid).toBe(false);

    // A non-https declaration is a WARNING (the member is kept), exactly like
    // the other URI members — the rule bites at dereference time.
    const warned = validateDocument(
      metrics({ upstream: [{ declaration: "http://cloud.example/d" }] } as Partial<SustainabilityMetrics>),
    );
    expect(warned.valid).toBe(true);
    expect(warned.warnings.some((w) => w.startsWith("upstream[0].declaration"))).toBe(true);
  });

  // Draft -07 §Upstream Declarations: "The `upstream` member is an array of at
  // least one object ... A publisher with nothing to name omits the member
  // rather than carrying an empty array", and §Formal Definition (JTD) lists
  // the at-least-one-entry rule among those "which the CDDL captures and the
  // JTD cannot ... validating implementations enforce them". The publisher side
  // refuses to emit one; this is the consumer half of the same rule.
  it("rejects an empty upstream array (the draft requires at least one entry)", () => {
    const r = validateDocument(metrics({ upstream: [] } as Partial<SustainabilityMetrics>));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("upstream is present but empty");
    // The member is still optional: omitting it entirely is the conformant way
    // to say there is nothing to name.
    expect(validateDocument(metrics()).valid).toBe(true);
  });

  // JSON has no literal for NaN or Infinity, but `1e999` is a legal JSON
  // number that parses to Infinity in every JavaScript runtime — the hazard
  // the media type registration names ("numbers outside the range exactly
  // representable in IEEE 754 double precision"). Such a member carries no
  // actual value and re-serializes as `null`, so it cannot pass a strict gate
  // and cannot satisfy the at-least-one rule on its own.
  it("rejects a numeric member that is not a finite number (1e999 off the wire)", () => {
    const doc = JSON.parse(
      '{"updated":"2026-01-01T00:00:00Z","capabilities":"basic","provider":"p",' +
        '"measurement-method":"m","methodology-uri":"https://example.com/m",' +
        '"reporting-period":"2026-01","target":"example.com","carbon-footprint":1e999}',
    );
    expect(doc["carbon-footprint"]).toBe(Infinity);
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("carbon-footprint is Infinity");
    // …and it is not a metric for the at-least-one rule either: with nothing
    // else to report, the object reports nothing.
    expect(carriesAtLeastOne(doc)).toBe(false);
    expect(r.errors.join(" ")).toContain("at least one of them");
    // The rule reaches the scopes too, which MAY legitimately be negative but
    // may not be infinite.
    expect(validateDocument(metrics({ "scope-1": -Infinity })).valid).toBe(false);
  });

  it("accepts every recognized target-type value (-04 enum)", () => {
    for (const tt of ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"]) {
      const r = validateDocument(metrics({ "target-type": tt } as Partial<SustainabilityMetrics>));
      expect(r.valid, `target-type "${tt}" should validate`).toBe(true);
    }
  });

  it("rejects an unrecognized target-type value at the schema gate (the enum is deliberately closed)", () => {
    // The TOLERANCE for such a value lives in fetchSustainability's pre-pass
    // (strip + record), NOT in a weakened schema: validated as-is, it fails.
    const r = validateDocument(metrics({ "target-type": "warehouse" } as unknown as Partial<SustainabilityMetrics>));
    expect(r.valid).toBe(false);
  });

  // Draft cross-field MUST that JTD/CDDL cannot express: sci-score ⇒ functional-unit.
  it("rejects sci-score present without functional-unit (cross-field MUST)", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2 }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((m) => /sci-score.*functional-unit/i.test(m))).toBe(true);
  });

  it("accepts sci-score when functional-unit is also present", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2, "functional-unit": "request" }));
    expect(r.valid).toBe(true);
  });
});

describe("validateDocument: array (trend) rules", () => {
  it("accepts a valid ascending, non-overlapping, uniform-precision, uniform-target array", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", target: "/api" }),
      metrics({ "reporting-period": "2026-02", target: "/api" }),
      metrics({ "reporting-period": "2026-03", target: "/api" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an unsorted (non-ascending) array", () => {
    const doc = [
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(true);
  });

  it("rejects an overlapping-period array (duplicate reporting-period is non-ascending, i.e. not strictly increasing)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(true);
  });

  it("rejects a mixed-precision array (one entry 'YYYY', another 'YYYY-MM')", () => {
    const doc = [
      metrics({ "reporting-period": "2026" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /precision/i.test(e))).toBe(true);
  });

  it("rejects a mixed-target array (entries MUST share the same target value)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", target: "/api/a" }),
      metrics({ "reporting-period": "2026-02", target: "/api/b" }),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /target/i.test(e))).toBe(true);
  });

  it("accepts an array whose entries share one target-type value (-04 uniformity rule)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "path", target: "/api" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02", "target-type": "path", target: "/api" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects an array with MIXED target-type values ('when present, the same target-type value')", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "origin" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02", "target-type": "service" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /target-type/i.test(e))).toBe(true);
  });

  it("rejects an array where only SOME entries carry target-type (-04 all-or-none rule)", () => {
    // Final -04 wording: "target-type MUST be either present in every entry
    // with the same value or absent from every entry" — mixed PRESENCE is a
    // violation even when the values that are present agree.
    const doc = [
      metrics({ "reporting-period": "2026-01", "target-type": "origin" } as Partial<SustainabilityMetrics>),
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-03", "target-type": "origin" } as Partial<SustainabilityMetrics>),
    ];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /target-type.*(presence|every)/i.test(e))).toBe(true);
  });

  it("accepts an array where NO entry carries target-type (all-absent side of all-or-none)", () => {
    const doc = [
      metrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-02" }),
    ];
    expect(validateDocument(doc).valid).toBe(true);
  });

  it("does not run cross-entry array checks when a per-entry schema error already exists (avoids noisy cascades)", () => {
    const badEntry = metrics() as Record<string, unknown>;
    delete badEntry["provider"];
    const doc = [metrics({ "reporting-period": "2026-02" }), badEntry, metrics({ "reporting-period": "2026-01" })];
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    // Should report the per-entry schema failure, not also pile on ordering errors
    // (per src/validate.ts: array rules are only checked `if (... errors.length === 0)`).
    expect(r.errors.some((e) => /ascending/i.test(e))).toBe(false);
  });
});

describe("assertValid / ValidationError", () => {
  it("returns the document unchanged when valid", () => {
    const doc = metrics();
    expect(assertValid(doc)).toBe(doc);
  });

  it("throws a ValidationError whose message includes the failure reasons", () => {
    const doc = [
      metrics({ "reporting-period": "2026-02" }),
      metrics({ "reporting-period": "2026-01" }),
    ];
    expect(() => assertValid(doc)).toThrow(ValidationError);
    try {
      assertValid(doc);
      expect.fail("expected assertValid to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.errors.length).toBeGreaterThan(0);
      expect(err.errors.some((m) => /ascending/i.test(m))).toBe(true);
      // The thrown Error's own message must surface the same reasons, not just a generic label.
      expect(err.message).toContain("failed validation");
      for (const reason of err.errors) {
        expect(err.message).toContain(reason);
      }
    }
  });
});

describe("final-audit fixes: legacy sci-score sentinel + empty array", () => {
  it("accepts a legacy sci-score sentinel (-1) without functional-unit (compat rule)", () => {
    const r = validateDocument(metrics({ "sci-score": -1 } as any));
    expect(r.valid).toBe(true);
  });

  it("still rejects a reported sci-score without functional-unit", () => {
    const r = validateDocument(metrics({ "sci-score": 1.2 } as any));
    expect(r.valid).toBe(false);
  });

  it("rejects an empty array (conveys no report)", () => {
    const r = validateDocument([]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /empty array/i.test(e))).toBe(true);
  });
});

describe("-06: URI members restricted to https — WARNINGS, never errors", () => {
  // The `valid` boolean is a contract: the gateway calls validateDocument() at
  // boot and throws when it is false. A non-https URI member must therefore
  // never reach `errors`, no matter how many of them a document carries.
  it("warns about an absolute non-https methodology-uri while staying valid", () => {
    const r = validateDocument(metrics({ "methodology-uri": "http://example.com/methodology" }));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("methodology-uri");
    expect(r.warnings[0]).toContain("https");
  });

  it("warns about disclosure-uri and verifiable-attestation-uri too", () => {
    const r = validateDocument(
      metrics({
        "disclosure-uri": "http://example.com/disclosures",
        "verifiable-attestation-uri": "ftp://example.com/vc",
      } as Partial<SustainabilityMetrics>),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes("disclosure-uri"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("verifiable-attestation-uri"))).toBe(true);
  });

  it("keeps URI members out of the warning list when they are https", () => {
    const r = validateDocument(
      metrics({
        "disclosure-uri": "https://example.com/disclosures",
        "verifiable-attestation-uri": "https://example.com/vc",
      } as Partial<SustainabilityMetrics>),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("says nothing about a value that is not an absolute URI at all", () => {
    // Out of scope for this check: no base to resolve against, and the
    // absolute-URI requirement is a separate rule.
    const r = validateDocument(metrics({ "methodology-uri": "/methodology" }));
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("prefixes array-entry warnings with the entry index, like errors", () => {
    const r = validateDocument([
      metrics({ "reporting-period": "2026-01" }),
      metrics({ "reporting-period": "2026-02", "methodology-uri": "http://example.com/m" }),
    ]);
    expect(r.valid).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^\[1\]/);
  });

  it("still reports warnings for a document that ALSO has errors, without conflating them", () => {
    const doc = metrics({ "methodology-uri": "http://example.com/m" }) as Record<string, unknown>;
    delete doc["provider"]; // a real error, unrelated to the URI scheme
    const r = validateDocument(doc);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.every((e) => !e.includes("methodology-uri"))).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });
});
